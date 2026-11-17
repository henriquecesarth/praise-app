package com.louvaio.louvaio_mobile.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.io.path.createTempDirectory

class RehearsalPackageSafHandlerTest {

    @Test
    fun channelNameAndRequestCodesAreStableAndDistinct() {
        assertEquals(
            "com.louvaio.mobile/rehearsal_package_saf",
            RehearsalPackageSafHandler.CHANNEL_NAME,
        )
        assertEquals(8811, RehearsalPackageSafHandler.REQ_PICK_REHEARSAL_PACKAGE)
        assertEquals(8812, RehearsalPackageSafHandler.REQ_EXPORT_REHEARSAL_PACKAGE)
        assertNotEquals(
            RehearsalPackageSafHandler.REQ_PICK_REHEARSAL_PACKAGE,
            RehearsalPackageSafHandler.REQ_EXPORT_REHEARSAL_PACKAGE,
        )
        assertTrue(RehearsalPackageSafHandler.REQ_PICK_REHEARSAL_PACKAGE > 0)
        assertTrue(RehearsalPackageSafHandler.REQ_EXPORT_REHEARSAL_PACKAGE > 0)
    }

    @Test
    fun sanitizeExportFileNameStripsTraversalBackslashesControlAndIllegalChars() {
        assertEquals(
            "secret.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("../../secret"),
        )
        assertEquals(
            "ensaio_domingo.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("..\\..\\pasta\\sub\\ensaio_domingo"),
        )
        assertEquals(
            "culto_domingo.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("culto\u0000\u001F\u007F_domingo"),
        )
        assertEquals(
            "a_b_c_d_e_f_g_h.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("a<b>c:d\"e|f?g*h"),
        )
    }

    @Test
    fun sanitizeExportFileNameNormalizesZipAndExtensionSuffixes() {
        assertEquals(
            "meu-ensaio.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("meu-ensaio.zip"),
        )
        assertEquals(
            "meu-ensaio.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("meu-ensaio.ZIP"),
        )
        assertEquals(
            "meu-ensaio.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("meu-ensaio.louvaio-rehearsal.zip"),
        )
        assertEquals(
            "meu-ensaio.louvaio-rehearsal.zip",
            RehearsalPackageSafHandler.sanitizeExportFileName("meu-ensaio.LOUVAIO-REHEARSAL.ZIP"),
        )
    }

    @Test
    fun sanitizeExportFileNameTruncatesOver80CharsPreservingExtension() {
        val longName = "x".repeat(120) + ".louvaio-rehearsal.zip"
        val sanitized = RehearsalPackageSafHandler.sanitizeExportFileName(longName)
        assertEquals("${"x".repeat(80)}.louvaio-rehearsal.zip", sanitized)
        assertTrue(sanitized.endsWith(".louvaio-rehearsal.zip"))
    }

    @Test
    fun sanitizeExportFileNameFallsBackOnBlankDotsAndEmptyStem() {
        val fallback = "ensaio_louvaio.louvaio-rehearsal.zip"
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName(null))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName(""))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("   "))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("..."))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("___"))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("../../..."))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("..\\\\..\\\\___"))
        assertEquals(fallback, RehearsalPackageSafHandler.sanitizeExportFileName("   ...   "))
        assertEquals("zip.louvaio-rehearsal.zip", RehearsalPackageSafHandler.sanitizeExportFileName(".zip"))
    }

    @Test
    fun isInsideFilesDirEnforcesCanonicalPrefixContainment() {
        val root = createTempDirectory("louvaio-saf-test").toFile()
        try {
            val filesDir = File(root, "files").apply { mkdirs() }.canonicalFile
            val child = File(filesDir, "rehearsal_packages/staging/tx_1.part/pkg.zip").canonicalFile
            val siblingPrefix = File(root, "files_evil/a").canonicalFile
            val parentOutside = File(filesDir, "../outside").canonicalFile

            assertTrue(RehearsalPackageSafHandler.isInsideFilesDir(child, filesDir))
            assertFalse(RehearsalPackageSafHandler.isInsideFilesDir(siblingPrefix, filesDir))
            assertFalse(RehearsalPackageSafHandler.isInsideFilesDir(filesDir, filesDir))
            assertFalse(RehearsalPackageSafHandler.isInsideFilesDir(parentOutside, filesDir))
        } finally {
            root.deleteRecursively()
        }
    }
}
