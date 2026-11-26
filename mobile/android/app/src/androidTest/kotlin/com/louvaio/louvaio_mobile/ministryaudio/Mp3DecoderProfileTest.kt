package com.louvaio.louvaio_mobile.ministryaudio

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.CRC32
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * M22-S4.1 profiling, on demand (needs <externalFilesDir>/s4long, see the S4 doc; skipped otherwise). Measures decoder
 * configurations against the production pump replica; a configuration is only comparable when its PCM CRC equals the
 * baseline of the SAME codec. Nothing here is production code. Results are logged under tag M22S41.
 *
 * Instrumentation args: `profileSeconds` (audio length per screening run, default 60; 0 = whole stem).
 */
class Mp3DecoderProfileTest {
    private val tag = "M22S41"
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val dir get() = File(inst.targetContext.getExternalFilesDir(null), "s4long")
    private val seconds get() = InstrumentationRegistry.getArguments().getString("profileSeconds")?.toInt() ?: 60

    private enum class Mode { SYNC_CURRENT, SYNC_DRAIN, ASYNC }

    private data class Cfg(val codec: String, val mode: Mode, val pack: Int = 1, val maxRate: Boolean = false) {
        val label get() = "$codec ${mode.name.lowercase()} pack=$pack${if (maxRate) " maxRate" else ""}"
    }

    private class Stats {
        var ms = 0L
        var startMs = 0L
        var inCalls = 0L
        var inWaitNs = 0L
        var outCalls = 0L
        var outWaitNs = 0L
        var emptyOutCalls = 0L
        var inBuffers = 0L
        var mpegFrames = 0L
        var outBuffers = 0L
        var bytes = 0L
        val crc = CRC32()
    }

    private fun stems(): List<File> {
        val cases = File(dir, "cases.json")
        assumeTrue("long fixtures not pushed", cases.exists())
        val arr = JSONObject(cases.readText()).getJSONArray("cases")
        return (0 until arr.length()).map { File(dir, arr.getJSONObject(it).getString("file")) }
    }

