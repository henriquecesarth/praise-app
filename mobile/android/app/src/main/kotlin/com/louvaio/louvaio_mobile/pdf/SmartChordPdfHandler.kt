package com.louvaio.louvaio_mobile.pdf

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.Locale

interface PdfExportBridge {
    fun writePdfFile(bytes: ByteArray, fileName: String): File
    fun launchShareChooser(file: File, title: String)
    fun launchPrintJob(file: File, jobName: String)
}

class SmartChordPdfHandler(
    private val context: Context,
    private val bridge: PdfExportBridge = AndroidPdfExportBridge(context),
) {
    companion object {
        const val MAX_PDF_EXPORT_BYTES = 10 * 1024 * 1024 // 10 MiB
        private val PDF_MAGIC = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2D) // %PDF-
        private const val SHARED_PDF_DIR = "shared_pdfs"
        private const val STALE_AGE_MS = 24L * 60L * 60L * 1000L

        fun sanitizeFileName(rawName: String?): String {
            val base = (rawName ?: "cifra_louvaio.pdf")
                .substringAfterLast('/')
                .substringAfterLast('\\')
                .trim()
                .replace(Regex("""[^A-Za-z0-9._-]"""), "_")
                .replace(Regex("""_+"""), "_")
                .trim('_', '.')
            val stem = base
                .removeSuffix(".pdf")
                .removeSuffix(".PDF")
                .trim('_', '.')
                .ifEmpty { "cifra_louvaio" }
                .take(80)
            return "$stem.pdf"
        }

        fun hasValidPdfHeader(bytes: ByteArray): Boolean {
            if (bytes.size < PDF_MAGIC.size || bytes.size > MAX_PDF_EXPORT_BYTES) {
                return false
            }
            for (i in PDF_MAGIC.indices) {
                if (bytes[i] != PDF_MAGIC[i]) return false
            }
            return true
        }
    }

    fun sharePdf(bytes: ByteArray, fileName: String?, title: String?): String {
        val safeName = sanitizeFileName(fileName)
        require(hasValidPdfHeader(bytes)) { "Payload PDF inválido ou acima do limite permitido." }
        val file = bridge.writePdfFile(bytes, safeName)
        val safeTitle = title?.trim()?.ifEmpty { null } ?: safeName
        bridge.launchShareChooser(file, safeTitle)
        return file.absolutePath
    }

    fun printPdf(bytes: ByteArray, jobName: String?): String {
        val safeName = sanitizeFileName(jobName)
        require(hasValidPdfHeader(bytes)) { "Payload PDF inválido ou acima do limite permitido." }
        val file = bridge.writePdfFile(bytes, safeName)
        val cleanJobName = jobName?.trim()?.ifEmpty { null } ?: "LouvAIO Cifra"
        bridge.launchPrintJob(file, cleanJobName)
        return file.absolutePath
    }

    class AndroidPdfExportBridge(private val context: Context) : PdfExportBridge {
        override fun writePdfFile(bytes: ByteArray, fileName: String): File {
            val dir = File(context.cacheDir, SHARED_PDF_DIR)
            if (!dir.exists() && !dir.mkdirs()) {
                throw IOException("Não foi possível criar diretório temporário de PDF.")
            }
            cleanupStaleFiles(dir)
            val target = File(dir, fileName)
            FileOutputStream(target).use { output ->
                output.write(bytes)
                output.flush()
            }
            return target
        }

        override fun launchShareChooser(file: File, title: String) {
            val authority = "${context.packageName}.fileprovider"
            val uri: Uri = FileProvider.getUriForFile(context, authority, file)
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(sendIntent, title).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (context !is android.app.Activity) {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            context.startActivity(chooser)
        }

        override fun launchPrintJob(file: File, jobName: String) {
            val manager = context.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                ?: throw IllegalStateException("Serviço de impressão indisponível neste dispositivo.")
            val adapter = FilePdfPrintDocumentAdapter(file, jobName)
            val attributes = PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .build()
            manager.print(jobName, adapter, attributes)
        }

        private fun cleanupStaleFiles(dir: File) {
            val cutoff = System.currentTimeMillis() - STALE_AGE_MS
            dir.listFiles()?.forEach { child ->
                if (child.isFile && child.name.lowercase(Locale.ROOT).endsWith(".pdf") && child.lastModified() < cutoff) {
                    child.delete()
                }
            }
        }
    }
}

class FilePdfPrintDocumentAdapter(
    private val pdfFile: File,
    private val documentName: String,
) : PrintDocumentAdapter() {
    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }
        val safeName = if (documentName.lowercase(Locale.ROOT).endsWith(".pdf")) {
            documentName
        } else {
            "$documentName.pdf"
        }
        val info = PrintDocumentInfo.Builder(safeName)
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
            .build()
        callback.onLayoutFinished(info, true)
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onWriteCancelled()
            return
        }
        try {
            FileInputStream(pdfFile).use { input ->
                FileOutputStream(destination.fileDescriptor).use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        if (cancellationSignal?.isCanceled == true) {
                            callback.onWriteCancelled()
                            return
                        }
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                }
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (ex: Exception) {
            callback.onWriteFailed(ex.message ?: "Falha ao gravar PDF para impressão.")
        }
    }
}
