package com.louvaio.louvaio_mobile.ministryaudio

import com.louvaio.louvaio_mobile.vocal.AudioFocusController
import com.louvaio.louvaio_mobile.vocal.NoisyAudioMonitor
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.fail

/** Small synthetic WAV builders (never real audio). */
object Wav {
    fun header(
        rate: Int,
        dataSize: Long,
        channels: Int = 2,
        bits: Int = 16,
        tag: Int = 1,
        riffSize: Long = 36 + dataSize,
        magic: String = "RIFF",
        byteRate: Long = rate.toLong() * channels * bits / 8,
        blockAlign: Int = channels * bits / 8,
    ): ByteArray {
        val b = ByteArray(44)
        fun str(off: Int, s: String) = s.forEachIndexed { i, c -> b[off + i] = c.code.toByte() }
        fun u16(off: Int, v: Int) {
            b[off] = v.toByte()
            b[off + 1] = (v shr 8).toByte()
        }
        fun u32(off: Int, v: Long) {
            u16(off, (v and 0xFFFF).toInt())
            u16(off + 2, ((v shr 16) and 0xFFFF).toInt())
        }
        str(0, magic)
        u32(4, riffSize)
        str(8, "WAVE")
        str(12, "fmt ")
        u32(16, 16)
        u16(20, tag)
        u16(22, channels)
        u32(24, rate.toLong())
        u32(28, byteRate)
        u16(32, blockAlign)
        u16(34, bits)
        str(36, "data")
        u32(40, dataSize)
        return b
    }

    /** L = R = sample(frame). */
    fun build(rate: Int, frames: Int, sample: (Int) -> Int): ByteArray {
        val out = ByteArray(44 + frames * 4)
        header(rate, frames * 4L).copyInto(out)
        for (f in 0 until frames) {
            val v = sample(f).coerceIn(-32768, 32767)
            val o = 44 + f * 4
            out[o] = v.toByte()
            out[o + 1] = (v shr 8).toByte()
            out[o + 2] = v.toByte()
            out[o + 3] = (v shr 8).toByte()
        }
        return out
    }

    fun writeAll(
        dir: File,
        rate: Int,
        frames: Int,
        sampler: (StemId, Int) -> Int = { id, _ -> (id.ordinal + 1) * 100 },
    ) {
        dir.mkdirs()
        for (id in StemId.values()) {
            File(dir, id.fileName).writeBytes(build(rate, frames) { f -> sampler(id, f) })
        }
    }
}

class SourceStats {
    val opened = AtomicInteger()
    val closed = AtomicInteger()
    @Volatile var maxReadLen = 0
    @Volatile var totalRead = 0L
    val reads = AtomicInteger()
    @Volatile var failAfterReads = -1
}

/** Wraps a real file source to observe reads/closes and inject failures. */
class TrackedSource(private val inner: StemSource, private val stats: SourceStats) : StemSource {
    override val sizeBytes: Long get() = inner.sizeBytes

    init {
        stats.opened.incrementAndGet()
    }

    override fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int {
        val n = stats.reads.incrementAndGet()
        if (stats.failAfterReads in 0 until n) {
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "injected")
        }
        stats.maxReadLen = maxOf(stats.maxReadLen, length)
        // Partial reads on purpose: never more than 7 bytes per call.
        val got = inner.readAt(position, dst, offset, minOf(length, 7))
        if (got > 0) stats.totalRead += got
        return got
    }

    override fun close() {
        stats.closed.incrementAndGet()
        inner.close()
    }
}

/** In-memory source with optional partial reads. */
class MemorySource(
    private val bytes: ByteArray,
    private val maxPerRead: Int = Int.MAX_VALUE,
    declaredSize: Long = bytes.size.toLong(),
) : StemSource {
    override val sizeBytes: Long = declaredSize
    @Volatile var closed = false
    @Volatile var maxRequested = 0

    override fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int {
        maxRequested = maxOf(maxRequested, length)
        if (position >= bytes.size) return -1
        val n = minOf(length, maxPerRead, (bytes.size - position).toInt())
        System.arraycopy(bytes, position.toInt(), dst, offset, n)
        return n
    }

    override fun close() {
        closed = true
    }
}

