package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.zip.CRC32
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * M22-S4.1 on the device with the ~298 s stems in <externalFilesDir>/s4long (skipped otherwise): production bridge,
 * decoder and calibration. Measures time to prepare, memory and temporary storage; proves the packed/parallel PCM equals
 * the one-frame-per-buffer reference; checks seeks against that linear PCM; and plays through a REAL AudioTrack at master
 * volume 0 counting underruns. Results are logged under tag M22S41.
 */
class Mp3LongPlaybackDeviceTest {
    private val tag = "M22S41"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val source get() = File(inst.targetContext.getExternalFilesDir(null), "s4long")
    private val user = "user_1"
    private val ministry = "min-1"
    private val rec = "c".repeat(64)
    private val sid = "session-long-1"
    private val filesDir by lazy { File(inst.targetContext.cacheDir, "s41long") }
    private var bridge: MinistryAudioBridge? = null

    private lateinit var alignment: Mp3Alignment
    private var rate = 0
    private var frames = 0L

    private fun sha(d: String, id: String) =
        MessageDigest.getInstance("SHA-256").digest((d + id).toByteArray()).joinToString("") { "%02x".format(it) }

    private fun ministryRoot() = File(
        filesDir,
        "ministry_audio_library/v1/users/${sha("louvaio-ministry-audio-user-v1:", user)}/ministries/${sha("louvaio-ministry-audio-ministry-v1:", ministry)}",
    )

    private fun setUpStems() {
        val cases = File(source, "cases.json")
        assumeTrue("long fixtures not pushed", cases.exists())
        val arr = JSONObject(cases.readText()).getJSONArray("cases")
        val first = arr.getJSONObject(0)
        rate = first.getInt("sampleRate")
        frames = first.getLong("frames")
        val a = first.getJSONObject("alignment")
        alignment = Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames"))
        filesDir.deleteRecursively()
        val dir = File(ministryRoot(), "recordings/$rec").apply { mkdirs() }
        StemId.values().forEachIndexed { i, s ->
            File(source, arr.getJSONObject(i).getString("file")).copyTo(File(dir, "stem_${s.wireName}.mp3"))
        }
    }

    @After
    fun tearDown() {
        bridge?.dispose()
        filesDir.deleteRecursively()
    }

    private fun newBridge(factory: StereoTrackFactory, parallel: Int = Mp3Support.DEFAULT_PARALLEL_STEMS): MinistryAudioBridge {
        val ctx = inst.targetContext
        val decoder = AndroidMp3PcmDecoder()
        return MinistryAudioBridge(
            filesDir,
            { },
            { listener ->
                MinistryAudioEngine(
                    trackFactory = factory,
                    arbiter = AudioOutputArbiter(),
                    dispatcher = CallbackDispatcher { it() },
                    listener = listener,
                )
            },
            Mp3Support(
                decoder,
                Mp3DecoderCalibration(decoder, File(ctx.cacheDir, "s41_cal")) { ctx.assets.open(it) },
                parallelStems = parallel,
            ),
        ).also { bridge = it }
    }

    private fun args() = mapOf(
        "sessionId" to sid, "userId" to user, "ministryId" to ministry, "recordingId" to rec,
        "sampleRate" to rate, "frames" to frames, "codec" to "mp3_cbr256",
        "encoderDelayFrames" to alignment.encoderDelayFrames, "paddingFrames" to alignment.paddingFrames,
        "mpegAudioFrames" to alignment.mpegAudioFrames,
    )

    private fun cmd(m: String, extra: Map<String, Any?> = emptyMap()) =
        bridge!!.callBlocking(m, mapOf("sessionId" to sid) + extra).also { assertTrue("$m ${it.errorCode}", it.isOk) }

    private fun snapshot() = bridge!!.callBlocking("snapshot", mapOf("sessionId" to sid)).value!!

    private fun waitUntil(ms: Long, c: () -> Boolean): Boolean {
        val end = SystemClock.elapsedRealtime() + ms
        while (SystemClock.elapsedRealtime() < end) {
            if (c()) return true
            Thread.sleep(2)
        }
        return false
    }

    /** Runs [block] while sampling process memory; returns (peak PSS KiB, peak Java KiB, peak native KiB). */
    private fun <T> sampling(block: () -> T): Pair<T, Triple<Long, Long, Long>> {
        var pss = 0L
        var javaKb = 0L
        var nativeKb = 0L
        val running = java.util.concurrent.atomic.AtomicBoolean(true)
        fun sample() {
            val rt = Runtime.getRuntime()
            pss = maxOf(pss, Debug.getPss())
            javaKb = maxOf(javaKb, (rt.totalMemory() - rt.freeMemory()) / 1024)
            nativeKb = maxOf(nativeKb, Debug.getNativeHeapAllocatedSize() / 1024)
        }
        sample()
        val t = Thread { while (running.get()) { sample(); Thread.sleep(50) } }.apply { start() }
        val v = try {
            block()
        } finally {
            running.set(false)
            t.join()
        }
        return v to Triple(pss, javaKb, nativeKb)
    }

