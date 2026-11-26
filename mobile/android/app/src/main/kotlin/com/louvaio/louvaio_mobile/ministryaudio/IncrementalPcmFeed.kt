package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Raw MP3 decoding from an arbitrary MPEG frame: platform gapless trimming OFF, so output sample n of a window opened at
 * audio frame k is raw sample k*1152+n of the stream. Same stop/release rules as [Mp3PcmDecoder.decode].
 */
interface Mp3WindowDecoder {
    @Throws(MinistryAudioException::class)
    fun decodeFrom(
        file: File,
        byteOffset: Long,
        /** Must see every compressed frame handed to the codec, and [Mp3InputCheck.end] when the input is over. */
        input: Mp3InputCheck,
        onInfo: (Mp3StreamInfo) -> Unit,
        sink: PcmSink,
        cancelled: () -> Boolean,
    )
}

/** What [MinistryAudioEngine] needs from a source that is still being produced while it plays. */
interface StreamingFeed {
    val sources: List<StemSource>
    val sampleRate: Int
    val totalFrames: Long

    /** Makes the producers serve [frame] onwards. No-op when they already do. Never call while holding the engine lock. */
    @Throws(MinistryAudioException::class)
    fun position(frame: Long)

    /** True when ALL stems hold [frames] frames (clamped to the end) from [fromFrame]. */
    fun isReady(fromFrame: Long, frames: Int): Boolean

    /** Everything before [frame] was consumed, for every stem, audible or not. */
    fun consumed(frame: Long)

    /** First real failure of any producer. A failed feed never serves again. */
    fun failure(): MinistryAudioException?

    /** True once every producer reached the end of its stream with exactly the expected number of samples. */
    fun verified(): Boolean

    /** Stops the producers and releases their codecs. False while one of them is still alive. */
    fun suspendProducers(): Boolean

    /** Asks every producer to stop without waiting. */
    fun abort()

    /** [abort] and wait. False while a producer (and so a codec and a file) is still alive: call again. */
    fun close(): Boolean
}

class IncrementalStem(val file: File, val index: Mp3StreamIndex)

/**
 * M22-S4.2: six producers, one per stem, each decoding from its validated MPEG frame index into a bounded [PcmRing].
 * No temporary PCM. A seek stops all six, waits for their codecs to be released and only then starts the next
 * generation, so a result of an older seek can never reach the mixer and no more than six codecs ever exist.
 *
 * Integrity is progressive and ends at EOS. The codec INPUT is checked frame by frame against the validated index. The
 * OUTPUT can only be counted: a producer fails as soon as it delivers MORE samples than its window allows, and at the end
 * of the stream the count must be exact. A codec that loses or repeats PCM internally is therefore only detected after
 * part of the audio was already played; any failure stops the whole set.
 */
