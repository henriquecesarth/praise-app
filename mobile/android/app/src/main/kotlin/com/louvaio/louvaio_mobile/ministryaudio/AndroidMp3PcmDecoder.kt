package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File

/**
 * Platform MP3 decoder (MediaExtractor + MediaCodec, synchronous mode), streaming PCM16 to a sink with a fixed scratch
 * buffer. Everything is released in `finally`, including on cancellation. It only trusts the format the platform
 * reports; the trimming/length policy lives in [Mp3StemDecoder] and is verified on the device by [Mp3DecoderCalibration].
 */
class AndroidMp3PcmDecoder(
    private val dequeueTimeoutUs: Long = 10_000L,
    private val stallLimitMs: Long = 15_000L,
) : Mp3PcmDecoder {

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
            codec = try {
                MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG).also {
                    it.configure(input, null, null, 0)
                    it.start()
                }
            } catch (_: Exception) {
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificador MP3 indisponível.")
            }
            pump(extractor, codec, input, onInfo, sink, cancelled)
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
        var announced = false
        var scratch = ByteArray(16 * 1024)
        var lastProgress = System.nanoTime()

        fun announce(out: MediaFormat?) {
            val rate = (out ?: input).intOrNull(MediaFormat.KEY_SAMPLE_RATE) ?: input.intOrNull(MediaFormat.KEY_SAMPLE_RATE) ?: 0
            val ch = (out ?: input).intOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: input.intOrNull(MediaFormat.KEY_CHANNEL_COUNT) ?: 0
            val enc = out?.intOrNull(MediaFormat.KEY_PCM_ENCODING)
            if (enc != null && enc != AudioFormat.ENCODING_PCM_16BIT) {
                throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Saída PCM não é 16 bits.")
            }
            val delay = input.intOrNull(MediaFormat.KEY_ENCODER_DELAY)
            val padding = input.intOrNull(MediaFormat.KEY_ENCODER_PADDING)
            onInfo(Mp3StreamInfo(rate, ch, delay != null || padding != null, delay, padding))
            announced = true
        }

        while (!outDone) {
            if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
            if (!inDone) {
                val ix = codec.dequeueInputBuffer(dequeueTimeoutUs)
                if (ix >= 0) {
                    val buf = codec.getInputBuffer(ix)!!
                    val n = extractor.readSampleData(buf, 0)
                    if (n < 0) {
                        codec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inDone = true
                    } else {
                        codec.queueInputBuffer(ix, 0, n, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                    lastProgress = System.nanoTime()
                }
            }
            val ox = codec.dequeueOutputBuffer(info, dequeueTimeoutUs)
            when {
                ox >= 0 -> {
                    lastProgress = System.nanoTime()
                    if (info.size > 0) {
                        if (!announced) announce(null)
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
                    if (!announced) announce(codec.outputFormat)
                }
                ox == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
            }
            if ((System.nanoTime() - lastProgress) / 1_000_000L > stallLimitMs) {
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificador MP3 sem progresso.")
            }
        }
        if (!announced) throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "MP3 sem áudio.")
    }

    private fun MediaFormat.intOrNull(key: String): Int? = if (containsKey(key)) getInteger(key) else null
}
