package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * M22-S4.2 homologation of the incremental path on a real device: production bridge, engine, validator, calibration and
 * platform codecs. The reference is the production FULL decode of the same files mixed by the same [MixerCore].
 *
 * Long sets (skipped when absent): <externalFilesDir>/s4long (LAME 3.100, 44.1 kHz) and s42lavc48 (Lavc, 48 kHz), each
 * ~298 s with a cases.json. Real-track runs use master volume 0. Results are logged under tag M22S42. Not covered here:
 * online revalidation and download (Dart + backend), physical headphone removal, human listening.
 */
class Mp3IncrementalDeviceTest {
    private val tag = "M22S42"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val ctx get() = inst.targetContext
    private val user = "user_1"
    private val ministry = "min-1"
    private val sid = "session-s42-1"
    private val root by lazy { File(ctx.cacheDir, "s42dev") }
    private var bridge: MinistryAudioBridge? = null
    private val states = CopyOnWriteArrayList<Pair<String, String?>>()

    private class Recording(
        val name: String,
        val id: String,
        val rate: Int,
        val frames: Long,
        val alignment: Mp3Alignment,
        val stems: Map<StemId, File>,
    )

    @After
    fun tearDown() {
        bridge?.dispose()
        root.deleteRecursively()
        assertTrue("producer threads left", await(5_000) { producers() == 0 })
    }

    // ----------------------------------------------------------------- fixtures

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun sha(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun shaOf(f: File): String {
        val d = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i ->
            val b = ByteArray(1 shl 16)
            while (true) {
                val n = i.read(b)
                if (n < 0) break
                d.update(b, 0, n)
            }
        }
        return hex(d.digest())
    }

    private fun ministryRoot() = File(
        root,
        "ministry_audio_library/v1/users/${sha("louvaio-ministry-audio-user-v1:$user".toByteArray())}/ministries/" +
            sha("louvaio-ministry-audio-ministry-v1:$ministry".toByteArray()),
    )

    private fun install(name: String, idChar: Char, rate: Int, frames: Long, alignment: Mp3Alignment, source: (Int) -> ByteArray): Recording {
        val id = idChar.toString().repeat(64)
        val dir = File(ministryRoot(), "recordings/$id").apply { mkdirs() }
        val stems = StemId.values().mapIndexed { i, s ->
            s to File(dir, "stem_${s.wireName}.mp3").apply { if (!exists()) writeBytes(source(i)) }
        }.toMap()
        return Recording(name, id, rate, frames, alignment, stems)
    }

    private fun long(folder: String, idChar: Char): Recording? {
        val dir = File(ctx.getExternalFilesDir(null), folder)
        val cases = File(dir, "cases.json")
        if (!cases.exists()) return null
        val arr = JSONObject(cases.readText()).getJSONArray("cases")
        val c = arr.getJSONObject(0)
        val a = c.getJSONObject("alignment")
        return install(
            folder, idChar, c.getInt("sampleRate"), c.getLong("frames"),
            Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames")),
        ) { File(dir, arr.getJSONObject(it).getString("file")).readBytes() }
    }

    private fun lame() = long("s4long", 'a')
    private fun lavc() = long("s42lavc48", 'b')

    private fun longSets(): List<Recording> {
        val sets = listOfNotNull(lame(), lavc())
        assumeTrue("long fixtures not pushed", sets.isNotEmpty())
        return sets
    }

    private fun shortSets(): List<Recording> {
        val cases = JSONObject(inst.context.assets.open("mp3-alignment/cases.json").bufferedReader().readText()).getJSONArray("cases")
        return (0 until cases.length()).map { i ->
            val c = cases.getJSONObject(i)
            val a = c.getJSONObject("alignment")
            val bytes = inst.context.assets.open("mp3-alignment/" + c.getString("file")).readBytes()
            install(
                c.getString("name"), '1' + i, c.getInt("sampleRate"), c.getLong("frames"),
                Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames")),
            ) { bytes }
        }
    }

    // ------------------------------------------------------------------- tracks

    /** Real AudioTrack with the production parameters, plus what the test needs to measure. */
    private class Measured(private val track: AudioTrack) : StereoTrackHandle {
        val firstWriteAt = AtomicLong()
        val written = AtomicLong()
        @Volatile var released = false
        @Volatile private var lastUnderruns = 0
        val underruns: Int get() = if (released) lastUnderruns else track.underrunCount.also { lastUnderruns = it }
        val head: Long get() = if (released) 0 else track.playbackHeadPosition.toLong() and 0xFFFFFFFFL

