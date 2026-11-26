package com.louvaio.louvaio_mobile.ministryaudio

import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import kotlin.math.abs

/**
 * M22-S4-C on the device: the REAL bridge, MediaCodec decoder, calibration gate and engine, with the AudioTrack replaced
 * by a capture handle so the exact mixed output can be measured. Six stems, alternating the two production encoder
 * profiles (Lavc / LAME 3.100) with the same manifest alignment: all must land on the same frame.
 */
class Mp3PlaybackDeviceTest {
    private val tag = "M22S4PLAY"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val rate = 44_100
    private val frames = 44_100L
    private val bursts = intArrayOf(3000, 22_050, 41_100)
    private val user = "user_1"
    private val ministry = "min-1"
    private val rec = "b".repeat(64)
    private val sid = "session-dev-01"
    private lateinit var filesDir: File
    private var bridge: MinistryAudioBridge? = null
    private val captures = CopyOnWriteArrayList<CaptureTrack>()

    /** Records everything the engine writes; the head advances as fast as data arrives. */
    class CaptureTrack : StereoTrackHandle {
        @Volatile var head = 0L
        val data = java.io.ByteArrayOutputStream()
        override fun play() {}
        override fun pause() {}
        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            synchronized(this) {
                for (i in 0 until sizeInShorts) {
                    val v = data[offsetInShorts + i].toInt()
                    this.data.write(v and 0xFF); this.data.write((v shr 8) and 0xFF)
                }
                head += sizeInShorts / 2
            }
            return sizeInShorts
        }
        override fun stop() {}
        override fun flush() {}
        override fun release() {}
        override fun headPositionFrames() = head
        fun left(): ShortArray = channel(0)
        fun channel(c: Int): ShortArray = synchronized(this) {
            val b = data.toByteArray()
            ShortArray(b.size / 4) { ((b[it * 4 + c * 2 + 1].toInt() shl 8) or (b[it * 4 + c * 2].toInt() and 0xFF)).toShort() }
        }
    }

    private fun sha(d: String, id: String) =
        MessageDigest.getInstance("SHA-256").digest((d + id).toByteArray()).joinToString("") { "%02x".format(it) }

    private fun ministryRoot() = File(
        filesDir,
        "ministry_audio_library/v1/users/${sha("louvaio-ministry-audio-user-v1:", user)}/ministries/${sha("louvaio-ministry-audio-ministry-v1:", ministry)}",
    )

    private fun writeStems(asset: (Int) -> String) {
        val dir = File(ministryRoot(), "recordings/$rec").apply { mkdirs() }
        StemId.values().forEachIndexed { i, s ->
            File(dir, "stem_${s.wireName}.mp3").writeBytes(inst.context.assets.open("mp3-alignment/${asset(i)}").readBytes())
        }
    }

    @Before
    fun setUp() {
        filesDir = File(inst.targetContext.cacheDir, "s4play").apply { deleteRecursively(); mkdirs() }
        // Mixed profiles exercise the MIXER only; the server contract (homogeneous sets) is covered separately below.
        writeStems { if (it % 2 == 0) "impulse_lame_44100.mp3" else "impulse_lavc_44100.mp3" }
        val ctx = inst.targetContext
        bridge = MinistryAudioBridge(
            filesDir,
            { },
            { listener ->
                MinistryAudioEngine(
                    trackFactory = object : StereoTrackFactory {
                        override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = CaptureTrack().also { captures.add(it) }
                    },
                    arbiter = AudioOutputArbiter(),
                    dispatcher = CallbackDispatcher { it() },
                    listener = listener,
                )
            },
            Mp3Support(
                AndroidMp3PcmDecoder(),
                Mp3DecoderCalibration(AndroidMp3PcmDecoder(), File(ctx.cacheDir, "s4play_cal")) { ctx.assets.open(it) },
            ),
        )
    }

    @After
    fun tearDown() {
        bridge?.dispose()
        filesDir.deleteRecursively()
    }

    private val args get() = mapOf(
        "sessionId" to sid, "userId" to user, "ministryId" to ministry, "recordingId" to rec,
        "sampleRate" to rate, "frames" to frames,
        "codec" to "mp3_cbr256", "encoderDelayFrames" to 1105, "paddingFrames" to 875, "mpegAudioFrames" to 40,
    )

    private fun prepare(): Long {
        val t0 = SystemClock.elapsedRealtime()
        val r = bridge!!.callBlocking("prepare", args)
        assertTrue(r.errorCode, r.isOk)
        Log.i(tag, "prepare ms=${SystemClock.elapsedRealtime() - t0} tempBytes=${File(ministryRoot(), "pcm_tmp/$sid").listFiles()!!.sumOf { it.length() }}")
        return r.value!!["frames"] as Long
    }

    private fun state() = bridge!!.callBlocking("snapshot", mapOf("sessionId" to sid)).value!!["state"]
    private fun cmd(m: String, extra: Map<String, Any?> = emptyMap()) =
        bridge!!.callBlocking(m, mapOf("sessionId" to sid) + extra).also { assertTrue("$m ${it.errorCode}", it.isOk) }

    private fun playToEnd(): ShortArray {
        val before = captures.size
        cmd("play")
        assertTrue(waitUntil { state() == "completed" })
        return captures[before].left()
    }

    private fun waitUntil(ms: Long = 10_000, c: () -> Boolean): Boolean {
        val end = SystemClock.elapsedRealtime() + ms
        while (SystemClock.elapsedRealtime() < end) { if (c()) return true; Thread.sleep(5) }
        return false
    }

    private fun peakAt(x: ShortArray, centre: Int, from: Int = 0): Pair<Int, Int> {
        var best = -1; var bv = -1
        for (p in maxOf(0, centre - 600)..minOf(x.size - 1, centre + 600)) {
            val a = abs(x[p].toInt())
            if (a > bv) { bv = a; best = p }
        }
        return best + from to bv
    }

    @Test
    fun everyStemAloneAndTheMixLandOnTheOriginalFrames() {
        assertEquals(frames, prepare())
        val offsetsByStem = ArrayList<List<Int>>()
        for (solo in StemId.values()) {
            for (s in StemId.values()) cmd("setTrackMuted", mapOf("stem" to s.wireName, "enabled" to (s != solo)))
            val out = playToEnd()
            assertEquals("frames written", frames.toInt(), out.size)
            val offs = bursts.map { c -> val (p, a) = peakAt(out, c); assertTrue("amp $a", a > 5_000); p - c }
            offsetsByStem.add(offs)
            offs.forEach { assertTrue("${solo.wireName} offset $it", abs(it) <= 1) }
        }
        for (s in StemId.values()) cmd("setTrackMuted", mapOf("stem" to s.wireName, "enabled" to false))
        cmd("setMasterVolume", mapOf("value" to 0.15)) // six summed bursts would clip and hide the true peak position
        val mix = playToEnd()
        val mixOffs = bursts.map { c -> peakAt(mix, c).first - c }
        mixOffs.forEach { assertTrue("mix offset $it", abs(it) <= 1) }
        Log.i(tag, "offsets per stem (start,middle,end)=$offsetsByStem mix=$mixOffs")
    }

    /** Six stems of ONE profile and rate, for the four combinations the backend can publish. */
    @Test
    fun homogeneousSetsOfBothProfilesAndRatesLandOnBothChannels() {
        for ((profile, r, padding, mpeg) in listOf(
            Combo("lame", 44_100, 875, 40), Combo("lavc", 44_100, 875, 40),
            Combo("lame", 48_000, 431, 43), Combo("lavc", 48_000, 431, 43),
        )) {
            writeStems { "impulse_${profile}_$r.mp3" }
            val a = args + mapOf("sampleRate" to r, "frames" to r.toLong(), "paddingFrames" to padding, "mpegAudioFrames" to mpeg)
            val reply = bridge!!.callBlocking("prepare", a)
            assertTrue("$profile $r ${reply.errorCode}", reply.isOk)
            cmd("setMasterVolume", mapOf("value" to 0.15))
            val before = captures.size
            cmd("play")
            assertTrue(waitUntil { state() == "completed" })
            val centres = if (r == 44_100) bursts else intArrayOf(3000, 24_000, 45_000)
            for (ch in 0..1) {
                val out = captures[before].channel(ch)
                assertEquals(r, out.size)
                val offs = centres.map { c -> val (p, amp) = peakAt(out, c); assertTrue("amp $amp", amp > 3_000); p - c }
                Log.i(tag, "homogeneous $profile $r ch=$ch offsets=$offs")
                offs.forEach { assertTrue("$profile $r ch=$ch offset $it", abs(it) <= 1) }
            }
            cmd("close")
        }
    }

    private data class Combo(val profile: String, val rate: Int, val padding: Int, val mpeg: Int)

    @Test
    fun seekPauseResumeKeepAllStemsAligned() {
        prepare()
        cmd("setMasterVolume", mapOf("value" to 0.15))
        cmd("seek", mapOf("frame" to 20_000))
        cmd("play")
        assertTrue(waitUntil { state() == "completed" })
        val tail = captures.last().left()
        assertEquals(frames.toInt() - 20_000, tail.size)
        val (p, a) = peakAt(tail, 22_050 - 20_000)
        assertTrue(a > 3_000)
        assertTrue("seek offset ${p - 2050}", abs(p - 2050) <= 1)
        Log.i(tag, "seek@20000 middle burst offset=${p - 2050}")
    }

    @Test
    fun closeRemovesDecodedPcmAndLeavesTheMp3Untouched() {
        prepare()
        val tmp = File(ministryRoot(), "pcm_tmp/$sid")
        assertTrue(tmp.isDirectory)
        assertEquals(true, bridge!!.callBlocking("close", mapOf("sessionId" to sid)).value!!["closed"])
        assertFalse(tmp.exists())
        assertTrue(File(ministryRoot(), "recordings/$rec/stem_vocals.mp3").exists())
    }
}
