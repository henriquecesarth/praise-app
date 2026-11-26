package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Synthetic "MP3" stream for the incremental path: raw PCM is a pure function of (stem, raw frame), so any window can be
 * produced from the frame it starts at and every output sample is checkable.
 */
class FakeStream(val mpeg: Int = 300, val rate: Int = 44_100) {
    val alignment = Mp3Alignment(1105, 875, mpeg)
    val frames: Long = mpeg * 1152L - 1105 - 875
    private val tagDelay = Mp3StemDecoder.tagDelay(alignment)

    fun sample(stem: Int, rawFrame: Long): Int = ((rawFrame * (7 + stem) + stem * 997) % 4001).toInt() - 2000

    /** Audio frame k is addressed by byte offset k+1 (offset 0 = file start, as in the real stream). */
    fun stems(): List<IncrementalStem> = (0 until 6).map { i ->
        IncrementalStem(File("fake_$i.mp3"), Mp3StreamIndex(IntArray(mpeg) { it + 1 }, "LAME3.100", 1))
    }

    private fun pcm(stem: Int, rawFrom: Long, count: Int): ByteArray {
        val out = ByteArray(count * 4)
        for (f in 0 until count) {
            val v = sample(stem, rawFrom + f)
            out[f * 4] = v.toByte()
            out[f * 4 + 1] = (v shr 8).toByte()
            out[f * 4 + 2] = (-v).toByte()
            out[f * 4 + 3] = (-v shr 8).toByte()
        }
        return out
    }

    /** The trimmed timeline of a stem, as the full decode would produce it. */
    fun trimmed(stem: Int): ByteArray = pcm(stem, tagDelay.toLong(), frames.toInt())

    /** What the mixer must deliver playing from [from] to the end. */
    fun reference(from: Long = 0): ShortArray {
        val sources = (0 until 6).map { MemorySource(WavHeader(rate, frames).toBytes() + trimmed(it)) }
        val core = MixerCore(sources, rate, frames)
        core.seek(from)
        val out = ShortArray(((frames - from) * 2).toInt())
        val block = ShortArray(core.chunkFrames * 2)
        var at = 0
        while (true) {
            val n = core.render(block, core.chunkFrames)
            if (n == 0) break
            System.arraycopy(block, 0, out, at, n * 2)
            at += n * 2
        }
        return out
    }

    inner class Decoder : Mp3WindowDecoder {
        val alive = AtomicInteger()
        val peakAlive = AtomicInteger()
        val starts = CopyOnWriteArrayList<Pair<Int, Int>>()

        /** Stem -> (raw frame at which it blocks until released). */
        val stalls = ConcurrentHashMap<Int, Pair<Long, CountDownLatch>>()

        /** Stem -> raw frames added to (or removed from) the end of its stream. */
        val lengthError = ConcurrentHashMap<Int, Int>()

        /** Stem -> (raw frame at which it throws). */
        val failures = ConcurrentHashMap<Int, Pair<Long, MinistryAudioException>>()

        /** Stem whose codec "cannot be created". */
        @Volatile var unavailable = -1

        @Volatile var name = "fake.decoder"

        /** Ignores cancellation while this latch is closed: a wedged codec. */
        @Volatile var wedged: CountDownLatch? = null

        fun stall(stem: Int, atRawFrame: Long): CountDownLatch =
            CountDownLatch(1).also { stalls[stem] = atRawFrame to it }

        override fun decodeFrom(
            file: File,
            byteOffset: Long,
            onInfo: (Mp3StreamInfo) -> Unit,
            sink: PcmSink,
            cancelled: () -> Boolean,
        ) {
            val stem = file.name.removePrefix("fake_").removeSuffix(".mp3").toInt()
            if (stem == unavailable) throw Mp3CodecUnavailableException()
            peakAlive.accumulateAndGet(alive.incrementAndGet(), ::maxOf)
            try {
                val startFrame = if (byteOffset == 0L) 0 else (byteOffset - 1).toInt()
                starts.add(stem to startFrame)
                onInfo(Mp3StreamInfo(rate, 2, false, null, null, name))
                var at = startFrame * 1152L
                val end = mpeg * 1152L + (lengthError[stem] ?: 0)
                while (at < end) {
                    wedged?.await(30, TimeUnit.SECONDS)
                    if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "cancelled")
                    stalls[stem]?.let { (from, latch) ->
                        while (at >= from && !latch.await(2, TimeUnit.MILLISECONDS)) {
                            if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "cancelled")
                        }
                    }
                    failures[stem]?.let { (from, error) -> if (at >= from) throw error }
                    val n = minOf(1000L, end - at).toInt()
                    val chunk = pcm(stem, at, n)
                    sink.write(chunk, 0, chunk.size)
                    at += n
                }
            } finally {
                alive.decrementAndGet()
            }
        }
    }

    fun feed(decoder: Mp3WindowDecoder, joinMs: Long = 2_000, expected: String? = "fake.decoder") =
        IncrementalPcmFeed(stems(), rate, frames, alignment, decoder, expected, joinMs = joinMs)
}

fun streamThreadsAlive(): Int = Thread.getAllStackTraces().keys.count {
    it.isAlive && it.name.startsWith(IncrementalPcmFeed.THREAD_PREFIX)
}
