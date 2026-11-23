package com.louvaio.louvaio_mobile.ministryaudio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MixerCoreTest {
    private val rate = 8000
    private val chunk = 16

    private fun core(
        frames: Int,
        rampMs: Int = 1,
        fadeIn: Boolean = false,
        maxPerRead: Int = Int.MAX_VALUE,
        sources: MutableList<MemorySource>? = null,
        sampler: (Int, Int) -> Int,
    ): MixerCore {
        val list = StemId.values().map { id ->
            MemorySource(Wav.build(rate, frames) { f -> sampler(id.ordinal, f) }, maxPerRead)
        }
        sources?.addAll(list)
        return MixerCore(list, rate, frames.toLong(), chunk, rampMs, fadeIn)
    }

    /** Renders everything, returning the left channel. */
    private fun renderAll(c: MixerCore): IntArray {
        val out = ArrayList<Int>()
        val buf = ShortArray(chunk * 2)
        while (true) {
            val n = c.render(buf, chunk)
            if (n == 0) break
            for (i in 0 until n) out.add(buf[i * 2].toInt())
        }
        return out.toIntArray()
    }

    @Test
    fun `six tracks start on the same frame`() {
        // Track k has an impulse of (k+1)*100 at frame 5 only.
        val c = core(40) { k, f -> if (f == 5) (k + 1) * 100 else 0 }
        val out = renderAll(c)
        for (f in out.indices) assertEquals("frame $f", if (f == 5) 2100 else 0, out[f])
    }

    @Test
    fun `impulses of two tracks stay aligned across chunk boundaries`() {
        // Impulses at frame 21 (crosses the 16-frame chunk boundary).
        val c = core(64) { k, f -> if ((k == 0 || k == 3) && f == 21) 700 else 0 }
        val out = renderAll(c)
        assertEquals(1400, out[21])
        assertEquals(0, out.take(21).sumOf { it } + out.drop(22).sumOf { it })
    }

    @Test
    fun `gain is independent per track`() {
        val c = core(64) { _, _ -> 1000 }
        c.setGain(0, 0.5f)
        c.setGain(1, 0.25f)
        for (i in 2..5) c.setGain(i, 0f)
        renderAll(c).drop(16).forEach { assertEquals(750, it) } // 500 + 250
    }

    @Test
    fun `mute silences only that track`() {
        val c = core(64) { _, _ -> 100 }
        c.setMuted(0, true)
        c.setMuted(5, true)
        renderAll(c).drop(16).forEach { assertEquals(400, it) }
    }

    @Test
    fun `solo plays only soloed tracks and mute still wins`() {
        val c = core(96) { k, _ -> (k + 1) * 10 }
        c.setSolo(1, true)
        c.setSolo(2, true)
        val out = renderAll(c)
        out.drop(16).forEach { assertEquals(20 + 30, it) }

        val c2 = core(96) { k, _ -> (k + 1) * 10 }
        c2.setSolo(1, true)
        c2.setMuted(1, true) // soloed but muted: silent
        renderAll(c2).drop(16).forEach { assertEquals(0, it) }

        val c3 = core(96) { k, _ -> (k + 1) * 10 }
        c3.setSolo(3, true)
        c3.setSolo(3, false) // solo cleared: everything audible again
        renderAll(c3).drop(16).forEach { assertEquals(210, it) }
    }

    @Test
    fun `sum is limited and never wraps around`() {
        val pos = core(48) { _, _ -> 30000 }
        renderAll(pos).forEach { assertEquals(32767, it) }
        val neg = core(48) { _, _ -> -30000 }
        renderAll(neg).forEach { assertEquals(-32768, it) }
    }

    @Test
    fun `master volume scales the mix`() {
        val c = core(64) { _, _ -> 100 }
        c.setMaster(0.5f)
        renderAll(c).forEach { assertEquals(300, it) } // 600 * 0.5, no fade-in
    }

    @Test
    fun `gain changes are ramped, with no step larger than the ramp slope`() {
        val frames = 400
        val c = core(frames, rampMs = 5) { k, _ -> if (k == 0) 1000 else 0 }
        val buf = ShortArray(chunk * 2)
        val seen = ArrayList<Int>()
        var changed = false
        while (true) {
            val n = c.render(buf, chunk)
            if (n == 0) break
            for (i in 0 until n) seen.add(buf[i * 2].toInt())
            if (!changed && seen.size >= 64) {
                c.setGain(0, 0f)
                changed = true
            }
        }
        var maxStep = 0
        for (i in 1 until seen.size) maxStep = maxOf(maxStep, kotlin.math.abs(seen[i] - seen[i - 1]))
        // 5 ms at 8 kHz = 40 frames for the full 0..1 swing of a 1000 signal.
        assertTrue("max step $maxStep", maxStep <= 26)
        assertEquals(0, seen.last())
        assertTrue(seen[63] == 1000)
    }

    @Test
    fun `start and seek fade in instead of jumping`() {
        val c = core(400, rampMs = 5, fadeIn = true) { k, _ -> if (k == 0) 1000 else 0 }
        val buf = ShortArray(chunk * 2)
        c.render(buf, chunk)
        assertTrue("first frame must start near silence", buf[0].toInt() <= 30)
        c.seek(200)
        c.render(buf, chunk)
        assertTrue("post-seek first frame must start near silence", buf[0].toInt() <= 30)
    }

    @Test
    fun `seek to start, middle and end never leaks old frames`() {
        val total = 200
        // Track 0 carries the frame number; the rest are silent.
        val c = core(total) { k, f -> if (k == 0) f else 0 }
        val buf = ShortArray(chunk * 2)

        c.render(buf, chunk); c.render(buf, chunk)
        assertEquals(32L, c.positionFrames)

        c.seek(100)
        assertEquals(1, c.render(buf, 1))
        assertEquals(100, buf[0].toInt())
        c.render(buf, chunk)
        assertEquals(101, buf[0].toInt())

        c.seek(0)
        c.render(buf, chunk)
        assertEquals(0, buf[0].toInt())
        assertEquals(15, buf[30].toInt())

        c.seek(total.toLong())
        assertEquals(0, c.render(buf, chunk))
        c.seek(total - 3L)
        assertEquals(3, c.render(buf, chunk))
        assertEquals(total - 3, buf[0].toInt())

        c.seek(-50)
        assertEquals(0L, c.positionFrames)
        c.seek(10_000)
        assertEquals(total.toLong(), c.positionFrames)
    }

    @Test
    fun `repeated seeks are stable and deterministic`() {
        val c = core(300) { k, f -> if (k == 2) f else 0 }
        val buf = ShortArray(chunk * 2)
        repeat(200) { i ->
            val target = ((i * 37) % 280).toLong()
            c.seek(target)
            c.render(buf, chunk)
            assertEquals(target.toInt(), buf[0].toInt())
        }
    }

    @Test
    fun `partial reads from the source still produce aligned output`() {
        val c = core(80, maxPerRead = 3) { k, f -> if (f == 33) (k + 1) else 0 }
        val out = renderAll(c)
        assertEquals(21, out[33])
        assertEquals(21, out.sum())
    }

    @Test
    fun `a truncated source fails the render with a controlled error`() {
        val frames = 64
        val full = Wav.build(rate, frames) { 5 }
        val sources = StemId.values().mapIndexed { i, _ ->
            // Stem 4 loses its last 20 bytes: fine until the very end.
            MemorySource(if (i == 4) full.copyOf(full.size - 20) else full)
        }
        val c = MixerCore(sources, rate, frames.toLong(), chunk, 1, false)
        val buf = ShortArray(chunk * 2)
        c.render(buf, chunk)
        c.render(buf, chunk)
        c.render(buf, chunk)
        assertCode(MinistryAudioException.WAV_TRUNCATED) { c.render(buf, chunk) }
    }

    @Test
    fun `invalid control values are rejected`() {
        val c = core(32) { _, _ -> 0 }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { c.setGain(0, 1.5f) }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { c.setGain(0, -0.1f) }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { c.setGain(0, Float.NaN) }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { c.setMuted(6, true) }
        assertCode(MinistryAudioException.INVALID_ARGUMENT) { c.setMaster(2f) }
    }

    @Test
    fun `memory is bounded by the chunk buffers, not by the file length`() {
        val shortCore = core(64) { _, _ -> 1 }
        val longSources = mutableListOf<MemorySource>()
        val longCore = core(64 * 400, sources = longSources) { _, _ -> 1 }
        assertEquals(6L * chunk * 4, shortCore.workingSetBytes)
        assertEquals(shortCore.workingSetBytes, longCore.workingSetBytes)
        renderAll(longCore)
        // No request ever exceeded one chunk of one stem.
        longSources.forEach { assertTrue(it.maxRequested <= chunk * 4) }
    }

    @Test
    fun `silent tracks are not read (io saving) yet stay aligned when unmuted`() {
        val sources = mutableListOf<MemorySource>()
        val c = core(200, sources = sources) { k, f -> if (k == 1) f else 0 }
        c.setMuted(1, true)
        val buf = ShortArray(chunk * 2)
        c.render(buf, chunk)
        assertEquals(0, sources[1].maxRequested)
        c.seek(100)
        c.setMuted(1, false)
        c.render(buf, chunk) // ramps in from silence at frame 100
        c.render(buf, chunk)
        assertEquals(100 + chunk + 15, buf[30].toInt())
    }
}
