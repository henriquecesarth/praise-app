package com.louvaio.louvaio_mobile.pdf

import android.content.ContextWrapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

class SmartChordPdfHandlerTest {

    private class FakeCacheContext(private val tempCacheDir: File) : ContextWrapper(null) {
        override fun getCacheDir(): File = tempCacheDir
        override fun getPackageName(): String = "com.louvaio.app.test"
    }

    private class RecordingPdfBridge(private val rootDir: File) : PdfExportBridge {
        var lastWrittenFile: File? = null
        var lastWrittenBytes: ByteArray? = null
        var sharedFile: File? = null
        var sharedTitle: String? = null
        var printedFile: File? = null
        var printedJobName: String? = null

        override fun writePdfFile(bytes: ByteArray, fileName: String): File {
            val out = File(rootDir, fileName)
            out.writeBytes(bytes)
            lastWrittenFile = out
            lastWrittenBytes = bytes
            return out
        }

        override fun launchShareChooser(file: File, title: String) {
            sharedFile = file
            sharedTitle = title
        }

        override fun launchPrintJob(file: File, jobName: String) {
            printedFile = file
            printedJobName = jobName
        }
    }

    @Test
    fun sanitizeFileNamePreventsTraversalAndEnforcesPdfExtension() {
        assertEquals("Gra_a_Infinita.pdf", SmartChordPdfHandler.sanitizeFileName("../../Graça Infinita"))
        assertEquals("Infinita.pdf", SmartChordPdfHandler.sanitizeFileName("../../pasta/subpasta/Infinita"))
        assertEquals("Louvor_Culto.pdf", SmartChordPdfHandler.sanitizeFileName("Louvor Culto.PDF"))
        assertEquals("cifra_louvaio.pdf", SmartChordPdfHandler.sanitizeFileName("...///"))
    }

    @Test
    fun sharePdfValidatesMagicHeaderWritesFileAndLaunchesShareChooser() {
        val tempDir = createTempDirectory("louvaio-pdf-test").toFile()
        try {
            val bridge = RecordingPdfBridge(tempDir)
            val handler = SmartChordPdfHandler(
                context = FakeCacheContext(tempDir),
                bridge = bridge,
            )
            val pdfBytes = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n".toByteArray(Charsets.US_ASCII)

            val outputPath = handler.sharePdf(pdfBytes, "../../Graca Infinita", "Graça Infinita (G)")

            assertTrue(File(outputPath).exists())
            assertEquals("Graca_Infinita.pdf", bridge.lastWrittenFile?.name)
            assertEquals("Graça Infinita (G)", bridge.sharedTitle)
            assertEquals(outputPath, bridge.sharedFile?.absolutePath)
            assertTrue(SmartChordPdfHandler.hasValidPdfHeader(bridge.lastWrittenBytes!!))
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun printPdfValidatesMagicHeaderAndLaunchesPrintJob() {
        val tempDir = createTempDirectory("louvaio-pdf-print").toFile()
        try {
            val bridge = RecordingPdfBridge(tempDir)
            val handler = SmartChordPdfHandler(
                context = FakeCacheContext(tempDir),
                bridge = bridge,
            )
            val pdfBytes = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n".toByteArray(Charsets.US_ASCII)

            val outputPath = handler.printPdf(pdfBytes, "Santo Espirito - G")

            assertTrue(File(outputPath).exists())
            assertEquals("Santo_Espirito_-_G.pdf", bridge.printedFile?.name)
            assertEquals("Santo Espirito - G", bridge.printedJobName)
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun androidBridgeWritesPdfIntoSharedCacheAndPrunesStalePdfs() {
        val tempDir = createTempDirectory("louvaio-pdf-bridge").toFile()
        try {
            val sharedDir = File(tempDir, "shared_pdfs").apply { mkdirs() }
            val stale = File(sharedDir, "stale.pdf").apply {
                writeText("old")
                setLastModified(System.currentTimeMillis() - (26L * 60L * 60L * 1000L))
            }
            val freshOther = File(sharedDir, "fresh.pdf").apply {
                writeText("keep")
                setLastModified(System.currentTimeMillis())
            }

            val bridge = SmartChordPdfHandler.AndroidPdfExportBridge(FakeCacheContext(tempDir))
            val pdfBytes = "%PDF-1.4\n%%EOF\n".toByteArray(Charsets.US_ASCII)
            val written = bridge.writePdfFile(pdfBytes, "culto.pdf")

            assertTrue(written.exists())
            assertEquals(sharedDir.absolutePath, written.parentFile?.absolutePath)
            assertFalse("Stale cached PDF older than 24h must be pruned", stale.exists())
            assertTrue("Fresh cached PDF must remain", freshOther.exists())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun rejectsNonPdfOrOversizedPayloads() {
        val tempDir = createTempDirectory("louvaio-pdf-reject").toFile()
        try {
            val bridge = RecordingPdfBridge(tempDir)
            val handler = SmartChordPdfHandler(context = FakeCacheContext(tempDir), bridge = bridge)
            assertFalse(SmartChordPdfHandler.hasValidPdfHeader("Plain text clipboard".toByteArray()))
            assertThrows(IllegalArgumentException::class.java) {
                handler.sharePdf("Not a PDF".toByteArray(), "bad.pdf", "Bad")
            }
            assertThrows(IllegalArgumentException::class.java) {
                handler.printPdf(ByteArray(0), "Empty")
            }
        } finally {
            tempDir.deleteRecursively()
        }
    }
}
