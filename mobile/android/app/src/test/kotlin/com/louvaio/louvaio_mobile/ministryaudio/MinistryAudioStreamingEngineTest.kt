package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioManager
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MinistryAudioStreamingEngineTest {
    private val stream = FakeStream()
    private val decoder = stream.Decoder()
    private val tracks = CopyOnWriteArrayList<FakeTrack>()
    private val states = CopyOnWriteArrayList<Pair<EngineState, String?>>()
    private val focus = FakeFocus()
    private val noisy = FakeNoisy()
    private val arbiter = AudioOutputArbiter()
    private var writeDelayMs = 0L
    private var engine: MinistryAudioEngine? = null
    private var feed: IncrementalPcmFeed? = null

    /** Lets a test hold the playback head back and act when the track is released. */
    private class ControlledTrack(private val inner: FakeTrack, private val test: MinistryAudioStreamingEngineTest) :
        StereoTrackHandle by inner {
        override fun headPositionFrames(): Long {
            test.onHead?.also { test.onHead = null }?.invoke()
            return minOf(inner.headPositionFrames(), test.headLimit)
        }
        override fun play() {
            if (test.failPlay) throw IllegalStateException("output")
            inner.play()
        }
        override fun release() {
            test.onRelease?.also { test.onRelease = null }?.invoke()
            inner.release()
        }
    }

    @Volatile private var headLimit = Long.MAX_VALUE
    @Volatile private var onRelease: (() -> Unit)? = null
    @Volatile private var onHead: (() -> Unit)? = null
    @Volatile private var failPlay = false

    private fun create(
        starvationMs: Long = 20_000,
        joinMs: Long = 2_000,
        tailMs: Long = 1_500,
        output: StereoTrackHandle? = null,
    ): MinistryAudioEngine {
        val e = MinistryAudioEngine(
            trackFactory = object : StereoTrackFactory {
                override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle =
                    output ?: ControlledTrack(FakeTrack(writeDelayMs = writeDelayMs).also { tracks.add(it) }, this@MinistryAudioStreamingEngineTest)
            },
            tailStallTimeoutMs = tailMs,
            focus = focus,
            noisy = noisy,
            arbiter = arbiter,
            listener = { state, code -> states.add(state to code) },
            starvationTimeoutMs = starvationMs,
        )
        feed = stream.feed(decoder, joinMs = joinMs)
        e.loadStreaming(feed!!)
        engine = e
        return e
    }

    @After
    fun tearDown() {
        decoder.wedged?.countDown()
        decoder.stalls.values.forEach { it.second.countDown() }
        engine?.dispose()
        assertTrue(waitUntil { streamThreadsAlive() == 0 && renderThreadsAlive() == 0 })
        assertEquals(0, decoder.alive.get())
    }

    private fun played() = tracks.single().snapshot().toShortArray()

    private fun await(state: EngineState) =
        assertTrue("expected $state, got ${engine!!.state}/${engine!!.lastErrorCode}", waitUntil { engine!!.state == state })

    @Test
    fun playsTheWholeTimelineExactlyAndCompletesOnlyAfterEveryEos() {
        val e = create()
        e.play()
        await(EngineState.COMPLETED)
        assertArrayEquals(stream.reference(), played())
        assertEquals(stream.frames, e.positionFrames)
        assertTrue(feed!!.verified())
        assertEquals(EngineState.BUFFERING, states.map { it.first }.first { it != EngineState.READY })
    }

    @Test
    fun aStallInAnyStemHoldsTheClockAndResumesOnTheSameTimeline() {
        for (stem in 0 until 6) {
            tracks.clear()
            states.clear()
            val gate = decoder.stall(stem, 100_000)
            val e = create()
            e.play()
            assertTrue(waitUntil { states.count { it.first == EngineState.BUFFERING } >= 2 })
            await(EngineState.BUFFERING)
            val position = e.positionFrames
            val written = tracks.single().shortsWritten
            Thread.sleep(40)
            assertEquals("stem $stem: clock must not move", position, e.positionFrames)
            assertEquals("stem $stem: nothing is written while buffering", written, tracks.single().shortsWritten)
            assertTrue(tracks.single().paused)
            assertTrue(position < 100_000)
            gate.countDown()
            await(EngineState.COMPLETED)
            // Byte identical to the uninterrupted mix: no inserted silence, no dropped or shifted frames.
            assertArrayEquals("stem $stem", stream.reference(), played())
            assertTrue(e.dispose())
            decoder.stalls.clear()
        }
    }

    @Test
    fun mutedStemsKeepAdvancingAndComeBackAligned() {
        writeDelayMs = 1
        val e = create()
        e.setTrackMuted(StemId.values()[2], true)
        e.setTrackSolo(StemId.values()[0], true)
        e.play()
        assertTrue(waitUntil { e.positionFrames > 150_000 })
        e.setTrackSolo(StemId.values()[0], false)
        e.setTrackMuted(StemId.values()[2], false)
        await(EngineState.COMPLETED)
        val reference = stream.reference()
        val out = played()
        assertEquals(reference.size, out.size)
        // After the 5 ms ramps the unmuted mix is the reference mix again, sample for sample.
        assertArrayEquals(reference.copyOfRange(reference.size - 40_000, reference.size), out.copyOfRange(out.size - 40_000, out.size))
    }

    @Test
    fun seekRestartsTheProducersAndPlaysTheExactSuffix() {
        for (target in listOf(0L, 33_333L, stream.frames / 2, stream.frames - 3000)) {
            tracks.clear()
            val e = create()
            e.seekToFrame(target)
            e.play()
            await(EngineState.COMPLETED)
            assertArrayEquals("target $target", stream.reference(target), played())
            assertTrue(e.dispose())
        }
    }

    @Test
    fun seekWhilePlayingPausedAndRebuffering() {
        writeDelayMs = 2
        val gate = decoder.stall(1, 100_000)
        val e = create()
        e.play()
        await(EngineState.BUFFERING)
        assertTrue(waitUntil { e.positionFrames > 0 && e.state == EngineState.BUFFERING })
        decoder.stalls.clear()
        e.seekToFrame(200_000) // while re-buffering
        gate.countDown()
        assertTrue(waitUntil { e.state == EngineState.PLAYING && e.positionFrames >= 200_000 })
        e.pause()
        e.seekToFrame(10_000) // while paused
        assertEquals(10_000L, e.positionFrames)
        e.resume()
        assertTrue(waitUntil { e.state == EngineState.PLAYING && e.positionFrames in 10_000L..150_000L })
        repeat(10) { e.seekToFrame(20_000L * it) } // repeated seeks: only the last one matters
        await(EngineState.COMPLETED)
        val tail = stream.reference(180_000)
        val out = played()
        assertArrayEquals(tail.copyOfRange(tail.size - 20_000, tail.size), out.copyOfRange(out.size - 20_000, out.size))
    }

    @Test
    fun pauseDuringBufferingStaysPausedWhenDataArrives() {
        val gate = decoder.stall(5, 100_000)
        val e = create()
        e.play()
        assertTrue(waitUntil { e.state == EngineState.BUFFERING && e.positionFrames > 0 })
        e.pause()
        gate.countDown()
        Thread.sleep(60)
        assertEquals(EngineState.PAUSED, e.state)
        e.resume()
        await(EngineState.COMPLETED)
        assertArrayEquals(stream.reference(), played())
    }

    @Test
    fun focusLossAndNoisyPauseWhileBuffering() {
        for (interrupt in listOf<() -> Unit>({ focus.fire(AudioManager.AUDIOFOCUS_LOSS) }, { noisy.fire() })) {
            val gate = decoder.stall(0, 0)
            val e = create()
            e.play()
            await(EngineState.BUFFERING)
            interrupt()
            assertEquals(EngineState.PAUSED, e.state)
            gate.countDown()
            Thread.sleep(40)
            assertEquals(EngineState.PAUSED, e.state)
            assertTrue(e.dispose())
            decoder.stalls.clear()
        }
    }

    @Test
    fun stopReleasesAllCodecsAndPlayStartsAgainFromZero() {
        writeDelayMs = 2
        val e = create()
        e.play()
        assertTrue(waitUntil { e.positionFrames > 20_000 })
        assertTrue(e.stop())
        assertEquals("codecs released on stop (also the background path)", 0, decoder.alive.get())
        assertEquals(EngineState.READY, e.state)
        tracks.clear()
        writeDelayMs = 0
        e.play()
        await(EngineState.COMPLETED)
        assertArrayEquals(stream.reference(), played())
    }

    @Test
    fun anotherAudioOwnerPreemptsAndReleasesTheCodecs() {
        writeDelayMs = 2
        val e = create()
        e.play()
        assertTrue(waitUntil { e.positionFrames > 0 })
        arbiter.claim("vocal") {}
        await(EngineState.READY)
        assertTrue(waitUntil { decoder.alive.get() == 0 })
    }

    @Test
    fun aDecoderFailureMidPlaybackEndsTheWholeSessionWithoutCodecsLeft() {
        decoder.failures[3] = 200_000L to MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "injected")
        writeDelayMs = 1
        val e = create()
        e.play()
        await(EngineState.ERROR)
        assertEquals(MinistryAudioException.MP3_DECODE_FAILED, e.lastErrorCode)
        assertEquals("codecs are gone before ERROR is published", 0, decoder.alive.get())
        assertTrue(played().size < stream.reference().size)
        assertTrue(e.dispose())
    }

    @Test
    fun prematureAndExcessEosNeverReachCompleted() {
        for (error in listOf(-500, 500)) {
            tracks.clear()
            states.clear()
            decoder.lengthError[2] = error
            val e = create()
            e.play()
            await(EngineState.ERROR)
            assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, e.lastErrorCode)
            assertFalse(states.any { it.first == EngineState.COMPLETED })
            assertTrue(e.dispose())
        }
    }

    @Test
    fun aDivergingInputFrameEndsTheSessionWithThatCause() {
        repeat(8) {
            tracks.clear()
            decoder.inputFault[1] = 200 to 0
            val e = create()
            e.play()
            await(EngineState.ERROR)
            // Never the READ_FAILED of a render that raced the aborted rings.
            assertEquals(MinistryAudioException.MP3_INVALID, e.lastErrorCode)
            assertTrue(e.dispose())
        }
    }

    @Test
    fun seekToTheExactEndCompletes() {
        writeDelayMs = 2
        val e = create(starvationMs = 1_500)
        e.play()
        assertTrue(waitUntil { e.positionFrames > 0 })
        e.seekToFrame(stream.frames)
        await(EngineState.COMPLETED)
        assertEquals(stream.frames, e.positionFrames)
        assertTrue(feed!!.verified())
    }

    @Test
    fun resumeAfterAPausedSeekDoesNotRestartTheOutputBeforeTheNewPositionIsBuffered() {
        writeDelayMs = 2
        val e = create()
        e.play()
        assertTrue(waitUntil { e.state == EngineState.PLAYING && e.positionFrames > 0 })
        e.pause()
        val gate = decoder.stall(2, 200_000)
        e.seekToFrame(200_000)
        val plays = tracks.single().events.count { it == "play" }
        e.resume()
        assertEquals(EngineState.BUFFERING, e.state)
        Thread.sleep(60)
        assertEquals("no queued audio of the old position may be heard", plays, tracks.single().events.count { it == "play" })
        gate.countDown()
        await(EngineState.COMPLETED)
        val tail = stream.reference(200_000)
        val out = played()
        assertArrayEquals(tail, out.copyOfRange(out.size - tail.size, out.size))
    }

    @Test
    fun aPauseDuringTheFinalDrainDoesNotCutTheTail() {
        headLimit = 1_000
        val e = create(tailMs = 150)
        e.play()
        assertTrue(waitUntil { tracks.isNotEmpty() && tracks.single().shortsWritten.toLong() == stream.frames * 2 })
        Thread.sleep(30)
        e.pause()
        Thread.sleep(400) // longer than the tail stall timeout
        e.resume()
        Thread.sleep(60)
        assertTrue("completed with audio still queued", e.state != EngineState.COMPLETED)
        headLimit = Long.MAX_VALUE
        await(EngineState.COMPLETED)
    }

    /** Like the device: a resumed track with a partial buffer does not move again until it is fed. */
    @Test
    fun theTailStillPlaysWhenTheOutputOnlyResumesAfterBeingFed() {
        val inner = FakeTrack()
        val head = java.util.concurrent.atomic.AtomicLong(1_000)
        var releasedAt = -1L
        val track = object : StereoTrackHandle by inner {
            override fun writeNonBlocking(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
                inner.write(data, offsetInShorts, sizeInShorts).also { if (it > 0) head.set(Long.MAX_VALUE) }
            override fun headPositionFrames(): Long = minOf(inner.headPositionFrames(), head.get())
            override fun release() {
                releasedAt = headPositionFrames()
                inner.release()
            }
        }
        val e = create(tailMs = 1_000, output = track)
        e.play()
        assertTrue(waitUntil { inner.shortsWritten.toLong() == stream.frames * 2 })
        e.pause()
        e.resume()
        await(EngineState.COMPLETED)
        assertTrue("released with the head at $releasedAt", releasedAt >= stream.frames)
        assertEquals(stream.frames, e.positionFrames)
        assertTrue("padding is silent", inner.snapshot().drop((stream.frames * 2).toInt()).all { it.toInt() == 0 })
    }

    @Test
    fun aPauseArrivingInsideADrainIterationDoesNotCompleteIt() {
        headLimit = 1_000
        val e = create(tailMs = 100)
        e.play()
        assertTrue(waitUntil { tracks.isNotEmpty() && tracks.single().shortsWritten.toLong() == stream.frames * 2 })
        Thread.sleep(20)
        // The render thread is held past the stall deadline between its pause check and the head sample.
        onHead = {
            Thread.sleep(150)
            e.pause()
        }
        assertTrue(waitUntil { onHead == null && e.state == EngineState.PAUSED })
        Thread.sleep(80)
        assertEquals(EngineState.PAUSED, e.state)
        headLimit = Long.MAX_VALUE
        e.resume()
        await(EngineState.COMPLETED)
    }

    @Test
    fun aPauseAfterTheEndWasReachedIsRefusedRatherThanDiscarded() {
        var refused: String? = null
        val e = create()
        // The track is released after the completion decision: a pause here can no longer be honoured.
        onRelease = {
            refused = try {
                e.pause()
                "accepted"
            } catch (x: MinistryAudioException) {
                x.code
            }
        }
        e.play()
        await(EngineState.COMPLETED)
        assertEquals(MinistryAudioException.INVALID_STATE, refused)
        assertFalse(states.any { it.first == EngineState.PAUSED })
    }

    @Test
    fun aSeekQueuedDuringTheLastDrainIterationKeepsPlaying() {
        headLimit = 1_000
        val e = create()
        e.play()
        assertTrue(waitUntil { tracks.isNotEmpty() && tracks.single().shortsWritten.toLong() == stream.frames * 2 })
        Thread.sleep(20)
        // The head reaches the end and, in the same iteration, a seek is accepted.
        onHead = {
            headLimit = Long.MAX_VALUE
            e.seekToFrame(0)
        }
        assertTrue(waitUntil { onHead == null })
        await(EngineState.COMPLETED)
        assertEquals("played again from the target", stream.frames * 4, tracks.single().shortsWritten.toLong())
    }

    @Test
    fun anOutputThatCannotStartEndsTheSessionInsteadOfReportingPlaying() {
        failPlay = true
        val e = create()
        e.play()
        await(EngineState.ERROR)
        assertEquals(MinistryAudioException.OUTPUT_FAILED, e.lastErrorCode)
        assertFalse(states.any { it.first == EngineState.PLAYING })
        assertEquals(0, decoder.alive.get())
    }

    @Test
    fun aSeekAcceptedWhileFinishingIsKept() {
        val e = create()
        onRelease = { e.seekToFrame(12_345) }
        e.play()
        assertTrue(waitUntil { onRelease == null && e.state == EngineState.READY })
        Thread.sleep(30)
        assertEquals(EngineState.READY, e.state)
        assertEquals(12_345L, e.positionFrames)
        assertFalse(states.any { it.first == EngineState.COMPLETED })
    }

    @Test
    fun aFailureWhilePausedEndsTheSession() {
        val gate = decoder.stall(2, 150_000)
        decoder.failures[2] = 150_000L to MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "injected")
        val e = create()
        e.play()
        assertTrue(waitUntil { e.state == EngineState.BUFFERING && e.positionFrames > 0 })
        e.pause()
        gate.countDown()
        await(EngineState.ERROR)
    }

    @Test
    fun starvationIsBounded() {
        decoder.stall(4, 50_000)
        val e = create(starvationMs = 150)
        e.play()
        await(EngineState.ERROR)
        assertEquals(MinistryAudioException.MP3_DECODE_FAILED, e.lastErrorCode)
        assertEquals(0, decoder.alive.get())
    }

    @Test
    fun pausedTimeIsNotStarvation() {
        val gate = decoder.stall(4, 100_000)
        val e = create(starvationMs = 300)
        e.play()
        assertTrue(waitUntil { e.state == EngineState.BUFFERING && e.positionFrames > 0 })
        e.pause()
        Thread.sleep(500)
        assertEquals(EngineState.PAUSED, e.state)
        gate.countDown()
        e.resume()
        await(EngineState.COMPLETED)
    }

    @Test
    fun disposeIsNotConfirmedWhileACodecIsWedged() {
        val wedge = CountDownLatch(1)
        decoder.wedged = wedge
        val e = create(joinMs = 100)
        e.play()
        assertTrue(waitUntil { decoder.alive.get() == 6 })
        assertFalse("the lease must be kept", e.dispose())
        assertFalse(e.dispose())
        wedge.countDown()
        assertTrue(waitUntil { e.dispose() })
        assertEquals(0, decoder.alive.get())
    }

    @Test
    fun disposeWhileBlockedProducersAndBufferingReturnsPromptly() {
        decoder.stall(0, 0)
        val e = create()
        e.play()
        await(EngineState.BUFFERING)
        val start = System.nanoTime()
        assertTrue(e.dispose())
        assertTrue((System.nanoTime() - start) / 1_000_000 < 1_500)
        assertEquals(0, decoder.alive.get())
    }
}
