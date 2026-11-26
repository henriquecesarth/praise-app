package com.louvaio.louvaio_mobile.ministryaudio

import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * M22-S4-C: MP3 recordings through the bridge with a fake platform decoder (the real decoder is covered on the device).
 * The WAV engine, arbiter, focus and mixer are the production ones; only the PCM source of each stem differs.
 */
class MinistryAudioBridgeMp3Test {
    @get:Rule
    val tmp = TemporaryFolder()

    private val rate = 44_100
    private val frames = 3000L
    private val alignment = Mp3Alignment(1105, 503, 4)
    private val user = "user_1"
    private val ministry = "min-1"
    private val rec = "a".repeat(64)
    private val sid = "session-0001"
    private lateinit var filesDir: File
    private val tracks = CopyOnWriteArrayList<FakeTrack>()
    private val stats = SourceStats()
    private var bridge: MinistryAudioBridge? = null

    private fun sha(domain: String, id: String) =
        MessageDigest.getInstance("SHA-256").digest((domain + id).toByteArray()).joinToString("") { "%02x".format(it) }

    private fun ministryRoot(m: String = ministry, u: String = user) = File(
        filesDir,
        "ministry_audio_library/v1/users/${sha("louvaio-ministry-audio-user-v1:", u)}/ministries/${sha("louvaio-ministry-audio-ministry-v1:", m)}",
    )

    private fun recDir() = File(ministryRoot(), "recordings/$rec")
    private fun tempRoot() = File(ministryRoot(), "pcm_tmp")

    @Before
    fun setUp() {
        filesDir = tmp.newFolder("files")
    }

    @After
    fun tearDown() {
        bridge?.dispose()
        assertTrue(waitUntil(3000) { renderThreadsAlive() == 0 })
    }

    private fun writeMp3s(missing: StemId? = null) {
        recDir().mkdirs()
        for (s in StemId.values()) if (s != missing) File(recDir(), "stem_${s.wireName}.mp3").writeBytes(ByteArray(100) { s.ordinal.toByte() })
    }

    /** Frame n of stem k carries 100*k + n%97 in both channels, so mixing/offset errors are visible. */
    private class FakeMp3Decoder(val frames: Long, val delay: Int) : Mp3PcmDecoder {
        val decoded = CopyOnWriteArrayList<String>()
        val concurrent = AtomicInteger()
        val maxConcurrent = AtomicInteger()
        var onStem: (String) -> Unit = {}
        var failOn: String? = null

        /** The bridge's own stop predicate, as last handed to a decoder. */
        @Volatile var stopRequested: () -> Boolean = { false }