    private val silentFactory = object : StereoTrackFactory {
        override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = error("not played")
    }

    private fun crcOfTemp(): List<Long> = StemId.values().map { s ->
        val crc = CRC32()
        File(ministryRoot(), "pcm_tmp/$sid/${s.fileName}").inputStream().use { i ->
            val b = ByteArray(1 shl 16)
            while (true) {
                val n = i.read(b)
                if (n < 0) break
                crc.update(b, 0, n)
            }
        }
        crc.value
    }

    @Test
    fun prepareTimeMemoryStorageAndPcmEquivalence() {
        setUpStems()
        val idle = sampling { Thread.sleep(200) }.second
        Log.i(tag, "memory idle pssKiB=${idle.first} javaKiB=${idle.second} nativeKiB=${idle.third}")

        val ctx = inst.targetContext
        val calibration = Mp3DecoderCalibration(AndroidMp3PcmDecoder(), File(ctx.cacheDir, "s41_cal2")) { ctx.assets.open(it) }
        var t0 = SystemClock.elapsedRealtime()
        val decoderName = calibration.requireVerified { false }
        Log.i(tag, "calibration ms=${SystemClock.elapsedRealtime() - t0} decoder=$decoderName")

        var optimized: List<Long>? = null
        // Run twice: the first prepare includes calibration (cold), the second does not.
        newBridge(silentFactory)
        // Timed runs are not sampled: Debug.getPss is expensive enough to distort them.
        for (run in listOf("cold", "warm", "sampled")) {
            t0 = SystemClock.elapsedRealtime()
            val (reply, mem) = if (run == "sampled") {
                sampling { bridge!!.callBlocking("prepare", args()) }
            } else {
                bridge!!.callBlocking("prepare", args()) to Triple(-1L, -1L, -1L)
            }
            val ms = SystemClock.elapsedRealtime() - t0
            assertTrue(reply.errorCode, reply.isOk)
            val temp = File(ministryRoot(), "pcm_tmp/$sid").listFiles()!!.sumOf { it.length() }
            Log.i(
                tag,
                "prepare $run parallel=${Mp3Support.DEFAULT_PARALLEL_STEMS} ms=$ms tempBytes=$temp " +
                    "peakPssKiB=${mem.first} peakJavaKiB=${mem.second} peakNativeKiB=${mem.third}",
            )
            optimized = crcOfTemp()
            cmd("close")
        }
        bridge!!.dispose()

        // Reference pump: one MPEG frame per input buffer, one stem at a time (only two stems, it is slow).
        val reference = AndroidMp3PcmDecoder(framesPerBuffer = 1)
        for (i in listOf(0, 5)) {
            val s = StemId.values()[i]
            val out = File(ctx.cacheDir, "s41_ref.wav.part")
            try {
                t0 = SystemClock.elapsedRealtime()
                Mp3StemDecoder.decodeToWav(
                    File(ministryRoot(), "recordings/$rec/stem_${s.wireName}.mp3"), out, rate, frames, alignment, reference, decoderName,
                ) { false }
                val crc = CRC32().apply { update(out.readBytes()) }.value
                Log.i(tag, "reference ${s.wireName} ms=${SystemClock.elapsedRealtime() - t0} samePcm=${crc == optimized!![i]}")
                assertEquals(optimized!![i], crc)
            } finally {
                out.delete()
            }
        }
    }

