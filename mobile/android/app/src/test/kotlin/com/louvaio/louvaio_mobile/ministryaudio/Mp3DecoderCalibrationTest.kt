package com.louvaio.louvaio_mobile.ministryaudio

import java.io.ByteArrayInputStream
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * JVM tests of the calibration POLICY with a fake platform decoder that emits ideal impulses. What the real decoder does
 * with the four bundled fixtures is covered on the device.
 */
class Mp3DecoderCalibrationTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val assets = mutableListOf<String>()

    /** The "MP3" is just the asset name, so the fake knows which fixture it is decoding. */
    private fun open(name: String) = ByteArrayInputStream(name.toByteArray()).also { assets.add(name.substringAfterLast('/')) }

    private class Fake(
        var shiftRightChannel: Int = 0,
        var nameFor: (String) -> String = { "c2.fake" },
        var fail: String? = null,
    ) : Mp3PcmDecoder {
        var calls = 0

        override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
            calls++
            if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "x")
            fail?.let { throw MinistryAudioException(it, "x") }
            val asset = file.readText()
            val rate = if (asset.contains("44100")) 44_100 else 48_000
            val bursts = if (rate == 44_100) intArrayOf(3000, 22_050, 41_100) else intArrayOf(3000, 24_000, 45_000)
            val padding = if (rate == 44_100) 875 else 431
            val pcm = ByteArray(rate * 4)
            for (c in bursts) {
                for ((channel, frame) in listOf(0 to c, 1 to c + shiftRightChannel)) {
                    val o = frame * 4 + channel * 2
                    pcm[o] = 0xFF.toByte()
                    pcm[o + 1] = 0x7F
                }
            }
            onInfo(Mp3StreamInfo(rate, 2, true, 576, padding + 529, nameFor(asset)))
            sink.write(pcm, 0, pcm.size)
        }
    }

    private fun calibration(d: Mp3PcmDecoder) = Mp3DecoderCalibration(d, tmp.newFolder(), ::open)

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: MinistryAudioException) {
            return e.code
        }
        throw AssertionError("expected MinistryAudioException")
    }

    @Test
    fun `all four profile and rate combinations are verified once and the decoder name is returned`() {
        val d = Fake()
        val c = calibration(d)
        assertEquals("c2.fake", c.requireVerified { false })
        assertEquals("c2.fake", c.requireVerified { false })
        assertEquals(4, d.calls)
        assertEquals(
            listOf("impulse_lame_44100.mp3", "impulse_lavc_44100.mp3", "impulse_lame_48000.mp3", "impulse_lavc_48000.mp3"),
            assets,
        )
    }

    @Test
    fun `a shifted right channel is refused and the refusal is cached`() {
        val d = Fake(shiftRightChannel = 10)
        val c = calibration(d)
        assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, code { c.requireVerified { false } })
        d.shiftRightChannel = 0
        assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, code { c.requireVerified { false } })
        assertEquals(1, d.calls)
    }

    @Test
    fun `fixtures decoded by different codecs are refused`() {
        val d = Fake(nameFor = { if (it.contains("48000")) "c2.b" else "c2.a" })
        assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, code { calibration(d).requireVerified { false } })
    }

    @Test
    fun `cancellation and environmental failures are reported but never cached`() {
        val d = Fake()
        val c = calibration(d)
        assertEquals(MinistryAudioException.CANCELLED, code { c.requireVerified { true } })
        d.fail = MinistryAudioException.MP3_DECODE_FAILED
        assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, code { c.requireVerified { false } })
        d.fail = null
        assertEquals("c2.fake", c.requireVerified { false })
    }
}
