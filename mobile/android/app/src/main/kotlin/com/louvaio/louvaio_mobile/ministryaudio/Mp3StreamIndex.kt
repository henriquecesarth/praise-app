package com.louvaio.louvaio_mobile.ministryaudio

import java.io.BufferedInputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * M22-S4.2: structural validation and MPEG frame index of one `mp3_cbr256` stem, run BEFORE any codec is opened.
 *
 * It mirrors the server contract (backend `mp3-stream-validator.ts` and `mp3-encoder-profile.ts`): only an Info/Xing frame
 * followed by exactly `mpegAudioFrames` MPEG-1 Layer III CBR 256 kbps stereo frames, nothing else; LAME tag CRC and music
 * CRC; a supported encoder profile; delay/padding agreeing with the manifest; exact size and SHA-256. One sequential pass,
 * one frame buffered at a time; the only thing kept is one Int offset per frame.
 */
class Mp3StreamIndex(
    /** Byte offset of every AUDIO frame (the Info frame excluded). */
    val offsets: IntArray,
    val encoder: String,
    val sizeBytes: Long,
)

class Mp3StemExpectation(val sizeBytes: Long, val sha256: String)

object Mp3StreamIndexer {
    private const val BITRATE_INDEX_256 = 13
    private const val TAG_OFFSET = 36
    private const val LAME_BLOCK = 36
    private const val PROFILE_TAG_DELAY = 576
    private val PROFILE_PREFIXES = listOf("LAME3.100", "Lavc")

    /** Same ceiling as the server: 300 s of CBR 256 plus the alignment margin. */
    private const val MAX_AUDIO_FRAMES = 300 * 48_000 / 1152 + 8
    private const val MAX_FRAME_BYTES = 1045

    private val CRC_TABLE = IntArray(256) { n ->
        var c = n
        repeat(8) { c = if (c and 1 != 0) (c ushr 1) xor 0xA001 else c ushr 1 }
        c
    }

    private fun crc16(crc: Int, b: ByteArray, from: Int, to: Int): Int {
        var c = crc
        for (i in from until to) c = CRC_TABLE[(c xor b[i].toInt()) and 0xFF] xor (c ushr 8)
        return c
    }

    private fun invalid(why: String): Nothing =
        throw MinistryAudioException(MinistryAudioException.MP3_INVALID, "MP3 inválido: $why.")

    @Throws(MinistryAudioException::class)
    fun index(
        file: File,
        sampleRate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        expected: Mp3StemExpectation,
        cancelled: () -> Boolean = { false },
    ): Mp3StreamIndex {
        if (sampleRate != 44_100 && sampleRate != 48_000) invalid("taxa")
        if (!alignment.isConsistent(frames) || alignment.mpegAudioFrames > MAX_AUDIO_FRAMES) invalid("alinhamento")
        if (file.length() != expected.sizeBytes) invalid("tamanho")
        return try {
            file.inputStream().use { raw ->
                read(BufferedInputStream(raw, 1 shl 16), sampleRate, frames, alignment, expected, cancelled)
            }
        } catch (e: MinistryAudioException) {
            throw e
        } catch (_: java.io.IOException) {
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Falha ao ler o áudio.")
        }
    }

