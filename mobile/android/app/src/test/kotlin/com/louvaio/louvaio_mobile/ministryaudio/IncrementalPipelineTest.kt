package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class IncrementalPipelineTest {
    @get:Rule
    val temp = TemporaryFolder()

    // ------------------------------------------------------------------ index

    private class Case(val name: String, val rate: Int, val frames: Long, val alignment: Mp3Alignment)

    private val cases = listOf(
        Case("impulse_lame_44100", 44_100, 44_100, Mp3Alignment(1105, 875, 40)),
        Case("impulse_lavc_44100", 44_100, 44_100, Mp3Alignment(1105, 875, 40)),
        Case("impulse_lame_48000", 48_000, 48_000, Mp3Alignment(1105, 431, 43)),
        Case("impulse_lavc_48000", 48_000, 48_000, Mp3Alignment(1105, 431, 43)),
    )

    private fun fixture(name: String) = File("src/main/assets/ministry_audio_mp3_calibration/$name.mp3").readBytes()

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private fun index(
        c: Case,
        bytes: ByteArray,
        expected: Mp3StemExpectation = Mp3StemExpectation(bytes.size.toLong(), sha(bytes)),
        alignment: Mp3Alignment = c.alignment,
        frames: Long = c.frames,
        rate: Int = c.rate,
    ): Mp3StreamIndex {
        val f = temp.newFile().apply { writeBytes(bytes) }
        return Mp3StreamIndexer.index(f, rate, frames, alignment, expected)
    }

    @Test
    fun indexesBothProfilesAtBothRates() {
        for (c in cases) {
            val bytes = fixture(c.name)
            val index = index(c, bytes)
            assertEquals(c.name, c.alignment.mpegAudioFrames, index.offsets.size)
            // Every offset is a frame header and consecutive frames are one CBR 256 frame apart.
            val length = 144 * 256_000 / c.rate
            for (i in index.offsets.indices) {
                assertEquals(c.name, 0xFF.toByte(), bytes[index.offsets[i]])
                if (i > 0) assertTrue(index.offsets[i] - index.offsets[i - 1] in length..length + 1)
            }
        }
    }

    @Test
    fun rejectsAnyDivergenceOfBytesOrManifest() {
        val c = cases[0]
        val good = fixture(c.name)
        val honest = Mp3StemExpectation(good.size.toLong(), sha(good))
        fun refused(label: String, block: () -> Unit) {
            try {
                block()
            } catch (e: MinistryAudioException) {
                assertEquals(label, MinistryAudioException.MP3_INVALID, e.code)
                return
            }
            throw AssertionError("accepted: $label")
        }
        fun mutated(at: Int, xor: Int = 1) = good.copyOf().also { it[at] = (it[at].toInt() xor xor).toByte() }

        refused("wrong sha") { index(c, good, Mp3StemExpectation(good.size.toLong(), "0".repeat(64))) }
        refused("wrong size") { index(c, good, Mp3StemExpectation(good.size + 1L, honest.sha256)) }
        // Consistent SHA on tampered bytes: the structure and the CRCs must catch it on their own.
        refused("payload (music CRC)") { index(c, mutated(good.size - 10)) }
        refused("info frame (tag CRC)") { index(c, mutated(40)) }
        refused("side info of the info frame") { index(c, mutated(10)) }
        refused("header sync") { index(c, mutated(index(c, good).offsets[3], 0x10)) }
        refused("bitrate") { index(c, mutated(index(c, good).offsets[3] + 2, 0x10)) }
        refused("truncated") { index(c, good.copyOf(good.size - 5)) }
        refused("trailing bytes") { index(c, good + ByteArray(5)) }
        refused("one frame less") { index(c, good.copyOf(index(c, good).offsets.last())) }
        refused("ID3 prefix") { index(c, "ID3".toByteArray() + good) }
        refused("alignment shifted by one frame") {
            index(c, good, alignment = Mp3Alignment(1105 + 1, 875 - 1, 40))
        }
        refused("manifest rate") { index(c, good, rate = 48_000) }
        refused("manifest frames") { index(c, good, frames = c.frames - 1, alignment = Mp3Alignment(1105, 876, 40)) }
    }

    @Test
    fun indexingCanBeCancelled() {
        val c = cases[0]
        val bytes = fixture(c.name)
        val f = temp.newFile().apply { writeBytes(bytes) }
        assertCode(MinistryAudioException.CANCELLED) {
            Mp3StreamIndexer.index(f, c.rate, c.frames, c.alignment, Mp3StemExpectation(bytes.size.toLong(), sha(bytes))) { true }
        }
    }

    // ------------------------------------------------------------------- ring

    @Test
    fun ringBlocksTheProducerWhenFullAndAbortWakesIt() {
        val ring = PcmRing(100)
        val written = AtomicReference<Throwable?>()
        val producer = Thread {
            try {
                ring.write(ByteArray(1000), 0, 1000)
            } catch (e: Throwable) {
                written.set(e)
            }
        }.apply { start() }
        assertTrue(waitUntil { ring.availableFrames(0) == 100L })
        Thread.sleep(30)
        assertTrue("producer must be blocked", producer.isAlive)
        ring.abort()
        producer.join(2000)
        assertFalse(producer.isAlive)
        assertEquals(MinistryAudioException.CANCELLED, (written.get() as MinistryAudioException).code)
        assertEquals(0L, ring.availableFrames(0))
    }

    @Test
    fun ringNeverServesDataItDoesNotHold() {
        val ring = PcmRing(100)
        ring.write(ByteArray(40) { it.toByte() }, 0, 40) // 10 frames
        val dst = ByteArray(44)
        assertCode(MinistryAudioException.READ_FAILED) { ring.readAt(44, dst, 0, 44) }
        ring.discardBefore(4)
        assertCode(MinistryAudioException.READ_FAILED) { ring.readAt(44, dst, 0, 4) }
        assertEquals(6L, ring.availableFrames(4))
        assertEquals(4, ring.readAt(44 + 16, dst, 0, 4))
        assertEquals(16.toByte(), dst[0])
        ring.reset(1000)
        assertEquals(1000L, ring.startFrame)
        assertEquals(0L, ring.availableFrames(4))
    }

    // ------------------------------------------------------------------- feed

    private fun drain(stream: FakeStream, feed: IncrementalPcmFeed, from: Long): ShortArray {
        feed.position(from)
        val core = MixerCore(feed.sources, stream.rate, stream.frames)
        core.seek(from)
        val out = ShortArray(((stream.frames - from) * 2).toInt())
        val block = ShortArray(core.chunkFrames * 2)
        var at = 0
        while (core.positionFrames < stream.frames) {
            assertTrue("starved at ${core.positionFrames}", waitUntil { feed.isReady(core.positionFrames, core.chunkFrames) })
            val n = core.render(block, core.chunkFrames)
            feed.consumed(core.positionFrames)
            System.arraycopy(block, 0, out, at, n * 2)
            at += n * 2
        }
        return out
    }

    @Test
    fun everyStartingPositionDeliversExactlyTheTrimmedTimeline() {
        val stream = FakeStream(mpeg = 200)
        val decoder = stream.Decoder()
        val feed = stream.feed(decoder)
        for (from in listOf(0L, 1L, 575L, 576L, 20_000L, 100_000L, stream.frames - 1000, stream.frames - 1)) {
            assertArrayEquals("from $from", stream.reference(from), drain(stream, feed, from))
            assertTrue("EOS $from", waitUntil { feed.verified() })
        }
        assertTrue(feed.close())
        assertEquals(0, decoder.alive.get())
        assertEquals("never more than one codec per stem", 6, decoder.peakAlive.get())
    }

    @Test
    fun windowsStartTenFramesEarlyAndSeekingToTheSamePlaceDoesNotRestart() {
        val stream = FakeStream()
        val decoder = stream.Decoder()
        val feed = stream.feed(decoder)
        feed.position(50_000)
        assertTrue(waitUntil { feed.isReady(50_000, stream.rate) })
        assertEquals(setOf((50_000 + 576) / 1152 - 10), decoder.starts.map { it.second }.toSet())
        feed.position(50_000)
        assertEquals(6, decoder.starts.size)
        assertTrue(feed.close())
    }

    @Test
    fun producersAreBoundedByTheRingsAndAStalledStemHoldsTheWholeSet() {
        val stream = FakeStream(mpeg = 400)
        val decoder = stream.Decoder()
        val gate = decoder.stall(3, 40_000)
        val feed = stream.feed(decoder)
        feed.position(0)
        assertTrue(waitUntil { feed.isReady(0, 30_000) })
        assertFalse(feed.isReady(0, stream.rate))
        // The other five fill their 3 s ring and stop there.
        val rings = feed.sources.map { it as PcmRing }
        assertTrue(waitUntil { rings.filterIndexed { i, _ -> i != 3 }.all { it.availableFrames(0) == 3L * stream.rate } })
        gate.countDown()
        assertTrue(waitUntil { feed.isReady(0, stream.rate) })
        assertTrue(feed.close())
        assertEquals(0, decoder.alive.get())
    }

    @Test
    fun shortAndLongStreamsAreRefused() {
        for (error in listOf(-1, 1, -1152, 1152)) {
            val stream = FakeStream(mpeg = 100)
            val decoder = stream.Decoder().apply { lengthError[2] = error }
            val feed = stream.feed(decoder)
            feed.position(0)
            assertTrue("error $error", waitUntil { feed.failure() != null || feed.verified() })
            // A shortfall smaller than the encoder padding is still a failure: the count must be exact.
            assertEquals("error $error", MinistryAudioException.MP3_LENGTH_MISMATCH, feed.failure()?.code)
            assertFalse(feed.verified())
            assertFalse(feed.isReady(0, 1))
            assertTrue(feed.close())
            assertEquals(0, decoder.alive.get())
        }
    }

    @Test
    fun anUncalibratedCodecIsRefused() {
        val stream = FakeStream(mpeg = 100)
        val decoder = stream.Decoder().apply { name = "other.decoder" }
        val feed = stream.feed(decoder)
        feed.position(0)
        assertTrue(waitUntil { feed.failure() != null })
        assertEquals(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, feed.failure()!!.code)
        assertTrue(feed.close())
    }

    @Test
    fun oneFailingProducerStopsAllAndNothingRestarts() {
        val stream = FakeStream()
        val decoder = stream.Decoder().apply {
            failures[4] = 20_000L to MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "injected")
        }
        val feed = stream.feed(decoder)
        feed.position(0)
        assertTrue(waitUntil { feed.failure() != null })
        assertTrue(waitUntil { decoder.alive.get() == 0 })
        val starts = decoder.starts.size
        feed.position(10_000)
        assertEquals(starts, decoder.starts.size)
        assertTrue(feed.close())
    }

    @Test
    fun closeConfirmsOnlyWhenEveryProducerIsGone() {
        val stream = FakeStream()
        val decoder = stream.Decoder()
        val wedge = CountDownLatch(1)
        decoder.wedged = wedge
        val feed = stream.feed(decoder, joinMs = 100)
        feed.position(0)
        assertTrue(waitUntil { decoder.alive.get() == 6 })
        assertFalse("wedged codecs must not be reported as closed", feed.close())
        assertCode(MinistryAudioException.SHUTDOWN_PENDING) {
            val other = stream.feed(decoder, joinMs = 50)
            other.position(0)
            assertTrue(waitUntil { decoder.alive.get() == 12 })
            other.position(5000)
        }
        wedge.countDown()
        assertTrue(waitUntil { feed.close() })
        assertTrue(waitUntil { decoder.alive.get() == 0 })
        feed.position(0) // closed for good
        assertEquals(0, decoder.alive.get())
    }

    @Test
    fun repeatedSeeksRacingCloseLeaveNoThread() {
        val stream = FakeStream()
        repeat(15) { round ->
            val decoder = stream.Decoder()
            val feed = stream.feed(decoder)
            val started = CountDownLatch(1)
            val seeker = Thread {
                started.countDown()
                for (i in 0 until 40) runCatching { feed.position((i * 7919L) % stream.frames) }
            }.apply { start() }
            started.await(1, TimeUnit.SECONDS)
            Thread.sleep((round % 5).toLong())
            feed.abort()
            seeker.join(5000)
            assertTrue(feed.close())
            assertEquals("round $round", 0, decoder.alive.get())
        }
        assertTrue(waitUntil { streamThreadsAlive() == 0 })
    }
}