class IncrementalPcmFeed(
    private val stems: List<IncrementalStem>,
    override val sampleRate: Int,
    override val totalFrames: Long,
    private val alignment: Mp3Alignment,
    private val decoder: Mp3WindowDecoder,
    /** When set, a producer running on any other codec fails (it was not calibrated). */
    private val expectedDecoder: String?,
    ringFrames: Int = sampleRate * RING_SECONDS,
    private val joinMs: Long = JOIN_MS,
) : StreamingFeed {
    init {
        require(stems.size == MixerCore.STEM_COUNT)
    }

    private val rings = List(stems.size) { PcmRing(ringFrames) }
    override val sources: List<StemSource> get() = rings

    val ringBytesTotal: Long get() = rings.sumOf { it.capacityBytes.toLong() }

    private val control = Any()
    private val firstFailure = AtomicReference<MinistryAudioException?>()
    private val finished = AtomicInteger()
    private val opened = AtomicInteger()
    private var producers: List<Thread> = emptyList()

    @Volatile
    private var closed = false

    @Volatile
    private var running = false

    @Volatile
    private var generation = 0

    @Volatile
    private var generationStartNanos = 0L

    /** Milliseconds from the start of the current generation until the sixth codec reported its format; -1 before. */
    @Volatile
    var codecOpenMillis = -1L
        private set

    @Throws(MinistryAudioException::class)
    override fun position(frame: Long) {
        synchronized(control) {
            if (closed || firstFailure.get() != null) return
            val target = frame.coerceIn(0L, totalFrames)
            if (running && rings.all { !it.isAborted && it.startFrame == target }) return
            if (!stopLocked()) {
                throw MinistryAudioException(MinistryAudioException.SHUTDOWN_PENDING, "O áudio ainda está encerrando.")
            }
            // A producer may have failed while it was being joined: a failed feed never opens new codecs.
            if (firstFailure.get() != null) return
            startLocked(target)
        }
    }

    private fun startLocked(from: Long) {
        val gen = ++generation
        finished.set(0)
        opened.set(0)
        codecOpenMillis = -1L
        generationStartNanos = System.nanoTime()
        rings.forEach { it.reset(from) }
        // close() raises the flag before aborting the rings: re-checking after the reset leaves no window.
        if (closed || firstFailure.get() != null) {
            rings.forEach { it.abort() }
            return
        }
        running = true
        val started = ArrayList<Thread>(stems.size)
        producers = started
        try {
            stems.indices.forEach { i ->
                val t = Thread({ produce(i, from, gen) }, "$THREAD_PREFIX-$i").apply { isDaemon = true }
                t.start()
                started.add(t)
            }
        } catch (e: Throwable) {
            fail(MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Falha ao iniciar a decodificação."))
        }
    }

    private fun produce(i: Int, from: Long, gen: Int) {
        val stop = { closed || gen != generation || firstFailure.get() != null }
        try {
            if (stop()) return
            val stem = stems[i]
            val raw = from + Mp3StemDecoder.tagDelay(alignment)
            val startFrame = maxOf(0, (raw / SAMPLES).toInt() - PREROLL_FRAMES)
            val expectedBytes = (alignment.mpegAudioFrames - startFrame).toLong() * SAMPLES * WavV1.BYTES_PER_FRAME
            val keep = (totalFrames - from) * WavV1.BYTES_PER_FRAME
            val trimmer = PcmTrimmer((raw - startFrame.toLong() * SAMPLES) * WavV1.BYTES_PER_FRAME, keep) { b, o, l ->
                rings[i].write(b, o, l)
            }
            var delivered = 0L
            var detached = false // the ring was aborted: the audio is dropped, the count goes on
            // Window 0 starts at the file start so the Info frame is handled as in the linear decode.
            val offset = if (startFrame == 0) 0L else stem.index.offsets[startFrame].toLong()
            decoder.decodeFrom(
                stem.file,
                offset,
                input = stem.index.inputCheck(startFrame),
                onInfo = { info ->
                    if (info.sampleRate != sampleRate || info.channels != 2 || info.platformGapless) {
                        throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Formato MP3 diverge do manifesto.")
                    }
                    if (expectedDecoder != null && info.decoderName != expectedDecoder) {
                        throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Decodificador não calibrado.")
                    }
                    if (opened.incrementAndGet() == stems.size && gen == generation) {
                        codecOpenMillis = (System.nanoTime() - generationStartNanos) / 1_000_000
                    }
                },
                sink = { b, o, l ->
                    delivered += l
                    // Proven wrong whatever happens next: latched at once, so a concurrent seek cannot discard it.
                    if (delivered > expectedBytes) throw lengthMismatch().also(::fail)
                    if (!detached) {
                        // An abort during the LAST buffer must not hide a short stream: the decoder still reaches EOS
                        // and the count below is still checked. Otherwise it stops at its next cancellation check.
                        try {
                            trimmer.write(b, o, l)
                        } catch (e: MinistryAudioException) {
                            if (e.code != MinistryAudioException.CANCELLED) throw e
                            detached = true
                        }
                    }
                },
                cancelled = stop,
            )
            if (delivered != expectedBytes || (!detached && trimmer.keptBytes != keep)) throw lengthMismatch()
            if (!detached) finished.incrementAndGet()
        } catch (e: MinistryAudioException) {
            // A stop request surfaces as CANCELLED: a consequence, never the cause. A refused input frame or a wrong
            // length at EOS is a fact about the audio, kept even if a stop or a seek arrived in the meantime.
            if (e.code in FACTS || (!stop() && e.code != MinistryAudioException.CANCELLED)) fail(e)
        } catch (e: Throwable) {
            if (!stop()) fail(MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Falha ao decodificar o MP3."))
        }
    }

    private fun lengthMismatch() = MinistryAudioException(
        MinistryAudioException.MP3_LENGTH_MISMATCH,
        "Duração decodificada diverge do manifesto.",
    )

    private fun fail(error: MinistryAudioException) {
        if (firstFailure.compareAndSet(null, error)) rings.forEach { it.abort() }
    }

    override fun isReady(fromFrame: Long, frames: Int): Boolean {
        if (firstFailure.get() != null) return false
        val need = minOf(frames.toLong(), totalFrames - fromFrame).coerceAtLeast(0L)
        return rings.all { !it.isAborted && it.availableFrames(fromFrame) >= need && it.startFrame <= fromFrame }
    }

    override fun consumed(frame: Long) = rings.forEach { it.discardBefore(frame) }

    override fun failure(): MinistryAudioException? = firstFailure.get()

    override fun verified(): Boolean = firstFailure.get() == null && finished.get() == stems.size

    /** Producer threads still alive (diagnostics and tests). */
    val aliveProducers: Int get() = synchronized(control) { producers.count { it.isAlive } }

    override fun suspendProducers(): Boolean = synchronized(control) { stopLocked() }

    override fun abort() {
        closed = true
        rings.forEach { it.abort() }
    }

    override fun close(): Boolean {
        abort()
        return synchronized(control) { stopLocked() }
    }

    /** Waits (bounded) for every producer of the current generation. Keeps the list while one is alive. */
    private fun stopLocked(): Boolean {
        generation++
        running = false
        rings.forEach { it.abort() }
        val deadline = System.nanoTime() + joinMs * 1_000_000L
        var interrupted = false
        for (t in producers) {
            while (t.isAlive && t !== Thread.currentThread()) {
                val left = (deadline - System.nanoTime()) / 1_000_000L
                if (left <= 0) break
                try {
                    t.join(left)
                } catch (_: InterruptedException) {
                    interrupted = true
                }
            }
        }
        if (interrupted) Thread.currentThread().interrupt()
        val alive = producers.filter { it.isAlive }
        producers = alive
        return alive.isEmpty()
    }

    companion object {
        const val THREAD_PREFIX = "ministry-audio-stream"

        /** Measured on the TB-J616F: 2 already reproduced the linear decode; 10 is kept as margin. */
        const val PREROLL_FRAMES = 10
        const val RING_SECONDS = 3
        private const val SAMPLES = Mp3Alignment.SAMPLES_PER_FRAME
        private const val JOIN_MS = 3_000L
        private val FACTS = setOf(MinistryAudioException.MP3_INVALID, MinistryAudioException.MP3_LENGTH_MISMATCH)
    }
}
