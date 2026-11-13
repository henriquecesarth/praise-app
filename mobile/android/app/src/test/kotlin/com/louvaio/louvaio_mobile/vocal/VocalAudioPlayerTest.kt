package com.louvaio.louvaio_mobile.vocal

import android.media.AudioManager
import io.flutter.plugin.common.MethodChannel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.io.FileInputStream
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class VocalAudioPlayerTest {

    companion object {
        private lateinit var bank: PianoBank
        private val assetDir = listOf(
            File("assets/audio/upright-kw"),
            File("../assets/audio/upright-kw"),
            File("../../assets/audio/upright-kw"),
            File("mobile/assets/audio/upright-kw")
        ).firstOrNull { it.exists() } ?: File("../../assets/audio/upright-kw")

        @BeforeClass
        @JvmStatic
        fun setUp() {
            assertTrue("Asset directory must exist: $assetDir", assetDir.exists())
            bank = PianoBank { fileName ->
                FileInputStream(File(assetDir, fileName))
            }
            bank.loadAll()
        }
    }

    private class RecordingTrackHandle(
        private val id: Int,
        private val eventLog: MutableList<String>,
        private val blockFirstWrite: Boolean = false,
        private val freezePlaybackHead: Boolean = false,
        private val writeDelayMs: Long = 0L,
        private val onFadeDown: (() -> Unit)? = null
    ) : AudioTrackHandle {
        @Volatile
        var released = false
        @Volatile
        var paused = false
        @Volatile
        var currentVolume = 1.0f
        @Volatile
        var totalWrittenFrames = 0L

        val writeEntered = CountDownLatch(1)
        private val unblockWrite = CountDownLatch(1)
        private val writeBlockedOnce = AtomicBoolean(false)

        override fun play() {
            paused = false
            eventLog.add("play:$id")
        }

        override fun pause() {
            paused = true
            eventLog.add("pause:$id")
            unblockWrite.countDown()
        }

        override fun write(audioData: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
            assertFalse("AudioTrack write called AFTER release()!", released)
            if (blockFirstWrite && writeBlockedOnce.compareAndSet(false, true)) {
                writeEntered.countDown()
                try {
                    unblockWrite.await(2, TimeUnit.SECONDS)
                } catch (_: InterruptedException) {
                    eventLog.add("write_interrupted:$id")
                    return -1
                }
            } else {
                writeEntered.countDown()
            }
            if (writeDelayMs > 0L) {
                try {
                    Thread.sleep(writeDelayMs)
                } catch (_: InterruptedException) {
                    return -1
                }
            }
            if (paused) return 0
            totalWrittenFrames += sizeInShorts
            return sizeInShorts
        }

        override fun stop() {
            eventLog.add("stop:$id")
        }

        override fun flush() {
            eventLog.add("flush:$id")
        }

        override fun release() {
            released = true
            eventLog.add("release:$id")
        }

        override fun getPlaybackHeadPositionFrames(): Long {
            assertFalse("AudioTrack playbackHeadPosition read AFTER release()!", released)
            return if (freezePlaybackHead) totalWrittenFrames / 2 else totalWrittenFrames
        }

        override fun fadeVolume(fadeDown: Boolean, durationMs: Long) {
            eventLog.add("fade:${if (fadeDown) "down" else "up"}:$id")
            if (fadeDown) {
                onFadeDown?.invoke()
            }
        }

        override fun setVolumeLevel(gain: Float) {
            currentVolume = gain
            eventLog.add("vol:$gain:$id")
        }
    }

    private class FakeTrackFactory(
        private val blockFirstWrite: Boolean = false,
        private val freezePlaybackHead: Boolean = false,
        private val writeDelayMs: Long = 0L,
        private val onFadeDown: (() -> Unit)? = null
    ) : AudioTrackFactory {
        val events: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val handles: MutableList<RecordingTrackHandle> = Collections.synchronizedList(mutableListOf())
        private val idGen = AtomicInteger(0)

        override fun create(sampleRate: Int, bufferSizeBytes: Int): AudioTrackHandle {
            val id = idGen.incrementAndGet()
            val handle = RecordingTrackHandle(
                id = id,
                eventLog = events,
                blockFirstWrite = blockFirstWrite,
                freezePlaybackHead = freezePlaybackHead,
                writeDelayMs = writeDelayMs,
                onFadeDown = onFadeDown
            )
            handles.add(handle)
            return handle
        }
    }

    private fun awaitCondition(timeoutMs: Long = 2000L, predicate: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!predicate() && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }
        assertTrue("Condition was not satisfied within ${timeoutMs}ms", predicate())
    }

    private class FakeAudioFocusController(
        var allowFocus: Boolean = true
    ) : AudioFocusController {
        val requestCalls = AtomicInteger(0)
        val abandonCalls = AtomicInteger(0)
        @Volatile
        private var callback: ((Int) -> Unit)? = null

        override fun requestFocus(onFocusChange: (Int) -> Unit): Boolean {
            requestCalls.incrementAndGet()
            if (!allowFocus) return false
            callback = onFocusChange
            return true
        }

        override fun abandonFocus() {
            abandonCalls.incrementAndGet()
            callback = null
        }

        fun dispatchFocusChange(focusChange: Int) {
            callback?.invoke(focusChange)
        }
    }

    private class FakeNoisyMonitor : NoisyAudioMonitor {
        val registerCalls = AtomicInteger(0)
        val unregisterCalls = AtomicInteger(0)
        @Volatile
        var isRegistered = false
        @Volatile
        private var callback: (() -> Unit)? = null

        override fun register(onBecomingNoisy: () -> Unit) {
            registerCalls.incrementAndGet()
            isRegistered = true
            callback = onBecomingNoisy
        }

        override fun unregister() {
            if (!isRegistered) return
            unregisterCalls.incrementAndGet()
            isRegistered = false
            callback = null
        }

        fun triggerNoisy() {
            callback?.invoke()
        }
    }

    private fun syncResult(
        onSuccess: (Any?) -> Unit = {},
        onError: (String, String?, Any?) -> Unit = { _, _, _ -> }
    ): Pair<MethodChannel.Result, CountDownLatch> {
        val latch = CountDownLatch(1)
        val result = object : MethodChannel.Result {
            override fun success(res: Any?) {
                onSuccess(res)
                latch.countDown()
            }

            override fun error(code: String, msg: String?, details: Any?) {
                onError(code, msg, details)
                latch.countDown()
            }

            override fun notImplemented() {
                latch.countDown()
            }
        }
        return result to latch
    }

    @Test
    fun stopPausesJoinsRenderThreadBeforeFlushAndReleaseNoWriteAfterRelease() {
        val factory = FakeTrackFactory(blockFirstWrite = true)
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(bank, factory, focus, noisy)

        val (playRes, playLatch) = syncResult()
        player.playSequence(1L, listOf(60, 64, 67), listOf(1.0, 1.0, 1.0), 80, false, playRes)
        assertTrue(playLatch.await(2, TimeUnit.SECONDS))

        val handle = factory.handles.first()
        assertTrue("Render thread should enter write()", handle.writeEntered.await(2, TimeUnit.SECONDS))

        val (stopRes, stopLatch) = syncResult()
        player.stop(1L, stopRes)
        assertTrue(stopLatch.await(2, TimeUnit.SECONDS))

        assertTrue(handle.released)
        val pauseIdx = factory.events.indexOf("pause:1")
        val stopIdx = factory.events.indexOf("stop:1")
        val flushIdx = factory.events.indexOf("flush:1")
        val releaseIdx = factory.events.indexOf("release:1")

        assertTrue("Expected pause before stop/flush/release: ${factory.events}", pauseIdx in 0 until stopIdx)
        assertTrue("Expected flush before release", flushIdx in (stopIdx + 1) until releaseIdx)
        assertEquals(VocalAudioPlayer.State.STOPPED, player.currentState)
        assertFalse(noisy.isRegistered)
        assertTrue(focus.abandonCalls.get() >= 1)

        player.release()
    }

    @Test
    fun rapidSequentialPlaySequenceAndStopNeverLeaksTracksOrFocus() {
        val factory = FakeTrackFactory()
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(bank, factory, focus, noisy)

        for (session in 1L..8L) {
            val (res, latch) = syncResult()
            player.playSequence(session, listOf(60), listOf(0.5), 120, false, res)
            assertTrue(latch.await(2, TimeUnit.SECONDS))
        }

        player.release()

        assertEquals(8, factory.handles.size)
        assertTrue("All tracks must be released", factory.handles.all { it.released })
        assertFalse("Noisy monitor must be unregistered on release", noisy.isRegistered)
        assertEquals(VocalAudioPlayer.State.STOPPED, player.currentState)
    }

    @Test
    fun tailPlaybackHeadStallTransitionsToCompletedAndAbandonsFocus() {
        val factory = FakeTrackFactory(freezePlaybackHead = true)
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(
            bank = bank,
            trackFactory = factory,
            focusController = focus,
            noisyMonitor = noisy,
            tailStallTimeoutMs = 120L
        )

        val (res, latch) = syncResult()
        player.playSequence(10L, listOf(60), listOf(0.125), 240, false, res)
        assertTrue(latch.await(2, TimeUnit.SECONDS))

        val deadline = System.currentTimeMillis() + 2000L
        while (player.currentState != VocalAudioPlayer.State.COMPLETED &&
            System.currentTimeMillis() < deadline
        ) {
            Thread.sleep(20)
        }

        assertEquals(VocalAudioPlayer.State.COMPLETED, player.currentState)
        assertFalse(noisy.isRegistered)
        assertTrue(focus.abandonCalls.get() >= 1)

        player.release()
    }

    @Test
    fun audioFocusDenialTransientPauseDuckGainAndPermanentLossWorkCorrectly() {
        // 1. Focus denied prevents playback
        val deniedFactory = FakeTrackFactory()
        val deniedFocus = FakeAudioFocusController(allowFocus = false)
        val playerDenied = VocalAudioPlayer(bank, deniedFactory, deniedFocus, FakeNoisyMonitor())
        var errorCode: String? = null
        val (denyRes, denyLatch) = syncResult(onError = { code, _, _ -> errorCode = code })
        playerDenied.playSequence(1L, listOf(60), listOf(1.0), 80, false, denyRes)
        assertTrue(denyLatch.await(2, TimeUnit.SECONDS))
        assertEquals("AUDIO_FOCUS_DENIED", errorCode)
        assertTrue(deniedFactory.handles.isEmpty())
        playerDenied.release()

        // 2. Transient duck, gain restore, transient pause, permanent loss
        val factory = FakeTrackFactory(writeDelayMs = 2L)
        val focus = FakeAudioFocusController(allowFocus = true)
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(bank, factory, focus, noisy)

        val (res, latch) = syncResult()
        player.playSequence(5L, listOf(60, 62, 64, 65), listOf(2.0, 2.0, 2.0, 2.0), 60, false, res)
        assertTrue(latch.await(2, TimeUnit.SECONDS))
        val track = factory.handles.first()

        focus.dispatchFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        awaitCondition { track.currentVolume < 0.5f }

        focus.dispatchFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        awaitCondition { track.currentVolume > 0.95f }
        assertEquals(1.0f, track.currentVolume, 0.01f)

        focus.dispatchFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        awaitCondition { player.currentState == VocalAudioPlayer.State.PAUSED }

        val (resumeRes, resumeLatch) = syncResult()
        player.resume(5L, resumeRes)
        assertTrue(resumeLatch.await(2, TimeUnit.SECONDS))
        assertEquals(VocalAudioPlayer.State.PLAYING, player.currentState)
        assertTrue(noisy.isRegistered)

        focus.dispatchFocusChange(AudioManager.AUDIOFOCUS_LOSS)
        awaitCondition { player.currentState == VocalAudioPlayer.State.STOPPED && track.released }
        assertFalse(noisy.isRegistered)

        player.release()
    }

    @Test
    fun becomingNoisyHeadsetDisconnectImmediatelyStopsAndUnregistersReceiver() {
        val factory = FakeTrackFactory(writeDelayMs = 2L)
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(bank, factory, focus, noisy)

        val (res, latch) = syncResult()
        player.playSequence(77L, listOf(60, 64, 67), listOf(2.0, 2.0, 2.0), 60, false, res)
        assertTrue(latch.await(2, TimeUnit.SECONDS))
        assertTrue(noisy.isRegistered)

        var posMap: Map<*, *>? = null
        noisy.triggerNoisy()
        awaitCondition { player.currentState == VocalAudioPlayer.State.STOPPED && factory.handles.first().released }

        assertFalse(noisy.isRegistered)
        assertNotNull(factory.handles.first())

        val (posRes, posLatch) = syncResult(onSuccess = { posMap = it as? Map<*, *> })
        player.getPosition(77L, posRes)
        assertTrue(posLatch.await(2, TimeUnit.SECONDS))
        assertEquals("stopped", posMap?.get("state"))

        // Idempotent unregister on stop/release
        val unregsBefore = noisy.unregisterCalls.get()
        val (stopRes, stopLatch) = syncResult()
        player.stop(77L, stopRes)
        assertTrue(stopLatch.await(2, TimeUnit.SECONDS))
        player.release()
        assertEquals(unregsBefore, noisy.unregisterCalls.get())
    }

    @Test
    fun pauseAndResumeContinuesRenderingRemainingBlocksToCompletion() {
        val factory = FakeTrackFactory(writeDelayMs = 1L)
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        val player = VocalAudioPlayer(bank, factory, focus, noisy)

        var totalFrames = 0L
        val (playRes, playLatch) = syncResult(onSuccess = { res ->
            totalFrames = ((res as? Map<*, *>)?.get("totalFrames") as? Number)?.toLong() ?: 0L
        })
        player.playSequence(91L, listOf(60, 62, 64), listOf(1.0, 1.0, 1.0), 80, false, playRes)
        assertTrue(playLatch.await(2, TimeUnit.SECONDS))
        assertTrue(totalFrames > 0L)

        val track = factory.handles.first()
        val (pauseRes, pauseLatch) = syncResult()
        player.pause(91L, pauseRes)
        assertTrue(pauseLatch.await(2, TimeUnit.SECONDS))
        assertEquals(VocalAudioPlayer.State.PAUSED, player.currentState)
        assertFalse(noisy.isRegistered)

        Thread.sleep(15)
        val framesAtPause = track.totalWrittenFrames
        Thread.sleep(50)
        assertEquals(framesAtPause, track.totalWrittenFrames)
        assertEquals(VocalAudioPlayer.State.PAUSED, player.currentState)

        val (resumeRes, resumeLatch) = syncResult()
        player.resume(91L, resumeRes)
        assertTrue(resumeLatch.await(2, TimeUnit.SECONDS))

        awaitCondition(timeoutMs = 5000L) {
            player.currentState == VocalAudioPlayer.State.COMPLETED
        }

        assertTrue(
            "Expected all $totalFrames frames written after resume, got ${track.totalWrittenFrames}",
            track.totalWrittenFrames >= totalFrames
        )
        player.release()
    }

    @Test
    fun commandsAfterReleaseCompleteGracefullyWithoutRejectedExecutionException() {
        val factory = FakeTrackFactory()
        val player = VocalAudioPlayer(bank, factory)
        player.release()

        var playErrorCode: String? = null
        val (playRes, playLatch) = syncResult(onError = { code, _, _ -> playErrorCode = code })
        player.playSequence(101L, listOf(60), listOf(1.0), 80, false, playRes)
        assertTrue(playLatch.await(2, TimeUnit.SECONDS))
        assertEquals("PLAYER_RELEASED", playErrorCode)

        val (pauseRes, pauseLatch) = syncResult()
        player.pause(101L, pauseRes)
        assertTrue(pauseLatch.await(2, TimeUnit.SECONDS))

        val (resumeRes, resumeLatch) = syncResult()
        player.resume(101L, resumeRes)
        assertTrue(resumeLatch.await(2, TimeUnit.SECONDS))

        val (stopRes, stopLatch) = syncResult()
        player.stop(101L, stopRes)
        assertTrue(stopLatch.await(2, TimeUnit.SECONDS))

        var posState: String? = null
        val (posRes, posLatch) = syncResult(onSuccess = { res ->
            posState = (res as? Map<*, *>)?.get("state") as? String
        })
        player.getPosition(101L, posRes)
        assertTrue(posLatch.await(2, TimeUnit.SECONDS))
        assertEquals("stopped", posState)
    }

    @Test
    fun completionDuringPauseFadeDoesNotRevertStateToPaused() {
        lateinit var player: VocalAudioPlayer
        var triggeredCompletionWait = false
        val factory = FakeTrackFactory(
            writeDelayMs = 0L,
            onFadeDown = {
                if (!triggeredCompletionWait) {
                    triggeredCompletionWait = true
                    // Wait during fadeVolume for renderThread to naturally complete playback
                    val deadline = System.currentTimeMillis() + 3000L
                    while (player.currentState != VocalAudioPlayer.State.COMPLETED &&
                        System.currentTimeMillis() < deadline
                    ) {
                        Thread.sleep(10)
                    }
                }
            }
        )
        val focus = FakeAudioFocusController()
        val noisy = FakeNoisyMonitor()
        player = VocalAudioPlayer(bank, factory, focus, noisy)

        val (playRes, playLatch) = syncResult()
        player.playSequence(102L, listOf(60), listOf(0.25), 120, false, playRes)
        assertTrue(playLatch.await(2, TimeUnit.SECONDS))

        val (pauseRes, pauseLatch) = syncResult()
        player.pause(102L, pauseRes)
        assertTrue(pauseLatch.await(4, TimeUnit.SECONDS))

        assertEquals(VocalAudioPlayer.State.COMPLETED, player.currentState)
        assertTrue(focus.abandonCalls.get() >= 1)
        assertFalse(noisy.isRegistered)
        player.release()
    }
}
