package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/**
 * M22-S4-B: MP3 -> PCM16 decoding for the (unchanged) WAV engine.
 *
 * Strategy A of the audit: each MP3 stem is decoded SEQUENTIALLY (one at a time, bounded memory) into a private
 * temporary `stem_<id>.wav` that the existing engine plays exactly like a cached WAV. No new playback path exists.
 *
 * Alignment is never assumed. The platform decoder is measured at run time ([Mp3DecoderCalibration]) with impulse
 * fixtures of both production encoder profiles, and a stem is only exposed when the number of delivered frames and the
 * trimming agree exactly with the manifest. Nothing is padded or truncated to force a frame count: surplus decoder
 * output beyond `delay + frames` is the encoder padding, never silence made up to match.
 */
data class Mp3Alignment(val encoderDelayFrames: Int, val paddingFrames: Int, val mpegAudioFrames: Int) {
    fun isConsistent(frames: Long): Boolean =
        encoderDelayFrames in 0..MAX_ALIGNMENT && paddingFrames in 0..MAX_ALIGNMENT && mpegAudioFrames > 0 &&
            encoderDelayFrames + frames + paddingFrames == mpegAudioFrames.toLong() * SAMPLES_PER_FRAME

    companion object {
        const val SAMPLES_PER_FRAME = 1152
        const val MAX_ALIGNMENT = 4 * SAMPLES_PER_FRAME

        /** The server profile counts a 529-frame decoder delay on top of the LAME tag (tag 576 -> manifest 1105). */
        const val SERVER_DECODER_DELAY = 529
    }
}

fun interface PcmSink {
    fun write(buf: ByteArray, off: Int, len: Int)
}

/** What the platform reported about the stream before the first PCM byte. */
data class Mp3StreamInfo(
    val sampleRate: Int,
    val channels: Int,
    /** True when the platform decoder applies the encoder delay/padding (gapless) by itself. */
    val platformGapless: Boolean,
    val platformDelayFrames: Int?,
    val platformPaddingFrames: Int?,
)

interface Mp3PcmDecoder {
    /**
     * Decodes [file] to interleaved PCM16 stereo into [sink]. [onInfo] is called once, before any PCM. Must stop
     * promptly (throwing [MinistryAudioException] CANCELLED) when [cancelled] turns true, and always release every
     * codec/extractor resource.
     */
    @Throws(MinistryAudioException::class)
    fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean)
}

/** Drops [skipBytes] and keeps at most [keepBytes] of a byte stream; counts everything it saw. */
class PcmTrimmer(private var skipBytes: Long, private val keepBytes: Long, private val out: PcmSink) : PcmSink {
    var deliveredBytes = 0L
        private set
    var keptBytes = 0L
        private set

    override fun write(buf: ByteArray, off: Int, len: Int) {
        deliveredBytes += len
        var o = off
        var l = len
        if (skipBytes > 0) {
            val s = minOf(skipBytes, l.toLong()).toInt()
            skipBytes -= s
            o += s
            l -= s
        }
        if (l > 0 && keptBytes < keepBytes) {
            val k = minOf(l.toLong(), keepBytes - keptBytes).toInt()
            out.write(buf, o, k)
            keptBytes += k
        }
    }
}

object Mp3StemDecoder {
    private const val BYTES_PER_FRAME = WavV1.BYTES_PER_FRAME

