package com.louvaio.louvaio_mobile.vocal

import com.louvaio.louvaio_mobile.ministryaudio.AudioOutputArbiter
import com.louvaio.louvaio_mobile.ministryaudio.EngineState
import com.louvaio.louvaio_mobile.ministryaudio.FakeTrack
import com.louvaio.louvaio_mobile.ministryaudio.MinistryAudioEngine
import com.louvaio.louvaio_mobile.ministryaudio.StereoTrackFactory
import com.louvaio.louvaio_mobile.ministryaudio.StereoTrackHandle
import com.louvaio.louvaio_mobile.ministryaudio.Wav
import com.louvaio.louvaio_mobile.ministryaudio.waitUntil
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Only one of {vocal exercises, ministry audio} may own the output. */
class VocalMinistryArbitrationTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val assetDir = listOf(
        File("assets/audio/upright-kw"),
        File("../assets/audio/upright-kw"),
        File("../../assets/audio/upright-kw"),
        File("mobile/assets/audio/upright-kw"),
    ).firstOrNull { it.exists() } ?: File("../../assets/audio/upright-kw")

    private class VTrack : AudioTrackHandle {
        @Volatile var released = false
        override fun play() {}
        override fun pause() {}
        override fun write(audioData: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            Thread.sleep(2)
            return sizeInShorts
        }
        override fun stop() {}
        override fun flush() {}
        override fun release() { released = true }
        override fun getPlaybackHeadPositionFrames(): Long = 0L
        override fun fadeVolume(fadeDown: Boolean, durationMs: Long, targetGain: Float) {}
        override fun setVolumeLevel(gain: Float) {}
    }

    private val vTracks = java.util.Collections.synchronizedList(mutableListOf<VTrack>())
    private val players = mutableListOf<VocalAudioPlayer>()
    private val engines = mutableListOf<MinistryAudioEngine>()

    @After
    fun tearDown() {
        players.forEach { it.release() }
        engines.forEach { it.dispose() }
    }

    private fun result(latch: CountDownLatch) = object : MethodChannel.Result {
        override fun success(res: Any?) = latch.countDown()
        override fun error(code: String, msg: String?, details: Any?) = latch.countDown()
        override fun notImplemented() = latch.countDown()
    }

    private fun vocal(arbiter: AudioOutputArbiter): VocalAudioPlayer {
        val bank = PianoBank { FileInputStream(File(assetDir, it)) }
        val p = VocalAudioPlayer(
            bank,
            object : AudioTrackFactory {
                override fun create(sampleRate: Int, bufferSizeBytes: Int): AudioTrackHandle =
                    VTrack().also { vTracks.add(it) }
            },
            outputArbiter = arbiter,
        )
        players.add(p)
        return p
    }

    private fun ministry(arbiter: AudioOutputArbiter, track: FakeTrack): MinistryAudioEngine {
        val dir = File(tmp.newFolder("rec"), "r")
        Wav.writeAll(dir, 8000, 40000)
        val e = MinistryAudioEngine(
            trackFactory = object : StereoTrackFactory {
                override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = track
            },
            arbiter = arbiter,
            chunkFrames = 64,
        )
        engines.add(e)
        e.load(dir, dir.parentFile)
        return e
    }

    private fun playVocal(p: VocalAudioPlayer, session: Long) {
        val latch = CountDownLatch(1)
        p.playSequence(session, listOf(60, 62), listOf(8.0, 8.0), 60, false, result(latch))
        assertTrue(latch.await(5, TimeUnit.SECONDS))
    }

    @Test
    fun `starting a vocal exercise stops ministry playback`() {
        val arbiter = AudioOutputArbiter()
        val track = FakeTrack(writeDelayMs = 1)
        val m = ministry(arbiter, track)
        m.play()
        assertEquals("ministry-audio", arbiter.activeOwner)

        val v = vocal(arbiter)
        playVocal(v, 1L)
        assertTrue(waitUntil { m.state == EngineState.READY && track.released })
        assertEquals("vocal-exercises", arbiter.activeOwner)
        assertEquals(VocalAudioPlayer.State.PLAYING, v.currentState)
    }

    @Test
    fun `starting ministry playback stops the vocal exercise`() {
        val arbiter = AudioOutputArbiter()
        val v = vocal(arbiter)
        playVocal(v, 1L)
        assertEquals("vocal-exercises", arbiter.activeOwner)

        val m = ministry(arbiter, FakeTrack(writeDelayMs = 1))
        m.play()
        assertTrue(waitUntil { v.currentState == VocalAudioPlayer.State.STOPPED })
        assertTrue(waitUntil { vTracks.all { it.released } })
        assertEquals("ministry-audio", arbiter.activeOwner)
    }

    @Test
    fun `stopping either side never leaves a claim stuck`() {
        val arbiter = AudioOutputArbiter()
        val v = vocal(arbiter)
        playVocal(v, 1L)
        val latch = CountDownLatch(1)
        v.stop(1L, result(latch))
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertNull(arbiter.activeOwner)

        val m = ministry(arbiter, FakeTrack(writeDelayMs = 1))
        m.play()
        assertTrue(m.stop())
        assertNull(arbiter.activeOwner)
    }
}
