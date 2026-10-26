package com.louvaio.louvaio_mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

class ShareIntentHandler(private val context: Context) {

    companion object {
        const val MAX_PDF_SIZE_BYTES = 3L * 1024L * 1024L // 3 MiB
        private val PDF_MAGIC_BYTES = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2D) // "%PDF-"
    }

    private var initialIntentConsumed = false

    fun consumeInitialShare(intent: Intent?): Map<String, Any?>? {
        if (initialIntentConsumed || intent == null) return null
        if (intent.action != Intent.ACTION_SEND) return null

        initialIntentConsumed = true
        return processIntent(intent)
    }

    fun clearInitialShare() {
        initialIntentConsumed = true
    }

    fun processIntent(intent: Intent?): Map<String, Any?>? {
        if (intent == null || intent.action != Intent.ACTION_SEND) return null

        val mimeType = intent.type

        if (mimeType == null) {
            return mapOf(
                "type" to "error",
                "error" to "UNKNOWN_MIME_TYPE",
                "errorMessage" to "Tipo de conteúdo não especificado."
            )
        }

        if (mimeType.startsWith("text/")) {
            return processTextIntent(intent)
        }

        if (mimeType == "application/pdf" || mimeType.endsWith("/pdf")) {
            return processPdfIntent(intent)
        }

        return mapOf(
            "type" to "unsupported",
            "mimeType" to mimeType,
            "error" to "UNSUPPORTED_TYPE",
            "errorMessage" to "Tipo de arquivo não suportado. Compartilhe texto ou arquivo PDF."
        )
    }

    private fun processTextIntent(intent: Intent): Map<String, Any?> {
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            ?: (if (intent.clipData != null && intent.clipData!!.itemCount > 0) {
                intent.clipData!!.getItemAt(0).text?.toString()
            } else null)

        if (text.isNullOrBlank()) {
            return mapOf(
                "type" to "text",
                "error" to "EMPTY_TEXT",
                "errorMessage" to "O texto compartilhado está vazio."
            )
        }

        return mapOf(
            "type" to "text",
            "text" to text
        )
    }

    private fun processPdfIntent(intent: Intent): Map<String, Any?> {
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
                null
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

        var effectiveFileName = displayName ?: streamUri.lastPathSegment ?: "cifra_compartilhada.pdf"
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
        val tempFile = File(cacheDir, "shared_${System.currentTimeMillis()}.pdf")

        try {
            context.contentResolver.openInputStream(streamUri)?.use { input ->
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var totalRead: Long = 0

                    while (input.read(buffer).also { bytesRead = it } != -1) {
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
}
