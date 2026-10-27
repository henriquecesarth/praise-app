package com.louvaio.louvaio_mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.OperationCanceledException
import android.provider.OpenableColumns
import android.text.Html
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream

class ShareIntentHandler(private val context: Context) {

    companion object {
        const val MAX_PDF_SIZE_BYTES = 3L * 1024L * 1024L // 3 MiB
        const val MAX_IMAGE_SIZE_BYTES = 5L * 1024L * 1024L // 5 MiB
        const val MAX_TEXT_LENGTH = 100_000
        private val PDF_MAGIC_BYTES = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2D) // "%PDF-"
        private const val STALE_CACHE_AGE_MS = 24L * 60L * 60L * 1000L
    }

    // One operation per intent. Provider cancellation/close is done off main.
    class ReadOperation {
        val signal = CancellationSignal()
        @Volatile private var cancelled = false
        @Volatile private var input: InputStream? = null
        @Volatile private var file: File? = null

        fun markCancelled() { cancelled = true }

        fun checkCancelled() {
            if (cancelled || Thread.currentThread().isInterrupted) throw OperationCanceledException()
        }

        fun trackInput(value: InputStream): InputStream {
            input = value
            checkCancelled()
            return value
        }

        fun trackFile(value: File): File {
            file = value
            checkCancelled()
            return value
        }

        fun discardFiles() { file?.delete() }

        fun cancelResources() {
            try { input?.close() } catch (_: Exception) { /* best effort */ }
            signal.cancel()
            discardFiles()
        }

        fun cleanupIfCancelled() {
            if (cancelled || Thread.currentThread().isInterrupted) discardFiles()
        }
    }

    fun processIntent(intent: Intent?, read: ReadOperation): Map<String, Any?>? {
        try {
            read.checkCancelled()
            cleanupStaleCacheFiles()
            return readIntent(intent, read)
        } finally {
            read.cleanupIfCancelled()
        }
    }

    private fun readIntent(intent: Intent?, read: ReadOperation): Map<String, Any?>? {
        if (intent == null || intent.action != Intent.ACTION_SEND) return null

        val mimeType = intent.type

        if (mimeType == null) {
            return mapOf(
                "type" to "error",
                "error" to "UNKNOWN_MIME_TYPE",
                "errorMessage" to "Tipo de conteúdo não especificado."
            )
        }

        // Share providers may label copied note text as text/html or text/uri-list.
        // Keep this allowlist narrow: arbitrary application/* payloads still fail closed.
        if (mimeType == "text/plain" || mimeType == "text/html" || mimeType == "text/uri-list") {
            return processTextIntent(intent)
        }

        if (mimeType == "application/pdf" || mimeType.endsWith("/pdf")) {
            return processPdfIntent(intent, read)
        }

        if (mimeType.startsWith("image/")) {
            return processImageIntent(intent, read)
        }

        return mapOf(
            "type" to "unsupported",
            "mimeType" to mimeType,
            "error" to "UNSUPPORTED_TYPE",
            "errorMessage" to "Tipo de arquivo não suportado. Compartilhe texto, PDF ou imagem."
        )
    }

    private fun processTextIntent(intent: Intent): Map<String, Any?> {
        val clipText = if (intent.clipData != null && intent.clipData!!.itemCount > 0) {
            intent.clipData!!.getItemAt(0).text?.toString()
        } else {
            null
        }
        val htmlText = intent.getStringExtra(Intent.EXTRA_HTML_TEXT)?.let { html ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString()
            } else {
                @Suppress("DEPRECATION")
                Html.fromHtml(html).toString()
            }
        }
        // Providers such as Keep may put Spannable content in EXTRA_TEXT. Reading it
        // as a String first can throw ClassCastException, so preserve CharSequence.
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            ?: htmlText
            ?: clipText

        if (text.isNullOrBlank()) {
            return mapOf(
                "type" to "text",
                "error" to "EMPTY_TEXT",
                "errorMessage" to "O texto compartilhado está vazio."
            )
        }

        if (text.length > MAX_TEXT_LENGTH) {
            return mapOf(
                "type" to "text",
                "error" to "TEXT_TOO_LARGE",
                "errorMessage" to "O texto compartilhado excede o limite de 100.000 caracteres."
            )
        }

        return mapOf(
            "type" to "text",
            "text" to text
        )
    }

    private fun processPdfIntent(intent: Intent, read: ReadOperation): Map<String, Any?> {
        val streamUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        } ?: intent.data

        if (streamUri == null) {
            return mapOf(
                "type" to "pdf",
                "error" to "MISSING_URI",
                "errorMessage" to "URI do arquivo PDF ausente."
            )
        }

        var displayName: String? = null
        var declaredSize: Long = -1

        try {
            context.contentResolver.query(
                streamUri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
                read.signal,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx != -1 && !cursor.isNull(nameIdx)) {
                        displayName = cursor.getString(nameIdx)
                    }
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIdx != -1 && !cursor.isNull(sizeIdx)) {
                        declaredSize = cursor.getLong(sizeIdx)
                    }
                }
            }
        } catch (_: Exception) {
            // Ignore cursor failure; fallback to stream reading
        }
        read.checkCancelled()

        var effectiveFileName = safeFileName(displayName ?: streamUri.lastPathSegment ?: "cifra_compartilhada.pdf")
        if (!effectiveFileName.lowercase().endsWith(".pdf")) {
            effectiveFileName = "$effectiveFileName.pdf"
        }

        if (declaredSize > MAX_PDF_SIZE_BYTES) {
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "fileSize" to declaredSize,
                "error" to "FILE_TOO_LARGE",
                "errorMessage" to "Arquivo PDF excede o limite máximo permitido de 3 MB."
            )
        }

        val cacheDir = File(context.cacheDir, "shared_imports")
        if (!cacheDir.exists()) {
            cacheDir.mkdirs()
        }
        val tempFile = read.trackFile(File.createTempFile("shared_", ".pdf", cacheDir))

        try {
            openInputStream(streamUri, read)?.use { input ->
                read.checkCancelled()
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalRead: Long = 0

                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        read.checkCancelled()
                        totalRead += bytesRead
                        if (totalRead > MAX_PDF_SIZE_BYTES) {
                            output.close()
                            tempFile.delete()
                            return mapOf(
                                "type" to "pdf",
                                "fileName" to effectiveFileName,
                                "fileSize" to totalRead,
                                "error" to "FILE_TOO_LARGE",
                                "errorMessage" to "Arquivo PDF excede o limite máximo permitido de 3 MB."
                            )
                        }
                        output.write(buffer, 0, bytesRead)
                    }
                }
            } ?: run {
                tempFile.delete()
                return mapOf(
                    "type" to "pdf",
                    "fileName" to effectiveFileName,
                    "error" to "FILE_UNAVAILABLE",
                    "errorMessage" to "Não foi possível abrir o arquivo compartilhado."
                )
            }
        } catch (_: SecurityException) {
            tempFile.delete()
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "error" to "PERMISSION_DENIED",
                "errorMessage" to "Permissão de leitura negada pelo aplicativo de origem."
            )
        } catch (e: Exception) {
            tempFile.delete()
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "error" to "FILE_READ_ERROR",
                "errorMessage" to "Falha ao ler o arquivo compartilhado: ${e.message}"
            )
        }

        read.checkCancelled()
        if (tempFile.length() < 5) {
            tempFile.delete()
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "error" to "INVALID_PDF",
                "errorMessage" to "Arquivo PDF vazio ou inválido."
            )
        }

        val headerBytes = ByteArray(5)
        try {
            tempFile.inputStream().use { it.read(headerBytes) }
        } catch (_: IOException) {
            tempFile.delete()
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "error" to "INVALID_PDF",
                "errorMessage" to "Arquivo PDF inválido ou corrompido."
            )
        }

        if (!headerBytes.contentEquals(PDF_MAGIC_BYTES)) {
            tempFile.delete()
            return mapOf(
                "type" to "pdf",
                "fileName" to effectiveFileName,
                "error" to "INVALID_PDF",
                "errorMessage" to "Arquivo PDF inválido ou corrompido."
            )
        }

        return mapOf(
            "type" to "pdf",
            "filePath" to tempFile.absolutePath,
            "fileName" to effectiveFileName,
            "fileSize" to tempFile.length()
        )
    }

    private fun processImageIntent(intent: Intent, read: ReadOperation): Map<String, Any?> {
        val streamUri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        } ?: intent.data

        if (streamUri == null) {
            return mapOf(
                "type" to "image",
                "error" to "MISSING_URI",
                "errorMessage" to "URI do arquivo de imagem ausente."
            )
        }

        var displayName: String? = null
        var declaredSize: Long = -1

        try {
            context.contentResolver.query(
                streamUri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null,
                read.signal,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex != -1) displayName = cursor.getString(nameIndex)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (sizeIndex != -1 && !cursor.isNull(sizeIndex)) declaredSize = cursor.getLong(sizeIndex)
                }
            }
        } catch (_: SecurityException) {
            // Content resolver query failed; continue with stream
        } catch (_: Exception) {
            // Ignore metadata query failures
        }
        read.checkCancelled()

        var effectiveFileName = safeFileName(displayName ?: streamUri.lastPathSegment ?: "cifra_compartilhada.png")
        val lower = effectiveFileName.lowercase()
        if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg") && !lower.endsWith(".webp")) {
            effectiveFileName = "$effectiveFileName.png"
        }

        if (declaredSize > MAX_IMAGE_SIZE_BYTES) {
            return mapOf(
                "type" to "image",
                "fileName" to effectiveFileName,
                "fileSize" to declaredSize,
                "error" to "FILE_TOO_LARGE",
                "errorMessage" to "Arquivo de imagem excede o limite máximo permitido de 5 MB."
            )
        }

        val cacheDir = File(context.cacheDir, "shared_imports").apply { if (!exists()) mkdirs() }
        val tempFile = read.trackFile(File.createTempFile("shared_", "_$effectiveFileName", cacheDir))

        try {
            openInputStream(streamUri, read)?.use { input ->
                read.checkCancelled()
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    var bytesRead: Int
                    var totalRead: Long = 0

                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        read.checkCancelled()
                        totalRead += bytesRead
                        if (totalRead > MAX_IMAGE_SIZE_BYTES) {
                            output.close()
                            tempFile.delete()
                            return mapOf(
                                "type" to "image",
                                "fileName" to effectiveFileName,
                                "fileSize" to totalRead,
                                "error" to "FILE_TOO_LARGE",
                                "errorMessage" to "Arquivo de imagem excede o limite máximo permitido de 5 MB."
                            )
                        }
                        output.write(buffer, 0, bytesRead)
                    }
                }
            } ?: run {
                tempFile.delete()
                return mapOf(
                    "type" to "image",
                    "fileName" to effectiveFileName,
                    "error" to "FILE_UNAVAILABLE",
                    "errorMessage" to "Não foi possível abrir a imagem compartilhada."
                )
            }
        } catch (_: SecurityException) {
            tempFile.delete()
            return mapOf(
                "type" to "image",
                "fileName" to effectiveFileName,
                "error" to "PERMISSION_DENIED",
                "errorMessage" to "Permissão de leitura negada pelo aplicativo de origem."
            )
        } catch (e: Exception) {
            tempFile.delete()
            return mapOf(
                "type" to "image",
                "fileName" to effectiveFileName,
                "error" to "FILE_READ_ERROR",
                "errorMessage" to "Falha ao ler a imagem compartilhada: ${e.message}"
            )
        }

        read.checkCancelled()
        if (tempFile.length() == 0L) {
            tempFile.delete()
            return mapOf(
                "type" to "image",
                "fileName" to effectiveFileName,
                "error" to "EMPTY_FILE",
                "errorMessage" to "Arquivo de imagem vazio."
            )
        }

        if (!isSupportedImageFile(tempFile)) {
            tempFile.delete()
            return mapOf(
                "type" to "image",
                "fileName" to effectiveFileName,
                "error" to "UNSUPPORTED_IMAGE_FORMAT",
                "errorMessage" to "A imagem deve estar no formato PNG, JPEG ou WebP."
            )
        }

        return mapOf(
            "type" to "image",
            "filePath" to tempFile.absolutePath,
            "fileName" to effectiveFileName,
            "fileSize" to tempFile.length()
        )
    }

    private fun openInputStream(uri: Uri, read: ReadOperation): InputStream? {
        read.checkCancelled()
        val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r", read.signal) ?: return null
        return try {
            val input = descriptor.createInputStream()
            try {
                read.trackInput(input)
            } catch (error: Exception) {
                input.close()
                throw error
            }
        } catch (error: Exception) {
            descriptor.close()
            throw error
        }
    }

    private fun isSupportedImageFile(file: File): Boolean {
        val header = ByteArray(12)
        return try {
            file.inputStream().use { input ->
                var offset = 0
                while (offset < header.size) {
                    val read = input.read(header, offset, header.size - offset)
                    if (read <= 0) break
                    offset += read
                }
                val isPng = offset >= 8 && header.copyOfRange(0, 8).contentEquals(
                    byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
                )
                val isJpeg = offset >= 3 &&
                    header[0] == 0xFF.toByte() && header[1] == 0xD8.toByte() && header[2] == 0xFF.toByte()
                val isWebp = offset >= 12 &&
                    String(header, 0, 4, Charsets.US_ASCII) == "RIFF" &&
                    String(header, 8, 4, Charsets.US_ASCII) == "WEBP"
                isPng || isJpeg || isWebp
            }
        } catch (_: IOException) {
            false
        }
    }

    private fun cleanupStaleCacheFiles() {
        val cacheDir = File(context.cacheDir, "shared_imports")
        val cutoff = System.currentTimeMillis() - STALE_CACHE_AGE_MS
        cacheDir.listFiles()
            ?.filter { it.isFile && it.name.startsWith("shared_") && it.lastModified() < cutoff }
            ?.forEach { it.delete() }
    }

    private fun safeFileName(value: String): String {
        val sanitized = value
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .filterNot { it.isISOControl() }
            .take(120)
        return sanitized.ifBlank { "arquivo_compartilhado" }
    }
}
