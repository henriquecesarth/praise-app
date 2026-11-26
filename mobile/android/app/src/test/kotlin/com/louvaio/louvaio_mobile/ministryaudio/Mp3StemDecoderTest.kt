package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * JVM tests of the trimming/length policy with a fake platform decoder that reproduces the two behaviours MEASURED on
 * the Lenovo TB-J616F (Android 12): platform-gapless (Lavc tag: exact `frames` delivered) and non-gapless (LAME 3.100:
 * `mpegFrames * 1152` delivered, the tag delay still in front). Real decoder behaviour is covered by the
 * instrumented tests; these tests never claim it.
 */
class Mp3StemDecoderTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val rate = 44_100
    private val frames = 3000L
    private val delay = 1105 // tag 576 + 529
    private val mpeg = 4 // (1105 + 3000 + padding) / 1152 -> padding 503
    private val alignment = Mp3Alignment(delay, 503, mpeg)

    /** Frame n carries value n (mod 32749) in L and -n in R, so any shift is visible. */
    private fun pcm(from: Long, count: Long): ByteArray {
        val out = ByteArray((count * 4).toInt())
        for (i in 0 until count) {
            val v = ((from + i) % 32_749).toInt()
            val o = (i * 4).toInt()
            out[o] = v.toByte(); out[o + 1] = (v shr 8).toByte()
            val n = -v
            out[o + 2] = n.toByte(); out[o + 3] = (n shr 8).toByte()
        }
        return out
    }

    private class Fake(
        val info: Mp3StreamInfo,
        val bytes: ByteArray,
        val chunk: Int = 4608,
        val failAfterBytes: Long = -1,
        val onChunk: () -> Unit = {},
    ) : Mp3PcmDecoder {
        override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
            onInfo(info)
            var o = 0
            while (o < bytes.size) {
                if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "x")
                if (failAfterBytes in 0..o.toLong()) throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "x")
                val n = minOf(chunk, bytes.size - o)
                sink.write(bytes, o, n)
                onChunk()
                o += n
            }
        }
    }

    private val gaplessInfo = Mp3StreamInfo(rate, 2, true, delay - 529, 503 + 529)
    private val plainInfo = Mp3StreamInfo(rate, 2, false, null, null)

    private fun run(decoder: Mp3PcmDecoder, a: Mp3Alignment = alignment, cancelled: () -> Boolean = { false }): File {
        val dest = File(tmp.root, "stem_vocals.wav.part")
        Mp3StemDecoder.decodeToWav(File(tmp.root, "in.mp3"), dest, rate, frames, a, decoder, cancelled = cancelled)
        return dest
    }

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: MinistryAudioException) {
            return e.code
        }
        throw AssertionError("expected MinistryAudioException")
    }

    @Test
    fun `platform gapless output is kept as is and becomes a canonical WAV`() {
        val out = run(Fake(gaplessInfo, pcm(0, frames)))
        val b = out.readBytes()
        assertEquals(44 + frames * 4, b.size.toLong())
        assertArrayEquals(WavHeader(rate, frames).toBytes(), b.copyOfRange(0, 44))
        assertArrayEquals(pcm(0, frames), b.copyOfRange(44, b.size))
        // the engine's own parser accepts it
        assertEquals(frames, WavV1.parse(MemorySource(b)).frames)
    }

    @Test
    fun `non gapless output drops exactly the tag delay and the padding, never invents silence`() {
        val total = mpeg * 1152L // 4608 frames delivered, the first 576 are the tag delay
        val out = run(Fake(plainInfo, pcm(0, total)))
        val b = out.readBytes()
        assertEquals(44 + frames * 4, b.size.toLong())
        assertArrayEquals(pcm(576, frames), b.copyOfRange(44, b.size))
    }

    @Test
    fun `chunks of any size give the same result`() {
        val ref = run(Fake(plainInfo, pcm(0, mpeg * 1152L))).readBytes()
        for (chunk in listOf(4, 36, 1000, 4608, 99_999)) {
            assertArrayEquals("chunk $chunk", ref, run(Fake(plainInfo, pcm(0, mpeg * 1152L), chunk = chunk)).readBytes())
        }
    }

    @Test
    fun `platform gapless that still delivers the padding is refused`() {
        assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, code { run(Fake(gaplessInfo, pcm(0, mpeg * 1152L))) })
        assertFalse(File(tmp.root, "stem_vocals.wav.part").exists())
    }

    @Test
    fun `short output is refused and is never padded with silence`() {
        assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, code { run(Fake(gaplessInfo, pcm(0, frames - 1))) })
        assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, code { run(Fake(plainInfo, pcm(0, 576 + frames - 1))) })
        assertFalse(File(tmp.root, "stem_vocals.wav.part").exists())
    }

    @Test
    fun `non gapless output longer than the MPEG frames is refused`() {
        assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, code { run(Fake(plainInfo, pcm(0, mpeg * 1152L + 1))) })
    }

    @Test
    fun `a platform that trims without saying so is refused instead of being trimmed twice`() {
        // delay already removed, padding still there: long enough to satisfy a mere range check
        assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, code { run(Fake(plainInfo, pcm(576, mpeg * 1152L - 576))) })
    }

    @Test
    fun `a stem decoded by a codec other than the calibrated one is refused`() {
        val dest = File(tmp.root, "stem_vocals.wav.part")
        val other = Fake(gaplessInfo.copy(decoderName = "c2.other"), pcm(0, frames))
        assertEquals(
            MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED,
            code { Mp3StemDecoder.decodeToWav(File(tmp.root, "in.mp3"), dest, rate, frames, alignment, other, "c2.calibrated") { false } },
        )
        assertFalse(dest.exists())
    }

    @Test
    fun `platform metadata that disagrees with the manifest is not trusted`() {
        val wrongDelay = Mp3StreamInfo(rate, 2, true, 575, 503 + 529)
        val wrongPadding = Mp3StreamInfo(rate, 2, true, 576, 100)
        val partial = Mp3StreamInfo(rate, 2, true, 576, null)
        for (i in listOf(wrongDelay, wrongPadding, partial)) {
            assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, code { run(Fake(i, pcm(0, frames))) })
        }
    }

    @Test
    fun `wrong rate, channels or inconsistent alignment are unsupported`() {
        assertEquals(MinistryAudioException.MP3_UNSUPPORTED, code { run(Fake(gaplessInfo.copy(sampleRate = 48_000), pcm(0, frames))) })
        assertEquals(MinistryAudioException.MP3_UNSUPPORTED, code { run(Fake(gaplessInfo.copy(channels = 1), pcm(0, frames))) })
        assertEquals(MinistryAudioException.MP3_UNSUPPORTED, code { run(Fake(plainInfo, pcm(0, frames)), a = alignment.copy(paddingFrames = 7)) })
        assertEquals(MinistryAudioException.MP3_UNSUPPORTED, code { run(Fake(plainInfo, pcm(0, frames)), a = Mp3Alignment(100, 4608 - 3100, 4)) }) // delay < 529
    }

    @Test
    fun `cancellation stops decoding promptly and leaves no file`() {
        var chunks = 0
        val dec = Fake(plainInfo, pcm(0, mpeg * 1152L), chunk = 400, onChunk = { chunks++ })
        assertEquals(MinistryAudioException.CANCELLED, code { run(dec, cancelled = { chunks >= 2 }) })
        assertTrue(chunks <= 3)
        assertFalse(File(tmp.root, "stem_vocals.wav.part").exists())
    }

    @Test
    fun `decoder failure in the middle deletes the partial file`() {
        assertEquals(MinistryAudioException.MP3_DECODE_FAILED, code { run(Fake(plainInfo, pcm(0, mpeg * 1152L), failAfterBytes = 8000)) })
        assertFalse(File(tmp.root, "stem_vocals.wav.part").exists())
    }

    @Test
    fun `silent stream without any PCM is a decode failure`() {
        assertEquals(MinistryAudioException.MP3_DECODE_FAILED, code { run(object : Mp3PcmDecoder {
            override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) = Unit
        }) })
    }

    @Test
    fun `48 kHz and the real encoder alignments are consistent`() {
        // measured fixtures: 1 s at 44.1 kHz (padding 875, 40 frames) and 48 kHz (padding 431, 43 frames), delay 1105
        assertTrue(Mp3Alignment(1105, 875, 40).isConsistent(44_100))
        assertTrue(Mp3Alignment(1105, 431, 43).isConsistent(48_000))
        assertFalse(Mp3Alignment(1105, 874, 40).isConsistent(44_100))
        assertEquals(576, Mp3StemDecoder.tagDelay(Mp3Alignment(1105, 875, 40)))
    }
}
