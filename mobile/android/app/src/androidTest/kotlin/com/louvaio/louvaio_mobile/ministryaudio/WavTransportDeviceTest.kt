package com.louvaio.louvaio_mobile.ministryaudio

import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * WAV transport on the device, with the REAL AudioTrack: resume after a paused seek, pause during the final drain and
 * a seek accepted while finishing. The six stems are silent, generated in the cache directory.
 */
class WavTransportDeviceTest {
    private val tag = "WAVTRANSPORT"
    private val rate = 44_100
    private val frames = rate * 3L
    private lateinit var root: File
    private var engine: MinistryAudioEngine? = null
    private var track: Recording? = null

    /** Delegates to the device track and records what the engine did with it. */
    private class Recording(private val inner: StereoTrackHandle) : StereoTrackHandle by inner {
        val events = CopyOnWriteArrayList<String>()
        @Volatile var written = 0L
        @Volatile var headBase = 0L
        @Volatile var playedAtLastPause = 0L
        @Volatile var writtenAtLastPause = 0L
        @Volatile var onRelease: (() -> Unit)? = null

        val played get() = inner.headPositionFrames() - headBase

        override fun play() {
            events.add("play")
            inner.play()
        }

        // The release path pauses before it flushes, so the last pause sees what was really played.
        override fun pause() {
            playedAtLastPause = played
            writtenAtLastPause = written
            events.add("pause")
            inner.pause()
        }

        override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
            inner.write(data, offsetInShorts, sizeInShorts).also { if (it > 0) written += it / 2 }

        override fun writeNonBlocking(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
            inner.writeNonBlocking(data, offsetInShorts, sizeInShorts).also { if (it > 0) written += it / 2 }

        override fun flush() {
            events.add("flush")
            inner.flush()
            written = 0L
            headBase = inner.headPositionFrames()
        }

        override fun release() {
            onRelease?.also { onRelease = null }?.invoke()
            inner.release()
        }
    }

    @Before
    fun setUp() {
        root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "wavtransport")
        root.deleteRecursively()
        val dir = File(root, "rec").apply { mkdirs() }
        val data = (frames * 4).toInt()
        val wav = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
        wav.put("RIFF".toByteArray()).putInt(36 + data).put("WAVEfmt ".toByteArray()).putInt(16)
        wav.putShort(1).putShort(2).putInt(rate).putInt(rate * 4).putShort(4).putShort(16)
        wav.put("data".toByteArray()).putInt(data)
        StemId.values().forEach { File(dir, it.fileName).writeBytes(wav.array()) }
    }

    @After
    fun tearDown() {
        engine?.let { assertTrue(it.dispose()) }
        root.deleteRecursively()
    }

    private fun create(tailMs: Long = MinistryAudioEngine.DEFAULT_TAIL_STALL_MS): MinistryAudioEngine {
        val real = AndroidStereoTrackFactory()
        val e = MinistryAudioEngine(
            trackFactory = object : StereoTrackFactory {
                override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle =
                    Recording(real.create(sampleRate, bufferFrames)).also { track = it }
            },
            tailStallTimeoutMs = tailMs,
        )
        engine = e
        e.load(File(root, "rec"), root)
        return e
    }

    private fun await(what: String, timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeoutMs
        while (!condition()) {
            assertTrue("timeout: $what (state=${engine?.state} error=${engine?.lastErrorCode})", SystemClock.elapsedRealtime() < end)
            Thread.sleep(1)
        }
    }

    @Test
    fun resumeAfterAPausedSeekDropsTheQueuedAudioBeforeRestarting() {
        val e = create()
        e.play()
        await("playing") { (track?.played ?: 0L) > rate / 2 }
        e.pause()
        Thread.sleep(200) // paused with audio of the old position queued
        val target = frames * 6 / 10
        e.seekToFrame(target)
        val t = track!!
        val before = t.events.size
        e.resume()
        await("completed") { e.state == EngineState.COMPLETED }

        val after = t.events.drop(before)
        Log.i(tag, "pausedSeek events=$after playedAtEnd=${t.playedAtLastPause} writtenAtEnd=${t.writtenAtLastPause}")
        assertEquals("$after", "flush", after.first { it == "play" || it == "flush" })
        // Silence may follow the content (see the engine's drain); all of the content after the target must be played.
        val content = frames - target
        assertTrue("written ${t.writtenAtLastPause}", t.writtenAtLastPause in content..content + rate + rate / 10)
        assertTrue("cut at ${t.playedAtLastPause}", t.playedAtLastPause >= content)
    }

    @Test
    fun aPauseDuringTheFinalDrainDoesNotCutTheTail() {
        val e = create(tailMs = 300)
        e.play()
        await("all written") { track?.written == frames }
        e.pause()
        val t = track!!
        val playedAtPause = t.played
        assertTrue("not paused during the drain: $playedAtPause", playedAtPause < frames)
        Thread.sleep(800) // longer than the tail stall timeout
        assertEquals(EngineState.PAUSED, e.state)
        e.resume()
        await("completed") { e.state == EngineState.COMPLETED }
        Log.i(tag, "drain playedAtPause=$playedAtPause playedAtEnd=${t.playedAtLastPause} written=${t.writtenAtLastPause}")
        // Silence may be written after the content to keep the device consuming; the content itself must all be played.
        assertTrue(t.writtenAtLastPause >= frames)
        assertTrue("tail cut at ${t.playedAtLastPause}", t.playedAtLastPause >= frames)
    }

    @Test
    fun aSeekAcceptedWhileFinishingIsKept() {
        val e = create()
        e.play()
        val target = frames / 4
        track!!.onRelease = { e.seekToFrame(target) }
        await("ready") { track!!.onRelease == null && e.state == EngineState.READY }
        Thread.sleep(50)
        Log.i(tag, "lateSeek state=${e.state} position=${e.positionFrames}")
        assertEquals(EngineState.READY, e.state)
        assertEquals(target, e.positionFrames)
    }
}