    private fun read(
        input: InputStream,
        sampleRate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        expected: Mp3StemExpectation,
        cancelled: () -> Boolean,
    ): Mp3StreamIndex {
        val digest = MessageDigest.getInstance("SHA-256")
        val frame = ByteArray(MAX_FRAME_BYTES)
        val offsets = IntArray(alignment.mpegAudioFrames)
        var position = 0L
        var musicCrc = 0
        var tag: Tag? = null

        /** Reads exactly [n] bytes; false only on a clean end before the first one. */
        fun fill(from: Int, n: Int): Boolean {
            var done = 0
            while (done < n) {
                val r = input.read(frame, from + done, n - done)
                if (r < 0) {
                    if (done == 0 && from == 0) return false
                    invalid("truncado")
                }
                done += r
            }
            return true
        }

        var count = 0 // frames seen, the Info frame included
        while (fill(0, 4)) {
            if (count and 0xFF == 0 && cancelled()) {
                throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
            }
            if (count > alignment.mpegAudioFrames) invalid("bytes após o último frame")
            val h1 = frame[1].toInt() and 0xFF
            val h2 = frame[2].toInt() and 0xFF
            val h3 = frame[3].toInt() and 0xFF
            // MPEG-1, Layer III, no CRC protection.
            if (frame[0] != 0xFF.toByte() || h1 and 0xFE != 0xFA || h1 and 1 == 0) invalid("cabeçalho")
            if (h2 shr 4 != BITRATE_INDEX_256) invalid("bitrate")
            val rate = when ((h2 shr 2) and 3) {
                0 -> 44_100
                1 -> 48_000
                else -> 0
            }
            if (rate != sampleRate) invalid("taxa")
            if (h3 shr 6 > 1 || h3 and 3 != 0) invalid("canais ou ênfase")
            val length = 144 * 256_000 / rate + ((h2 shr 1) and 1)
            fill(4, length - 4)
            digest.update(frame, 0, length)
            if (count == 0) {
                tag = parseInfo(frame, length)
            } else {
                offsets[count - 1] = position.toInt()
                musicCrc = crc16(musicCrc, frame, 0, length)
            }
            position += length
            count++
        }
        val t = tag ?: invalid("sem frames")
        if (count - 1 != alignment.mpegAudioFrames) invalid("contagem de frames")
        if (position != expected.sizeBytes) invalid("tamanho")
        if (t.frames != alignment.mpegAudioFrames.toLong() || t.bytes != position || t.musicLength != position) {
            invalid("contagens da tag")
        }
        if (t.musicCrc != musicCrc) invalid("CRC de música")
        val decoderDelay = alignment.encoderDelayFrames - t.delay
        if (PROFILE_PREFIXES.none { t.encoder.startsWith(it) } || t.delay != PROFILE_TAG_DELAY ||
            decoderDelay != Mp3Alignment.SERVER_DECODER_DELAY
        ) {
            invalid("perfil do codificador")
        }
        if (t.delay + t.padding != alignment.encoderDelayFrames + alignment.paddingFrames ||
            t.padding - alignment.paddingFrames != decoderDelay ||
            frames != alignment.mpegAudioFrames * 1152L - t.delay - t.padding
        ) {
            invalid("delay e padding")
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (hex != expected.sha256) invalid("SHA-256")
        return Mp3StreamIndex(offsets, t.encoder, position)
    }

    private class Tag(
        val frames: Long,
        val bytes: Long,
        val delay: Int,
        val padding: Int,
        val encoder: String,
        val musicCrc: Int,
        val musicLength: Long,
    )

    private fun parseInfo(f: ByteArray, length: Int): Tag {
        fun u8(i: Int) = f[i].toInt() and 0xFF
        fun u16(i: Int) = (u8(i) shl 8) or u8(i + 1)
        fun u32(i: Int) = (u16(i).toLong() shl 16) or u16(i + 2).toLong()
        for (i in 4 until TAG_OFFSET) if (f[i].toInt() != 0) invalid("informação lateral")
        val name = String(f, TAG_OFFSET, 4, Charsets.ISO_8859_1)
        if (name != "Info" && name != "Xing") invalid("sem frame Info")
        val flags = u32(TAG_OFFSET + 4)
        if (flags and 3L != 3L || flags and 0xF.toLong().inv() != 0L) invalid("flags")
        var o = TAG_OFFSET + 8
        val frames = u32(o)
        o += 4
        val bytes = u32(o)
        o += 4
        if (flags and 4L != 0L) o += 100
        if (flags and 8L != 0L) o += 4
        if (o + LAME_BLOCK > length) invalid("tag LAME ausente")
        val encoder = String(f, o, 9, Charsets.ISO_8859_1)
        if (encoder.any { it.code !in 0x20..0x7e } || encoder.isBlank()) invalid("codificador")
        if (crc16(0, f, 0, o + 34) != u16(o + 34)) invalid("CRC da tag")
        for (i in o + LAME_BLOCK until length) if (f[i].toInt() != 0) invalid("bytes após a tag")
        val delay = (u8(o + 21) shl 4) or (u8(o + 22) shr 4)
        val padding = ((u8(o + 22) and 0x0F) shl 8) or u8(o + 23)
        return Tag(frames, bytes, delay, padding, encoder, u16(o + 32), u32(o + 28))
    }
}
