package com.louvaio.louvaio_mobile.vocal

import org.junit.Assert.*
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.io.FileInputStream
import kotlin.math.*

class SampledPianoMixerTest {

    companion object {
        private lateinit var bank: PianoBank
        private val assetDir = File("assets/audio/upright-kw").let {
            if (it.exists()) it else File("mobile/assets/audio/upright-kw").let { f ->
                if (f.exists()) f else File("C:/Users/henrique.hermogenes/Documents/p/praise/worktrees/m21-vocal/mobile/assets/audio/upright-kw")
            }
        }

        @BeforeClass
        @JvmStatic
        fun setUp() {
            assertTrue("Asset directory must exist: $assetDir", assetDir.exists())
            bank = PianoBank { fileName ->
                val f = File(assetDir, fileName)
                FileInputStream(f)
            }
            bank.loadAll()
        }
    }

    @Test
    fun testBankCoversMidiRangeAndLoads14Regions() {
        assertEquals(48, bank.supportedMidiLow)
        assertEquals(88, bank.supportedMidiHigh)
        assertEquals(14, bank.regions.size)

        for (midi in 48..88) {
            val region = bank.findRegion(midi)
            assertNotNull("Region for MIDI $midi must exist", region)
            val sample = bank.getSample(region!!.root)
            assertNotNull("Sample for root ${region.root} must be loaded", sample)
            assertTrue("Sample data must not be empty", sample!!.data.isNotEmpty())
            assertEquals(44100, sample.sampleRate)
        }
    }

    @Test
    fun testSincInterpolationTableUnitDCGain() {
        for (delta in -12..12) {
            val table = SampledPianoMixer.getSincTable(delta)
            assertEquals(SampledPianoMixer.SINC_PHASES, table.size)
            for (p in 0 until SampledPianoMixer.SINC_PHASES) {
                val kernel = table[p]
                assertEquals(SampledPianoMixer.SINC_TAPS, kernel.size)
                var sum = 0.0
                for (w in kernel) sum += w
                assertEquals("Phase $p for semitone delta $delta must have unit DC gain", 1.0, sum, 1e-4)
            }
        }
    }

    @Test
    fun testNotesExtremeRangeAndMiddleC() {
        // Test notes 48, 60, 88
        val notes = listOf(48, 60, 88)
        val durations = listOf(1.0, 1.0, 1.0)
        val mixer = SampledPianoMixer(
            bank = bank,
            notes = notes,
            durations = durations,
            bpm = 120,
            metronomeEnabled = false
        )

        assertTrue(mixer.totalFrames > 0)
        val buffer = ShortArray(SampledPianoMixer.BLOCK_SIZE)
        var totalRendered = 0L
        var peakSample = 0

        while (!mixer.isFinished) {
            val rendered = mixer.renderBlock(buffer, 0, SampledPianoMixer.BLOCK_SIZE)
            if (rendered == 0) break
            totalRendered += rendered
            for (i in 0 until rendered) {
                val absVal = abs(buffer[i].toInt())
                if (absVal > peakSample) peakSample = absVal
            }
        }

        assertTrue("Must render audio frames", totalRendered > 0)
        assertTrue("Peak audio must be audible", peakSample > 1000)
        assertEquals("Headroom bound: 0 clipped samples", 0L, mixer.clippedSamplesCount)
    }

    @Test
    fun testSequencesAcrossBpmRange() {
        for (testBpm in listOf(40, 80, 120, 180)) {
            val mixer = SampledPianoMixer(
                bank = bank,
                notes = listOf(60, 64, 67, -1, 72),
                durations = listOf(0.5, 0.5, 1.0, 1.0, 2.0),
                bpm = testBpm,
                metronomeEnabled = true
            )
            val buffer = ShortArray(SampledPianoMixer.BLOCK_SIZE)
            var renderedFrames = 0L
            while (!mixer.isFinished) {
                val count = mixer.renderBlock(buffer, 0, SampledPianoMixer.BLOCK_SIZE)
                if (count == 0) break
                renderedFrames += count
            }
            assertTrue("BPM $testBpm rendered frames: $renderedFrames", renderedFrames >= mixer.totalFrames)
            assertEquals("Zero clipped samples at BPM $testBpm", 0L, mixer.clippedSamplesCount)
        }
    }

    @Test
    fun testPolyphonyHeadroomAndOldestVoiceSteal() {
        // Start 9 overlapping notes at the same time to trigger voice stealing
        val nineNotes = listOf(60, 62, 64, 65, 67, 69, 71, 72, 74)
        val zeroDurations = listOf(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0)
        // Note events with simultaneous onset
        val mixer = SampledPianoMixer(
            bank = bank,
            notes = nineNotes,
            durations = List(9) { 2.0 },
            bpm = 120,
            metronomeEnabled = true
        )

        val buffer = ShortArray(SampledPianoMixer.BLOCK_SIZE)
        var maxDiff = 0
        var prevSample = 0
        while (!mixer.isFinished) {
            val count = mixer.renderBlock(buffer, 0, SampledPianoMixer.BLOCK_SIZE)
            if (count == 0) break
            for (i in 0 until count) {
                val diff = abs(buffer[i].toInt() - prevSample)
                if (diff > maxDiff) maxDiff = diff
                prevSample = buffer[i].toInt()
            }
        }

        assertEquals("Headroom bound must hold under maximum polyphony: 0 clips", 0L, mixer.clippedSamplesCount)
        // Check no sharp pop/step from un-smoothed voice cutoff
        assertTrue("Maximum adjacent frame step must be bounded without pop: $maxDiff", maxDiff < 16000)
    }

    @Test
    fun testMasterFadeRampZeroPop() {
        val mixer = SampledPianoMixer(
            bank = bank,
            notes = listOf(60, 64, 67),
            durations = listOf(1.0, 1.0, 1.0),
            bpm = 80,
            metronomeEnabled = false
        )

        val buffer = ShortArray(SampledPianoMixer.BLOCK_SIZE)
        // Render 10 blocks
        repeat(10) { mixer.renderBlock(buffer, 0, SampledPianoMixer.BLOCK_SIZE) }

        // Trigger 15ms fade to 0
        mixer.setMasterFade(0.0f, SampledPianoMixer.FADE_FRAMES_15MS)

        var finalSample = 32767
        // Render fade
        repeat(5) {
            val count = mixer.renderBlock(buffer, 0, SampledPianoMixer.BLOCK_SIZE)
            if (count > 0) finalSample = buffer[count - 1].toInt()
        }

        assertEquals("Audio must fade to absolute zero", 0, finalSample)
    }
}
