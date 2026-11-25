package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.io.InputStream
import kotlin.math.abs

/**
 * Proves, ON THE CURRENT DEVICE, that the platform decoder + [Mp3StemDecoder] reproduce the original timeline.
 *
 * Two bundled 1 s fixtures with three Hann-windowed 4 kHz bursts (start, middle, end), one per production encoder
 * profile and path: LAME 3.100 (the platform does NOT trim: the engine trims the tag delay) and Lavc (the platform
 * trims by itself, gapless). Each is decoded with the production code and the burst peaks must land on the original
 * positions within [TOLERANCE_FRAMES]. A device whose decoder behaves differently fails closed: MP3 is refused, nothing
 * is padded or shifted to compensate.
 */
class Mp3DecoderCalibration(
    private val decoder: Mp3PcmDecoder,
    private val scratchDir: File,
    private val openAsset: (String) -> InputStream,
) {
    private data class Case(val asset: String, val rate: Int, val frames: Long, val alignment: Mp3Alignment, val bursts: IntArray)

    @Volatile
    private var result: String? = null // null = not run; "" = verified; otherwise the failure code

    /** Throws [MinistryAudioException] unless this device is verified. The outcome is cached for the process. */
    @Synchronized
    @Throws(MinistryAudioException::class)
    fun requireVerified() {
        when (val r = result) {
            "" -> return
            null -> Unit
            else -> throw MinistryAudioException(r, "Alinhamento MP3 não verificado neste aparelho.")
        }
        try {
            CASES.forEach { run(it) }
            result = ""
        } catch (e: MinistryAudioException) {
            if (e.code != MinistryAudioException.CANCELLED) result = MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED
            throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Alinhamento MP3 não verificado neste aparelho.")
        } catch (_: Throwable) {
            result = MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED
            throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Alinhamento MP3 não verificado neste aparelho.")
        }
    }

    private fun run(c: Case) {
        scratchDir.mkdirs()
        val mp3 = File(scratchDir, "calibration.mp3")
        val wav = File(scratchDir, "calibration.wav.part")
        try {
            openAsset(c.asset).use { i -> mp3.outputStream().use { o -> i.copyTo(o) } }
            Mp3StemDecoder.decodeToWav(mp3, wav, c.rate, c.frames, c.alignment, decoder) { false }
            val data = wav.readBytes()
            for (centre in c.bursts) {
                val peak = peakNear(data, centre, c.frames)
                if (abs(peak.first - centre) > TOLERANCE_FRAMES || peak.second < MIN_PEAK) {
                    throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Burst fora do alinhamento.")
                }
            }
        } finally {
            runCatching { mp3.delete() }
            runCatching { wav.delete() }
        }
    }

    private fun peakNear(wav: ByteArray, centre: Int, frames: Long): Pair<Int, Int> {
        val lo = maxOf(0, centre - SEARCH)
        val hi = minOf(frames.toInt() - 1, centre + SEARCH)
        var best = lo
        var bv = -1
        for (p in lo..hi) {
            val idx = WavV1.HEADER_BYTES + p * WavV1.BYTES_PER_FRAME
            val v = abs(((wav[idx + 1].toInt() shl 8) or (wav[idx].toInt() and 0xFF)))
            if (v > bv) {
                bv = v
                best = p
            }
        }
        return best to bv
    }

    companion object {
        const val TOLERANCE_FRAMES = 1
        const val SEARCH = 200
        const val MIN_PEAK = 20_000
        const val ASSET_DIR = "ministry_audio_mp3_calibration"

        // Values produced by backend/scripts/m22s4/generate-android-alignment-fixtures.ts (delay 1105 = tag 576 + 529).
        private val CASES = listOf(
            Case("$ASSET_DIR/impulse_lame_44100.mp3", 44_100, 44_100, Mp3Alignment(1105, 875, 40), intArrayOf(3000, 22_050, 41_100)),
            Case("$ASSET_DIR/impulse_lavc_48000.mp3", 48_000, 48_000, Mp3Alignment(1105, 431, 43), intArrayOf(3000, 24_000, 45_000)),
        )
    }
}
