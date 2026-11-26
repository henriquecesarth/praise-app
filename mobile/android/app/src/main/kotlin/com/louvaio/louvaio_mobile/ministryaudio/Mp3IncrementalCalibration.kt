package com.louvaio.louvaio_mobile.ministryaudio

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.abs

/**
 * Proves, on the current device, what the incremental path relies on: with gapless trimming off the decoder delivers the
 * whole raw stream (`mpegAudioFrames * 1152`), the bursts of both channels sit at `tag delay + position`, and a window
 * opened at an arbitrary MPEG frame (with [IncrementalPcmFeed.PREROLL_FRAMES] of preroll) reproduces the linear decode
 * bit for bit. Four fixtures (both profiles, both rates), one and the same codec.
 *
 * A failure here says "this device cannot stream", not "this recording is bad": the caller may use the full decode, which
 * has its own calibration.
 */
class Mp3IncrementalCalibration(
    private val decoder: Mp3WindowDecoder,
    private val scratchDir: File,
    private val openAsset: (String) -> InputStream,
) : Mp3Gate {
    @Volatile
    private var verifiedDecoder: String? = null

    @Volatile
    private var rejected = false

    @Synchronized
    override fun requireVerified(cancelled: () -> Boolean): String {
        verifiedDecoder?.let { return it }
        if (rejected) throw unverified()
        try {
            var name: String? = null
            for (fixture in Mp3DecoderCalibration.fixtures) name = run(fixture, name, cancelled)
            return name!!.also { verifiedDecoder = it }
        } catch (e: MinistryAudioException) {
            if (e.code == MinistryAudioException.CANCELLED) throw e
            if (e.code in DETERMINISTIC) rejected = true
            throw unverified()
        } catch (_: Exception) {
            throw unverified()
        }
    }

    private companion object {
        val DETERMINISTIC = setOf(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, MinistryAudioException.MP3_INVALID)
    }

    private fun unverified() = MinistryAudioException(
        MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED,
        "Reprodução incremental não verificada neste aparelho.",
    )

    private fun run(f: Mp3DecoderCalibration.Fixture, expected: String?, cancelled: () -> Boolean): String {
        scratchDir.mkdirs()
        val mp3 = File(scratchDir, "calibration-stream.mp3")
        try {
            val bytes = openAsset(f.asset).use { it.readBytes() }
            mp3.writeBytes(bytes)
            val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val index = Mp3StreamIndexer.index(
                mp3, f.rate, f.frames, f.alignment, Mp3StemExpectation(bytes.size.toLong(), sha), cancelled,
            )
            var name = expected
            fun window(start: Int): ByteArray {
                val out = ByteArrayOutputStream()
                val offset = if (start == 0) 0L else index.offsets[start].toLong()
                // The same input check as playback: an extractor that does not hand over exact frames cannot stream.
                decoder.decodeFrom(mp3, offset, index.inputCheck(start), { info ->
                    if (info.channels != 2 || info.sampleRate != f.rate || info.platformGapless ||
                        (name != null && info.decoderName != name)
                    ) {
                        throw unverified()
                    }
                    name = info.decoderName
                }, { b, o, l -> out.write(b, o, l) }, cancelled)
                return out.toByteArray()
            }

            val linear = window(0)
            val mpeg = f.alignment.mpegAudioFrames
            if (linear.size != mpeg * Mp3Alignment.SAMPLES_PER_FRAME * WavV1.BYTES_PER_FRAME) throw unverified()
            val delay = Mp3StemDecoder.tagDelay(f.alignment)
            for (channel in 0..1) {
                for (centre in f.bursts) {
                    var best = 0
                    var value = -1
                    for (p in delay + centre - Mp3DecoderCalibration.SEARCH..delay + centre + Mp3DecoderCalibration.SEARCH) {
                        val i = p * WavV1.BYTES_PER_FRAME + channel * 2
                        if (i < 0 || i + 1 >= linear.size) continue
                        val v = abs((linear[i + 1].toInt() shl 8) or (linear[i].toInt() and 0xFF))
                        if (v > value) {
                            value = v
                            best = p
                        }
                    }
                    if (abs(best - delay - centre) > Mp3DecoderCalibration.TOLERANCE_FRAMES ||
                        value < Mp3DecoderCalibration.MIN_PEAK
                    ) {
                        throw unverified()
                    }
                }
            }
            for (target in listOf(1, 11, mpeg / 2, mpeg - 12)) {
                val start = maxOf(0, target - IncrementalPcmFeed.PREROLL_FRAMES)
                val got = window(start)
                val from = target * Mp3Alignment.SAMPLES_PER_FRAME * WavV1.BYTES_PER_FRAME
                val skip = (target - start) * Mp3Alignment.SAMPLES_PER_FRAME * WavV1.BYTES_PER_FRAME
                if (got.size - skip != linear.size - from) throw unverified()
                for (i in from until linear.size) if (got[i - from + skip] != linear[i]) throw unverified()
            }
            return name!!
        } finally {
            runCatching { mp3.delete() }
        }
    }
}
