package com.louvaio.louvaio_mobile.ministryaudio

import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/**
 * Error with a stable machine code. Messages never contain file paths or any
 * server-provided value.
 */
class MinistryAudioException(val code: String, message: String) : Exception(message) {
    companion object {
        const val INVALID_STATE = "AUDIO_NATIVE_INVALID_STATE"
        const val INVALID_ARGUMENT = "AUDIO_NATIVE_INVALID_ARGUMENT"
        const val PATH_REJECTED = "AUDIO_NATIVE_PATH_REJECTED"
        const val STEM_MISSING = "AUDIO_NATIVE_STEM_MISSING"
        const val WAV_INVALID_HEADER = "AUDIO_NATIVE_WAV_INVALID_HEADER"
        const val WAV_UNSUPPORTED_FORMAT = "AUDIO_NATIVE_WAV_UNSUPPORTED_FORMAT"
        const val WAV_RATE_UNSUPPORTED = "AUDIO_NATIVE_WAV_RATE_UNSUPPORTED"
        const val WAV_TOO_LONG = "AUDIO_NATIVE_WAV_TOO_LONG"
        const val WAV_TRUNCATED = "AUDIO_NATIVE_WAV_TRUNCATED"
        const val WAV_SIZE_MISMATCH = "AUDIO_NATIVE_WAV_SIZE_MISMATCH"
        const val RATE_MISMATCH = "AUDIO_NATIVE_RATE_MISMATCH"
        const val FRAMES_MISMATCH = "AUDIO_NATIVE_FRAMES_MISMATCH"
        const val READ_FAILED = "AUDIO_NATIVE_READ_FAILED"
        const val OUTPUT_FAILED = "AUDIO_NATIVE_OUTPUT_FAILED"
        const val FOCUS_DENIED = "AUDIO_NATIVE_FOCUS_DENIED"
    }
}

/** The six stems of a ministry recording, in their fixed canonical order. */
enum class StemId(val wireName: String) {
    VOCALS("vocals"),
    DRUMS("drums"),
    BASS("bass"),
    GUITAR("guitar"),
    PIANO("piano"),
    OTHER("other");

    /** Fixed internal file name used by the Dart download manager. */
    val fileName: String get() = "stem_$wireName.wav"
}

/** Random-access, bounded-read view of one stem file. */
interface StemSource : Closeable {
    val sizeBytes: Long

    /** May return fewer bytes than asked; <= 0 means no more data. */
    fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int
}

/** Reads exactly [length] bytes, looping over partial reads. */
fun StemSource.readFully(position: Long, dst: ByteArray, offset: Int, length: Int) {
    var done = 0
    while (done < length) {
        val n = readAt(position + done, dst, offset + done, length - done)
        if (n <= 0) {
            throw MinistryAudioException(
                MinistryAudioException.WAV_TRUNCATED,
                "Arquivo de áudio truncado.",
            )
        }
        done += n
    }
}

class FileStemSource private constructor(
    private val file: RandomAccessFile,
    override val sizeBytes: Long,
) : StemSource {
    @Volatile
    private var closed = false

    @Synchronized
    override fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int {
        if (closed) {
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Fonte de áudio fechada.")
        }
        return try {
            file.seek(position)
            file.read(dst, offset, length)
        } catch (_: IOException) {
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Falha ao ler o áudio.")
        }
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        try {
            file.close()
        } catch (_: IOException) {
        }
    }

    companion object {
        fun open(file: File): FileStemSource {
            val raf = try {
                RandomAccessFile(file, "r")
            } catch (_: IOException) {
                throw MinistryAudioException(MinistryAudioException.STEM_MISSING, "Arquivo de áudio indisponível.")
            }
            return try {
                FileStemSource(raf, raf.length())
            } catch (e: IOException) {
                try {
                    raf.close()
                } catch (_: IOException) {
                }
                throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Falha ao ler o áudio.")
            }
        }
    }
}

data class WavHeader(val sampleRate: Int, val frames: Long) {
    val sizeBytes: Long get() = WavV1.HEADER_BYTES + frames * WavV1.BYTES_PER_FRAME
}

/**
 * Strict parser of the WAV v1 contract: canonical 44-byte header, PCM16 stereo,
 * 8-48 kHz, at most 300 s, and `size == 44 + frames * 4` exactly (the same rule
 * as the ministry manifest). Anything else (MP3, WAVE_FORMAT_EXTENSIBLE, extra
 * chunks, other layouts) is rejected.
 */
object WavV1 {
    const val HEADER_BYTES = 44
    const val BYTES_PER_FRAME = 4
    const val MIN_SAMPLE_RATE = 8_000
    const val MAX_SAMPLE_RATE = 48_000
    const val MAX_SECONDS = 300L

