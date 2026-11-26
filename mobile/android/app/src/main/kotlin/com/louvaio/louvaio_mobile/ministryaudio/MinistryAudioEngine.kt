package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioManager
import com.louvaio.louvaio_mobile.vocal.AudioFocusController
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import com.louvaio.louvaio_mobile.vocal.NoisyAudioMonitor
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

enum class EngineState { IDLE, LOADING, READY, PLAYING, BUFFERING, PAUSED, COMPLETED, ERROR, DISPOSED }

fun interface MinistryAudioListener {
    /** Called for every state change, in order. `errorCode` only for ERROR. */
    fun onStateChanged(state: EngineState, errorCode: String?)
}

/** Single stereo PCM16 output (one device track for the whole mix). */
interface StereoTrackHandle {
    fun play()
    fun pause()

    /** Blocking write of interleaved shorts; returns shorts written or < 0. */
    fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int

    /** Like [write], but takes only what fits right now (0 when the device buffer is full). */
    fun writeNonBlocking(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
        write(data, offsetInShorts, sizeInShorts)
    fun stop()
    fun flush()
    fun release()
    fun headPositionFrames(): Long
}

interface StereoTrackFactory {
    fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle
}

/**
 * Only one audio owner may play at a time. Claiming preempts the previous
 * owner (its callback stops it). The OS audio focus gives the same exclusion
 * with the vocal exercises without touching their code; this arbiter makes it
 * explicit and testable, and lets the future Flutter integration (C2) register
 * the vocal player too.
 */
class AudioOutputArbiter {
    interface Claim {
        fun release()
    }

    private class Entry(
        val owner: String,
        val onPreempted: () -> Unit,
        val arbiter: AudioOutputArbiter,
    ) : Claim {
        override fun release() = arbiter.releaseClaim(this)
    }

    private val lock = Any()
    private var current: Entry? = null

    val activeOwner: String? get() = synchronized(lock) { current?.owner }

    fun claim(owner: String, onPreempted: () -> Unit): Claim {
        val entry = Entry(owner, onPreempted, this)
        val previous = synchronized(lock) {
            val p = current
            current = entry
            p
        }
        previous?.onPreempted?.invoke() // outside the arbiter lock
        return entry
    }

    private fun releaseClaim(entry: Entry) {
        synchronized(lock) { if (current === entry) current = null }
    }