        override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
            val n = concurrent.incrementAndGet()
            maxConcurrent.updateAndGet { maxOf(it, n) }
            try {
                decoded.add(file.name)
                stopRequested = cancelled
                onStem(file.name)
                if (failOn == file.name) throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "x")
                onInfo(Mp3StreamInfo(44_100, 2, false, null, null))
                val k = StemId.values().indexOfFirst { file.name == "stem_${it.wireName}.mp3" }
                val total = 4 * 1152L
                val out = ByteArray(4608 * 4)
                for (i in 0 until total) {
                    if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "x")
                    val v = (100 * k + ((i - 576 + 97 * 100) % 97)).toInt()
                    out[(i * 4).toInt()] = v.toByte(); out[(i * 4 + 1).toInt()] = (v shr 8).toByte()
                    out[(i * 4 + 2).toInt()] = v.toByte(); out[(i * 4 + 3).toInt()] = (v shr 8).toByte()
                }
                sink.write(out, 0, out.size)
            } finally {
                concurrent.decrementAndGet()
            }
        }
    }

    /** 1 = the sequential reference, so order assertions are deterministic; the parallel default has its own tests. */
    private var parallel = 1
    private var gate: Mp3Gate = Mp3Gate { "" }
    private var space: (File) -> Long = { Long.MAX_VALUE / 4 }
    private val decoder = FakeMp3Decoder(frames, alignment.encoderDelayFrames)

    private fun newBridge(withMp3: Boolean = true): MinistryAudioBridge {
        val b = MinistryAudioBridge(
            filesDir,
            { },
            { listener ->
                MinistryAudioEngine(
                    trackFactory = object : StereoTrackFactory {
                        override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = FakeTrack().also { tracks.add(it) }
                    },
                    arbiter = AudioOutputArbiter(),
                    dispatcher = CallbackDispatcher { it() },
                    listener = listener,
                    chunkFrames = 64,
                    sourceFactory = { TrackedSource(FileStemSource.open(it), stats) },
                )
            },
            if (withMp3) Mp3Support(decoder, { cancelled -> gate.requireVerified(cancelled) }, { space(it) }, parallel) else null,
        )
        bridge = b
        return b
    }

    private fun args(extra: Map<String, Any?> = mp3Keys()) = mapOf(
        "sessionId" to sid, "userId" to user, "ministryId" to ministry,
        "recordingId" to rec, "sampleRate" to rate, "frames" to frames,
    ) + extra

    private fun mp3Keys(
        codec: Any? = "mp3_cbr256",
        delay: Any? = 1105,
        pad: Any? = 503,
        mpeg: Any? = 4,
    ) = mapOf("codec" to codec, "encoderDelayFrames" to delay, "paddingFrames" to pad, "mpegAudioFrames" to mpeg)

    private fun MinistryAudioBridge.fails(code: String, a: Map<String, Any?>) {
        val r = callBlocking("prepare", a)
        assertFalse("prepare should fail", r.isOk)
        assertEquals(code, r.errorCode)
    }

    @Test
    fun `mp3 prepare decodes one stem at a time to private PCM, plays it and deletes it on confirmed close`() {
        writeMp3s()
        val b = newBridge()
        val r = b.callBlocking("prepare", args())
        assertTrue(r.errorCode, r.isOk)
        assertEquals(frames, r.value!!["frames"])
        assertEquals(rate, r.value!!["sampleRate"])
        assertEquals(StemId.values().map { "stem_${it.wireName}.mp3" }, decoder.decoded.toList())
        assertEquals(1, decoder.maxConcurrent.get())
        val tempDir = File(tempRoot(), sid)
        assertEquals(StemId.values().map { it.fileName }.sorted(), tempDir.list()!!.sorted()) // no .part left
        assertTrue(File(recDir(), "stem_vocals.mp3").exists()) // the cached MP3 is never modified
        for (s in StemId.values()) assertEquals(44 + frames * 4, File(tempDir, s.fileName).length())
        b.callBlocking("play", mapOf("sessionId" to sid))
        assertTrue(waitUntil { b.callBlocking("snapshot", mapOf("sessionId" to sid)).value!!["state"] == "completed" })
        assertTrue(tempDir.exists()) // still there until the engine is confirmed closed
        assertEquals(true, b.callBlocking("close", mapOf("sessionId" to sid)).value!!["closed"])
        assertFalse(tempDir.exists())
        assertEquals(stats.opened.get(), stats.closed.get())
    }

    @Test
    fun `the decoded timeline is the manifest timeline with the tag delay removed`() {
        writeMp3s()
        val b = newBridge()
        b.callBlocking("prepare", args())
        val f = File(File(tempRoot(), sid), "stem_bass.wav").readBytes()
        val k = StemId.BASS.ordinal
        for (i in listOf(0, 1, 500, 2999)) {
            val v = (f[44 + i * 4 + 1].toInt() shl 8) or (f[44 + i * 4].toInt() and 0xFF)
            assertEquals(100 * k + (i % 97), v) // frame i of the output is frame i + 576 of the decoder output
        }
    }

    @Test
    fun `invalid or missing MP3 arguments are rejected before anything is decoded`() {
        writeMp3s()
        val b = newBridge()
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys(delay = null)))
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys() + ("extra" to 1)))
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys(pad = 7))) // delay+frames+padding != mpeg*1152
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys(delay = "1105")))
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys(mpeg = -1)))
        b.fails(MinistryAudioException.MP3_UNSUPPORTED, args(mp3Keys(codec = "pcm_s16le")))
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys()) + ("sampleRate" to 22_050))
        b.fails(MinistryAudioException.INVALID_ARGUMENT, args(mp3Keys()) + ("frames" to 44_100L * 301))
        assertTrue(decoder.decoded.isEmpty())
        assertFalse(tempRoot().exists())
    }

    @Test
    fun `a bridge without MP3 support refuses MP3`() {
        writeMp3s()
        newBridge(withMp3 = false).fails(MinistryAudioException.MP3_UNSUPPORTED, args())
        assertTrue(decoder.decoded.isEmpty())
    }

    @Test
    fun `an unverified device is refused before decoding`() {
        writeMp3s()
        gate = Mp3Gate { throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "x") }
        newBridge().fails(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, args())
        assertTrue(decoder.decoded.isEmpty())
        assertFalse(tempRoot().exists())
    }

    @Test
    fun `insufficient space is detected before the first stem is decoded`() {
        writeMp3s()
        var asked = 0L
        space = { asked = 6 * (44 + frames * 4); asked + 64L * 1024 * 1024 - 1 }
        newBridge().fails(MinistryAudioException.INSUFFICIENT_SPACE, args())
        assertTrue(asked > 0)
        assertTrue(decoder.decoded.isEmpty())
        assertFalse(File(tempRoot(), sid).exists())
    }

    @Test
    fun `a missing MP3 file or a decode failure leaves no temporary files and no session`() {
        writeMp3s(missing = StemId.PIANO)
        val b = newBridge()
        b.fails(MinistryAudioException.STEM_MISSING, args())
        assertTrue(decoder.decoded.isEmpty())

        writeMp3s()
        decoder.failOn = "stem_guitar.mp3"
        b.fails(MinistryAudioException.MP3_DECODE_FAILED, args())
        assertEquals(listOf("stem_vocals.mp3", "stem_drums.mp3", "stem_bass.mp3", "stem_guitar.mp3"), decoder.decoded.toList())
        assertFalse(File(tempRoot(), sid).exists())
        val r = b.callBlocking("play", mapOf("sessionId" to sid))
        assertEquals(MinistryAudioException.STALE_SESSION, r.errorCode)
    }

    @Test
    fun `closing the session while it is being decoded cancels it and deletes what was decoded`() {
        writeMp3s()
        val reached = CountDownLatch(1)
        val release = CountDownLatch(1)
        decoder.onStem = { name ->
            if (name == "stem_bass.mp3") {
                reached.countDown()
                release.await(5, TimeUnit.SECONDS)
            }
        }
        val b = newBridge()
        val prepared = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("prepare", args()) { prepared.complete(it) }
        assertTrue(reached.await(5, TimeUnit.SECONDS))
        assertTrue(File(tempRoot(), sid).exists())
        val closed = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("close", mapOf("sessionId" to sid)) { closed.complete(it) } // inline cancel, not queued behind prepare
        release.countDown()
        val p = prepared.get(5, TimeUnit.SECONDS)
        assertFalse(p.isOk)
        assertEquals(MinistryAudioException.CANCELLED, p.errorCode)
        assertEquals(true, closed.get(5, TimeUnit.SECONDS).value!!["closed"])
        assertFalse(File(tempRoot(), sid).exists())
        assertEquals(listOf("stem_vocals.mp3", "stem_drums.mp3", "stem_bass.mp3"), decoder.decoded.toList()) // no stem after cancel
    }

    @Test
    fun `closing during calibration cancels it before anything is decoded`() {
        writeMp3s()
        val reached = CountDownLatch(1)
        gate = Mp3Gate { cancelled ->
            reached.countDown()
            val end = System.currentTimeMillis() + 5000
            while (!cancelled() && System.currentTimeMillis() < end) Thread.sleep(5)
            if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "x")
            ""
        }
        val b = newBridge()
        val prepared = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("prepare", args()) { prepared.complete(it) }
        assertTrue(reached.await(5, TimeUnit.SECONDS))
        b.submit("close", mapOf("sessionId" to sid)) { }
        assertEquals(MinistryAudioException.CANCELLED, prepared.get(5, TimeUnit.SECONDS).errorCode)
        assertTrue(decoder.decoded.isEmpty())
    }

    @Test
    fun `a close that arrives while the prepare is still queued cancels it before it decodes`() {
        writeMp3s()
        val reached = CountDownLatch(1)
        val release = CountDownLatch(1)
        decoder.onStem = { reached.countDown(); release.await(5, TimeUnit.SECONDS) }
        val b = newBridge()
        b.submit("prepare", args()) { }
        assertTrue(reached.await(5, TimeUnit.SECONDS))
        val queued = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("prepare", args() + ("sessionId" to "session-0002")) { queued.complete(it) }
        b.submit("close", mapOf("sessionId" to "session-0002")) { }
        b.submit("close", mapOf("sessionId" to sid)) { }
        release.countDown()
        assertEquals(MinistryAudioException.CANCELLED, queued.get(5, TimeUnit.SECONDS).errorCode)
        assertEquals(1, decoder.decoded.size)
    }

    @Test
    fun `parallel decoding is bounded and exposes the same six complete stems`() {
        writeMp3s()
        parallel = Mp3Support.DEFAULT_PARALLEL_STEMS
        val three = CountDownLatch(3)
        decoder.onStem = { three.countDown(); three.await(5, TimeUnit.SECONDS) }
        val b = newBridge()
        val r = b.callBlocking("prepare", args())
        assertTrue(r.errorCode, r.isOk)
        assertEquals(3, decoder.maxConcurrent.get())
        assertEquals(6, decoder.decoded.size)
        val tempDir = File(tempRoot(), sid)
        assertEquals(StemId.values().map { it.fileName }.sorted(), tempDir.list()!!.sorted())
        val k = StemId.OTHER.ordinal
        val f = File(tempDir, StemId.OTHER.fileName).readBytes()
        assertEquals(100 * k + 5, (f[44 + 5 * 4 + 1].toInt() shl 8) or (f[44 + 5 * 4].toInt() and 0xFF))
    }

    @Test
    fun `a failure or a close during parallel decoding replies only after every decoder has stopped`() {
        for (cancel in listOf(false, true)) {
            writeMp3s()
            parallel = 3
            decoder.decoded.clear()
            val reached = CountDownLatch(3)
            val release = CountDownLatch(1)
            val finished = AtomicInteger()
            decoder.onStem = { name ->
                reached.countDown()
                if (!cancel && name == "stem_vocals.mp3") {
                    reached.await(5, TimeUnit.SECONDS)
                    throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "x")
                }
                release.await(5, TimeUnit.SECONDS)
                finished.incrementAndGet()
            }
            val b = newBridge()
            val prepared = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
            b.submit("prepare", args()) { prepared.complete(it) }
            assertTrue(reached.await(5, TimeUnit.SECONDS))
            if (cancel) b.submit("close", mapOf("sessionId" to sid)) { }
            // The bridge must have registered the stop before the blocked workers are let go.
            assertTrue(waitUntil(5000) { decoder.stopRequested() })
            Thread.sleep(50)
            assertFalse("replied while decoders were still running", prepared.isDone)
            assertTrue(File(tempRoot(), sid).exists())
            release.countDown()
            val reply = prepared.get(5, TimeUnit.SECONDS)
            assertEquals(
                if (cancel) MinistryAudioException.CANCELLED else MinistryAudioException.MP3_DECODE_FAILED,
                reply.errorCode,
            )
            assertEquals(0, decoder.concurrent.get())
            // nothing new was started; a failure then gets its single sequential retry, which fails on the first stem
            assertEquals(if (cancel) 3 else 4, decoder.decoded.size)
            assertEquals(if (cancel) 3 else 2, finished.get())
            assertFalse(File(tempRoot(), sid).exists())
            b.dispose()
        }
    }

    @Test
    fun `a device that cannot run several decoders at once falls back to the sequential decode`() {
        writeMp3s()
        parallel = 3
        val two = CountDownLatch(2)
        decoder.onStem = {
            if (decoder.concurrent.get() > 1) {
                two.countDown()
                two.await(1, TimeUnit.SECONDS)
                throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "no codec resources")
            }
            if (decoder.decoded.size <= 3) two.await(1, TimeUnit.SECONDS)
        }
        val b = newBridge()
        val r = b.callBlocking("prepare", args())
        assertTrue(r.errorCode, r.isOk)
        assertEquals(StemId.values().map { it.fileName }.sorted(), File(tempRoot(), sid).list()!!.sorted())
    }

    @Test
    fun `cancelling a queued prepare leaves the current session alone`() {
        writeMp3s()
        val reached = CountDownLatch(1)
        val release = CountDownLatch(1)
        decoder.onStem = { reached.countDown(); release.await(5, TimeUnit.SECONDS) }
        val b = newBridge()
        val first = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("prepare", args()) { first.complete(it) }
        assertTrue(reached.await(5, TimeUnit.SECONDS))
        val queued = java.util.concurrent.CompletableFuture<MinistryAudioBridge.Reply>()
        b.submit("prepare", args() + ("sessionId" to "session-0002")) { queued.complete(it) }
        b.submit("close", mapOf("sessionId" to "session-0002")) { }
        release.countDown()
        assertTrue(first.get(5, TimeUnit.SECONDS).isOk)
        assertEquals(MinistryAudioException.CANCELLED, queued.get(5, TimeUnit.SECONDS).errorCode)
        assertTrue(b.callBlocking("snapshot", mapOf("sessionId" to sid)).isOk)
        assertTrue(File(tempRoot(), sid).exists())
    }

    @Test
    fun `stale decoded PCM of this and other accounts is swept by the next prepare`() {
        writeMp3s()
        val stale = File(tempRoot(), "old-session").apply { mkdirs() }
        File(stale, "stem_vocals.wav").writeBytes(ByteArray(10))
        val other = File(ministryRoot("min-2", "user_2"), "pcm_tmp/x").apply { mkdirs() }
        File(other, "stem_vocals.wav").writeBytes(ByteArray(10))
        val b = newBridge()
        assertTrue(b.callBlocking("prepare", args()).isOk)
        assertFalse(stale.exists())
        assertFalse(other.exists())
        assertTrue(File(tempRoot(), sid).exists())
    }

    @Test
    fun `a new prepare closes the previous session first and removes its decoded PCM`() {
        writeMp3s()
        val b = newBridge()
        assertTrue(b.callBlocking("prepare", args()).isOk)
        val first = File(tempRoot(), sid)
        assertTrue(first.exists())
        val r = b.callBlocking("prepare", args() + ("sessionId" to "session-0002"))
        assertTrue(r.errorCode, r.isOk)
        assertFalse(first.exists())
        assertTrue(File(tempRoot(), "session-0002").exists())
        assertEquals(StemId.values().size * 2, decoder.decoded.size)
    }

    @Test
    fun `WAV recordings are unaffected by MP3 support`() {
        Wav.writeAll(recDir(), 8000, 2000)
        val b = newBridge()
        val r = b.callBlocking("prepare", mapOf(
            "sessionId" to sid, "userId" to user, "ministryId" to ministry, "recordingId" to rec, "sampleRate" to 8000, "frames" to 2000,
        ))
        assertTrue(r.errorCode, r.isOk)
        assertTrue(decoder.decoded.isEmpty())
        assertFalse(tempRoot().exists())
    }
}