class FakeTrack(
    private val blockFirstWrite: Boolean = false,
    private val writeDelayMs: Long = 0L,
    private val failWritesAfter: Int = -1,
    private val freezeHead: Boolean = false,
) : StereoTrackHandle {
    private val lock = Any()
    private val samples = ArrayList<Short>()
    val flushMarks = CopyOnWriteArrayList<Int>()
    val events = CopyOnWriteArrayList<String>()
    val writesAfterRelease = AtomicInteger()
    val writeCalls = AtomicInteger()
    val writeEntered = CountDownLatch(1)
    private val unblock = CountDownLatch(1)
    @Volatile var released = false
    @Volatile var paused = false
    @Volatile private var blockedOnce = false

    val shortsWritten: Int get() = synchronized(lock) { samples.size }
    fun snapshot(): List<Short> = synchronized(lock) { ArrayList(samples) }
    fun release_unblock() = unblock.countDown()

    override fun play() {
        paused = false
        events.add("play")
    }

    override fun pause() {
        paused = true
        events.add("pause")
        unblock.countDown()
    }

    override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
        if (released) {
            writesAfterRelease.incrementAndGet()
            return -1
        }
        val call = writeCalls.incrementAndGet()
        if (failWritesAfter in 0 until call) return -1
        if (blockFirstWrite && !blockedOnce) {
            blockedOnce = true
            writeEntered.countDown()
            unblock.await(3, TimeUnit.SECONDS)
        } else {
            writeEntered.countDown()
        }
        if (writeDelayMs > 0) Thread.sleep(writeDelayMs)
        if (paused) return 0
        synchronized(lock) {
            for (i in 0 until sizeInShorts) samples.add(data[offsetInShorts + i])
        }
        return sizeInShorts
    }

    override fun stop() {
        events.add("stop")
    }

    override fun flush() {
        flushMarks.add(shortsWritten)
        events.add("flush")
    }

    override fun release() {
        released = true
        events.add("release")
    }

    override fun headPositionFrames(): Long = if (freezeHead) 0L else shortsWritten / 2L
}

class FakeFocus(var grant: Boolean = true) : AudioFocusController {
    @Volatile var callback: ((Int) -> Unit)? = null
    val requests = AtomicInteger()
    val abandons = AtomicInteger()

    override fun requestFocus(onFocusChange: (Int) -> Unit): Boolean {
        requests.incrementAndGet()
        if (grant) callback = onFocusChange
        return grant
    }

    override fun abandonFocus() {
        abandons.incrementAndGet()
    }

    fun fire(change: Int) = callback?.invoke(change)
}

class FakeNoisy : NoisyAudioMonitor {
    @Volatile var callback: (() -> Unit)? = null
    val registers = AtomicInteger()
    val unregisters = AtomicInteger()

    override fun register(onBecomingNoisy: () -> Unit) {
        registers.incrementAndGet()
        callback = onBecomingNoisy
    }

    override fun unregister() {
        unregisters.incrementAndGet()
    }

    fun fire() = callback?.invoke()
}

fun assertCode(code: String, block: () -> Unit) {
    try {
        block()
    } catch (e: MinistryAudioException) {
        assertEquals(code, e.code)
        return
    }
    fail("expected $code")
}

fun waitUntil(timeoutMs: Long = 5000, condition: () -> Boolean): Boolean {
    val end = System.nanoTime() + timeoutMs * 1_000_000
    while (System.nanoTime() < end) {
        if (condition()) return true
        Thread.sleep(2)
    }
    return condition()
}

fun renderThreadsAlive(): Int =
    Thread.getAllStackTraces().keys.count { it.name == MinistryAudioEngine.THREAD_NAME && it.isAlive }