    fun parse(source: StemSource): WavHeader {
        val size = source.sizeBytes
        if (size < HEADER_BYTES) {
            throw MinistryAudioException(MinistryAudioException.WAV_TRUNCATED, "Arquivo de áudio truncado.")
        }
        val h = ByteArray(HEADER_BYTES)
        source.readFully(0, h, 0, HEADER_BYTES)

        if (!tag(h, 0, "RIFF") || !tag(h, 8, "WAVE") || !tag(h, 12, "fmt ") || !tag(h, 36, "data")) {
            throw MinistryAudioException(MinistryAudioException.WAV_INVALID_HEADER, "Cabeçalho WAV inválido.")
        }
        val fmtSize = u32(h, 16)
        val formatTag = u16(h, 20)
        val channels = u16(h, 22)
        val rate = u32(h, 24)
        val byteRate = u32(h, 28)
        val blockAlign = u16(h, 32)
        val bits = u16(h, 34)
        if (fmtSize != 16L || formatTag != 1 || channels != 2 || bits != 16 || blockAlign != BYTES_PER_FRAME) {
            throw MinistryAudioException(
                MinistryAudioException.WAV_UNSUPPORTED_FORMAT,
                "Formato de áudio não suportado (esperado PCM16 estéreo).",
            )
        }
        if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
            throw MinistryAudioException(
                MinistryAudioException.WAV_RATE_UNSUPPORTED,
                "Taxa de amostragem fora do intervalo suportado.",
            )
        }
        if (byteRate != rate * BYTES_PER_FRAME) {
            throw MinistryAudioException(MinistryAudioException.WAV_INVALID_HEADER, "Cabeçalho WAV inválido.")
        }
        val dataSize = u32(h, 40)
        val riffSize = u32(h, 4)
        if (dataSize <= 0 || dataSize % BYTES_PER_FRAME != 0L) {
            throw MinistryAudioException(MinistryAudioException.WAV_INVALID_HEADER, "Cabeçalho WAV inválido.")
        }
        val expected = HEADER_BYTES + dataSize
        if (size < expected) {
            throw MinistryAudioException(MinistryAudioException.WAV_TRUNCATED, "Arquivo de áudio truncado.")
        }
        if (size != expected || riffSize != size - 8) {
            throw MinistryAudioException(
                MinistryAudioException.WAV_SIZE_MISMATCH,
                "Tamanho do arquivo de áudio inconsistente.",
            )
        }
        val frames = dataSize / BYTES_PER_FRAME
        if (frames > rate * MAX_SECONDS) {
            throw MinistryAudioException(MinistryAudioException.WAV_TOO_LONG, "Áudio excede a duração máxima.")
        }
        return WavHeader(rate.toInt(), frames)
    }

    private fun tag(b: ByteArray, off: Int, s: String): Boolean {
        for (i in s.indices) if (b[off + i] != s[i].code.toByte()) return false
        return true
    }

    private fun u16(b: ByteArray, off: Int): Int =
        (b[off].toInt() and 0xFF) or ((b[off + 1].toInt() and 0xFF) shl 8)

    private fun u32(b: ByteArray, off: Int): Long =
        (u16(b, off).toLong()) or (u16(b, off + 2).toLong() shl 16)
}

/**
 * Resolves the six stem files of one recording from a directory, refusing
 * anything outside the allowed private root. The trust boundary is the caller
 * (the revalidated cache): this only prevents path abuse, it never authorizes
 * playback.
 */
object MinistryAudioPaths {
    fun resolve(directory: File, allowedRoot: File): Map<StemId, File> {
        val root = canonical(allowedRoot)
        val dir = canonical(directory)
        val inside = dir.path == root.path || dir.path.startsWith(root.path + File.separator)
        if (!inside || !dir.isDirectory) {
            throw MinistryAudioException(MinistryAudioException.PATH_REJECTED, "Diretório de áudio não permitido.")
        }
        val out = LinkedHashMap<StemId, File>()
        for (id in StemId.values()) {
            val candidate = File(dir, id.fileName)
            val real = canonical(candidate)
            // A symlink (or any indirection) would resolve outside `dir`.
            if (real.parentFile?.path != dir.path || real.name != id.fileName) {
                throw MinistryAudioException(MinistryAudioException.PATH_REJECTED, "Arquivo de áudio não permitido.")
            }
            if (!real.isFile) {
                throw MinistryAudioException(MinistryAudioException.STEM_MISSING, "Arquivo de áudio indisponível.")
            }
            out[id] = real
        }
        return out
    }

    private fun canonical(file: File): File = try {
        file.canonicalFile
    } catch (_: IOException) {
        throw MinistryAudioException(MinistryAudioException.PATH_REJECTED, "Caminho de áudio inválido.")
    }
}
