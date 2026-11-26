package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.io.InputStream
import kotlin.math.abs

/** Gate that must pass before any MP3 is decoded on this device. */
fun interface Mp3Gate {
    /** Returns the name of the platform decoder that was verified; every stem must be decoded by that same one. */
    @Throws(MinistryAudioException::class)
    fun requireVerified(cancelled: () -> Boolean): String
}

/**
 * Proves, ON THE CURRENT DEVICE, that the platform decoder + [Mp3StemDecoder] reproduce the original timeline.
 *
 * Four bundled 1 s fixtures with three Hann-windowed 4 kHz bursts (start, middle, end): both production encoder profiles
 * (LAME 3.100, which the platform does NOT trim, and Lavc, which it trims by itself) at both sample rates. Each is
 * decoded with the production code and the burst peaks of BOTH channels must land on the original positions within
 * [TOLERANCE_FRAMES], all by one and the same decoder. A device whose decoder behaves differently fails closed: MP3 is
 * refused, nothing is padded or shifted to compensate.
 */
class Mp3DecoderCalibration(
    private val decoder: Mp3PcmDecoder,
    private val scratchDir: File,
    private val openAsset: (String) -> InputStream,
) : Mp3Gate {
    private data class Case(val asset: String, val rate: Int, val frames: Long, val alignment: Mp3Alignment, val bursts: IntArray)

    @Volatile
    private var verifiedDecoder: String? = null

    @Volatile
    private var rejected = false

    /**
     * Throws [MinistryAudioException] unless this device is verified. A success and a proven misbehaviour are cached for
     * the process; a cancellation or an environmental failure (I/O, codec unavailable) is not, so a later call retries.
     */
    @Synchronized
    @Throws(MinistryAudioException::class)
    override fun requireVerified(cancelled: () -> Boolean): String {
        verifiedDecoder?.let { return it }
        if (rejected) throw unverified()
        try {
            var name: String? = null
            for (c in CASES) {
                val used = run(c, name, cancelled)
                name = used
            }
            return name!!.also { verifiedDecoder = it }
        } catch (e: MinistryAudioException) {
            if (e.code == MinistryAudioException.CANCELLED) throw e
            if (e.code in DETERMINISTIC) rejected = true
            throw unverified()
        } catch (_: Exception) {
            throw unverified()
        }
    }

    private fun unverified() = MinistryAudioException(
        MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED,
        "Alinhamento MP3 não verificado neste aparelho.",
    )

    private fun run(c: Case, expectedDecoder: String?, cancelled: () -> Boolean): String {
        scratchDir.mkdirs()
        val mp3 = File(scratchDir, "calibration.mp3")
        val wav = File(scratchDir, "calibration.wav.part")
        try {
            openAsset(c.asset).use { i -> mp3.outputStream().use { o -> i.copyTo(o) } }
            val used = Mp3StemDecoder.decodeToWav(mp3, wav, c.rate, c.frames, c.alignment, decoder, expectedDecoder, cancelled)
            val data = wav.readBytes()
            for (channel in 0..1) {
                for (centre in c.bursts) {
                    val peak = peakNear(data, channel, centre, c.frames)
                    if (abs(peak.first - centre) > TOLERANCE_FRAMES || peak.second < MIN_PEAK) {
                        throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Burst fora do alinhamento.")
                    }
                }
            }
            return used
        } finally {
            runCatching { mp3.delete() }
            runCatching { wav.delete() }
        }
    }

    private fun peakNear(wav: ByteArray, channel: Int, centre: Int, frames: Long): Pair<Int, Int> {
        val lo = maxOf(0, centre - SEARCH)
        val hi = minOf(frames.toInt() - 1, centre + SEARCH)
        var best = lo
        var bv = -1
        for (p in lo..hi) {
            val idx = WavV1.HEADER_BYTES + p * WavV1.BYTES_PER_FRAME + channel * 2
            val v = abs(((wav[idx + 1].toInt() shl 8) or (wav[idx].toInt() and 0xFF)))
            if (v > bv) {
                bv = v
                best = p
            }
        }
        return best to bv
    }

    /** The impulse fixtures, shared with [Mp3IncrementalCalibration]. */
    internal class Fixture(val asset: String, val rate: Int, val frames: Long, val alignment: Mp3Alignment, val bursts: IntArray)

    companion object {
        internal val fixtures: List<Fixture>
            get() = CASES.map { Fixture(it.asset, it.rate, it.frames, it.alignment, it.bursts) }

        const val TOLERANCE_FRAMES = 1
        const val SEARCH = 200
        const val MIN_PEAK = 20_000
        const val ASSET_DIR = "ministry_audio_mp3_calibration"

        /** Failures that say something about the decoder itself and will not change on retry. */
        private val DETERMINISTIC = setOf(
            MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED,
            MinistryAudioException.MP3_LENGTH_MISMATCH,
            MinistryAudioException.MP3_UNSUPPORTED,
        )

        // Values produced by backend/scripts/m22s4/generate-android-alignment-fixtures.ts (delay 1105 = tag 576 + 529).
        private val BURSTS_44 = intArrayOf(3000, 22_050, 41_100)
        private val BURSTS_48 = intArrayOf(3000, 24_000, 45_000)
        private val CASES = listOf(
            Case("$ASSET_DIR/impulse_lame_44100.mp3", 44_100, 44_100, Mp3Alignment(1105, 875, 40), BURSTS_44),
            Case("$ASSET_DIR/impulse_lavc_44100.mp3", 44_100, 44_100, Mp3Alignment(1105, 875, 40), BURSTS_44),
            Case("$ASSET_DIR/impulse_lame_48000.mp3", 48_000, 48_000, Mp3Alignment(1105, 431, 43), BURSTS_48),
            Case("$ASSET_DIR/impulse_lavc_48000.mp3", 48_000, 48_000, Mp3Alignment(1105, 431, 43), BURSTS_48),
        )
    }
}
