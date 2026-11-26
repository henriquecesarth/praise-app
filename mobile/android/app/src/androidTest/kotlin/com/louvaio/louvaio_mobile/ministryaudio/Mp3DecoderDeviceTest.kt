package com.louvaio.louvaio_mobile.ministryaudio

import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.math.abs

/**
 * M22-S4-B on-device evidence (real MediaCodec): alignment of impulse fixtures of BOTH encoder profiles at 44.1/48 kHz
 * (start, middle, end), the calibration gate, cancellation and, when the long fixtures were pushed, 298 s timing and
 * memory. Results are logged under tag M22S4DEV.
 *
 * Optional long fixtures: <externalFilesDir>/s4long/{cases.json, stem_*.mp3} (see the S4 doc for how they are made).
 */
class Mp3DecoderDeviceTest {
    private val tag = "M22S4DEV"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val scratch get() = File(inst.targetContext.cacheDir, "s4dev").apply { mkdirs() }

    private fun alignmentOf(o: JSONObject) =
        Mp3Alignment(o.getInt("encoderDelayFrames"), o.getInt("paddingFrames"), o.getInt("mpegAudioFrames"))

    private fun peak(wav: ByteArray, centre: Int, frames: Int): Pair<Int, Int> {
        val lo = maxOf(0, centre - 600)
        val hi = minOf(frames - 1, centre + 600)
        var best = lo
        var bv = -1
        for (p in lo..hi) {
            val i = 44 + p * 4
            val v = abs((wav[i + 1].toInt() shl 8) or (wav[i].toInt() and 0xFF))
            if (v > bv) { bv = v; best = p }
        }
        return best to bv
    }

    @Test
    fun impulseFixturesAreSampleAlignedForBothProfiles() {
        val cases = JSONObject(inst.context.assets.open("mp3-alignment/cases.json").bufferedReader().readText()).getJSONArray("cases")
        val decoder = AndroidMp3PcmDecoder()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val mp3 = File(scratch, "in.mp3").apply { writeBytes(inst.context.assets.open("mp3-alignment/" + c.getString("file")).readBytes()) }
            val out = File(scratch, "out.wav.part")
            val rate = c.getInt("sampleRate")
            val frames = c.getInt("frames")
            Mp3StemDecoder.decodeToWav(mp3, out, rate, frames.toLong(), alignmentOf(c.getJSONObject("alignment")), decoder) { false }
            val wav = out.readBytes()
            assertEquals(44L + frames * 4L, wav.size.toLong())
            FileStemSource.open(out).use { assertEquals(frames.toLong(), WavV1.parse(it).frames) }
            val b = c.getJSONArray("bursts")
            val offs = (0 until b.length()).map { k ->
                val centre = b.getInt(k)
                val (p, amp) = peak(wav, centre, frames)
                assertTrue("amp $amp", amp > 20_000)
                p - centre
            }
            Log.i(tag, "${c.getString("name")} offsets(start,middle,end)=$offs")
            offs.forEach { assertTrue("${c.getString("name")} offset $it", abs(it) <= 1) }
            mp3.delete(); out.delete()
        }
    }

    @Test
    fun calibrationGateVerifiesThisDevice() {
        val cal = Mp3DecoderCalibration(AndroidMp3PcmDecoder(), scratch) { inst.targetContext.assets.open(it) }
        val t0 = SystemClock.elapsedRealtime()
        val name = cal.requireVerified { false }
        Log.i(tag, "calibration ms=${SystemClock.elapsedRealtime() - t0} decoder=$name")
        assertEquals(name, cal.requireVerified { false }) // cached
    }

    @Test
    fun cancellationStopsDecodingAndLeavesNothing() {
        val mp3 = File(scratch, "c.mp3").apply { writeBytes(inst.context.assets.open("mp3-alignment/impulse_lame_44100.mp3").readBytes()) }
        val out = File(scratch, "c.wav.part")
        try {
            Mp3StemDecoder.decodeToWav(mp3, out, 44_100, 44_100, Mp3Alignment(1105, 875, 40), AndroidMp3PcmDecoder()) { true }
            fail("expected CANCELLED")
        } catch (e: MinistryAudioException) {
            assertEquals(MinistryAudioException.CANCELLED, e.code)
        }
        assertTrue(!out.exists())
        mp3.delete()
    }

    @Test
    fun corruptOrWrongProfileIsRefusedWithoutOutput() {
        val garbage = File(scratch, "g.mp3").apply { writeBytes(ByteArray(5000) { (it * 31).toByte() }) }
        val out = File(scratch, "g.wav.part")
        try {
            Mp3StemDecoder.decodeToWav(garbage, out, 44_100, 44_100, Mp3Alignment(1105, 875, 40), AndroidMp3PcmDecoder()) { false }
            fail("expected failure")
        } catch (e: MinistryAudioException) {
            assertTrue(e.code, e.code == MinistryAudioException.MP3_DECODE_FAILED || e.code == MinistryAudioException.MP3_UNSUPPORTED)
        }
        assertTrue(!out.exists())
        garbage.delete()
        // right audio, wrong manifest (frames/alignment): refused, never padded or cut
        val mp3 = File(scratch, "w.mp3").apply { writeBytes(inst.context.assets.open("mp3-alignment/impulse_lavc_44100.mp3").readBytes()) }
        try {
            Mp3StemDecoder.decodeToWav(mp3, out, 44_100, 44_000, Mp3Alignment(1105, 975, 40), AndroidMp3PcmDecoder()) { false }
            fail("expected mismatch")
        } catch (e: MinistryAudioException) {
            assertTrue(e.code, e.code == MinistryAudioException.MP3_LENGTH_MISMATCH || e.code == MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED)
        }
        assertTrue(!out.exists())
        mp3.delete()
    }

    @Test
    fun longStemsTimingAndMemory() {
        val dir = File(inst.targetContext.getExternalFilesDir(null), "s4long")
        val cases = File(dir, "cases.json")
        if (!cases.exists()) { Log.i(tag, "long fixtures not pushed: skipped"); return }
        val arr = JSONObject(cases.readText()).getJSONArray("cases")
        val decoder = AndroidMp3PcmDecoder()
        var totalMs = 0L
        var peakJava = 0L
        var peakNative = 0L
        var tmpBytes = 0L
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            val out = File(scratch, "long_$i.wav.part")
            val t0 = SystemClock.elapsedRealtime()
            Mp3StemDecoder.decodeToWav(File(dir, c.getString("file")), out, c.getInt("sampleRate"), c.getLong("frames"), alignmentOf(c.getJSONObject("alignment")), decoder) { false }
            val ms = SystemClock.elapsedRealtime() - t0
            totalMs += ms
            val rt = Runtime.getRuntime()
            peakJava = maxOf(peakJava, rt.totalMemory() - rt.freeMemory())
            peakNative = maxOf(peakNative, Debug.getNativeHeapAllocatedSize())
            tmpBytes += out.length()
            Log.i(tag, "long ${c.getString("file")} frames=${c.getLong("frames")} ms=$ms tempBytes=${out.length()}")
            assertEquals(44L + c.getLong("frames") * 4, out.length())
            out.delete()
        }
        Log.i(tag, "long TOTAL ms=$totalMs stems=${arr.length()} tempBytesAllStems=$tmpBytes javaHeapUsedAfter=$peakJava nativeHeapAllocated=$peakNative")
    }
}