    private fun codecs() = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filter { c -> !c.isEncoder && c.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_AUDIO_MPEG, true) } }
        .filter { it.name.startsWith("c2.") }

    private fun maxFrames(): Long = if (seconds <= 0) Long.MAX_VALUE else seconds * 44_100L / 1152

    /** Fills one input buffer with up to `pack` whole MPEG frames; returns how many (0 = end of stream). */
    private fun fill(ex: MediaExtractor, buf: java.nio.ByteBuffer, pack: Int, st: Stats, limit: Long): Pair<Int, Int> {
        var off = 0
        var n = 0
        while (n < pack && st.mpegFrames < limit) {
            val size = ex.sampleSize
            if (size < 0 || off + size > buf.capacity()) break
            val got = ex.readSampleData(buf, off)
            if (got < 0) break
            off += got
            n++
            st.mpegFrames++
            ex.advance()
        }
        return off to n
    }

    private fun consume(codec: MediaCodec, ix: Int, info: MediaCodec.BufferInfo, scratch: ByteArray, st: Stats, sink: PcmSink?) {
        if (info.size > 0) {
            val b = codec.getOutputBuffer(ix)!!
            b.position(info.offset)
            b.limit(info.offset + info.size)
            var left = info.size
            while (left > 0) {
                val n = minOf(left, scratch.size)
                b.get(scratch, 0, n)
                st.crc.update(scratch, 0, n)
                sink?.write(scratch, 0, n)
                left -= n
            }
            st.bytes += info.size
            st.outBuffers++
        }
        codec.releaseOutputBuffer(ix, false)
    }

    private fun decode(file: File, cfg: Cfg, limit: Long, sink: PcmSink? = null): Stats {
        val st = Stats()
        val t0 = SystemClock.elapsedRealtime()
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        var thread: HandlerThread? = null
        try {
            ex.setDataSource(file.path)
            ex.selectTrack(0)
            val format = ex.getTrackFormat(0)
            if (cfg.pack > 1) format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, cfg.pack * 1045)
            if (cfg.maxRate) {
                format.setInteger(MediaFormat.KEY_PRIORITY, 1)
                format.setInteger(MediaFormat.KEY_OPERATING_RATE, Short.MAX_VALUE.toInt())
            }
            val c = MediaCodec.createByCodecName(cfg.codec)
            codec = c
            if (cfg.mode == Mode.ASYNC) {
                thread = HandlerThread("bench-codec").apply { start() }
                runAsync(c, format, ex, cfg, limit, st, sink, Handler(thread.looper), t0)
            } else {
                c.configure(format, null, null, 0)
                c.start()
                st.startMs = SystemClock.elapsedRealtime() - t0
                runSync(c, ex, cfg, limit, st, sink)
            }
        } finally {
            runCatching { codec?.stop() }
            runCatching { codec?.release() }
            ex.release()
            thread?.quitSafely()
        }
        st.ms = SystemClock.elapsedRealtime() - t0
        return st
    }

    private fun runSync(codec: MediaCodec, ex: MediaExtractor, cfg: Cfg, limit: Long, st: Stats, sink: PcmSink?) {
        val info = MediaCodec.BufferInfo()
        val scratch = ByteArray(16 * 1024)
        var inDone = false
        var outDone = false
        var last = System.nanoTime()

        fun feed(timeoutUs: Long): Boolean {
            val a = System.nanoTime()
            val ix = codec.dequeueInputBuffer(timeoutUs)
            st.inWaitNs += System.nanoTime() - a
            st.inCalls++
            if (ix < 0) return false
            val (len, n) = fill(ex, codec.getInputBuffer(ix)!!, cfg.pack, st, limit)
            if (n == 0) {
                codec.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inDone = true
            } else {
                codec.queueInputBuffer(ix, 0, len, st.inBuffers * 1000, 0)
                st.inBuffers++
            }
            return true
        }

        fun drain(timeoutUs: Long): Boolean {
            val a = System.nanoTime()
            val ox = codec.dequeueOutputBuffer(info, timeoutUs)
            st.outWaitNs += System.nanoTime() - a
            st.outCalls++
            if (ox >= 0) {
                consume(codec, ox, info, scratch, st, sink)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
                return true
            }
            if (ox == MediaCodec.INFO_TRY_AGAIN_LATER) st.emptyOutCalls++
            return ox == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED
        }

        while (!outDone) {
            var progressed = false
            if (cfg.mode == Mode.SYNC_CURRENT) {
                if (!inDone) progressed = feed(10_000)
                if (drain(10_000)) progressed = true
            } else {
                // Never wait for one side while the other has work: fill every free input, drain every ready output.
                while (!inDone && feed(0)) progressed = true
                while (!outDone && drain(0)) progressed = true
                if (!progressed && !outDone) progressed = drain(2_000)
            }
            if (progressed) last = System.nanoTime()
            check(System.nanoTime() - last < 15_000_000_000L) { "stalled" }
        }
    }

    private fun runAsync(
        codec: MediaCodec,
        format: MediaFormat,
        ex: MediaExtractor,
        cfg: Cfg,
        limit: Long,
        st: Stats,
        sink: PcmSink?,
        handler: Handler,
        t0: Long,
    ) {
        val done = CountDownLatch(1)
        val scratch = ByteArray(16 * 1024)
        var failure: Throwable? = null
        var inDone = false
        fun guard(block: () -> Unit) {
            if (done.count == 0L) return
            try {
                block()
            } catch (e: Throwable) {
                failure = e
                done.countDown()
            }
        }
        codec.setCallback(
            object : MediaCodec.Callback() {
                override fun onInputBufferAvailable(c: MediaCodec, ix: Int) = guard {
                    if (inDone) return@guard
                    st.inCalls++
                    val (len, n) = fill(ex, c.getInputBuffer(ix)!!, cfg.pack, st, limit)
                    if (n == 0) {
                        c.queueInputBuffer(ix, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inDone = true
                    } else {
                        c.queueInputBuffer(ix, 0, len, st.inBuffers * 1000, 0)
                        st.inBuffers++
                    }
                }

                override fun onOutputBufferAvailable(c: MediaCodec, ix: Int, info: MediaCodec.BufferInfo) = guard {
                    st.outCalls++
                    consume(c, ix, info, scratch, st, sink)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) done.countDown()
                }

                override fun onError(c: MediaCodec, e: MediaCodec.CodecException) = guard { throw e }

                override fun onOutputFormatChanged(c: MediaCodec, f: MediaFormat) = Unit
            },
            handler,
        )
        codec.configure(format, null, null, 0)
        codec.start()
        st.startMs = SystemClock.elapsedRealtime() - t0
        check(done.await(180, TimeUnit.SECONDS)) { "async stalled" }
        failure?.let { throw it }
    }

    private fun report(label: String, st: Stats, reference: Stats?) {
        val audioMs = st.mpegFrames * 1152 * 1000 / 44_100
        val perFrame = if (st.mpegFrames > 0) (st.inCalls + st.outCalls).toDouble() / st.mpegFrames else 0.0
        val same = reference?.let { it.crc.value == st.crc.value && it.bytes == st.bytes }
        Log.i(
            tag,
            "$label ms=${st.ms} xRealtime=${"%.1f".format(audioMs.toDouble() / maxOf(1, st.ms))} startMs=${st.startMs} " +
                "frames=${st.mpegFrames} inBuf=${st.inBuffers} outBuf=${st.outBuffers} calls/frame=${"%.2f".format(perFrame)} " +
                "inWaitMs=${st.inWaitNs / 1_000_000} outWaitMs=${st.outWaitNs / 1_000_000} emptyOut=${st.emptyOutCalls} " +
                "bytes=${st.bytes} crc=${st.crc.value} samePcm=$same",
        )
    }

    @Test
    fun pumpVariantsPerCodec() {
        val stem = stems().first()
        for (info in codecs()) {
            val base = decode(stem, Cfg(info.name, Mode.SYNC_CURRENT), maxFrames())
            report("A ${info.name}", base, null)
            val variants = listOf(
                Cfg(info.name, Mode.SYNC_DRAIN),
                Cfg(info.name, Mode.SYNC_DRAIN, maxRate = true),
                Cfg(info.name, Mode.ASYNC),
                Cfg(info.name, Mode.SYNC_DRAIN, pack = 16),
                Cfg(info.name, Mode.ASYNC, pack = 16),
                Cfg(info.name, Mode.SYNC_CURRENT, pack = 16),
                Cfg(info.name, Mode.SYNC_DRAIN, pack = 32),
                Cfg(info.name, Mode.SYNC_DRAIN, pack = 64),
            )
            for (cfg in variants) {
                try {
                    report(cfg.label, decode(stem, cfg, maxFrames()), base)
                } catch (e: Throwable) {
                    Log.i(tag, "${cfg.label} FAILED ${e.javaClass.simpleName} ${e.message}")
                }
            }
        }
    }

    @Test
    fun codecInstanceLimits() {
        val stem = stems().first()
        val ex = MediaExtractor().apply { setDataSource(stem.path) }
        val format = ex.getTrackFormat(0)
        ex.release()
        for (info in codecs()) {
            val declared = info.getCapabilitiesForType(MediaFormat.MIMETYPE_AUDIO_MPEG).maxSupportedInstances
            val open = ArrayList<MediaCodec>()
            try {
                // Idle instances only: shows they can be allocated, not that they decode fast in parallel.
                while (open.size < minOf(6, declared)) {
                    val c = MediaCodec.createByCodecName(info.name)
                    open.add(c)
                    c.configure(format, null, null, 0)
                    c.start()
                }
            } catch (e: Throwable) {
                Log.i(tag, "instances ${info.name} refused at #${open.size}: ${e.javaClass.simpleName}")
            } finally {
                Log.i(tag, "instances ${info.name} declaredMax=$declared openedTogether=${open.size}")
                open.forEach { runCatching { it.stop() }; runCatching { it.release() } }
            }
        }
    }

    @Test
    fun boundedParallelDecodingOfSixStems() {
        val files = stems()
        for (info in codecs()) {
            for ((mode, pack) in listOf(Mode.SYNC_CURRENT to 1, Mode.SYNC_DRAIN to 16)) {
                var reference: List<Long>? = null
                for (parallel in 1..3) {
                    val pool = Executors.newFixedThreadPool(parallel)
                    try {
                        val t0 = SystemClock.elapsedRealtime()
                        val results = files.map { f -> pool.submit<Stats> { decode(f, Cfg(info.name, mode, pack), maxFrames()) } }
                            .map { it.get(600, TimeUnit.SECONDS) }
                        val wall = SystemClock.elapsedRealtime() - t0
                        val crcs = results.map { it.crc.value }
                        if (reference == null) reference = crcs
                        Log.i(tag, "D ${info.name} ${mode.name.lowercase()} pack=$pack parallel=$parallel stems=${files.size} wallMs=$wall samePcm=${crcs == reference}")
                    } catch (e: Throwable) {
                        Log.i(tag, "D ${info.name} ${mode.name.lowercase()} pack=$pack parallel=$parallel FAILED ${e.javaClass.simpleName} ${e.message}")
                    } finally {
                        pool.shutdownNow()
                        pool.awaitTermination(30, TimeUnit.SECONDS)
                    }
                }
            }
        }
    }

    /**
     * Whole production decode of six stems (decoder only vs. WAV on disk) at several parallelism levels, to find what
     * bounds the time to prepare. Use `-e profileSeconds 0` (the audio length arg is ignored here: whole stems).
     */
    @Test
    fun productionDecodeScaling() {
        val files = stems()
        val case = JSONObject(File(dir, "cases.json").readText()).getJSONArray("cases").getJSONObject(0)
        val a = case.getJSONObject("alignment")
        val alignment = Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames"))
        val decoder = AndroidMp3PcmDecoder()
        for (parallel in listOf(2, 3, 4)) {
            for (toDisk in listOf(false, true)) {
                val pool = Executors.newFixedThreadPool(parallel)
                try {
                    val t0 = SystemClock.elapsedRealtime()
                    files.mapIndexed { i, f ->
                        pool.submit {
                            if (toDisk) {
                                val out = File(inst.targetContext.cacheDir, "s41_$i.wav.part")
                                Mp3StemDecoder.decodeToWav(
                                    f, out, case.getInt("sampleRate"), case.getLong("frames"), alignment, decoder,
                                ) { false }
                            } else {
                                decoder.decode(f, {}, { _, _, _ -> }, { false })
                            }
                        }
                    }.forEach { it.get(600, TimeUnit.SECONDS) }
                    Log.i(tag, "scaling parallel=$parallel toDisk=$toDisk stems=${files.size} wallMs=${SystemClock.elapsedRealtime() - t0}")
                } finally {
                    pool.shutdown()
                    pool.awaitTermination(30, TimeUnit.SECONDS)
                    files.indices.forEach { File(inst.targetContext.cacheDir, "s41_$it.wav.part").delete() }
                }
            }
        }
    }

    /** Splits the production path of ONE whole stem into codec time, buffered writes and the final flush + fsync. */
    @Test
    fun productionPathBreakdownOfOneStem() {
        val stem = stems().first()
        val case = JSONObject(File(dir, "cases.json").readText()).getJSONArray("cases").getJSONObject(0)
        val a = case.getJSONObject("alignment")
        val real = AndroidMp3PcmDecoder()
        var decodeNs = 0L
        var writeNs = 0L
        val timed = object : Mp3PcmDecoder {
            override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) {
                val t = System.nanoTime()
                real.decode(file, onInfo, { b, o, l ->
                    val w = System.nanoTime()
                    sink.write(b, o, l)
                    writeNs += System.nanoTime() - w
                }, cancelled)
                decodeNs = System.nanoTime() - t
            }
        }
        val out = File(inst.targetContext.cacheDir, "s41.wav.part")
        try {
            val t0 = System.nanoTime()
            val name = Mp3StemDecoder.decodeToWav(
                stem, out, case.getInt("sampleRate"), case.getLong("frames"),
                Mp3Alignment(a.getInt("encoderDelayFrames"), a.getInt("paddingFrames"), a.getInt("mpegAudioFrames")),
                timed,
            ) { false }
            val total = System.nanoTime() - t0
            Log.i(
                tag,
                "production decoder=$name totalMs=${total / 1_000_000} codecAndExtractorMs=${(decodeNs - writeNs) / 1_000_000} " +
                    "sinkWriteMs=${writeNs / 1_000_000} headerFlushFsyncMs=${(total - decodeNs) / 1_000_000} bytes=${out.length()}",
            )
        } finally {
            out.delete()
        }
    }
}
