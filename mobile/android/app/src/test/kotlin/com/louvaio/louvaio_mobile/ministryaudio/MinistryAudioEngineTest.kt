package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioManager
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.nio.file.Files
import java.util.Random
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class MinistryAudioEngineTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val rate = 8000
    private val chunk = 64
    private val engines = ArrayList<MinistryAudioEngine>()
    private lateinit var root: File
    private var dirSeq = 0

    @Before
    fun setUp() {
        root = tmp.newFolder("root")
    }

    @After
    fun tearDown() {
        engines.forEach { runCatching { it.dispose() } }
        assertTrue("render thread leaked", waitUntil(3000) { renderThreadsAlive() == 0 })
    }

    private fun newDir(
        frames: Int = 2000,
        sampler: (StemId, Int) -> Int = { id, _ -> (id.ordinal + 1) * 100 },
    ): File {
        val d = File(root, "rec${dirSeq++}")
        Wav.writeAll(d, rate, frames, sampler)
        return d
    }

    private fun engine(
        track: FakeTrack = FakeTrack(),
        focus: FakeFocus? = null,
        noisy: FakeNoisy? = null,
        arbiter: AudioOutputArbiter = AudioOutputArbiter(),
        stats: SourceStats = SourceStats(),
        events: MutableList<EngineState>? = null,
        factory: StereoTrackFactory? = null,
        tailMs: Long = 500,
    ): MinistryAudioEngine {
        val f = factory ?: object : StereoTrackFactory {
            override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = track
        }
        val e = MinistryAudioEngine(
            trackFactory = f,
            focus = focus,
            noisy = noisy,
            arbiter = arbiter,
            dispatcher = CallbackDispatcher { it() },
            listener = MinistryAudioListener { s, _ -> events?.add(s) },
            chunkFrames = chunk,
            tailStallTimeoutMs = tailMs,
            sourceFactory = { file -> TrackedSource(FileStemSource.open(file), stats) },
        )
        engines.add(e)
        return e
    }

    private fun awaitState(e: MinistryAudioEngine, s: EngineState, ms: Long = 8000) =
        assertTrue("expected $s but was ${e.state}", waitUntil(ms) { e.state == s })

    private fun leftOf(track: FakeTrack): List<Int> =
        track.snapshot().filterIndexed { i, _ -> i % 2 == 0 }.map { it.toInt() }

    // ---------------------------------------------------------------- mixing

    @Test
    fun `plays to completion with an exact aligned mix and ordered events`() {
        val track = FakeTrack()
        val events = CopyOnWriteArrayList<EngineState>()
        val e = engine(track, events = events)
        val header = e.load(newDir(), root)
        assertEquals(2000L, header.frames)
        e.play()
        awaitState(e, EngineState.COMPLETED)

        val l = leftOf(track)
        assertEquals(2000, l.size)
        assertEquals(4000, track.shortsWritten)
        for (f in 100 until l.size) assertEquals("frame $f", 2100, l[f])
        // the first frames fade in from silence (no click)
        assertTrue(l[0] < 200)
        assertEquals(2000L, e.positionFrames)
        assertTrue(track.released)
        assertEquals(0, track.writesAfterRelease.get())
        assertEquals(
            listOf(EngineState.LOADING, EngineState.READY, EngineState.PLAYING, EngineState.COMPLETED),
            events.toList(),
        )
    }

    @Test
    fun `six tracks with an impulse on the same frame produce one aligned impulse`() {
        val track = FakeTrack()
        val e = engine(track)
        e.load(newDir(400) { id, f -> if (f == 70) (id.ordinal + 1) * 100 else 0 }, root)
        e.play()
        awaitState(e, EngineState.COMPLETED)
        val l = leftOf(track)
        val nonZero = l.withIndex().filter { it.value != 0 }
        assertEquals(1, nonZero.size)
        assertEquals(70, nonZero[0].index) // crosses the 64-frame chunk boundary
        assertTrue(nonZero[0].value in 1..2100)
    }

    @Test
    fun `track controls reach the output through the single device track`() {
        val track = FakeTrack()
        val e = engine(track)
        e.load(newDir(2000) { _, _ -> 100 }, root)
        e.setTrackMuted(StemId.VOCALS, true)
        e.setTrackGain(StemId.DRUMS, 0.5f)
        e.setTrackSolo(StemId.DRUMS, true)
        e.setTrackSolo(StemId.BASS, true)
        e.setMasterVolume(1f)
        e.play()
        awaitState(e, EngineState.COMPLETED)
        val l = leftOf(track)
        for (f in 100 until l.size) assertEquals(150, l[f]) // 50 (drums) + 100 (bass)
    }

    // ------------------------------------------------------------- transport

    @Test
    fun `pause and resume lose and repeat no frames`() {
        val frames = 20000
        val track = FakeTrack(writeDelayMs = 1)
        val e = engine(track)
        e.load(newDir(frames) { id, f -> if (id == StemId.VOCALS) f else 0 }, root)
        e.play()
        assertTrue(waitUntil { track.shortsWritten > 2000 })
        e.pause()
        assertEquals(EngineState.PAUSED, e.state)
        Thread.sleep(40)
        val frozen = track.shortsWritten
        Thread.sleep(80)
        assertEquals("no writes while paused", frozen, track.shortsWritten)
        e.resume()
        assertEquals(EngineState.PLAYING, e.state)
        awaitState(e, EngineState.COMPLETED)

        val l = leftOf(track)
        assertEquals(frames, l.size)
        for (f in 200 until frames) assertEquals("frame $f", f, l[f])
    }

    @Test
    fun `pause while a write is blocked is safe and resumes cleanly`() {
        val frames = 600
        val track = FakeTrack(blockFirstWrite = true)
        val e = engine(track)
        e.load(newDir(frames) { id, f -> if (id == StemId.VOCALS) f else 0 }, root)
        e.play()
        assertTrue(track.writeEntered.await(3, TimeUnit.SECONDS))
        e.pause()
        assertEquals(EngineState.PAUSED, e.state)
        e.resume()
        awaitState(e, EngineState.COMPLETED)
        val l = leftOf(track)
        assertEquals(frames, l.size)
        for (f in 200 until frames) assertEquals(f, l[f])
    }

    @Test
    fun `seek while playing flushes the device queue and never replays old frames`() {
        val frames = 20000
        val track = FakeTrack(writeDelayMs = 1)
        val e = engine(track)
        e.load(newDir(frames) { id, f -> if (id == StemId.VOCALS) f else 0 }, root)
        e.play()
        assertTrue(waitUntil { track.shortsWritten > 4000 })
        e.seekToFrame(15000)
        assertTrue(e.positionFrames >= 15000)
        awaitState(e, EngineState.COMPLETED)

        // flushMarks[0] is the seek's flush; the last one is the release flush.
        assertEquals(2, track.flushMarks.size)
        val mark = track.flushMarks.first()
        val after = track.snapshot().drop(mark).filterIndexed { i, _ -> i % 2 == 0 }.map { it.toInt() }
        assertEquals(frames - 15000, after.size)
        var previous = -1
        for ((i, v) in after.withIndex()) {
            if (i < 100) continue // fade-in region
            assertTrue("old frame $v after seek", v >= 15000)
            assertTrue(v >= previous)
            previous = v
        }
        assertEquals(frames - 1, after.last())
    }

    @Test
    fun `seek to start, middle and end while ready`() {
        val track = FakeTrack()
        val e = engine(track)
        e.load(newDir(2000) { id, f -> if (id == StemId.VOCALS) f else 0 }, root)
        e.seekToFrame(1000)
        assertEquals(1000L, e.positionFrames)
        e.play()
        awaitState(e, EngineState.COMPLETED)
        val l = leftOf(track)
        assertEquals(1000, l.size)
        for (i in 100 until l.size) assertEquals(1000 + i, l[i])

        e.seekToFrame(0)
        assertEquals(EngineState.READY, e.state)
        assertEquals(0L, e.positionFrames)
        e.seekToFrame(99_999)
        assertEquals(2000L, e.positionFrames) // clamped to the end
        e.seekToFrame(-5)
        assertEquals(0L, e.positionFrames)
    }

    @Test
    fun `stop while a write is blocked releases everything and returns to ready`() {
        val track = FakeTrack(blockFirstWrite = true)
        val focus = FakeFocus()
        val noisy = FakeNoisy()
        val arbiter = AudioOutputArbiter()
        val e = engine(track, focus, noisy, arbiter)
        e.load(newDir(), root)
        e.play()
        assertEquals("ministry-audio", arbiter.activeOwner)
        assertTrue(track.writeEntered.await(3, TimeUnit.SECONDS))
        e.stop()
        assertEquals(EngineState.READY, e.state)
        assertEquals(0L, e.positionFrames)
        assertTrue(track.released)
        assertEquals(0, track.writesAfterRelease.get())
        assertEquals(0, renderThreadsAlive())
        assertTrue(focus.abandons.get() >= 1)
        assertTrue(noisy.unregisters.get() >= 1)
        assertNull(arbiter.activeOwner)
        e.stop() // idempotent
    }

    @Test
    fun `a stalled device tail does not hang completion`() {
        val track = FakeTrack(freezeHead = true)
        val e = engine(track, tailMs = 250)
        e.load(newDir(300), root)
        e.play()
        awaitState(e, EngineState.COMPLETED, 5000)
        assertTrue(track.released)
    }

    @Test
    fun `play after completion restarts from the beginning`() {
        val tracks = CopyOnWriteArrayList<FakeTrack>()
        val e = engine(factory = object : StereoTrackFactory {
            override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle =
                FakeTrack().also { tracks.add(it) }
        })
        e.load(newDir(500), root)
        e.play()
        awaitState(e, EngineState.COMPLETED)
        e.play()
        assertTrue(waitUntil { tracks.size == 2 && e.state == EngineState.COMPLETED && tracks[1].released })
        assertEquals(500, leftOf(tracks[0]).size)
        assertEquals(500, leftOf(tracks[1]).size)
    }

    // -------------------------------------------------------- load / errors

    private fun loadFails(code: String, setup: (File) -> Unit = {}, expectedFrames: Long? = null): SourceStats {
        val stats = SourceStats()
        val e = engine(stats = stats)
        val d = newDir(300)
        setup(d)
        assertCode(code) { e.load(d, root, expectedFrames = expectedFrames) }
        assertEquals(EngineState.ERROR, e.state)
        assertEquals(code, e.lastErrorCode)
        assertEquals("every opened file must be closed", stats.opened.get(), stats.closed.get())
        assertEquals(0, renderThreadsAlive())
        assertCode(MinistryAudioException.INVALID_STATE) { e.play() }
        return stats
    }

    @Test
    fun `truncated file is rejected and everything is closed`() {
        loadFails(MinistryAudioException.WAV_TRUNCATED, {
            val f = File(it, StemId.PIANO.fileName)
            f.writeBytes(f.readBytes().copyOf(f.length().toInt() - 5))
        })
    }

    @Test
    fun `invalid header and MP3 are rejected`() {
        loadFails(MinistryAudioException.WAV_INVALID_HEADER, {
            File(it, StemId.BASS.fileName).writeBytes(ByteArray(400) { 7 })
        })
        loadFails(MinistryAudioException.WAV_INVALID_HEADER, {
            File(it, StemId.OTHER.fileName).writeBytes("ID3".toByteArray() + ByteArray(500))
        })
    }

    @Test
    fun `diverging sample rates and frame counts are rejected`() {
        loadFails(MinistryAudioException.RATE_MISMATCH, {
            File(it, StemId.GUITAR.fileName).writeBytes(Wav.build(16000, 300) { 1 })
        })
        loadFails(MinistryAudioException.FRAMES_MISMATCH, {
            File(it, StemId.DRUMS.fileName).writeBytes(Wav.build(rate, 301) { 1 })
        })
        loadFails(MinistryAudioException.FRAMES_MISMATCH, expectedFrames = 999L)
    }

    @Test
    fun `read error during playback ends in ERROR with every resource released`() {
        val stats = SourceStats()
        val track = FakeTrack()
        val focus = FakeFocus()
        val e = engine(track, focus, stats = stats)
        e.load(newDir(5000), root)
        stats.failAfterReads = stats.reads.get() + 30
        e.play()
        awaitState(e, EngineState.ERROR)
        assertEquals(MinistryAudioException.READ_FAILED, e.lastErrorCode)
        assertTrue(waitUntil { track.released && renderThreadsAlive() == 0 })
        assertEquals(0, track.writesAfterRelease.get())
        assertEquals(stats.opened.get(), stats.closed.get())
        assertTrue(focus.abandons.get() >= 1)
        assertCode(MinistryAudioException.INVALID_STATE) { e.play() }
    }

    @Test
    fun `output write failure ends in ERROR and releases the device track`() {
        val track = FakeTrack(failWritesAfter = 3)
        val stats = SourceStats()
        val e = engine(track, stats = stats)
        e.load(newDir(5000), root)
        e.play()
        awaitState(e, EngineState.ERROR)
        assertEquals(MinistryAudioException.OUTPUT_FAILED, e.lastErrorCode)
        assertTrue(track.released)
        assertEquals(0, track.writesAfterRelease.get())
        assertEquals(stats.opened.get(), stats.closed.get())
    }

    @Test
    fun `failing to create the output keeps the engine usable and frees focus`() {
        val focus = FakeFocus()
        val arbiter = AudioOutputArbiter()
        var fail = true
        val track = FakeTrack()
        val e = engine(
            focus = focus,
            arbiter = arbiter,
            factory = object : StereoTrackFactory {
                override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle {
                    if (fail) throw IllegalStateException("device busy")
                    return track
                }
            },
        )
        e.load(newDir(300), root)
        assertCode(MinistryAudioException.OUTPUT_FAILED) { e.play() }
        assertEquals(EngineState.READY, e.state)
        assertTrue(focus.abandons.get() >= 1)
        assertNull(arbiter.activeOwner)
        fail = false
        e.play()
        awaitState(e, EngineState.COMPLETED)
    }

    @Test
    fun `denied audio focus is a controlled failure`() {
        val arbiter = AudioOutputArbiter()
        val e = engine(focus = FakeFocus(grant = false), arbiter = arbiter)
        e.load(newDir(300), root)
        assertCode(MinistryAudioException.FOCUS_DENIED) { e.play() }
        assertEquals(EngineState.READY, e.state)
        assertNull(arbiter.activeOwner)
    }

    // ------------------------------------------------------ focus / headset

    @Test
    fun `focus loss pauses, transient loss resumes on gain, ducking attenuates`() {
        val track = FakeTrack(writeDelayMs = 1)
        val focus = FakeFocus()
        val e = engine(track, focus)
        e.load(newDir(30000) { id, _ -> if (id == StemId.VOCALS) 1000 else 0 }, root)
        e.play()
        assertTrue(waitUntil { track.shortsWritten > 1000 })

        focus.fire(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        assertTrue(waitUntil { track.snapshot().lastOrNull()?.toInt() == 250 })
        focus.fire(AudioManager.AUDIOFOCUS_GAIN)
        assertTrue(waitUntil { track.snapshot().lastOrNull()?.toInt() == 1000 })

        focus.fire(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        assertEquals(EngineState.PAUSED, e.state)
        focus.fire(AudioManager.AUDIOFOCUS_GAIN)
        assertEquals(EngineState.PLAYING, e.state)

        focus.fire(AudioManager.AUDIOFOCUS_LOSS)
        assertEquals(EngineState.PAUSED, e.state)
        focus.fire(AudioManager.AUDIOFOCUS_GAIN)
        assertEquals("permanent loss must not auto-resume", EngineState.PAUSED, e.state)
        e.resume()
        assertEquals(EngineState.PLAYING, e.state)
    }

    @Test
    fun `headset disconnection pauses without auto resume`() {
        val track = FakeTrack(writeDelayMs = 1)
        val noisy = FakeNoisy()
        val e = engine(track, noisy = noisy)
        e.load(newDir(30000), root)
        e.play()
        assertEquals(1, noisy.registers.get())
        noisy.fire()
        assertEquals(EngineState.PAUSED, e.state)
        Thread.sleep(50)
        assertEquals(EngineState.PAUSED, e.state)
    }

    @Test
    fun `another audio owner preempts the engine`() {
        val track = FakeTrack(writeDelayMs = 1)
        val arbiter = AudioOutputArbiter()
        val e = engine(track, arbiter = arbiter)
        e.load(newDir(30000), root)
        e.play()
        var vocalPreempted = false
        arbiter.claim("vocal") { vocalPreempted = true } // e.g. a vocal exercise starts
        assertTrue(waitUntil { e.state == EngineState.READY && track.released })
        assertFalse(vocalPreempted)
        assertEquals("vocal", arbiter.activeOwner)
    }

    // ------------------------------------------------------- paths / guards

    @Test
    fun `paths outside the allowed root, traversal, missing stems and symlinks are rejected`() {
        val e = engine()
        val outside = tmp.newFolder("outside").also { Wav.writeAll(it, rate, 100) }
        assertCode(MinistryAudioException.PATH_REJECTED) { e.load(outside, root) }
        val d = newDir(100)
        assertCode(MinistryAudioException.PATH_REJECTED) {
            e.load(File(d, "../../outside"), root)
        }
        File(d, StemId.PIANO.fileName).delete()
        assertCode(MinistryAudioException.STEM_MISSING) { e.load(d, root) }

        val d2 = newDir(100)
        val target = File(outside, StemId.VOCALS.fileName)
        val link = File(d2, StemId.BASS.fileName)
        link.delete()
        val canLink = runCatching { Files.createSymbolicLink(link.toPath(), target.toPath()) }.isSuccess
        assumeTrue("symlinks not permitted here", canLink)
        assertCode(MinistryAudioException.PATH_REJECTED) { e.load(d2, root) }
    }

    @Test
    fun `commands in the wrong state and invalid arguments are rejected`() {
        val e = engine()
        assertCode(MinistryAudioException.INVALID_STATE) { e.play() }
        assertCode(MinistryAudioException.INVALID_STATE) { e.pause() }
        assertCode(MinistryAudioException.INVALID_STATE) { e.resume() }
        assertCode(MinistryAudioException.INVALID_STATE) { e.seekToFrame(1) }
        assertCode(MinistryAudioException.INVALID_STATE) { e.setMasterVolume(1f) }
        e.load(newDir(300), root)
        assertCode(MinistryAudioException.INVALID_STATE) { e.pause() }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { e.setTrackGain(StemId.BASS, 2f) }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { e.setMasterVolume(Float.NaN) }
        e.stop() // safe in any state
    }

    // -------------------------------------------------- resources / memory

    @Test
    fun `memory is bounded and files are read incrementally exactly once`() {
        fun run(frames: Int): Pair<Long, SourceStats> {
            val stats = SourceStats()
            val track = FakeTrack()
            val e = engine(track, stats = stats)
            e.load(newDir(frames), root)
            e.play()
            awaitState(e, EngineState.COMPLETED)
            assertEquals(frames, leftOf(track).size)
            val bytes = e.workingSetBytes
            e.dispose()
            assertEquals(stats.opened.get(), stats.closed.get())
            return bytes to stats
        }
        val (shortBytes, _) = run(2000)
        val (longBytes, stats) = run(40000)
        assertEquals(6L * chunk * 4, shortBytes)
        assertEquals(shortBytes, longBytes)
        assertTrue("a read never exceeds one chunk", stats.maxReadLen <= chunk * 4)
        assertEquals(6L * (44 + 40000 * 4L), stats.totalRead)
    }

    @Test
    fun `dispose is idempotent, final and leaves no threads or open files`() {
        val stats = SourceStats()
        val track = FakeTrack(writeDelayMs = 1)
        val events = CopyOnWriteArrayList<EngineState>()
        val e = engine(track, stats = stats, events = events)
        e.load(newDir(30000), root)
        e.play()
        assertTrue(waitUntil { track.shortsWritten > 500 })
        e.dispose()
        e.dispose()
        assertEquals(EngineState.DISPOSED, e.state)
        assertTrue(track.released)
        assertEquals(0, track.writesAfterRelease.get())
        assertEquals(0, renderThreadsAlive())
        assertEquals(stats.opened.get(), stats.closed.get())
        assertEquals(EngineState.DISPOSED, events.last())
        assertCode(MinistryAudioException.INVALID_STATE) { e.play() }
        assertCode(MinistryAudioException.INVALID_STATE) { e.load(newDir(100), root) }
        e.stop()
    }

    @Test
    fun `concurrent commands never corrupt state, leak threads or write after release`() {
        val tracks = CopyOnWriteArrayList<FakeTrack>()
        val stats = SourceStats()
        val e = engine(
            stats = stats,
            focus = FakeFocus(),
            noisy = FakeNoisy(),
            factory = object : StereoTrackFactory {
                override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle =
                    FakeTrack(writeDelayMs = 1).also { tracks.add(it) }
            },
        )
        e.load(newDir(40000) { id, f -> if (id == StemId.VOCALS) f else 100 }, root)
        val unexpected = CopyOnWriteArrayList<Throwable>()
        val workers = (0 until 4).map { w ->
            Thread {
                val rnd = Random(100L + w)
                val end = System.nanoTime() + 600_000_000L
                while (System.nanoTime() < end) {
                    try {
                        when (rnd.nextInt(11)) {
                            0, 1 -> e.play()
                            2 -> e.pause()
                            3 -> e.resume()
                            4 -> e.stop()
                            5, 6 -> e.seekToFrame(rnd.nextInt(40000).toLong())
                            7 -> e.setTrackGain(StemId.values()[rnd.nextInt(6)], rnd.nextFloat())
                            8 -> e.setTrackMuted(StemId.values()[rnd.nextInt(6)], rnd.nextBoolean())
                            9 -> e.setTrackSolo(StemId.values()[rnd.nextInt(6)], rnd.nextBoolean())
                            else -> e.positionFrames
                        }
                    } catch (_: MinistryAudioException) {
                        // illegal-state races are expected and controlled
                    } catch (t: Throwable) {
                        unexpected.add(t)
                    }
                }
            }.apply { start() }
        }
        workers.forEach { it.join(10_000) }
        e.dispose()

        assertTrue("unexpected: $unexpected", unexpected.isEmpty())
        assertEquals(EngineState.DISPOSED, e.state)
        assertTrue(waitUntil { renderThreadsAlive() == 0 })
        for (t in tracks) {
            assertTrue("every created track is released", t.released)
            assertEquals(0, t.writesAfterRelease.get())
        }
        assertEquals(stats.opened.get(), stats.closed.get())
    }
}
