package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioManager
import com.louvaio.louvaio_mobile.vocal.AudioFocusController
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import com.louvaio.louvaio_mobile.vocal.NoisyAudioMonitor
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

enum class EngineState { IDLE, LOADING, READY, PLAYING, PAUSED, COMPLETED, ERROR, DISPOSED }

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
) {
    private class Session(val gen: Long, val core: MixerCore) {
        @Volatile var track: StereoTrackHandle? = null
        @Volatile var thread: Thread? = null
        @Volatile var stopRequested = false
        @Volatile var claim: AudioOutputArbiter.Claim? = null
        @Volatile var base = 0L
        @Volatile var headBase = 0L
        @Volatile var writtenFrames = 0L
        @Volatile var resumeOnGain = false
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

    @Volatile
    private var pendingSeek = -1L

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
            EngineState.DISPOSED, EngineState.PLAYING, EngineState.PAUSED -> invalidState()
            else -> Unit
        }
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
            if (state != EngineState.PLAYING) invalidState()
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

    /** Stops playback, releases the output and returns to READY at frame 0. */
    fun stop() {
        val s: Session?
        lock.withLock {
            if (state == EngineState.DISPOSED) return
            s = session
            if (s != null) requestStopLocked(s)
        }
        if (s != null) endSession(s)
        lock.withLock {
            if (state == EngineState.DISPOSED) return
            core?.let {
                it.seek(0)
                if (state == EngineState.PLAYING || state == EngineState.PAUSED ||
                    state == EngineState.COMPLETED
                ) {
                    setStateLocked(EngineState.READY)
                }
            }
            pendingSeek = -1L
        }
    }

    @Throws(MinistryAudioException::class)
    fun seekToFrame(frame: Long) {
        lock.withLock {
            val c = core
            when (state) {
                EngineState.READY, EngineState.PLAYING, EngineState.PAUSED, EngineState.COMPLETED ->
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

    /** Idempotent. Releases the track, the files and the render thread. */
    fun dispose() {
        val s: Session?
        val closing: MixerCore?
        lock.withLock {
            if (state == EngineState.DISPOSED) return
            s = session
            closing = core
            core = null
            header = null
            pendingSeek = -1L
            if (s != null) requestStopLocked(s)
            setStateLocked(EngineState.DISPOSED)
        }
        if (s != null) endSession(s)
        closing?.close()
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
            track.play()
            val thread = Thread({ renderLoop(s) }, THREAD_NAME).apply { isDaemon = true }
            s.thread = thread
            session = s
            pendingSeek = -1L
            setStateLocked(EngineState.PLAYING)
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
        runCatching { s.track?.pause() }
        setStateLocked(EngineState.PAUSED)
    }

    private fun resumeLocked() {
        val s = session ?: invalidState()
        runCatching { s.track?.play() }
        setStateLocked(EngineState.PLAYING)
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

    /** Joins the render thread (never under [lock]) and frees session state. */
    private fun endSession(s: Session) {
        val t = s.thread
        if (t != null && t !== Thread.currentThread()) {
            try {
                t.join(JOIN_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
        lock.withLock { if (session === s) session = null }
        finishSession(s)
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
        try {
            while (true) {
                lock.withLock {
                    while (!s.stopRequested && state == EngineState.PAUSED) cond.await()
                    if (s.stopRequested) return@withLock
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
                        if (state == EngineState.PLAYING) runCatching { track.play() }
                    }
                }
                if (s.stopRequested) break

                if (ended) {
                    val played = track.headPositionFrames() - s.headBase
                    val now = System.nanoTime()
                    if (played >= s.writtenFrames) {
                        completed = true
                        break
                    }
                    if (played != lastHead) {
                        lastHead = played
                        lastChange = now
                    } else if (now - lastChange > tailStallTimeoutMs * 1_000_000L) {
                        completed = true // device stalled at the tail: do not hang
                        break
                    }
                    Thread.sleep(TAIL_POLL_MS)
                    continue
                }

                if (off >= len) {
                    val n = c.render(buf, chunkFrames)
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
            error = e
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
                                setStateLocked(EngineState.ERROR, error.code)
                            }
                            completed -> {
                                c.seek(c.totalFrames)
                                setStateLocked(EngineState.COMPLETED)
                            }
                        }
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------- callbacks

    private fun onFocusChange(gen: Long, change: Int) {
        lock.withLock {
            val s = session
            if (s == null || s.gen != gen || s.stopRequested) return
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    s.resumeOnGain = false
                    if (state == EngineState.PLAYING) pauseLocked()
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    if (state == EngineState.PLAYING) {
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
            if (state == EngineState.PLAYING) pauseLocked()
        }
    }

    private fun onPreempted(gen: Long) {
        val current = lock.withLock { session?.takeIf { it.gen == gen } }
        if (current != null) stop()
    }

    // ----------------------------------------------------------------- state

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
        private const val OUTPUT_BUFFER_CHUNKS = 8
        private const val TAIL_POLL_MS = 5L
        private const val ZERO_WRITE_BACKOFF_MS = 2L
        private const val DUCK_LEVEL = 0.25f
    }
}