    companion object {
        val shared = AudioOutputArbiter()
    }
}

/**
 * Synchronized six-stem WAV engine for Android: ONE output track, ONE
 * frame-based timeline, incremental reads, a dedicated render thread.
 *
 * Isolated from the vocal exercises and not connected to any UI or channel.
 * It does not authorize anything: the future integration must pass only files
 * already revalidated by the ministry cache (and keep that cache's lease until
 * [stop]/[dispose]/ERROR). [MinistryAudioPaths] still refuses paths outside the
 * allowed private root.
 *
 * Threading: every command is serialized by one lock; only the render thread
 * touches the output track while playing, and it is also the one that releases
 * it, so there is never a write after release. `dispose()`/`stop()` are
 * idempotent and join the render thread.
 */
class MinistryAudioEngine internal constructor(
    private val trackFactory: StereoTrackFactory,
    private val focus: AudioFocusController? = null,
    private val noisy: NoisyAudioMonitor? = null,
    private val arbiter: AudioOutputArbiter = AudioOutputArbiter.shared,
    private val dispatcher: CallbackDispatcher = CallbackDispatcher { it() },
    private val listener: MinistryAudioListener? = null,
    private val chunkFrames: Int = MixerCore.DEFAULT_CHUNK_FRAMES,
    private val tailStallTimeoutMs: Long = DEFAULT_TAIL_STALL_MS,
    private val sourceFactory: (File) -> StemSource = { FileStemSource.open(it) },
    private val joinMs: Long = JOIN_MS,
    private val starvationTimeoutMs: Long = STARVATION_TIMEOUT_MS,
) {
    private class Session(val gen: Long, val core: MixerCore) {
        /** Counted down only when the render thread has fully finished. */
        val done = java.util.concurrent.CountDownLatch(1)

        /** Core whose files must be closed once the worker is really gone. */
        var closeOnExit: MixerCore? = null
        @Volatile var track: StereoTrackHandle? = null
        @Volatile var thread: Thread? = null
        @Volatile var stopRequested = false
        @Volatile var claim: AudioOutputArbiter.Claim? = null
        @Volatile var base = 0L
        @Volatile var headBase = 0L
        @Volatile var writtenFrames = 0L
        @Volatile var resumeOnGain = false
        /** Guarded by the engine lock: the end was reached while playing; a pause can no longer apply. */
        var finishing = false
        val finished = AtomicBoolean(false)
    }

    private val lock = ReentrantLock()
    private val cond = lock.newCondition()

    @Volatile
    var state: EngineState = EngineState.IDLE
        private set

    @Volatile
    var lastErrorCode: String? = null
        private set

    private var core: MixerCore? = null
    private var header: WavHeader? = null
    private var session: Session? = null
    private var sessionSeq = 0L
    private var disposing: Session? = null
    private val closeLock = Any()

    /** Present only for streaming playback; kept until its producers are confirmed gone. */
    @Volatile
    private var feed: StreamingFeed? = null

    @Volatile
    private var pendingSeek = -1L

    /** Counts pauses (guarded by [lock]): lets the render thread notice one it did not wait through. */
    private var pauseEpoch = 0L

    val sampleRate: Int get() = header?.sampleRate ?: 0
    val durationFrames: Long get() = header?.frames ?: 0L

    /** Bytes of per-stem working buffers (independent of file length). */
    val workingSetBytes: Long get() = lock.withLock { core?.workingSetBytes ?: 0L }

    /** Current position in frames (never ahead of what was actually played). */
    val positionFrames: Long
        get() = lock.withLock {
            val c = core ?: return@withLock 0L
            val pending = pendingSeek
            if (pending >= 0) return@withLock pending
            val s = session
            val t = s?.track
            if (s == null || t == null) return@withLock c.positionFrames
            val played = (t.headPositionFrames() - s.headBase).coerceIn(0L, s.writtenFrames)
            (s.base + played).coerceAtMost(c.totalFrames)
        }

    // ------------------------------------------------------------------ load

    /**
     * Validates and opens the six stems of [directory] (must live under
     * [allowedRoot]). Optional expectations come from the verified manifest.
     * Call from a background thread: it does header reads only (44 bytes per
     * stem), never full-file reads.
     */
    @Throws(MinistryAudioException::class)
    fun load(
        directory: File,
        allowedRoot: File,
        expectedSampleRate: Int? = null,
        expectedFrames: Long? = null,
    ): WavHeader = lock.withLock {
        when (state) {
            EngineState.DISPOSED, EngineState.PLAYING, EngineState.BUFFERING, EngineState.PAUSED -> invalidState()
            else -> Unit
        }
        // A worker that has not been confirmed gone may still use the files.
        if (session != null) invalidState()
        closeCoreLocked()
        setStateLocked(EngineState.LOADING)
        val opened = ArrayList<StemSource>()
        try {
            val files = MinistryAudioPaths.resolve(directory, allowedRoot)
            var first: WavHeader? = null
            for (id in StemId.values()) {
                val src = sourceFactory(files.getValue(id))
                opened.add(src)
                val h = WavV1.parse(src)
                if (first == null) {
                    first = h
                } else {
                    if (h.sampleRate != first.sampleRate) {
                        throw MinistryAudioException(
                            MinistryAudioException.RATE_MISMATCH,
                            "Taxas de amostragem divergentes entre as faixas.",
                        )
                    }
                    if (h.frames != first.frames) {
                        throw MinistryAudioException(
                            MinistryAudioException.FRAMES_MISMATCH,
                            "Número de frames divergente entre as faixas.",
                        )
                    }
                }
            }
            val h = first!!
            if ((expectedSampleRate != null && expectedSampleRate != h.sampleRate) ||
                (expectedFrames != null && expectedFrames != h.frames)
            ) {
                throw MinistryAudioException(
                    MinistryAudioException.FRAMES_MISMATCH,
                    "O áudio não corresponde ao manifesto esperado.",
                )
            }
            core = MixerCore(opened, h.sampleRate, h.frames, chunkFrames)
            header = h
            setStateLocked(EngineState.READY)
            h
        } catch (e: MinistryAudioException) {
            opened.forEach { runCatching { it.close() } }
            setStateLocked(EngineState.ERROR, e.code)
            throw e
        } catch (e: Throwable) {
            opened.forEach { runCatching { it.close() } }
            setStateLocked(EngineState.ERROR, MinistryAudioException.READ_FAILED)
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Falha ao abrir o áudio.")
        }
    }

    /**
     * Streaming variant of [load]: the six stems are still being decoded by [source]. Only on an engine that never loaded
     * anything. The engine owns the feed from here on: [dispose] returns true only once its producers are gone.
     */
    @Throws(MinistryAudioException::class)
    fun loadStreaming(source: StreamingFeed): Unit = lock.withLock {
        if (state != EngineState.IDLE) invalidState()
        feed = source
        core = MixerCore(source.sources, source.sampleRate, source.totalFrames, chunkFrames)
        header = WavHeader(source.sampleRate, source.totalFrames)
        setStateLocked(EngineState.READY)
    }

    // -------------------------------------------------------------- controls

    fun setTrackGain(stem: StemId, gain: Float) = requireCore().setGain(stem.ordinal, gain)
    fun setTrackMuted(stem: StemId, muted: Boolean) = requireCore().setMuted(stem.ordinal, muted)
    fun setTrackSolo(stem: StemId, solo: Boolean) = requireCore().setSolo(stem.ordinal, solo)
    fun setMasterVolume(volume: Float) = requireCore().setMaster(volume)

    private fun requireCore(): MixerCore = lock.withLock {
        if (state == EngineState.DISPOSED) invalidState()
        core ?: invalidState()
    }

    // ------------------------------------------------------------- transport

    @Throws(MinistryAudioException::class)
    fun play() {
        lock.withLock {
            when (state) {
                EngineState.PAUSED -> resumeLocked()
                EngineState.READY, EngineState.COMPLETED -> startLocked()
                else -> invalidState()
            }
        }
    }

    @Throws(MinistryAudioException::class)
    fun pause() {
        lock.withLock {
            if (!isRunningLocked() || session?.finishing == true) invalidState()
            session?.resumeOnGain = false
            pauseLocked()
        }
    }

    @Throws(MinistryAudioException::class)
    fun resume() {
        lock.withLock {
            if (state != EngineState.PAUSED) invalidState()
            resumeLocked()
        }
    }

    /**
     * Stops playback, releases the output and returns to READY at frame 0.
     *
     * Returns true only when the render thread has REALLY finished (no more
     * file or AudioTrack use). On false the worker is still running: the engine
     * goes to ERROR([MinistryAudioException.SHUTDOWN_PENDING]), keeps its files
     * open (nobody may release the cache lease) and a later [stop]/[dispose]
     * re-checks.
     */
    fun stop(): Boolean {
        val s: Session?
        var wasDisposed = false
        lock.withLock {
            wasDisposed = state == EngineState.DISPOSED
            s = session
            if (!wasDisposed && s != null) requestStopLocked(s)
        }
        // Never wait for the worker while holding the lock it needs to exit.
        if (wasDisposed) return disposeConfirmed()
        if (s != null && !endSession(s)) {
            lock.withLock {
                if (state != EngineState.DISPOSED) {
                    setStateLocked(EngineState.ERROR, MinistryAudioException.SHUTDOWN_PENDING)
                }
            }
            return false
        }
        // A stopped session must not keep six codecs open (the next start repositions the producers).
        if (feed?.suspendProducers() == false) {
            lock.withLock {
                if (state != EngineState.DISPOSED) setStateLocked(EngineState.ERROR, MinistryAudioException.SHUTDOWN_PENDING)
            }
            return false
        }
        lock.withLock {
            if (state == EngineState.DISPOSED) return true
            if (state == EngineState.ERROR && lastErrorCode == MinistryAudioException.SHUTDOWN_PENDING) {
                closeCoreLocked() // worker finally gone: files can be closed now
                lastErrorCode = null
                setStateLocked(EngineState.ERROR, MinistryAudioException.OUTPUT_FAILED)
                return true
            }
            core?.let {
                it.seek(0)
                if (isRunningLocked() || state == EngineState.PAUSED || state == EngineState.COMPLETED) {
                    setStateLocked(EngineState.READY)
                }
            }
            pendingSeek = -1L
        }
        return true
    }

    @Throws(MinistryAudioException::class)
    fun seekToFrame(frame: Long) {
        lock.withLock {
            val c = core
            when (state) {
                EngineState.READY, EngineState.PLAYING, EngineState.BUFFERING, EngineState.PAUSED, EngineState.COMPLETED ->
                    if (c == null) invalidState()
                else -> invalidState()
            }
            val target = frame.coerceIn(0L, c.totalFrames)
            if (session != null) {
                pendingSeek = target
                cond.signalAll()
            } else {
                c.seek(target)
                if (state == EngineState.COMPLETED) setStateLocked(EngineState.READY)
            }
        }
    }

    /**
     * Idempotent. Releases the track, the files and the render thread.
     * Returns true only once the worker is confirmed gone AND the files are
     * closed; on false, the files are closed by the worker itself when it
     * ends, and calling [dispose] again re-checks.
     */
    fun dispose(): Boolean {
        val s: Session?
        lock.withLock {
            if (state != EngineState.DISPOSED) {
                val closing = core
                core = null
                header = null
                pendingSeek = -1L
                val cur = session
                if (cur != null) {
                    requestStopLocked(cur)
                    feed?.abort()
                    synchronized(closeLock) { cur.closeOnExit = closing }
                    disposing = cur
                } else {
                    feed?.abort()
                    closing?.close()
                }
                setStateLocked(EngineState.DISPOSED)
            }
            s = disposing
        }
        if (s != null && !awaitDisposed(s)) return false
        return releaseFeed()
    }

    private fun disposeConfirmed(): Boolean {
        val s = lock.withLock { disposing }
        if (s != null && !awaitDisposed(s)) return false
        return releaseFeed()
    }

    /** Never under [lock]. True once no producer (codec, open file) is left. */
    private fun releaseFeed(): Boolean {
        val f = feed ?: return true
        if (!f.close()) return false
        feed = null
        return true
    }

    private fun awaitDisposed(s: Session): Boolean {
        val ok = endSession(s)
        if (ok) {
            drainDeferredClose(s)
            lock.withLock { if (disposing === s) disposing = null }
        }
        return ok
    }

    private fun drainDeferredClose(s: Session) {
        synchronized(closeLock) {
            val c = s.closeOnExit
            s.closeOnExit = null
            c?.close()
        }
    }

    // --------------------------------------------------------------- session

    private fun startLocked() {
        val c = core ?: invalidState()
        if (state == EngineState.COMPLETED || c.positionFrames >= c.totalFrames) c.seek(0)
        val rate = c.sampleRate
        val s = Session(++sessionSeq, c)
        var track: StereoTrackHandle? = null
        try {
            s.claim = arbiter.claim(OWNER) { onPreempted(s.gen) }
            val granted = focus?.requestFocus { change -> onFocusChange(s.gen, change) } ?: true
            if (!granted) {
                throw MinistryAudioException(MinistryAudioException.FOCUS_DENIED, "Foco de áudio negado.")
            }
            track = try {
                trackFactory.create(rate, chunkFrames * OUTPUT_BUFFER_CHUNKS)
            } catch (e: Throwable) {
                throw MinistryAudioException(MinistryAudioException.OUTPUT_FAILED, "Saída de áudio indisponível.")
            }
            s.track = track
            s.base = c.positionFrames
            s.headBase = track.headPositionFrames()
            noisy?.register { onNoisy(s.gen) }
            // Streaming: the output starts only once all six stems have data (decided by the render thread).
            val streaming = feed != null
            if (!streaming) track.play()
            val thread = Thread({ renderLoop(s) }, THREAD_NAME).apply { isDaemon = true }
            s.thread = thread
            session = s
            pendingSeek = -1L
            setStateLocked(if (streaming) EngineState.BUFFERING else EngineState.PLAYING)
            thread.start()
        } catch (e: Throwable) {
            session = null
            finishSession(s)
            track?.let { releaseTrack(it) }
            s.track = null
            throw if (e is MinistryAudioException) e else
                MinistryAudioException(MinistryAudioException.OUTPUT_FAILED, "Falha ao iniciar a reprodução.")
        }
    }

    private fun pauseLocked() {
        val s = session ?: invalidState()
        if (s.finishing) return // focus or noisy after the end was reached
        pauseEpoch++
        runCatching { s.track?.pause() }
        setStateLocked(EngineState.PAUSED)
    }

    private fun resumeLocked() {
        val s = session ?: invalidState()
        if (feed == null) {
            // With a seek pending, the queued audio is of the old position: drop it (also releasing a write that may still
            // be waiting on the paused track) and let the render thread restart the output after applying the seek.
            if (pendingSeek >= 0) runCatching { s.track?.flush() } else runCatching { s.track?.play() }
            setStateLocked(EngineState.PLAYING)
        } else {
            // Streaming: only the render thread restarts the output, after applying a pending seek (so no audio of the
            // old position is heard) and finding the six rings refilled.
            setStateLocked(EngineState.BUFFERING)
        }
        cond.signalAll()
    }

    /** Must hold [lock]. Unblocks a render thread stuck in a blocking write. */
    private fun requestStopLocked(s: Session) {
        s.stopRequested = true
        pendingSeek = -1L
        s.track?.let {
            runCatching { it.pause() }
            runCatching { it.flush() }
        }
        cond.signalAll()
    }

    /**
     * Waits (never under [lock]) for the render thread to REALLY finish.
     * Returns false when it is still running after the timeout: the session
     * then stays registered so no caller can mistake it for closed.
     */
    private fun endSession(s: Session): Boolean {
        val confirmed = when {
            s.thread == null -> true
            s.thread === Thread.currentThread() -> false
            else -> try {
                s.done.await(joinMs, java.util.concurrent.TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                false
            }
        }
        // Focus / receiver / arbiter claim are released even on timeout: the
        // output is already paused and flushed, and a stuck claim would block
        // the other audio owner forever. Files/lease are NOT (see return).
        finishSession(s)
        if (confirmed) lock.withLock { if (session === s) session = null }
        return confirmed
    }

    /** Focus / noisy receiver / arbiter claim; runs once per session. */
    private fun finishSession(s: Session) {
        if (!s.finished.compareAndSet(false, true)) return
        runCatching { focus?.abandonFocus() }
        runCatching { noisy?.unregister() }
        runCatching { s.claim?.release() }
    }

    private fun releaseTrack(t: StereoTrackHandle) {
        runCatching { t.pause() }
        runCatching { t.flush() }
        runCatching { t.stop() }
        runCatching { t.release() }
    }

    // ---------------------------------------------------------- render thread

    private fun renderLoop(s: Session) {
        try {
            renderLoopBody(s)
        } finally {
            // Last thing the worker does: from here on it touches nothing.
            s.done.countDown()
            drainDeferredClose(s)
        }
    }

    private fun renderLoopBody(s: Session) {
        val c = s.core
        val track = s.track ?: return
        val buf = ShortArray(chunkFrames * 2)
        var off = 0
        var len = 0
        var ended = false
        var lastHead = -1L
        var lastChange = System.nanoTime()
        var error: MinistryAudioException? = null
        var completed = false
        val stream = feed
        var starvedSince = 0L
        var seenPause = 0L
        // A device track resumed with only a partial buffer queued may not consume it until it is fed again.
        val silence = ShortArray(chunkFrames * 2)
        var padFrames = 0
        try {
            while (true) {
                lock.withLock {
                    while (!s.stopRequested && state == EngineState.PAUSED && stream?.failure() == null) {
                        // A producer may fail while paused: that has to end the session, not wait for a resume.
                        if (stream == null) cond.await() else cond.await(PAUSED_POLL_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
                    }
                    if (s.stopRequested) return@withLock
                    if (pauseEpoch != seenPause) {
                        // Even a pause that came and went between two iterations:
                        seenPause = pauseEpoch
                        starvedSince = 0L // time paused is not starvation
                        lastChange = System.nanoTime() // nor a stalled tail
                        padFrames = 0
                    }
                    if (state != EngineState.BUFFERING) starvedSince = 0L
                    val seek = pendingSeek
                    if (seek >= 0) {
                        pendingSeek = -1L
                        runCatching { track.pause() }
                        runCatching { track.flush() }
                        c.seek(seek)
                        s.base = seek
                        s.writtenFrames = 0L
                        s.headBase = track.headPositionFrames()
                        off = 0
                        len = 0
                        ended = false
                        starvedSince = 0L
                        if (stream == null) {
                            if (state == EngineState.PLAYING) runCatching { track.play() }
                        } else if (state == EngineState.PLAYING) {
                            setStateLocked(EngineState.BUFFERING)
                        }
                    }
                }
                if (s.stopRequested) break
                if (stream != null) {
                    stream.failure()?.let { throw it }
                    val buffering = state == EngineState.BUFFERING
                    if (!ended && (off >= len || buffering)) {
                        val position = c.positionFrames
                        // No-op unless a seek or a stop moved the timeline. Also at the very end: the producers of the
                        // new position are the ones whose EOS has to be verified.
                        stream.position(position)
                        // Re-buffering waits for a comfortable amount on ALL stems, so they stop and resume together.
                        if (!stream.isReady(position, if (buffering) maxOf(chunkFrames, c.sampleRate) else chunkFrames)) {
                            lock.withLock {
                                if (state == EngineState.PLAYING) {
                                    runCatching { track.pause() } // queued audio is kept, nothing is flushed or padded
                                    setStateLocked(EngineState.BUFFERING)
                                }
                            }
                            if (starvedSince == 0L) starvedSince = System.nanoTime()
                            if (System.nanoTime() - starvedSince > starvationTimeoutMs * 1_000_000L) {
                                stream.failure()?.let { throw it }
                                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificação sem progresso.")
                            }
                            Thread.sleep(BUFFER_POLL_MS)
                            continue
                        }
                        starvedSince = 0L
                    }
                    // Everything needed is buffered (or only the tail is left in the track): the output (re)starts.
                    lock.withLock {
                        // BUFFERING set after the readiness check above (a resume) waits for the next iteration, which
                        // applies the refill threshold. An output that cannot start ends the session.
                        if (state == EngineState.BUFFERING && (buffering || ended) && pendingSeek < 0 && !s.stopRequested) {
                            track.play()
                            setStateLocked(EngineState.PLAYING)
                        }
                    }
                }

                if (ended) {
                    val played = track.headPositionFrames() - s.headBase
                    val now = System.nanoTime()
                    if (played >= s.writtenFrames) {
                        // Streaming: the end is only real once all six decoders reached EOS with the exact length.
                        if (stream != null && !stream.verified()) {
                            stream.failure()?.let { throw it }
                            if (now - lastChange > starvationTimeoutMs * 1_000_000L) {
                                throw MinistryAudioException(MinistryAudioException.MP3_LENGTH_MISMATCH, "Fim do áudio não confirmado.")
                            }
                            Thread.sleep(TAIL_POLL_MS)
                            continue
                        }
                        // Decided atomically against pause and seek. A pause that won stays PAUSED and finishes on resume.
                        if (tryFinish(s, seenPause)) {
                            completed = true
                            break
                        }
                        Thread.sleep(TAIL_POLL_MS)
                        continue
                    }
                    if (played != lastHead) {
                        lastHead = played
                        lastChange = now
                    } else if (now - lastChange > tailStallTimeoutMs * 1_000_000L && stream?.verified() != false) {
                        // A head frozen by a pause that arrived during this iteration is not a stall.
                        if (tryFinish(s, seenPause)) {
                            completed = true // device stalled at the tail: do not hang
                            break
                        }
                    }
                    // Feeds silence behind the tail after a pause, up to one second; it is not part of the timeline
                    // (not counted in writtenFrames) and is flushed on release or by a seek.
                    if (seenPause > 0L && state == EngineState.PLAYING && padFrames < c.sampleRate) {
                        // Never blocking: a stalled output must still reach the stall check above. The content is already
                        // queued, so a failed write only ends the feeding.
                        val w = track.writeNonBlocking(silence, 0, silence.size)
                        padFrames = if (w < 0) c.sampleRate else padFrames + w / 2
                    }
                    Thread.sleep(TAIL_POLL_MS)
                    continue
                }

                // Streaming: nothing is rendered (and so dropped from the rings) unless the output is playing.
                if (stream != null && state != EngineState.PLAYING) continue

                if (off >= len) {
                    val n = c.render(buf, chunkFrames)
                    stream?.consumed(c.positionFrames)
                    if (n == 0) {
                        ended = true
                        lastHead = -1L
                        lastChange = System.nanoTime()
                        continue
                    }
                    len = n * 2
                    off = 0
                }
                val w = track.write(buf, off, len - off)
                if (w < 0) {
                    throw MinistryAudioException(MinistryAudioException.OUTPUT_FAILED, "Falha na saída de áudio.")
                }
                if (w == 0) {
                    Thread.sleep(ZERO_WRITE_BACKOFF_MS)
                    continue
                }
                off += w
                s.writtenFrames += (w / 2).toLong()
            }
        } catch (e: MinistryAudioException) {
            error = stream?.failure() ?: e
        } catch (_: InterruptedException) {
            // treated as a stop request
        } catch (e: Throwable) {
            error = MinistryAudioException(MinistryAudioException.OUTPUT_FAILED, "Falha na reprodução.")
        } finally {
            // Hide the track from readers (position) under the lock BEFORE
            // releasing it; only this thread ever writes, so never after release.
            lock.withLock { s.track = null }
            releaseTrack(track)
            if (!s.stopRequested) {
                finishSession(s)
                // Producers (codecs, open files) must be gone before ERROR is published; never waited for under the lock.
                val released = error == null || stream == null || stream.close()
                lock.withLock {
                    if (session === s && state != EngineState.DISPOSED) {
                        session = null
                        when {
                            error != null -> {
                                // Files are closed BEFORE ERROR is published, so a
                                // caller releasing its cache lease on ERROR never
                                // races with open handles.
                                core?.close()
                                core = null
                                header = null
                                setStateLocked(EngineState.ERROR, if (released) error.code else MinistryAudioException.SHUTDOWN_PENDING)
                            }
                            completed -> {
                                val late = pendingSeek
                                if (late >= 0) {
                                    // Accepted after the loop had decided to finish: keep it, ready to play from there.
                                    pendingSeek = -1L
                                    c.seek(late)
                                    setStateLocked(EngineState.READY)
                                } else {
                                    c.seek(c.totalFrames)
                                    setStateLocked(EngineState.COMPLETED)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun tryFinish(s: Session, seenPause: Long): Boolean = lock.withLock {
        // A seek queued since the head was read wins over completion: the loop applies it on its next turn.
        val ok = state == EngineState.PLAYING && pauseEpoch == seenPause && pendingSeek < 0
        if (ok) s.finishing = true
        ok
    }

    // -------------------------------------------------------------- callbacks

    private fun onFocusChange(gen: Long, change: Int) {
        lock.withLock {
            val s = session
            if (s == null || s.gen != gen || s.stopRequested) return
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    s.resumeOnGain = false
                    if (isRunningLocked()) pauseLocked()
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    if (isRunningLocked()) {
                        s.resumeOnGain = true
                        pauseLocked()
                    }
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> s.core.setDuck(DUCK_LEVEL)
                AudioManager.AUDIOFOCUS_GAIN -> {
                    s.core.setDuck(1f)
                    if (s.resumeOnGain && state == EngineState.PAUSED) {
                        s.resumeOnGain = false
                        resumeLocked()
                    }
                }
            }
        }
    }

    private fun onNoisy(gen: Long) {
        lock.withLock {
            val s = session
            if (s == null || s.gen != gen || s.stopRequested) return
            s.resumeOnGain = false
            if (isRunningLocked()) pauseLocked()
        }
    }

    private fun onPreempted(gen: Long) {
        val current = lock.withLock { session?.takeIf { it.gen == gen } }
        if (current != null) stop() // false => ERROR(SHUTDOWN_PENDING), re-checked later
    }

    // ----------------------------------------------------------------- state

    /** Playing, or about to as soon as the stems have data. */
    private fun isRunningLocked() = state == EngineState.PLAYING || state == EngineState.BUFFERING

    private fun setStateLocked(next: EngineState, errorCode: String? = null) {
        state = next
        lastErrorCode = errorCode
        val l = listener ?: return
        dispatcher.post { l.onStateChanged(next, errorCode) }
    }

    private fun closeCoreLocked() {
        core?.close()
        core = null
        header = null
        pendingSeek = -1L
    }

    private fun invalidState(): Nothing =
        throw MinistryAudioException(MinistryAudioException.INVALID_STATE, "Operação inválida no estado atual.")

    companion object {
        const val THREAD_NAME = "ministry-audio-render"
        const val DEFAULT_TAIL_STALL_MS = 1500L
        private const val OWNER = "ministry-audio"
        private const val JOIN_MS = 2000L
        private const val STARVATION_TIMEOUT_MS = 20_000L
        private const val BUFFER_POLL_MS = 5L
        private const val PAUSED_POLL_MS = 100L
        private const val OUTPUT_BUFFER_CHUNKS = 8
        private const val TAIL_POLL_MS = 5L
        private const val ZERO_WRITE_BACKOFF_MS = 2L
        private const val DUCK_LEVEL = 0.25f
    }
}
