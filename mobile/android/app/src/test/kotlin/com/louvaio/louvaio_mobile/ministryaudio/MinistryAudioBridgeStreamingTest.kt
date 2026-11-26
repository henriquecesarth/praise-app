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
 * M22-S4.2: the streaming strategy through the bridge. Real MP3 bytes (a calibration fixture used for the six stems) go
 * through the real validator; the platform codec is faked.
 */
class MinistryAudioBridgeStreamingTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val rate = 44_100
    private val frames = 44_100L
    private val mpeg = 40
    private val user = "user_1"
    private val ministry = "min-1"
    private val rec = "a".repeat(64)
    private val sid = "session-0001"
    private val mp3 = File("src/main/assets/ministry_audio_mp3_calibration/impulse_lame_44100.mp3").readBytes()
    private lateinit var filesDir: File
    private val events = CopyOnWriteArrayList<Map<String, Any?>>()
    private var bridge: MinistryAudioBridge? = null

    private fun hex(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private fun ns(domain: String, id: String) = hex((domain + id).toByteArray())
    private fun ministryRoot() = File(
        filesDir,
        "ministry_audio_library/v1/users/${ns("louvaio-ministry-audio-user-v1:", user)}/ministries/${ns("louvaio-ministry-audio-ministry-v1:", ministry)}",
    )
    private fun recDir() = File(ministryRoot(), "recordings/$rec")
    private fun tempRoot() = File(ministryRoot(), "pcm_tmp")

    /** Delivers silence of exactly the raw length, for both the streaming and the full strategy. */
    private inner class Platform : Mp3WindowDecoder, Mp3PcmDecoder {
        val streamed = AtomicInteger()
        val fullDecoded = AtomicInteger()
        val alive = AtomicInteger()
        @Volatile var unavailable = false
        @Volatile var short = false
        @Volatile var hold: CountDownLatch? = null
        @Volatile var wedged: CountDownLatch? = null
        @Volatile var onFullDecode: ((File) -> Unit)? = null
        @Volatile var afterRead: ((File) -> Unit)? = null
        val entered = CountDownLatch(1)

        override fun decodeFrom(
            file: File,
            byteOffset: Long,
            input: Mp3InputCheck,
            onInfo: (Mp3StreamInfo) -> Unit,
            sink: PcmSink,
            cancelled: () -> Boolean,
        ) {
            if (unavailable) throw Mp3CodecUnavailableException()
            alive.incrementAndGet()
            try {
                streamed.incrementAndGet()
                entered.countDown()
                wedged?.await(30, TimeUnit.SECONDS)
                while (hold?.await(2, TimeUnit.MILLISECONDS) == false) {
                    if (cancelled()) throw MinistryAudioException(MinistryAudioException.CANCELLED, "x")
                }
                onInfo(Mp3StreamInfo(rate, 2, false, null, null, "fake"))
                // Hand over the real frames of the file, as the platform extractor does (Info frame excluded).
                val bytes = file.readBytes()
                fun length(at: Int) = 144 * 256_000 / rate + ((bytes[at + 2].toInt() shr 1) and 1)
                var at = if (byteOffset == 0L) length(0) else byteOffset.toInt()
                while (at < bytes.size) {
                    val n = length(at)
                    input.frame(bytes.copyOfRange(at, at + n), n)
                    at += n
                }
                input.end()
                val out = ByteArray(mpeg * 1152 * 4 - if (short) 4 else 0)
                sink.write(out, 0, out.size)
            } finally {
                alive.decrementAndGet()
            }
        }

        override fun decodeChecked(
            file: File,
            input: Mp3InputCheck,
            onInfo: (Mp3StreamInfo) -> Unit,
            sink: PcmSink,
            cancelled: () -> Boolean,
        ) {
            onFullDecode?.invoke(file)
            val bytes = file.readBytes()
            afterRead?.invoke(file)
            fun length(at: Int) = 144 * 256_000 / rate + ((bytes[at + 2].toInt() shr 1) and 1)
            var at = length(0)
            while (at < bytes.size) {
                val n = length(at)
                input.frame(bytes.copyOfRange(at, at + n), n)
                at += n
            }
            input.end()
            decode(file, onInfo, sink, cancelled)
        }

        override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
            fullDecoded.incrementAndGet()
            onInfo(Mp3StreamInfo(rate, 2, false, null, null, "fake"))
            val out = ByteArray(mpeg * 1152 * 4)
            sink.write(out, 0, out.size)
        }
    }

    private val platform = Platform()
    private var streamingGate: Mp3Gate = Mp3Gate { "fake" }

    @Before
    fun setUp() {
        filesDir = tmp.newFolder("files")
        recDir().mkdirs()
        for (s in StemId.values()) File(recDir(), "stem_${s.wireName}.mp3").writeBytes(mp3)
    }

    @After
    fun tearDown() {
        platform.hold?.countDown()
        platform.wedged?.countDown()
        bridge?.dispose()
        assertTrue(waitUntil(3000) { renderThreadsAlive() == 0 && streamThreadsAlive() == 0 })
    }

    private fun newBridge(withStreaming: Boolean = true): MinistryAudioBridge = MinistryAudioBridge(
        filesDir,
        { events.add(it) },
        { listener ->
            MinistryAudioEngine(
                trackFactory = object : StereoTrackFactory {
                    override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle = FakeTrack()
                },
                arbiter = AudioOutputArbiter(),
                dispatcher = CallbackDispatcher { it() },
                listener = listener,
            )
        },
        Mp3Support(
            platform,
            { "fake" },
            incremental = if (withStreaming) Mp3IncrementalSupport(platform, { c -> streamingGate.requireVerified(c) }) else null,
        ),
    ).also { bridge = it }

    private fun stems(sha: String = hex(mp3), size: Long = mp3.size.toLong(), broken: String? = null) =
        StemId.values().associate {
            it.wireName to mapOf("sizeBytes" to size, "sha256" to if (broken == it.wireName) "0".repeat(64) else sha)
        }

    private fun args(strategy: Any? = "incremental", stems: Any? = stems(), session: String = sid) = mapOf(
        "sessionId" to session, "userId" to user, "ministryId" to ministry, "recordingId" to rec,
        "sampleRate" to rate, "frames" to frames, "codec" to "mp3_cbr256",
        "encoderDelayFrames" to 1105, "paddingFrames" to 875, "mpegAudioFrames" to mpeg,
        "strategy" to strategy, "stems" to stems,
    )

    private fun close(b: MinistryAudioBridge) = b.callBlocking("close", mapOf("sessionId" to sid)).value!!["closed"]

    @Test
    fun streamsWithoutAnyTemporaryPcmAndReleasesOnClose() {
        val b = newBridge()
        val r = b.callBlocking("prepare", args())
        assertTrue(r.errorMessage, r.isOk)
        assertEquals("incremental", r.value!!["strategy"])
        assertEquals(frames, r.value!!["frames"])
        for (key in listOf("indexMs", "calibrationMs", "prefillMs", "codecOpenMs", "ringBytes")) {
            assertTrue(key, r.value!!.containsKey(key))
        }
        assertEquals(6, platform.streamed.get())
        assertEquals(0, platform.fullDecoded.get())
        assertFalse(tempRoot().exists())
        assertTrue(b.callBlocking("play", mapOf("sessionId" to sid)).isOk)
        assertTrue(waitUntil { events.any { it["state"] == "completed" } })
        assertTrue(events.any { it["state"] == "buffering" })
        assertEquals(true, close(b))
        assertEquals(0, platform.alive.get())
    }

    @Test
    fun anyBadByteIsRefusedBeforeAnyCodecAndNeverFallsBack() {
        val b = newBridge()
        fun refused(label: String, a: Map<String, Any?>) {
            val r = b.callBlocking("prepare", a)
            assertEquals(label, MinistryAudioException.MP3_INVALID, r.errorCode)
        }
        refused("hash of one stem", args(stems = stems(broken = "other")))
        refused("size", args(stems = stems(size = mp3.size + 1L)))
        File(recDir(), "stem_bass.mp3").writeBytes(mp3.copyOf().also { it[it.size - 3] = 7 })
        refused("corrupt bytes", args())
        assertEquals(0, platform.streamed.get())
        assertEquals(0, platform.fullDecoded.get())
    }

    @Test
    fun fallsBackToTheFullDecodeOnlyWhenTheDeviceCannotStream() {
        val cases = listOf<Pair<String, () -> Unit>>(
            "calibration" to {
                streamingGate = Mp3Gate { throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "x") }
            },
            "codec_unavailable" to { platform.unavailable = true },
        )
        for ((reason, arrange) in cases) {
            streamingGate = Mp3Gate { "fake" }
            platform.unavailable = false
            arrange()
            val b = newBridge()
            val r = b.callBlocking("prepare", args())
            assertTrue("$reason ${r.errorMessage}", r.isOk)
            assertEquals("full", r.value!!["strategy"])
            assertEquals(reason, r.value!!["fallbackReason"])
            assertTrue(platform.fullDecoded.get() >= 6)
            assertEquals(true, close(b))
            b.dispose()
        }
        val without = newBridge(withStreaming = false)
        assertEquals("unavailable", without.callBlocking("prepare", args()).value!!["fallbackReason"])
    }

    @Test
    fun aDivergentStreamDoesNotFallBack() {
        platform.short = true
        val b = newBridge()
        // The shortfall surfaces at EOS, during the prefill of this one-second recording or on play.
        val r = b.callBlocking("prepare", args())
        if (r.isOk) {
            b.callBlocking("play", mapOf("sessionId" to sid))
            assertTrue(waitUntil { events.any { it["errorCode"] == MinistryAudioException.MP3_LENGTH_MISMATCH } })
        } else {
            assertEquals(MinistryAudioException.MP3_LENGTH_MISMATCH, r.errorCode)
        }
        assertEquals(0, platform.fullDecoded.get())
        assertFalse(events.any { it["state"] == "completed" })
    }

    @Test
    fun withoutStreamingSupportTheBytesAreStillVerifiedBeforeTheFullDecode() {
        val b = newBridge(withStreaming = false)
        val r = b.callBlocking("prepare", args(stems = stems(broken = "other")))
        assertEquals(MinistryAudioException.MP3_INVALID, r.errorCode)
        assertEquals(0, platform.fullDecoded.get())
    }

    @Test
    fun aFileChangedDuringTheFallbackDecodeIsRefused() {
        streamingGate = Mp3Gate { throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "x") }
        // Same length, so only the hash can tell.
        platform.onFullDecode = { file -> file.writeBytes(mp3.copyOf().also { it[it.size - 3] = 7 }) }
        val b = newBridge()
        assertEquals(MinistryAudioException.MP3_INVALID, b.callBlocking("prepare", args()).errorCode)
        assertEquals(0, tempRoot().walkTopDown().count { it.isFile })
    }

    @Test
    fun bytesThatChangeOnlyWhileTheFallbackReadsThemAreRefused() {
        streamingGate = Mp3Gate { throw MinistryAudioException(MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED, "x") }
        platform.onFullDecode = { file -> file.writeBytes(mp3.copyOf().also { it[it.size - 3] = 7 }) }
        platform.afterRead = { file -> file.writeBytes(mp3) } // restored before any hash can notice
        val b = newBridge()
        assertEquals(MinistryAudioException.MP3_INVALID, b.callBlocking("prepare", args()).errorCode)
        assertEquals(0, tempRoot().walkTopDown().count { it.isFile })
    }

    @Test
    fun anEngineThatCannotBeBuiltLeavesNoProducer() {
        val b = MinistryAudioBridge(
            filesDir,
            { events.add(it) },
            { _ -> throw IllegalStateException("no engine") },
            Mp3Support(platform, { "fake" }, incremental = Mp3IncrementalSupport(platform, { "fake" })),
        ).also { bridge = it }
        assertFalse(b.callBlocking("prepare", args()).isOk)
        assertTrue(waitUntil { streamThreadsAlive() == 0 })
        assertEquals(0, platform.alive.get())
        assertEquals(true, close(b))
    }

    @Test
    fun theStrategyArgumentsAreStrict() {
        val b = newBridge()
        val invalid = MinistryAudioException.INVALID_ARGUMENT
        assertEquals(invalid, b.callBlocking("prepare", args(strategy = "whatever")).errorCode)
        assertEquals(invalid, b.callBlocking("prepare", args(stems = stems() - "bass")).errorCode)
        assertEquals(invalid, b.callBlocking("prepare", args(stems = stems(sha = "xyz"))).errorCode)
        assertEquals(invalid, b.callBlocking("prepare", args(stems = stems(size = 0))).errorCode)
        assertEquals(invalid, b.callBlocking("prepare", args() - "stems").errorCode)
        assertEquals(invalid, b.callBlocking("prepare", args() - "strategy").errorCode)
        assertEquals(0, platform.streamed.get())
    }

    @Test
    fun closingWhileTheRingsAreFillingCancelsAndLeavesNoCodec() {
        platform.hold = CountDownLatch(1)
        val b = newBridge()
        val replies = CopyOnWriteArrayList<MinistryAudioBridge.Reply>()
        b.submit("prepare", args()) { replies.add(it) }
        assertTrue(platform.entered.await(3, TimeUnit.SECONDS))
        b.submit("close", mapOf("sessionId" to sid)) { replies.add(it) }
        assertTrue(waitUntil { replies.size == 2 })
        assertEquals(MinistryAudioException.CANCELLED, replies[0].errorCode)
        assertEquals(true, replies[1].value!!["closed"])
        assertEquals(0, platform.alive.get())
        assertEquals(0, platform.fullDecoded.get())
    }

    @Test
    fun aWedgedCodecKeepsTheSessionUnclosedUntilItIsGone() {
        platform.wedged = CountDownLatch(1)
        val b = newBridge()
        val replies = CopyOnWriteArrayList<MinistryAudioBridge.Reply>()
        b.submit("prepare", args()) { replies.add(it) }
        assertTrue(platform.entered.await(3, TimeUnit.SECONDS))
        b.submit("close", mapOf("sessionId" to sid)) { replies.add(it) }
        assertTrue(waitUntil(10_000) { replies.size == 2 })
        assertEquals(MinistryAudioException.SHUTDOWN_PENDING, replies[0].errorCode)
        assertEquals("the lease must be kept", false, replies[1].value!!["closed"])
        assertEquals(MinistryAudioException.SHUTDOWN_PENDING, b.callBlocking("prepare", args(session = "session-0002")).errorCode)
        platform.wedged!!.countDown()
        assertTrue(waitUntil { close(b) == true })
        assertEquals(0, platform.alive.get())
    }
}
