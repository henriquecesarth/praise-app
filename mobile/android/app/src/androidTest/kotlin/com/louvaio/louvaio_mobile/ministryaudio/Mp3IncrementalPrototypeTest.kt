package com.louvaio.louvaio_mobile.ministryaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.abs
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * M22-S4.1 PROTOTYPE, deliberately outside production code: incremental playback of six MP3 stems through bounded PCM
 * rings into the production [MixerCore] and one [AudioTrack], with no temporary PCM. It answers, on the device:
 * can a window starting at an arbitrary MPEG frame reproduce the linear decode bit for bit (and with how much preroll),
 * how long until the first audio and after a seek, and does the set stay sample-aligned when one producer stalls.
 *
 * Needs <externalFilesDir>/s4long (skipped otherwise). Results are logged under tag M22S41P. NOT covered here: engine
 * integration, focus/noisy/arbiter, lifecycle, and the length verification that today precedes any playback.
 */
class Mp3IncrementalPrototypeTest {
    private val tag = "M22S41P"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val source get() = File(inst.targetContext.getExternalFilesDir(null), "s4long")
    private val scratch get() = File(inst.targetContext.cacheDir, "s41proto").apply { mkdirs() }

    private class Fixture(val files: List<File>, val rate: Int, val frames: Long, val alignment: Mp3Alignment)

    private fun fixture(): Fixture {
        val cases = File(source, "cases.json")
        assumeTrue("long fixtures not pushed", cases.exists())
        val arr = JSONObject(cases.readText()).getJSONArray("cases")
        val c = arr.getJSONObject(0)
        val a = c.getJSONObject("alignment")
        return Fixture(
            (0 until arr.length()).map { File(source, arr.getJSONObject(it).getString("file")) },
            c.getInt("sampleRate"),
            c.getLong("frames"),
            Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames")),
        )
    }

    private class Stop : RuntimeException()

    /** Byte offset of every MPEG-1 Layer III AUDIO frame (the leading Info frame excluded). Refuses anything else. */
    private fun frameIndex(file: File): LongArray {
        val b = file.readBytes()
        val out = ArrayList<Long>(b.size / 800)
        var o = 0
        while (o + 4 <= b.size) {
            val h1 = b[o + 1].toInt() and 0xFF
            val h2 = b[o + 2].toInt() and 0xFF
            check(b[o] == 0xFF.toByte() && h1 and 0xFE == 0xFA) { "no MPEG-1 L3 header at $o" }
            val kbps = BITRATES[h2 shr 4]
            val rate = RATES[(h2 shr 2) and 3]
            check(kbps > 0 && rate > 0) { "bad header at $o" }
            out.add(o.toLong())
            o += 144_000 * kbps / rate + ((h2 shr 1) and 1)
        }
        check(o == b.size) { "truncated stream" }
        check(String(b, 36, 4, Charsets.US_ASCII) == "Info") { "no Info frame" }
        return out.drop(1).toLongArray()
    }