    /** Captures the first block written after each start; the head advances as data arrives. */
    private class FirstBlockTrack : StereoTrackHandle {
        @Volatile var head = 0L
        @Volatile var first: ShortArray? = null
        override fun play() {}
        override fun pause() {}
        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            if (first == null) first = data.copyOfRange(offsetInShorts, offsetInShorts + sizeInShorts)
            head += sizeInShorts / 2
            Thread.sleep(1)
            return sizeInShorts
        }
        override fun stop() {}
        override fun flush() {}
        override fun release() {}
        override fun headPositionFrames() = head
    }

    @Test
    fun repeatedSeeksMatchTheLinearPcm() {
        setUpStems()
        val tracks = java.util.concurrent.CopyOnWriteArrayList<FirstBlockTrack>()
        newBridge(object : StereoTrackFactory {
            override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = FirstBlockTrack().also { tracks.add(it) }
        })
        val reply = bridge!!.callBlocking("prepare", args())
        assertTrue(reply.errorCode, reply.isOk)
        // One stem solo at unity gain: the output after the 5 ms ramp must be that stem's linear PCM, bit for bit.
        cmd("setTrackSolo", mapOf("stem" to "bass", "enabled" to true))
        val wav = File(ministryRoot(), "pcm_tmp/$sid/${StemId.BASS.fileName}")
        val skip = rate / 100 // beyond the fade-in ramp
        val latencies = ArrayList<Long>()
        val targets = listOf(0L, frames / 2, frames - 20_000, rate.toLong(), frames / 2, 7L, frames - 20_000, frames / 3)
        for (target in targets) {
            cmd("stop")
            cmd("seek", mapOf("frame" to target))
            val before = tracks.size
            val t0 = System.nanoTime()
            cmd("play")
            assertTrue(waitUntil(5_000) { tracks.size > before && tracks[before].first != null })
            latencies.add((System.nanoTime() - t0) / 1_000_000)
            val got = tracks[before].first!!
            val expected = ByteArray(got.size * 2)
            RandomAccessFile(wav, "r").use { f ->
                f.seek(44 + target * 4)
                f.readFully(expected)
            }
            val shorts = ShortArray(got.size) {
                ((expected[it * 2 + 1].toInt() shl 8) or (expected[it * 2].toInt() and 0xFF)).toShort()
            }
            val from = skip * 2
            assertTrue("block too short ${got.size}", got.size > from + 512)
            assertArrayEquals("seek to $target", shorts.copyOfRange(from, got.size), got.copyOfRange(from, got.size))
        }
        Log.i(tag, "seek playToFirstBlockMs=$latencies targets=$targets bitExact=true")
    }

    private class RealTrack(val track: AudioTrack) : StereoTrackHandle {
        @Volatile var underruns = 0
        @Volatile var firstWriteNs = 0L
        override fun play() = track.play()
        override fun pause() = track.pause()
        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            val n = track.write(data, offsetInShorts, sizeInShorts, AudioTrack.WRITE_BLOCKING)
            if (firstWriteNs == 0L) firstWriteNs = System.nanoTime()
            underruns = track.underrunCount
            return n
        }
        override fun stop() = track.stop()
        override fun flush() = track.flush()
        override fun release() = track.release()
        override fun headPositionFrames() = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
    }

    @Test
    fun realAudioTrackPlaybackWithSeeksCountsUnderruns() {
        setUpStems()
        var real: RealTrack? = null
        newBridge(object : StereoTrackFactory {
            override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle {
                val min = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
                val track = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
                    .setAudioFormat(
                        AudioFormat.Builder().setSampleRate(sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build(),
                    )
                    .setBufferSizeInBytes(maxOf(min, bufferFrames * 4))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                return RealTrack(track).also { real = it }
            }
        })
        val reply = bridge!!.callBlocking("prepare", args())
        assertTrue(reply.errorCode, reply.isOk)
        cmd("setMasterVolume", mapOf("value" to 0.0)) // inaudible; all six stems are still read and mixed
        val t0 = System.nanoTime()
        cmd("play")
        assertTrue(waitUntil(5_000) { (snapshot()["positionFrames"] as Long) > 0 })
        val firstMs = (System.nanoTime() - t0) / 1_000_000
        Thread.sleep(40_000)
        val position = snapshot()["positionFrames"] as Long
        val steady = real!!.underruns
        val seekMs = ArrayList<Long>()
        for (target in listOf(frames / 2, 0L, frames - rate * 8L, rate * 30L)) {
            val s0 = System.nanoTime()
            cmd("seek", mapOf("frame" to target))
            // the position equals the target while the seek is pending; wait until playback moves past it
            assertTrue(waitUntil(5_000) { (snapshot()["positionFrames"] as Long) > target })
            seekMs.add((System.nanoTime() - s0) / 1_000_000)
            Thread.sleep(3_000)
        }
        cmd("pause")
        val paused = snapshot()["positionFrames"] as Long
        Thread.sleep(500)
        cmd("resume")
        Thread.sleep(2_000)
        assertTrue((snapshot()["positionFrames"] as Long) > paused)
        assertEquals("playing", snapshot()["state"])
        Log.i(
            tag,
            "realTrack firstPositionMs=$firstMs positionAfter40s=$position expected~${rate * 40L} " +
                "underrunsSteady40s=$steady underrunsAfterSeeksPause=${real!!.underruns} seekToMovingMs=$seekMs",
        )
        cmd("stop")
        cmd("close")
    }
}
