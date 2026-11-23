package com.louvaio.louvaio_mobile.ministryaudio

import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.security.MessageDigest
import java.util.Random
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class MinistryAudioBridgeTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val rate = 8000
    private val user = "user_1"
    private val ministry = "min-1"
    private val rec = "a".repeat(64)
    private val sid = "session-0001"
    private lateinit var filesDir: File
    private val events = CopyOnWriteArrayList<Map<String, Any?>>()
    private val tracks = CopyOnWriteArrayList<FakeTrack>()
    private val listeners = CopyOnWriteArrayList<MinistryAudioListener>()
    private val stats = SourceStats()
    private val factoryThreads = CopyOnWriteArrayList<String>()
    private var trackFactory: () -> FakeTrack = { FakeTrack() }
    private var bridge: MinistryAudioBridge? = null

    private fun sha(domain: String, id: String) =
        MessageDigest.getInstance("SHA-256").digest((domain + id).toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun recDir(recId: String = rec, u: String = user, m: String = ministry) = File(
        filesDir,
        "ministry_audio_library/v1/users/${sha("louvaio-ministry-audio-user-v1:", u)}" +
            "/ministries/${sha("louvaio-ministry-audio-ministry-v1:", m)}/recordings/$recId",
    )

    @Before
    fun setUp() {
        filesDir = tmp.newFolder("files")
    }

    @After
    fun tearDown() {
        bridge?.dispose()
        assertTrue(waitUntil(3000) { renderThreadsAlive() == 0 })
    }

    private fun newBridge(joinMs: Long = 2000): MinistryAudioBridge {
        val b = MinistryAudioBridge(
            filesDir,
            { events.add(it) },
            { listener ->
                factoryThreads.add(Thread.currentThread().name)
                listeners.add(listener)
                MinistryAudioEngine(
                    trackFactory = object : StereoTrackFactory {
                        override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle =
                            trackFactory().also { tracks.add(it) }
                    },
                    arbiter = AudioOutputArbiter(),
                    dispatcher = CallbackDispatcher { it() },
                    listener = listener,
                    chunkFrames = 64,
                    sourceFactory = { TrackedSource(FileStemSource.open(it), stats) },
                    joinMs = joinMs,
                )
            },
        )
        bridge = b
        return b
    }

    private fun prepareArgs(id: String = sid, recId: String = rec) = mapOf(
        "sessionId" to id, "userId" to user, "ministryId" to ministry,
        "recordingId" to recId, "sampleRate" to rate, "frames" to 2000,
    )

    private fun write(frames: Int = 2000, recId: String = rec) = Wav.writeAll(recDir(recId), rate, frames)

    private fun MinistryAudioBridge.ok(m: String, a: Map<String, Any?>? = null): MinistryAudioBridge.Reply =
        callBlocking(m, a).also { assertTrue("$m failed: ${it.errorCode}", it.isOk) }

    private fun MinistryAudioBridge.fails(m: String, code: String, a: Map<String, Any?>? = null) {
        val r = callBlocking(m, a)
        assertFalse("$m should fail", r.isOk)
        assertEquals(code, r.errorCode)
    }

    private fun state(b: MinistryAudioBridge, id: String = sid) =
        b.callBlocking("snapshot", mapOf("sessionId" to id)).value!!["state"]

    @Test
    fun `prepare, play to completion and close with ordered session events`() {
        write()
        val b = newBridge()
        val r = b.ok("prepare", prepareArgs())
        assertEquals(2000L, r.value!!["frames"])
        assertEquals(rate, r.value!!["sampleRate"])
        b.ok("setTrackGain", mapOf("sessionId" to sid, "stem" to "drums", "value" to 0.5))
        b.ok("setTrackMuted", mapOf("sessionId" to sid, "stem" to "bass", "enabled" to true))
        b.ok("setTrackSolo", mapOf("sessionId" to sid, "stem" to "vocals", "enabled" to false))
        b.ok("setMasterVolume", mapOf("sessionId" to sid, "value" to 0.8))
        b.ok("seek", mapOf("sessionId" to sid, "frame" to 100))
        b.ok("play", mapOf("sessionId" to sid))
        assertTrue(waitUntil { state(b) == "completed" })
        val snap = b.callBlocking("snapshot", mapOf("sessionId" to sid)).value!!
        assertEquals(2000L, snap["durationFrames"])
        assertEquals(0.5, (snap["gains"] as List<*>)[1])
        assertEquals(true, (snap["muted"] as List<*>)[2])
        assertEquals(0.8, snap["master"])
        assertEquals(true, b.ok("close", mapOf("sessionId" to sid)).value!!["closed"])
        assertEquals(stats.opened.get(), stats.closed.get())

        val states = events.filter { it["event"] == "state" }
        assertTrue(states.all { it["sessionId"] == sid })
        assertEquals(
            listOf("loading", "ready", "playing", "completed", "disposed"),
            states.map { it["state"] },
        )
    }

    @Test
    fun `commands never run on the caller or main thread`() {
        write()
        val b = newBridge()
        b.ok("prepare", prepareArgs())
        assertEquals(listOf(MinistryAudioBridge.COMMAND_THREAD), factoryThreads.toList())
    }

    @Test
    fun `unknown, missing and extra arguments are rejected before any engine exists`() {
        write()
        val b = newBridge()
        val bad = listOf(
            prepareArgs() + ("path" to "/data/x"),
            prepareArgs() + ("url" to "https://signed.example/x?sig=1"),
            prepareArgs() - "frames",
            prepareArgs() + ("userId" to "../evil"),
            prepareArgs() + ("ministryId" to "a/b"),
            prepareArgs(recId = "../" + "a".repeat(61)),
            prepareArgs(recId = "A".repeat(64)),
            prepareArgs(id = "short"),
            prepareArgs() + ("sampleRate" to 96000),
            prepareArgs() + ("frames" to 1.5),
            prepareArgs() + ("frames" to "2000"),
        )
        for (a in bad) b.fails("prepare", MinistryAudioException.INVALID_ARGUMENT, a)
        b.fails("prepare", MinistryAudioException.INVALID_ARGUMENT, null)
        b.fails("nope", MinistryAudioException.UNKNOWN_COMMAND)
        assertTrue("no engine may be created for invalid input", listeners.isEmpty())
    }

    @Test
    fun `control arguments are validated`() {
        write()
        val b = newBridge()
        b.ok("prepare", prepareArgs())
        val s = mapOf("sessionId" to sid)
        b.fails("play", MinistryAudioException.INVALID_ARGUMENT, s + ("path" to "/x"))
        b.fails("setTrackGain", MinistryAudioException.INVALID_ARGUMENT, s + mapOf("stem" to "drums", "value" to 2.0))
        b.fails("setTrackGain", MinistryAudioException.INVALID_ARGUMENT, s + mapOf("stem" to "kazoo", "value" to 0.5))
        b.fails("setTrackGain", MinistryAudioException.INVALID_ARGUMENT, s + mapOf("stem" to "drums", "value" to Double.NaN))
        b.fails("setTrackMuted", MinistryAudioException.INVALID_ARGUMENT, s + mapOf("stem" to "drums", "enabled" to "yes"))
        b.fails("seek", MinistryAudioException.INVALID_ARGUMENT, s + ("frame" to 1.5))
        b.fails("seek", MinistryAudioException.INVALID_ARGUMENT, s)
        b.fails("pause", MinistryAudioException.INVALID_STATE, s) // ready, not playing
    }

    @Test
    fun `a new session replaces the old one, stale commands and late events are dropped`() {
        write()
        val b = newBridge()
        b.ok("prepare", prepareArgs(id = "session-0001"))
        val oldListener = listeners.last()
        b.ok("prepare", prepareArgs(id = "session-0002"))
        assertEquals("the first session's files were closed first", 6, stats.closed.get())
        b.fails("play", MinistryAudioException.STALE_SESSION, mapOf("sessionId" to "session-0001"))
        b.fails("snapshot", MinistryAudioException.STALE_SESSION, mapOf("sessionId" to "session-0001"))
        events.clear()
        oldListener.onStateChanged(EngineState.PLAYING, null) // late callback of the old session
        assertTrue(events.isEmpty())
        b.ok("play", mapOf("sessionId" to "session-0002"))
        assertTrue(waitUntil { events.any { it["state"] == "completed" && it["sessionId"] == "session-0002" } })
        // closing an unknown / already closed session is idempotent
        assertEquals(true, b.ok("close", mapOf("sessionId" to "session-0001")).value!!["closed"])
    }

    @Test
    fun `native errors are typed and never leak paths`() {
        write()
        val f = File(recDir(), "stem_piano.wav")
        f.writeBytes(f.readBytes().copyOf(f.length().toInt() - 9))
        val b = newBridge()
        val r = b.callBlocking("prepare", prepareArgs())
        assertEquals(MinistryAudioException.WAV_TRUNCATED, r.errorCode)
        val text = "${r.errorMessage}"
        assertFalse(text.contains(filesDir.name))
        assertFalse(text.contains("stem_"))
        assertFalse(text.contains(".wav"))
        assertFalse(text.contains("/") || text.contains("\\"))
        assertEquals("every opened file closed", stats.opened.get(), stats.closed.get())
        // missing recording
        callBlockingCode(b, prepareArgs(recId = "b".repeat(64)))
    }

    private fun callBlockingCode(b: MinistryAudioBridge, a: Map<String, Any?>): String {
        val r = b.callBlocking("prepare", a)
        assertFalse(r.isOk)
        assertTrue(r.errorCode!!.startsWith("AUDIO_NATIVE_"))
        return r.errorCode!!
    }

    @Test
    fun `a wedged worker is never reported closed and blocks new sessions`() {
        write()
        val track = FakeTrack(blockFirstWrite = true, unblockOnPause = false)
        trackFactory = { track }
        val b = newBridge(joinMs = 200)
        b.ok("prepare", prepareArgs())
        b.ok("play", mapOf("sessionId" to sid))
        assertTrue(track.writeEntered.await(3, TimeUnit.SECONDS))

        assertEquals(false, b.ok("close", mapOf("sessionId" to sid)).value!!["closed"])
        assertEquals(0, stats.closed.get())
        b.fails("stop", MinistryAudioException.SHUTDOWN_PENDING, mapOf("sessionId" to sid))
        b.fails("prepare", MinistryAudioException.SHUTDOWN_PENDING, prepareArgs(id = "session-0002"))

        track.release_unblock()
        assertTrue(waitUntil { renderThreadsAlive() == 0 })
        assertEquals(true, b.ok("close", mapOf("sessionId" to sid)).value!!["closed"])
        assertEquals(stats.opened.get(), stats.closed.get())
        b.ok("prepare", prepareArgs(id = "session-0002")) // now possible
    }

    @Test
    fun `concurrent commands then dispose leave no threads, tracks or files open`() {
        write(frames = 40000)
        trackFactory = { FakeTrack(writeDelayMs = 1) }
        val b = newBridge()
        val a = prepareArgs() + ("frames" to 40000)
        b.ok("prepare", a)
        val unexpected = CopyOnWriteArrayList<Throwable>()
        val ts = (0 until 4).map { w ->
            Thread {
                val rnd = Random(7L + w)
                val end = System.nanoTime() + 500_000_000L
                val s = mapOf("sessionId" to sid)
                while (System.nanoTime() < end) {
                    try {
                        when (rnd.nextInt(8)) {
                            0 -> b.callBlocking("play", s)
                            1 -> b.callBlocking("pause", s)
                            2 -> b.callBlocking("resume", s)
                            3 -> b.callBlocking("stop", s)
                            4 -> b.callBlocking("seek", s + ("frame" to rnd.nextInt(40000)))
                            5 -> b.callBlocking("setTrackGain", s + mapOf("stem" to "bass", "value" to rnd.nextDouble()))
                            6 -> b.callBlocking("snapshot", s)
                            else -> if (rnd.nextInt(10) == 0) b.callBlocking("prepare", a)
                        }
                    } catch (t: Throwable) {
                        unexpected.add(t)
                    }
                }
            }.apply { start() }
        }
        ts.forEach { it.join(15_000) }
        assertTrue(unexpected.toString(), unexpected.isEmpty())
        assertTrue(b.dispose())
        assertTrue(waitUntil { renderThreadsAlive() == 0 })
        assertEquals(stats.opened.get(), stats.closed.get())
        for (t in tracks) {
            assertTrue(t.released)
            assertEquals(0, t.writesAfterRelease.get())
        }
        b.fails("snapshot", MinistryAudioException.INVALID_STATE, mapOf("sessionId" to sid))
    }

    @Test
    fun `stopCurrentAsync returns playback to ready without closing the session`() {
        write()
        trackFactory = { FakeTrack(writeDelayMs = 1) }
        val b = newBridge()
        b.ok("prepare", prepareArgs() + ("frames" to 2000))
        b.ok("play", mapOf("sessionId" to sid))
        b.stopCurrentAsync()
        assertTrue(waitUntil { state(b) == "ready" })
        assertNull(null)
    }
}