    /**
     * Raw (untrimmed) PCM from MPEG audio frame [startFrame] on. The extractor is opened at that frame's byte offset
     * (never seekTo, whose timestamps are estimates) and the platform gapless trimming is switched off, so output sample
     * n is exactly raw sample startFrame*1152+n of the stream. [sink] may throw [Stop].
     */
    private fun decodeRaw(file: File, index: LongArray, startFrame: Int, sink: PcmSink) {
        assumeTrue("packing needs API 28", android.os.Build.VERSION.SDK_INT >= 28)
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        val input = java.io.FileInputStream(file)
        try {
            // Frame 0 is opened from the file start so the Info frame is handled exactly as in the linear decode.
            val offset = if (startFrame == 0) 0L else index[startFrame]
            ex.setDataSource(input.fd, offset, file.length() - offset)
            ex.selectTrack(0)
            val format = ex.getTrackFormat(0)
            if (format.containsKey(MediaFormat.KEY_ENCODER_DELAY)) format.setInteger(MediaFormat.KEY_ENCODER_DELAY, 0)
            if (format.containsKey(MediaFormat.KEY_ENCODER_PADDING)) format.setInteger(MediaFormat.KEY_ENCODER_PADDING, 0)
            format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, PACK * 1045)
            val c = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_MPEG)
            codec = c
            c.configure(format, null, null, 0)
            c.start()
            val info = MediaCodec.BufferInfo()
            val scratchBytes = ByteArray(16 * 1024)
            var inDone = false
            var idle = false
            var last = System.nanoTime()
            while (true) {
                var fed = false
                if (!inDone) {
                    val ix = c.dequeueInputBuffer(0)
                    if (ix >= 0) {
                        val buf = c.getInputBuffer(ix)!!
                        var total = 0
                        for (i in 0 until PACK) {
                            if (i > 0 && (ex.sampleSize < 0 || ex.sampleSize > buf.capacity() - total)) break
                            val n = ex.readSampleData(buf, total)
                            if (n < 0) break
                            total += n
                            ex.advance()
                        }
                        if (total == 0) {
                            c.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inDone = true
                        } else {
                            c.queueInputBuffer(ix, 0, total, 0, 0)
                        }
                        fed = true
                    }
                }
                val ox = c.dequeueOutputBuffer(info, if (idle) 2_000L else 0L)
                idle = !fed && ox == MediaCodec.INFO_TRY_AGAIN_LATER
                if (ox >= 0) {
                    last = System.nanoTime()
                    if (info.size > 0) {
                        val b = c.getOutputBuffer(ox)!!
                        b.position(info.offset)
                        b.limit(info.offset + info.size)
                        while (b.hasRemaining()) {
                            val n = minOf(b.remaining(), scratchBytes.size)
                            b.get(scratchBytes, 0, n)
                            sink.write(scratchBytes, 0, n)
                        }
                    }
                    c.releaseOutputBuffer(ox, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                }
                // A producer blocked inside sink (back-pressure) is not a stall: `last` is only checked between buffers.
                if (fed) last = System.nanoTime()
                check(System.nanoTime() - last < 15_000_000_000L) { "stalled" }
            }
        } catch (_: Stop) {
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            ex.release()
            input.close()
        }
    }

    // ----------------------------------------------------------------- seek precision

    @Test
    fun windowedDecodeAgainstLinearDecode() {
        val f = fixture()
        val stem = f.files.first()
        val linear = File(scratch, "linear.pcm")
        val index = frameIndex(stem)
        assertEquals(f.alignment.mpegAudioFrames, index.size)
        linear.outputStream().buffered(1 shl 16).use { o -> decodeRaw(stem, index, 0) { b, off, len -> o.write(b, off, len) } }
        val total = linear.length() / 4
        assertEquals(f.alignment.mpegAudioFrames * 1152L, total)
        val last = f.alignment.mpegAudioFrames - 12
        val targets = listOf(1, 2, 11, 100, last / 3, last / 2, last / 2, last - 100, last)
        val window = 4096
        RandomAccessFile(linear, "r").use { ref ->
            for (preroll in listOf(0, 1, 2, 4, 10)) {
                var worst = 0
                var exact = 0
                var skipMs = 0L
                for (k in targets) {
                    val start = maxOf(0, k - preroll)
                    val skip = (k - start) * 1152 * 4
                    val got = ByteArray(window * 4)
                    var seen = 0
                    var filled = 0
                    val t0 = SystemClock.elapsedRealtime()
                    decodeRaw(stem, index, start) { b, off, len ->
                        val from = maxOf(0, skip - seen)
                        if (from < len) {
                            val n = minOf(len - from, got.size - filled)
                            System.arraycopy(b, off + from, got, filled, n)
                            filled += n
                        }
                        seen += len
                        if (filled == got.size) throw Stop()
                    }
                    skipMs = maxOf(skipMs, SystemClock.elapsedRealtime() - t0)
                    assertEquals(got.size, filled)
                    val want = ByteArray(window * 4)
                    ref.seek(k * 1152L * 4)
                    ref.readFully(want)
                    var diff = 0
                    for (i in got.indices step 2) {
                        val x = ((got[i + 1].toInt() shl 8) or (got[i].toInt() and 0xFF))
                        val y = ((want[i + 1].toInt() shl 8) or (want[i].toInt() and 0xFF))
                        diff = maxOf(diff, abs(x - y))
                    }
                    if (diff == 0) exact++
                    worst = maxOf(worst, diff)
                }
                Log.i(tag, "window preroll=$preroll bitExact=$exact/${targets.size} worstSampleDiff=$worst maxWindowMs=$skipMs")
                if (preroll == PREROLL) assertEquals("preroll $PREROLL must be exact", targets.size, exact)
            }
        }
        // MediaExtractor.seekTo is NOT used by the prototype; record where it would have landed.
        val ex = MediaExtractor()
        ex.setDataSource(stem.path)
        ex.selectTrack(0)
        val landed = ArrayList<String>()
        for (k in listOf(100, last / 2, last)) {
            val us = k * 1152L * 1_000_000L / f.rate
            ex.seekTo(us, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            landed.add("frame=$k errorUs=${ex.sampleTime - us}")
        }
        ex.release()
        Log.i(tag, "seekTo reported (timestamps are estimates, not sample positions): $landed")
        linear.delete()
    }

    /** Both profiles at both rates: raw domain is complete (gapless really off) and every window is exact. */
    @Test
    fun windowedDecodeOfBothProfilesAndRates() {
        val cases = JSONObject(inst.context.assets.open("mp3-alignment/cases.json").bufferedReader().readText()).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val mpeg = c.getJSONObject("alignment").getInt("mpegAudioFrames")
            val mp3 = File(scratch, "w.mp3").apply { writeBytes(inst.context.assets.open("mp3-alignment/" + c.getString("file")).readBytes()) }
            val index = frameIndex(mp3)
            fun raw(start: Int): ByteArray {
                val out = java.io.ByteArrayOutputStream()
                decodeRaw(mp3, index, start) { b, o, l -> out.write(b, o, l) }
                return out.toByteArray()
            }
            val linear = raw(0)
            val inexact = (1 until mpeg).filter { k ->
                val start = maxOf(0, k - PREROLL)
                val w = raw(start)
                val skip = (k - start) * 1152 * 4
                !w.copyOfRange(skip, w.size).contentEquals(linear.copyOfRange(k * 1152 * 4, linear.size))
            }
            Log.i(tag, "window ${c.getString("name")} rawFrames=${linear.size / 4} expected=${mpeg * 1152} inexactStartFrames=$inexact")
            assertEquals(c.getString("name"), mpeg * 1152 * 4, linear.size)
            assertTrue("${c.getString("name")} $inexact", inexact.isEmpty())
            mp3.delete()
        }
    }

    // ----------------------------------------------------------------- incremental playback

    /** Bounded PCM ring of one stem. Positions are manifest frames in bytes; nothing is ever invented. */
    private class Ring(private val capacity: Int, from: Long) : StemSource {
        private val data = ByteArray(capacity)
        private val lock = ReentrantLock()
        private val changed = lock.newCondition()
        private var start = from * 4
        private var end = from * 4
        private var finished = false
        private var closed = false
        private var failure: Throwable? = null

        override val sizeBytes: Long get() = Long.MAX_VALUE

        fun write(b: ByteArray, off: Int, len: Int) = lock.withLock {
            var done = 0
            while (done < len) {
                while (!closed && end - start == capacity.toLong()) changed.await()
                if (closed) throw Stop()
                val at = (end % capacity).toInt()
                val n = minOf(len - done, capacity - (end - start).toInt(), capacity - at)
                System.arraycopy(b, off + done, data, at, n)
                end += n
                done += n
                changed.signalAll()
            }
        }

        fun finish(error: Throwable?) = lock.withLock {
            finished = true
            failure = error
            changed.signalAll()
        }

        fun buffered(): Long = lock.withLock { end - start }

        /** Releases everything before [frame] (also for muted stems, which the mixer does not read). */
        fun discardUpTo(frame: Long) = lock.withLock {
            start = maxOf(start, minOf(frame * 4, end))
            changed.signalAll()
        }

        /** Blocks until the whole range is there: a starved stem stalls the whole mix, never yields silence. */
        override fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int = lock.withLock {
            val p = position - WavV1.HEADER_BYTES
            check(p >= start && length <= capacity) { "read outside the ring" }
            var waited = 0L
            while (!closed && !finished && end < p + length) {
                if (p > start) { start = minOf(p, end); changed.signalAll() }
                changed.await(100, TimeUnit.MILLISECONDS)
                waited += 100
                check(waited < 15_000) { "producer stalled" }
            }
            failure?.let { throw IllegalStateException("producer failed", it) }
            if (closed || end < p + length) {
                throw MinistryAudioException(MinistryAudioException.WAV_TRUNCATED, "stem ended early")
            }
            var done = 0
            while (done < length) {
                val at = ((p + done) % capacity).toInt()
                val n = minOf(length - done, capacity - at)
                System.arraycopy(data, at, dst, offset + done, n)
                done += n
            }
            length
        }

        override fun close() = lock.withLock {
            closed = true
            changed.signalAll()
        }
    }

    /** Six producers (one codec each) feeding six rings from manifest frame [from]. */
    private inner class Pipeline(f: Fixture, from: Long, stall: Pair<Int, Long>? = null) {
        val rings = List(6) { Ring(RING_BYTES, from) }
        private val done = CountDownLatch(6)

        init {
            val delay = Mp3StemDecoder.tagDelay(f.alignment).toLong()
            val raw = from + delay
            val startFrame = maxOf(0, (raw / 1152).toInt() - PREROLL)
            rings.forEachIndexed { i, ring ->
                Thread {
                    var error: Throwable? = null
                    try {
                        var stalled = false
                        val trimmer = PcmTrimmer((raw - startFrame * 1152L) * 4, (f.frames - from) * 4) { b, o, l ->
                            if (!stalled && stall != null && stall.first == i && ring.buffered() > RING_BYTES / 2) {
                                stalled = true
                                Thread.sleep(stall.second)
                            }
                            ring.write(b, o, l)
                        }
                        decodeRaw(f.files[i], frameIndex(f.files[i]), startFrame, trimmer)
                    } catch (e: Throwable) {
                        error = e
                    } finally {
                        ring.finish(error)
                        done.countDown()
                    }
                }.apply { isDaemon = true; start() }
            }
        }

        /** True only once every codec has been released. */
        fun close(): Boolean {
            rings.forEach { it.close() }
            return done.await(5, TimeUnit.SECONDS)
        }

        fun awaitPrebuffer(bytes: Long) {
            val end = SystemClock.elapsedRealtime() + 10_000
            while (rings.any { it.buffered() < bytes } && SystemClock.elapsedRealtime() < end) Thread.sleep(2)
        }
    }

    @Test
    fun incrementalMixMatchesFullDecodeThroughOneAudioTrack() {
        val f = fixture()
        // Reference: the production full decode, mixed by the same MixerCore.
        val decoder = AndroidMp3PcmDecoder()
        val wavs = f.files.mapIndexed { i, mp3 ->
            File(scratch, "ref_$i.wav").also { Mp3StemDecoder.decodeToWav(mp3, it, f.rate, f.frames, f.alignment, decoder) { false } }
        }
        val reference = MixerCore(wavs.map { FileStemSource.open(it) }, f.rate, f.frames)
        reference.setMaster(0.3f)

        val min = AudioTrack.getMinBufferSize(f.rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        val track = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
            .setAudioFormat(
                AudioFormat.Builder().setSampleRate(f.rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build(),
            )
            .setBufferSizeInBytes(maxOf(min, 1024 * 8 * 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track.setVolume(0f) // the mix stays full scale for the comparison; the speaker stays silent

        val a = ShortArray(2048)
        val b = ShortArray(2048)
        var peakPss = 0L

        /** Plays [seconds] from [from]; every block must equal the reference. */
        fun segment(name: String, from: Long, seconds: Int, stall: Pair<Int, Long>? = null) {
            val t0 = SystemClock.elapsedRealtime()
            track.pause()
            track.flush()
            val underrunsBefore = track.underrunCount
            val p = Pipeline(f, from, stall)
            try {
                p.awaitPrebuffer(PREBUFFER_BYTES.toLong().coerceAtMost((f.frames - from) * 4))
                val core = MixerCore(p.rings, f.rate, f.frames)
                core.setMaster(0.3f)
                core.seek(from)
                reference.seek(from)
                var firstMs = -1L
                var rebuffers = 0
                var longestMs = 0L
                var played = 0L
                var underrunsAfterFirstSecond = -1
                val goal = minOf(seconds.toLong() * f.rate, f.frames - from)
                track.play()
                while (played < goal) {
                    val r0 = System.nanoTime()
                    val n = core.render(a, 1024)
                    val ms = (System.nanoTime() - r0) / 1_000_000
                    if (ms > 20) rebuffers++
                    longestMs = maxOf(longestMs, ms)
                    assertEquals("frames $name", reference.render(b, 1024), n)
                    if (n == 0) break
                    for (i in 0 until n * 2) {
                        if (a[i] != b[i]) throw AssertionError("$name differs from the full decode at frame ${from + played + i / 2}")
                    }
                    var off = 0
                    while (off < n * 2) off += track.write(a, off, n * 2 - off, AudioTrack.WRITE_BLOCKING).also { check(it >= 0) }
                    if (firstMs < 0) firstMs = SystemClock.elapsedRealtime() - t0
                    played += n
                    if (underrunsAfterFirstSecond < 0 && played >= f.rate) underrunsAfterFirstSecond = track.underrunCount
                    p.rings.forEach { it.discardUpTo(core.positionFrames) }
                    if (played % (f.rate * 5L) < 1024) peakPss = maxOf(peakPss, Debug.getPss())
                }
                Log.i(
                    tag,
                    "segment $name from=$from firstAudioMs=$firstMs playedFrames=$played bitExact=true " +
                        "underruns=${track.underrunCount - underrunsBefore} " +
                        "underrunsAfter1s=${track.underrunCount - underrunsAfterFirstSecond} slowRenders=$rebuffers longestRenderMs=$longestMs",
                )
            } finally {
                assertTrue("codecs not released after $name", p.close())
            }
        }

        try {
            segment("start", 0, 30)
            segment("middle", f.frames / 2, 10)
            segment("backToStart", f.rate.toLong(), 5)
            segment("nearEnd", f.frames - f.rate * 4L, 10)
            segment("middleAgain", f.frames / 2 + 1, 5)
            segment("stallOneStem", f.rate * 60L, 10, stall = 3 to 4_000L)
            Log.i(
                tag,
                "ringBytesTotal=${RING_BYTES * 6L} tempPcmBytes=0 peakPssKiB=$peakPss javaUsedKiB=" +
                    "${(Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / 1024}",
            )
        } finally {
            runCatching { track.stop() }
            track.release()
            reference.close()
            wavs.forEach { it.delete() }
        }
    }

    private companion object {
        val BITRATES = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
        val RATES = intArrayOf(44_100, 48_000, 32_000, 0)
        const val PACK = 64
        const val PREROLL = 10
        const val RING_BYTES = 44_100 * 4 * 3 // 3 s per stem at 44.1 kHz
        const val PREBUFFER_BYTES = 44_100 * 4 // 1 s
    }
}