    /**
     * Decodes one stem into [dest] (a `.part` file the caller promotes atomically). On any failure [dest] is deleted.
     */
    @Throws(MinistryAudioException::class)
    fun decodeToWav(
        source: File,
        dest: File,
        sampleRate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        decoder: Mp3PcmDecoder,
        cancelled: () -> Boolean,
    ) {
        if (!alignment.isConsistent(frames)) {
            throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Alinhamento MP3 inconsistente.")
        }
        var ok = false
        try {
            RandomAccessFile(dest, "rw").use { raf ->
                raf.setLength(0)
                raf.write(WavHeader(sampleRate, frames).toBytes())
                val stream = java.io.BufferedOutputStream(java.io.FileOutputStream(raf.fd), OUT_BUFFER)
                val trimmerBox = arrayOfNulls<PcmTrimmer>(1)
                val manual = booleanArrayOf(false)
                val sink = PcmSink { b, o, l ->
                    trimmerBox[0]!!.write(b, o, l)
                }
                val fileSink = PcmSink { b, o, l ->
                    try {
                        stream.write(b, o, l)
                    } catch (_: IOException) {
                        throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Falha ao gravar o áudio temporário.")
                    }
                }
                decoder.decode(
                    source,
                    onInfo = { info ->
                        validateInfo(info, sampleRate, alignment)
                        manual[0] = !info.platformGapless
                        val skip = if (info.platformGapless) 0L else tagDelay(alignment).toLong() * BYTES_PER_FRAME
                        trimmerBox[0] = PcmTrimmer(skip, frames * BYTES_PER_FRAME, fileSink)
                    },
                    sink = sink,
                    cancelled = cancelled,
                )
                try {
                    stream.flush()
                } catch (_: IOException) {
                    throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Falha ao gravar o áudio temporário.")
                }
                val t = trimmerBox[0] ?: throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "MP3 sem áudio.")
                verifyLengths(t, manual[0], frames, alignment)
                raf.fd.sync()
            }
            if (dest.length() != WavV1.HEADER_BYTES + frames * BYTES_PER_FRAME) {
                throw MinistryAudioException(MinistryAudioException.MP3_LENGTH_MISMATCH, "Duração decodificada diverge do manifesto.")
            }
            ok = true
        } catch (e: MinistryAudioException) {
            throw e
        } catch (_: IOException) {
            throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Falha ao gravar o áudio temporário.")
        } finally {
            if (!ok) runCatching { dest.delete() }
        }
    }

    /** Delay that the decoder output still carries when nobody trims it (the LAME tag value). */
    fun tagDelay(a: Mp3Alignment): Int = a.encoderDelayFrames - Mp3Alignment.SERVER_DECODER_DELAY

    private fun validateInfo(info: Mp3StreamInfo, sampleRate: Int, a: Mp3Alignment) {
        if (info.sampleRate != sampleRate || info.channels != 2) {
            throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Formato MP3 diverge do manifesto.")
        }
        if (tagDelay(a) < 0) throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Alinhamento MP3 inconsistente.")
        if (info.platformGapless) {
            // The platform must agree with the manifest, or its trimming cannot be trusted.
            val d = info.platformDelayFrames
            val p = info.platformPaddingFrames
            if (d == null || p == null || d != tagDelay(a) || p != a.paddingFrames + Mp3Alignment.SERVER_DECODER_DELAY) {
                throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "Metadados gapless divergentes.")
            }
        }
    }

    private fun verifyLengths(t: PcmTrimmer, manual: Boolean, frames: Long, a: Mp3Alignment) {
        val delivered = t.deliveredBytes
        val want = frames * BYTES_PER_FRAME
        if (t.keptBytes != want) {
            throw MinistryAudioException(MinistryAudioException.MP3_LENGTH_MISMATCH, "Duração decodificada diverge do manifesto.")
        }
        val ok = if (manual) {
            delivered >= tagDelay(a).toLong() * BYTES_PER_FRAME + want &&
                delivered <= a.mpegAudioFrames.toLong() * Mp3Alignment.SAMPLES_PER_FRAME * BYTES_PER_FRAME
        } else {
            delivered == want // platform-trimmed output must be exact
        }
        if (!ok) throw MinistryAudioException(MinistryAudioException.MP3_LENGTH_MISMATCH, "Duração decodificada diverge do manifesto.")
    }

    private const val OUT_BUFFER = 1 shl 16
}

/** Canonical 44-byte WAV v1 header (the engine's own contract). */
fun WavHeader.toBytes(): ByteArray {
    val dataBytes = frames * WavV1.BYTES_PER_FRAME
    val b = java.nio.ByteBuffer.allocate(WavV1.HEADER_BYTES).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    b.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt((36 + dataBytes).toInt())
    b.put("WAVE".toByteArray(Charsets.US_ASCII)).put("fmt ".toByteArray(Charsets.US_ASCII))
    b.putInt(16).putShort(1).putShort(2).putInt(sampleRate).putInt(sampleRate * WavV1.BYTES_PER_FRAME)
    b.putShort(WavV1.BYTES_PER_FRAME.toShort()).putShort(16)
    b.put("data".toByteArray(Charsets.US_ASCII)).putInt(dataBytes.toInt())
    return b.array()
}