        override fun play() = track.play()
        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            val n = track.write(data, offsetInShorts, sizeInShorts, AudioTrack.WRITE_BLOCKING)
            if (n > 0) {
                firstWriteAt.compareAndSet(0, SystemClock.elapsedRealtime())
                written.addAndGet(n.toLong())
            }
            return n
        }
        /** Only the drain silence is written this way; it is not counted in [written]. */
        override fun writeNonBlocking(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
            track.write(data, offsetInShorts, sizeInShorts, AudioTrack.WRITE_NON_BLOCKING).also {
                if (it > 0) padded.addAndGet(it.toLong())
            }
        val padded = AtomicLong()
        /** The release path pauses before it flushes, so the last pause sees what was really played. */
        @Volatile var headAtLastPause = 0L
        override fun pause() {
            headAtLastPause = head
            track.pause()
        }
        override fun stop() = track.stop()
        override fun flush() = track.flush()
        override fun release() {
            lastUnderruns = track.underrunCount
            released = true
            track.release()
        }
        override fun headPositionFrames() = head
    }

    private val measured = CopyOnWriteArrayList<Measured>()
    private val realTracks = object : StereoTrackFactory {
        override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle {
            val min = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder().setSampleRate(sampleRate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build(),
                )
                .setBufferSizeInBytes(maxOf(min, bufferFrames * WavV1.BYTES_PER_FRAME))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            return Measured(track).also { measured.add(it) }
        }
    }

    /** Silent capture that compares every sample (both channels) with the full-decode mix as it is written. */
    private class Comparing(private val reference: MixerCore) : StereoTrackHandle {
        /** Where the reference goes at the next flush (a seek flushes the track before moving the mixer). */
        val target = AtomicLong(-1)
        val compared = AtomicLong()
        val firstDifference = AtomicLong(-1)
        private val block = ShortArray(reference.chunkFrames * 2)
        private var at = 0
        private var size = 0
        private var shorts = 0L
        @Volatile var paused = false

        fun restart(frame: Long) = synchronized(this) {
            reference.seek(frame)
            at = 0
            size = 0
        }

