package com.louvaio.louvaio_mobile.ministryaudio

import org.junit.Assert.assertEquals
import org.junit.Test

class WavV1Test {
    private fun parse(bytes: ByteArray, partial: Int = Int.MAX_VALUE) =
        WavV1.parse(MemorySource(bytes, partial))

    @Test
    fun `valid header is parsed even with partial reads`() {
        val h = parse(Wav.build(8000, 10) { 0 }, partial = 3)
        assertEquals(8000, h.sampleRate)
        assertEquals(10L, h.frames)
        assertEquals(44L + 40L, h.sizeBytes)
    }

    @Test
    fun `invalid magic and MP3 are rejected`() {
        val bad = Wav.build(8000, 4) { 0 }.also { it[0] = 'X'.code.toByte() }
        assertCode(MinistryAudioException.WAV_INVALID_HEADER) { parse(bad) }
        val mp3 = ByteArray(200).also {
            it[0] = 'I'.code.toByte(); it[1] = 'D'.code.toByte(); it[2] = '3'.code.toByte()
        }
        assertCode(MinistryAudioException.WAV_INVALID_HEADER) { parse(mp3) }
    }

    @Test
    fun `unsupported formats are rejected`() {
        val frames = 4
        val data = ByteArray(frames * 4)
        val headers = listOf(
            Wav.header(8000, 16, channels = 1, blockAlign = 2, byteRate = 16000), // mono
            Wav.header(8000, 16, bits = 8), // 8-bit
            Wav.header(8000, 16, tag = 3), // float
            Wav.header(8000, 16, tag = 0xFFFE), // extensible
        )
        for (h in headers) {
            assertCode(MinistryAudioException.WAV_UNSUPPORTED_FORMAT) { parse(h + data) }
        }
    }

    @Test
    fun `sample rate outside 8-48 kHz is rejected`() {
        for (rate in listOf(7_999, 48_001, 96_000, 0)) {
            val bytes = Wav.header(rate, 16, byteRate = rate.toLong() * 4) + ByteArray(16)
            assertCode(MinistryAudioException.WAV_RATE_UNSUPPORTED) { parse(bytes) }
        }
        parse(Wav.build(8000, 2) { 0 })
        parse(Wav.build(48000, 2) { 0 })
    }

    @Test
    fun `truncated and oversized files are rejected`() {
        val ok = Wav.build(8000, 10) { 1 }
        assertCode(MinistryAudioException.WAV_TRUNCATED) { parse(ok.copyOf(ok.size - 1)) }
        assertCode(MinistryAudioException.WAV_TRUNCATED) { parse(ok.copyOf(20)) }
        assertCode(MinistryAudioException.WAV_SIZE_MISMATCH) { parse(ok + byteArrayOf(0)) }
        val badRiff = Wav.build(8000, 10) { 1 }.also { it[4] = 0 }
        assertCode(MinistryAudioException.WAV_SIZE_MISMATCH) { parse(badRiff) }
    }

    @Test
    fun `zero frames, misaligned data and wrong byte rate are rejected`() {
        assertCode(MinistryAudioException.WAV_INVALID_HEADER) {
            parse(Wav.header(8000, 0))
        }
        assertCode(MinistryAudioException.WAV_INVALID_HEADER) {
            parse(Wav.header(8000, 6) + ByteArray(6))
        }
        assertCode(MinistryAudioException.WAV_INVALID_HEADER) {
            parse(Wav.header(8000, 8, byteRate = 1) + ByteArray(8))
        }
    }

    @Test
    fun `duration over 300 s is rejected without reading the data`() {
        // 8 kHz * 301 s of frames, declared size only (header is all that is read).
        val frames = 8000L * 301
        val header = Wav.header(8000, frames * 4)
        val source = MemorySource(header, declaredSize = 44 + frames * 4)
        assertCode(MinistryAudioException.WAV_TOO_LONG) { WavV1.parse(source) }
        val atLimit = 8000L * 300
        val ok = MemorySource(Wav.header(8000, atLimit * 4), declaredSize = 44 + atLimit * 4)
        assertEquals(atLimit, WavV1.parse(ok).frames)
    }

    @Test
    fun `stem file names are fixed and canonical`() {
        assertEquals(
            listOf("vocals", "drums", "bass", "guitar", "piano", "other"),
            StemId.values().map { it.wireName },
        )
        assertEquals("stem_vocals.wav", StemId.VOCALS.fileName)
    }
}
