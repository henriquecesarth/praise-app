package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import java.io.File

/**
 * Platform MP3 decoder (MediaExtractor + MediaCodec, synchronous mode), streaming PCM16 to a sink with a fixed scratch
 * buffer. Everything is released in `finally`, including on cancellation. It only trusts the format the platform
 * reports; the trimming/length policy lives in [Mp3StemDecoder] and is verified on the device by [Mp3DecoderCalibration].
 */
class AndroidMp3PcmDecoder(
    private val dequeueTimeoutUs: Long = 2_000L,
    private val stallLimitMs: Long = 15_000L,
    /**
     * MPEG frames handed to the codec per input buffer. The cost measured on the TB-J616F is the round trip per buffer,
     * not the decoding: 1 frame/buffer ran at ~8x realtime, 64 at ~80-100x, with identical PCM. 1 = reference pump.
     */
    private val framesPerBuffer: Int = DEFAULT_FRAMES_PER_BUFFER,
) : Mp3PcmDecoder {
    // MediaExtractor.getSampleSize (needed to pack safely) is API 28; older devices keep one frame per buffer.
    private val pack = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) framesPerBuffer.coerceAtLeast(1) else 1

    override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            try {
                extractor.setDataSource(file.path)
            } catch (_: Exception) {
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "MP3 ilegível.")
            }
            if (extractor.trackCount != 1) {
                throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "MP3 deve ter uma única faixa.")
            }
            val input = extractor.getTrackFormat(0)
            if (input.getString(MediaFormat.KEY_MIME) != MediaFormat.MIMETYPE_AUDIO_MPEG) {
                throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Formato de áudio não é MP3.")
            }
            extractor.selectTrack(0)
            if (pack > 1) input.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, pack * MAX_MPEG_FRAME_BYTES)
            try {
                // Owned (and so released by `finally`) from creation on: configure/start may fail for lack of resources.
                val created = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG)
                codec = created
                created.configure(input, null, null, 0)
                created.start()
            } catch (_: Exception) {
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificador MP3 indisponível.")
            }
            pump(extractor, codec!!, input, onInfo, sink, cancelled)
        } catch (e: MinistryAudioException) {
            throw e
        } catch (_: Exception) {
            throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Falha ao decodificar o MP3.")
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            runCatching { extractor.release() }
        }
    }

    private fun pump(
        extractor: MediaExtractor,
        codec: MediaCodec,
        input: MediaFormat,
        onInfo: (Mp3StreamInfo) -> Unit,
        sink: PcmSink,
        cancelled: () -> Boolean,
    ) {
        val info = MediaCodec.BufferInfo()
        var inDone = false
        var outDone = false
        var announced: Pair<Int, Int>? = null
        val scratch = ByteArray(16 * 1024)
        var lastProgress = System.nanoTime()

        // Called before the first PCM and again on every output format change, which must not alter the stream.
        fun announce(out: MediaFormat) {
            val rate = out.intOrNull(MediaFormat.KEY_SAMPLE_RATE) ?: input.intOrNull(MediaFormat.KEY_SAMPLE_RATE) ?: 0
            val ch = out.intOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: input.intOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: 0
            val enc = out.intOrNull(MediaFormat.KEY_PCM_ENCODING)
            if (enc != null && enc != AudioFormat.ENCODING_PCM_16BIT) {
                throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Saída PCM não é 16 bits.")
            }
            val previous = announced
            if (previous != null) {
                if (previous != rate to ch) {
                    throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Formato PCM mudou no meio do áudio.")
                }
                return
            }
            val delay = input.intOrNull(MediaFormat.KEY_ENCODER_DELAY)
            val padding = input.intOrNull(MediaFormat.KEY_ENCODER_PADDING)
            onInfo(Mp3StreamInfo(rate, ch, delay != null || padding != null, delay, padding, codec.name))
            announced = rate to ch
        }

        // Neither side is waited for while the other has work; only an idle pass blocks on the output.
        var idle = false
        while (!outDone) {
            if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
            var fed = false
            if (!inDone) {
                val ix = codec.dequeueInputBuffer(0)
                if (ix >= 0) {
                    val buf = codec.getInputBuffer(ix)!!
                    val pts = extractor.sampleTime
                    val n = fill(extractor, buf)
                    if (n < 0) {
                        codec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inDone = true
                    } else {
                        codec.queueInputBuffer(ix, 0, n, pts, 0)
                    }
                    fed = true
                    lastProgress = System.nanoTime()
                }
            }
            val ox = codec.dequeueOutputBuffer(info, if (idle) dequeueTimeoutUs else 0L)
            idle = !fed && ox == MediaCodec.INFO_TRY_AGAIN_LATER
            when {
                ox >= 0 -> {
                    lastProgress = System.nanoTime()
                    if (info.size > 0) {
                        if (announced == null) announce(codec.outputFormat)
                        val b = codec.getOutputBuffer(ox)!!
                        b.position(info.offset)
                        b.limit(info.offset + info.size)
                        var left = info.size
                        while (left > 0) {
                            val n = minOf(left, scratch.size)
                            b.get(scratch, 0, n)
                            sink.write(scratch, 0, n)
                            left -= n
                        }
                    }
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
                    codec.releaseOutputBuffer(ox, false)
                }
                ox == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    lastProgress = System.nanoTime()
                    announce(codec.outputFormat)
                }
                ox == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
            }
            if ((System.nanoTime() - lastProgress) / 1_000_000L > stallLimitMs) {
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificador MP3 sem progresso.")
            }
        }
        if (announced == null) throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "MP3 sem áudio.")
    }

    /** Puts up to [pack] whole MPEG frames into [buf]; returns the bytes written, or -1 at the end of the stream. */
    private fun fill(extractor: MediaExtractor, buf: java.nio.ByteBuffer): Int {
        var total = 0
        for (i in 0 until pack) {
            if (i > 0) {
                val next = extractor.sampleSize
                if (next < 0 || next > buf.capacity() - total) break
            }
            val n = extractor.readSampleData(buf, total)
            if (n < 0) break
            total += n
            extractor.advance()
        }
        return if (total == 0) -1 else total
    }

    private fun MediaFormat.intOrNull(key: String): Int? = if (containsKey(key)) getInteger(key) else null

    companion object {
        const val DEFAULT_FRAMES_PER_BUFFER = 64

        /** Above the largest MPEG-1 Layer III frame this app accepts (CBR 256 at 44.1 kHz: 836 bytes). */
        private const val MAX_MPEG_FRAME_BYTES = 1045
    }
}