        override fun play() { paused = false }
        override fun pause() { paused = true }
        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            if (paused) return 0
            synchronized(this) {
                for (i in 0 until sizeInShorts) {
                    if (at == size) {
                        size = reference.render(block, reference.chunkFrames) * 2
                        at = 0
                        if (size == 0) {
                            firstDifference.compareAndSet(-1, compared.get())
                            return sizeInShorts
                        }
                    }
                    if (data[offsetInShorts + i] != block[at]) firstDifference.compareAndSet(-1, compared.get())
                    at++
                    compared.incrementAndGet()
                }
                shorts += sizeInShorts
            }
            return sizeInShorts
        }
        override fun stop() = Unit
        override fun flush() {
            val t = target.get()
            if (t >= 0) restart(t)
        }
        override fun release() = Unit
        override fun headPositionFrames(): Long = synchronized(this) { shorts / 2 }
    }

    /** The production full decode of [r], mixed by the production mixer. */
    private fun reference(r: Recording): MixerCore {
        val dir = File(root, "ref/${r.name}").apply { mkdirs() }
        val decoder = AndroidMp3PcmDecoder()
        val wavs = StemId.values().map { s ->
            File(dir, s.fileName).also {
                if (!it.exists()) Mp3StemDecoder.decodeToWav(r.stems.getValue(s), it, r.rate, r.frames, r.alignment, decoder) { false }
            }
        }
        return MixerCore(wavs.map { FileStemSource.open(it) }, r.rate, r.frames)
    }

    // ------------------------------------------------------------------- bridge

    /** Platform decoder with injectable trouble on one stem, chosen by raw output byte offset of the window. */
    private class Faulty(private val inner: AndroidMp3PcmDecoder = AndroidMp3PcmDecoder()) : Mp3WindowDecoder {
        @Volatile var stem: String? = null
        @Volatile var stallAtByte = -1L
        @Volatile var stallMs = 0L
        @Volatile var dropAtByte = -1L
        @Volatile var duplicateAtByte = -1L
        @Volatile var failAtByte = -1L
        val alive = AtomicInteger()

        override fun decodeFrom(
            file: File,
            byteOffset: Long,
            input: Mp3InputCheck,
            onInfo: (Mp3StreamInfo) -> Unit,
            sink: PcmSink,
            cancelled: () -> Boolean,
        ) {
            var out = 0L
            val mine = file.name == stem
            var stalled = false
            var dropped = false
            var duplicated = false
            alive.incrementAndGet()
            try {
                inner.decodeFrom(file, byteOffset, input, onInfo, { b, o, l ->
                    out += l
                    if (mine) {
                        if (!stalled && stallAtByte in 0 until out) {
                            stalled = true
                            val end = SystemClock.elapsedRealtime() + stallMs
                            while (SystemClock.elapsedRealtime() < end && !cancelled()) Thread.sleep(5)
                        }
                        if (failAtByte in 0 until out) {
                            throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "injected")
                        }
                        if (!dropped && dropAtByte in 0 until out) {
                            dropped = true
                            return@decodeFrom
                        }
                        if (!duplicated && duplicateAtByte in 0 until out) {
                            duplicated = true
                            sink.write(b, o, l)
                        }
                    }
                    sink.write(b, o, l)
                }, cancelled)
            } finally {
                alive.decrementAndGet()
            }
        }
    }

    private fun newBridge(
        tracks: StereoTrackFactory,
        window: Mp3WindowDecoder = AndroidMp3PcmDecoder(),
        gate: Mp3Gate? = null,
    ): MinistryAudioBridge {
        bridge?.dispose()
        val full = AndroidMp3PcmDecoder()
        val calibration = File(ctx.cacheDir, "s42_cal")
        return MinistryAudioBridge(
            root,
            { states.add((it["state"] as String) to (it["errorCode"] as String?)) },
            { listener ->
                MinistryAudioEngine(trackFactory = tracks, arbiter = AudioOutputArbiter(), dispatcher = CallbackDispatcher { it() }, listener = listener)
            },
            Mp3Support(
                full,
                Mp3DecoderCalibration(full, calibration) { ctx.assets.open(it) },
                incremental = Mp3IncrementalSupport(
                    window,
                    gate ?: Mp3IncrementalCalibration(AndroidMp3PcmDecoder(), calibration) { ctx.assets.open(it) },
                ),
            ),
        ).also { bridge = it }
    }

    private fun args(r: Recording) = mapOf(
        "sessionId" to sid, "userId" to user, "ministryId" to ministry, "recordingId" to r.id,
        "sampleRate" to r.rate, "frames" to r.frames, "codec" to "mp3_cbr256",
        "encoderDelayFrames" to r.alignment.encoderDelayFrames, "paddingFrames" to r.alignment.paddingFrames,
        "mpegAudioFrames" to r.alignment.mpegAudioFrames,
        "strategy" to "incremental",
        "stems" to r.stems.entries.associate { (s, f) -> s.wireName to mapOf("sizeBytes" to f.length(), "sha256" to shaOf(f)) },
    )

    private fun prepare(r: Recording, a: Map<String, Any?> = args(r)): Map<String, Any?> {
        val reply = bridge!!.callBlocking("prepare", a)
        assertTrue("prepare ${r.name} ${reply.errorCode} ${reply.errorMessage}", reply.isOk)
        return reply.value!!
    }

    private fun cmd(m: String, extra: Map<String, Any?> = emptyMap()) =
        bridge!!.callBlocking(m, mapOf("sessionId" to sid) + extra).also { assertTrue("$m ${it.errorCode}", it.isOk) }

    private fun snapshot() = bridge!!.callBlocking("snapshot", mapOf("sessionId" to sid)).value!!
    private fun state() = snapshot()["state"] as String
    private fun position() = snapshot()["positionFrames"] as Long
    private fun close() = assertEquals(true, cmd("close").value!!["closed"])

    private fun await(ms: Long, c: () -> Boolean): Boolean {
        val end = SystemClock.elapsedRealtime() + ms
        while (SystemClock.elapsedRealtime() < end) {
            if (c()) return true
            Thread.sleep(2)
        }
        return c()
    }

    private fun awaitState(wanted: String, ms: Long = 60_000) =
        assertTrue("expected $wanted, got ${snapshot()}", await(ms) { state() == wanted })

    private fun producers() = Thread.getAllStackTraces().keys.count { it.isAlive && it.name.startsWith(IncrementalPcmFeed.THREAD_PREFIX) }

    private fun stats(values: List<Long>): String {
        val s = values.sorted()
        return "median=${s[s.size / 2]} min=${s.first()} max=${s.last()}"
    }

    private fun assertExact(label: String, track: Comparing, r: Recording, from: Long) {
        assertEquals("$label first differing sample", -1L, track.firstDifference.get())
        assertTrue("$label compared ${track.compared.get()}", track.compared.get() >= (r.frames - from) * 2)
    }

    // ------------------------------------------------------------ performance

    @Test
    fun openingTimeOverFiveRounds() {
        for (r in longSets()) {
            var t0 = SystemClock.elapsedRealtime()
            r.stems.values.forEach { shaOf(it) }
            Log.i(tag, "${r.name} sha256OfSixStemsAloneMs=${SystemClock.elapsedRealtime() - t0}")
            val a = args(r) // the manifest hashes are an input, not part of the timed open
            val columns = LinkedHashMap<String, MutableList<Long>>()
            fun record(key: String, value: Long) = columns.getOrPut(key) { mutableListOf() }.add(value)
            for (round in 1..5) {
                measured.clear()
                newBridge(realTracks) // new calibration objects: every round pays for calibration
                t0 = SystemClock.elapsedRealtime()
                val reply = prepare(r, a)
                val prepared = SystemClock.elapsedRealtime()
                assertEquals("incremental", reply["strategy"])
                cmd("setMasterVolume", mapOf("value" to 0.0))
                cmd("play")
                assertTrue(await(5_000) { measured.isNotEmpty() && measured[0].firstWriteAt.get() > 0 })
                assertTrue(await(5_000) { measured[0].head > 0 })
                val moving = SystemClock.elapsedRealtime()
                record("nativePrepareMs", prepared - t0)
                for (key in listOf("indexMs", "calibrationMs", "codecOpenMs", "prefillMs")) record(key, reply[key] as Long)
                record("playToFirstWriteMs", measured[0].firstWriteAt.get() - prepared)
                record("playToClockAdvanceMs", moving - prepared)
                record("openToClockAdvanceMs", moving - t0)
                Thread.sleep(8_000)
                val early = measured[0].underruns
                Thread.sleep(4_000)
                record("underrunsFirst8s", early.toLong())
                record("underruns8to12s", (measured[0].underruns - early).toLong())
                assertFalse(File(ministryRoot(), "pcm_tmp/$sid").exists())
                close()
                assertEquals(0, producers())
            }
            for ((key, values) in columns) Log.i(tag, "${r.name} opening $key ${stats(values)} rounds=$values")
        }
    }

    @Test
    fun memoryAndTemporaryStorage() {
        val r = longSets().first()
        val idle = Debug.getPss()
        var peak = 0L
        var ring = 0L
        newBridge(realTracks)
        val a = args(r)
        val running = java.util.concurrent.atomic.AtomicBoolean(true)
        val sampler = Thread {
            while (running.get()) {
                peak = maxOf(peak, Debug.getPss())
                Thread.sleep(100)
            }
        }.apply { start() }
        try {
            ring = prepare(r, a)["ringBytes"] as Long
            cmd("setMasterVolume", mapOf("value" to 0.0))
            cmd("play")
            for (i in 1..30) {
                Thread.sleep(500)
                if (i % 10 == 0) cmd("seek", mapOf("frame" to r.frames * i / 40))
            }
        } finally {
            running.set(false)
            sampler.join()
        }
        val temp = File(ministryRoot(), "pcm_tmp").walkTopDown().filter { it.isFile }.sumOf { it.length() }
        val wavs = File(ministryRoot(), "recordings/${r.id}").listFiles()!!.count { it.extension == "wav" }
        Log.i(tag, "memory idlePssKiB=$idle peakPssKiB=$peak ringBytes=$ring tempPcmBytes=$temp wavFiles=$wavs")
        assertEquals(0L, temp)
        assertEquals(0, wavs)
        close()
    }

    @Test
    fun continuousPlaybackOfTheWholeRecordingOnARealTrack() {
        val r = longSets().first()
        newBridge(realTracks)
        prepare(r)
        cmd("setMasterVolume", mapOf("value" to 0.0))
        states.clear()
        val t0 = SystemClock.elapsedRealtime()
        cmd("play")
        Thread.sleep(2_000)
        val early = measured[0].underruns
        var atTail = early
        var last = 0L
        while (state() != "completed") {
            val p = position()
            assertTrue("position went back $last -> $p", p >= last || state() == "completed")
            last = p
            if (p < r.frames - r.rate) atTail = measured[0].underruns
            assertTrue("error ${snapshot()}", state() != "error")
            assertTrue("stuck", SystemClock.elapsedRealtime() - t0 < r.frames * 1000 / r.rate + 60_000)
            Thread.sleep(250)
        }
        val elapsed = SystemClock.elapsedRealtime() - t0
        Log.i(
            tag,
            "${r.name} continuous elapsedMs=$elapsed audioMs=${r.frames * 1000 / r.rate} framesWritten=${measured[0].written.get() / 2} " +
                "underrunsFirst2s=$early underrunsFrom2sToLastSecond=${atTail - early} " +
                "bufferingEvents=${states.count { it.first == "buffering" }}",
        )
        assertEquals(r.frames, measured[0].written.get() / 2)
        close()
    }

    @Test
    fun seekLatencyAndPauseResumeOnARealTrack() {
        for (r in longSets()) {
            measured.clear()
            newBridge(realTracks)
            prepare(r)
            cmd("setMasterVolume", mapOf("value" to 0.0))
            cmd("play")
            Thread.sleep(2_000)
            val latencies = mutableListOf<Long>()
            val targets = listOf(r.frames / 2, 0L, r.frames - r.rate * 20L, r.frames / 3, r.rate * 7L, r.frames / 2 + 1)
            for (target in targets) {
                val before = measured[0].written.get()
                val t0 = SystemClock.elapsedRealtime()
                cmd("seek", mapOf("frame" to target))
                // Moving again = new frames written after the flush and the playback head advancing past the flush point.
                assertTrue(await(10_000) { measured[0].written.get() > before && state() == "playing" && position() > target })
                latencies.add(SystemClock.elapsedRealtime() - t0)
                Thread.sleep(1_500)
            }
            cmd("pause")
            val frozen = position()
            Thread.sleep(2_000)
            assertEquals(frozen, position())
            cmd("resume")
            assertTrue(await(10_000) { position() > frozen + r.rate / 2 })
            Log.i(tag, "${r.name} seekToAdvanceMs ${stats(latencies)} all=$latencies underrunsTotal=${measured[0].underruns}")
            assertTrue("seek latency $latencies", latencies.max() < 5_000)
            close()
        }
    }

    // ------------------------------------------------------------ correctness

    @Test
    fun aPauseDuringTheFinalDrainDoesNotCutTheTailOnARealTrack() {
        for (r in shortSets()) {
            measured.clear()
            newBridge(realTracks)
            assertEquals("incremental", prepare(r)["strategy"])
            cmd("setMasterVolume", mapOf("value" to 0.0))
            cmd("play")
            assertTrue("all written", await(10_000) { measured.isNotEmpty() && measured[0].written.get() == r.frames * 2 })
            cmd("pause")
            val t = measured[0]
            val atPause = t.head
            assertTrue("${r.name} not paused during the drain: $atPause", atPause < r.frames)
            Thread.sleep(2_000) // longer than the tail stall timeout
            assertEquals("paused", state())
            val resumedAt = SystemClock.elapsedRealtime()
            cmd("resume")
            awaitState("completed", 10_000)
            Log.i(
                tag,
                "${r.name} drainPause headAtPause=$atPause headAtEnd=${t.headAtLastPause} frames=${r.frames} " +
                    "paddedFrames=${t.padded.get() / 2} resumeToCompletedMs=${SystemClock.elapsedRealtime() - resumedAt}",
            )
            assertTrue("${r.name} tail cut at ${t.headAtLastPause} of ${r.frames}", t.headAtLastPause >= r.frames)
            close()
        }
    }

    @Test
    fun wholeRecordingEqualsTheFullDecodeForBothProfiles() {
        for (r in longSets()) {
            val track = Comparing(reference(r))
            newBridge(factory(track))
            prepare(r)
            states.clear()
            val t0 = SystemClock.elapsedRealtime()
            cmd("play")
            awaitState("completed", 120_000)
            Log.i(tag, "${r.name} wholeBitExact samples=${track.compared.get()} ms=${SystemClock.elapsedRealtime() - t0} bufferingEvents=${states.count { it.first == "buffering" }}")
            assertExact(r.name, track, r, 0)
            assertEquals(r.frames * 2, track.compared.get())
            close()
        }
    }

    private fun factory(track: StereoTrackHandle) = object : StereoTrackFactory {
        override fun create(sampleRate: Int, bufferFrames: Int) = track
    }

    @Test
    fun shortRecordingsOfBothProfilesAndRates() {
        for (r in shortSets()) {
            val track = Comparing(reference(r))
            newBridge(factory(track))
            assertEquals("incremental", prepare(r)["strategy"])
            cmd("play")
            awaitState("completed")
            assertExact(r.name, track, r, 0)
            assertEquals(r.frames * 2, track.compared.get())
            close()
            for (from in listOf(1L, 575L, r.frames / 2, r.frames - 1000)) {
                val seeked = Comparing(reference(r).also { it.seek(from) })
                newBridge(factory(seeked))
                prepare(r)
                cmd("seek", mapOf("frame" to from))
                cmd("play")
                awaitState("completed")
                assertExact("${r.name} from $from", seeked, r, from)
                close()
            }
            Log.i(tag, "${r.name} shortBitExact=true")
        }
    }

    @Test
    fun seeksStartMiddleEndRepeatedAndPausedEqualTheFullDecode() {
        for (r in longSets()) {
            val reference = reference(r)
            for (from in listOf(0L, 1L, r.rate * 3L + 17, r.frames / 2, r.frames - r.rate * 8L, r.frames - 500)) {
                val track = Comparing(reference).also { it.restart(from) }
                newBridge(factory(track))
                prepare(r)
                cmd("seek", mapOf("frame" to from))
                cmd("play")
                // Compare a bounded stretch; near the end this runs to completion.
                assertTrue(await(60_000) { track.compared.get() >= minOf(r.frames - from, r.rate * 6L) * 2 })
                assertEquals("${r.name} from $from", -1L, track.firstDifference.get())
                close()
            }
            // In-session seeks: playing, repeated, and while paused.
            val track = Comparing(reference).also { it.restart(0) }
            newBridge(factory(track))
            prepare(r)
            cmd("play")
            fun seekAndCompare(label: String, target: Long, before: () -> Unit = {}, after: () -> Unit = {}) {
                track.target.set(target)
                before()
                val seen = track.compared.get()
                cmd("seek", mapOf("frame" to target))
                after()
                assertTrue(label, await(60_000) { track.compared.get() >= seen + r.rate * 4L * 2 })
                assertEquals("${r.name} $label", -1L, track.firstDifference.get())
            }
            Thread.sleep(300)
            seekAndCompare("middle", r.frames / 2)
            seekAndCompare("back to start", 0)
            seekAndCompare("late", r.frames - r.rate * 30L)
            for (i in 1..12) {
                track.target.set(r.rate * i.toLong())
                cmd("seek", mapOf("frame" to r.rate * i.toLong()))
            }
            seekAndCompare("after repeated seeks", r.rate * 100L)
            seekAndCompare("while paused", r.rate * 40L, before = { cmd("pause") }, after = { cmd("resume") })
            Log.i(tag, "${r.name} seeksBitExact=true comparedSamples=${track.compared.get()}")
            close()
        }
    }

    @Test
    fun aStallInEachStemHoldsTheClockAndStaysExactAlsoWithASeekDuringIt() {
        val r = longSets().first()
        val reference = reference(r)
        val from = r.frames - r.rate * 12L
        for (stem in StemId.values()) {
            val faulty = Faulty().apply {
                this.stem = "stem_${stem.wireName}.mp3"
                stallAtByte = r.rate * 4L * 5
                stallMs = 1_500
            }
            val track = Comparing(reference).also { it.restart(from) }
            newBridge(factory(track), faulty)
            prepare(r)
            cmd("seek", mapOf("frame" to from))
            states.clear()
            cmd("play")
            // The first buffering is the start-up; the second one is the stall. State and position of ONE snapshot.
            var held = 0L
            assertTrue(
                await(30_000) {
                    val twice = states.count { it.first == "buffering" } >= 2
                    val s = snapshot()
                    held = s["positionFrames"] as Long
                    twice && s["state"] == "buffering" && held > from + r.rate
                },
            )
            Thread.sleep(300)
            assertEquals("${stem.wireName}: clock moved while starved", held, position())
            awaitState("completed")
            assertExact(stem.wireName, track, r, from)
            Log.i(tag, "stall ${stem.wireName} heldAtFrame=$held bitExact=true")
            close()
        }
        // Seek while re-buffering.
        val faulty = Faulty().apply {
            stem = "stem_bass.mp3"
            stallAtByte = r.rate * 4L * 2
            stallMs = 8_000
        }
        val track = Comparing(reference).also { it.restart(0) }
        newBridge(factory(track), faulty)
        prepare(r)
        cmd("play")
        assertTrue(await(30_000) { state() == "buffering" && position() > 0 })
        faulty.stem = null
        track.target.set(from)
        val t0 = SystemClock.elapsedRealtime()
        cmd("seek", mapOf("frame" to from))
        awaitState("completed")
        assertEquals(-1L, track.firstDifference.get())
        Log.i(tag, "seekDuringRebuffering completedMs=${SystemClock.elapsedRealtime() - t0} (stall would have lasted 8000)")
        close()
    }

    @Test
    fun decoderFailurePrematureAndExcessEosEndTheSessionWithoutCodecs() {
        val r = longSets().first()
        val from = r.frames - r.rate * 8L
        val cases = listOf<Triple<String, String, Faulty.() -> Unit>>(
            Triple("decoder failure", MinistryAudioException.MP3_DECODE_FAILED, { failAtByte = r.rate * 4L * 5 }),
            Triple("premature EOS", MinistryAudioException.MP3_LENGTH_MISMATCH, { dropAtByte = r.rate * 4L * 5 }),
            Triple("excess EOS", MinistryAudioException.MP3_LENGTH_MISMATCH, { duplicateAtByte = r.rate * 4L * 5 }),
        )
        for ((label, code, arrange) in cases) {
            val faulty = Faulty().apply { stem = "stem_piano.mp3" }
            val track = Comparing(reference(r)).also { it.restart(from) }
            newBridge(factory(track), faulty)
            prepare(r)
            faulty.arrange() // armed after prepare: the seek below opens the faulty window
            cmd("seek", mapOf("frame" to from))
            states.clear()
            cmd("play")
            assertTrue(label, await(60_000) { states.any { it.first == "error" } })
            assertEquals(label, code, states.first { it.first == "error" }.second)
            assertFalse(label, states.any { it.first == "completed" })
            assertEquals("$label: codecs alive after ERROR", 0, faulty.alive.get())
            Log.i(tag, "$label code=$code samplesDeliveredBeforeError=${track.compared.get()} of ${(r.frames - from) * 2} firstDifference=${track.firstDifference.get()}")
            close()
        }
    }

    @Test
    fun aStemChangedOnDiskAfterValidationEndsTheSession() {
        val r = longSets().first()
        val victim = r.stems.getValue(StemId.values()[2])
        val original = victim.readBytes()
        try {
            val track = Comparing(reference(r))
            newBridge(factory(track))
            prepare(r)
            // One audio frame near the middle is altered after the whole file was validated.
            java.io.RandomAccessFile(victim, "rw").use { f ->
                val at = original.size / 2
                f.seek(at.toLong())
                f.write(original[at].toInt() xor 0x01)
            }
            val from = r.frames / 2 - r.rate * 20L
            track.restart(from) // the seek below happens before the track exists
            cmd("seek", mapOf("frame" to from))
            states.clear()
            cmd("play")
            assertTrue(await(60_000) { states.any { it.first == "error" } })
            assertEquals(MinistryAudioException.MP3_INVALID, states.first { it.first == "error" }.second)
            assertFalse(states.any { it.first == "completed" })
            assertEquals("only validated audio before the refusal", -1L, track.firstDifference.get())
            Log.i(tag, "changedOnDisk refused=true samplesDeliveredBeforeError=${track.compared.get()} firstDifference=${track.firstDifference.get()}")
            close()
        } finally {
            victim.writeBytes(original)
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Test
    fun repeatedCancellationAndCloseLeaveNoCodecOrThread() {
        val r = longSets().first()
        val a = args(r)
        val faulty = Faulty()
        newBridge(realTracks, faulty)
        val fds = mutableListOf<Int>()
        val latencies = mutableListOf<Long>()
        var cancelled = 0
        for (i in 0 until 40) {
            val reply = java.util.concurrent.atomic.AtomicReference<MinistryAudioBridge.Reply>()
            bridge!!.submit("prepare", a) { reply.set(it) }
            Thread.sleep((i % 10) * 90L)
            val t0 = SystemClock.elapsedRealtime()
            val closed = cmd("close").value!!["closed"]
            latencies.add(SystemClock.elapsedRealtime() - t0)
            assertEquals(true, closed)
            assertTrue(await(5_000) { reply.get() != null })
            if (reply.get().errorCode == MinistryAudioException.CANCELLED) cancelled++ else assertTrue(reply.get().errorCode, reply.get().isOk)
            assertTrue("round $i producers=${producers()}", await(3_000) { producers() == 0 })
            assertEquals(0, faulty.alive.get())
            if (i % 4 == 3) fds.add(File("/proc/self/fd").list()!!.size)
        }
        Log.i(tag, "cancel rounds=40 cancelled=$cancelled closeMs ${stats(latencies)} fdEvery4=$fds")
        val half = fds.size / 2
        assertTrue("descriptors keep growing: $fds", fds.drop(half).maxOrNull()!! <= fds.take(half).maxOrNull()!! + 20)
    }

    @Test
    fun stopReleasesCodecsAndAnotherAppTakingFocusPauses() {
        val r = longSets().first()
        val faulty = Faulty()
        val events = CopyOnWriteArrayList<EngineState>()
        // The production engine factory: real AudioTrack, audio focus and becoming-noisy receiver.
        bridge?.dispose()
        val calibration = File(ctx.cacheDir, "s42_cal")
        bridge = MinistryAudioBridge(
            root,
            { },
            { listener ->
                createMinistryAudioEngine(ctx, { s, c -> events.add(s); listener.onStateChanged(s, c) }, CallbackDispatcher { it() })
            },
            Mp3Support(
                AndroidMp3PcmDecoder(),
                Mp3DecoderCalibration(AndroidMp3PcmDecoder(), calibration) { ctx.assets.open(it) },
                incremental = Mp3IncrementalSupport(faulty, Mp3IncrementalCalibration(AndroidMp3PcmDecoder(), calibration) { ctx.assets.open(it) }),
            ),
        )
        prepare(r)
        cmd("setMasterVolume", mapOf("value" to 0.0))
        cmd("play")
        awaitState("playing")
        Thread.sleep(1_000)
        assertEquals(6, faulty.alive.get())

        val audio = ctx.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager
        val other = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
            .setOnAudioFocusChangeListener { }
            .build()
        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, audio.requestAudioFocus(other))
        awaitState("paused", 5_000)
        val frozen = position()
        Thread.sleep(500)
        assertEquals(frozen, position())
        audio.abandonAudioFocusRequest(other)
        awaitState("playing", 5_000) // transient loss: resumes on its own
        assertTrue(await(5_000) { position() > frozen })

        bridge!!.stopCurrentAsync() // the app-left-foreground path
        awaitState("ready", 5_000)
        assertTrue("codecs held after stop: ${faulty.alive.get()}", await(3_000) { faulty.alive.get() == 0 })
        cmd("play")
        awaitState("playing", 15_000)
        close()
        assertEquals(0, faulty.alive.get())
        Log.i(tag, "focusTransientPauseAndResume=true stopReleasedCodecs=true states=${events.distinct()}")
    }

    @Test
    fun fallsBackToTheFullDecodeWhenStreamingIsNotCalibrated() {
        val r = shortSets().first()
        val track = Comparing(reference(r))
        newBridge(factory(track), gate = { throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "injected") })
        val reply = prepare(r)
        assertEquals("full", reply["strategy"])
        assertEquals("calibration", reply["fallbackReason"])
        cmd("play")
        awaitState("completed")
        assertExact("fallback", track, r, 0)
        close()
    }

    @Test
    fun wavRecordingsStillPlayThroughARealTrack() {
        val rate = 44_100
        val frames = rate * 3
        val id = "f".repeat(64)
        val dir = File(ministryRoot(), "recordings/$id").apply { mkdirs() }
        for (s in StemId.values()) {
            val bytes = ByteArray(frames * 4)
            for (f in 0 until frames) {
                val v = ((f * (s.ordinal + 3)) % 2000) - 1000
                bytes[f * 4] = v.toByte(); bytes[f * 4 + 1] = (v shr 8).toByte()
                bytes[f * 4 + 2] = v.toByte(); bytes[f * 4 + 3] = (v shr 8).toByte()
            }
            File(dir, s.fileName).writeBytes(WavHeader(rate, frames.toLong()).toBytes() + bytes)
        }
        newBridge(realTracks)
        val reply = bridge!!.callBlocking(
            "prepare",
            mapOf("sessionId" to sid, "userId" to user, "ministryId" to ministry, "recordingId" to id, "sampleRate" to rate, "frames" to frames),
        )
        assertTrue(reply.errorCode, reply.isOk)
        cmd("setMasterVolume", mapOf("value" to 0.0))
        cmd("play")
        awaitState("completed", 15_000)
        assertEquals(frames.toLong(), measured.last().written.get() / 2)
        assertFalse(states.any { it.first == "buffering" })
        close()
        Log.i(tag, "wavRegression=true underruns=${measured.last().underruns}")
    }
}
