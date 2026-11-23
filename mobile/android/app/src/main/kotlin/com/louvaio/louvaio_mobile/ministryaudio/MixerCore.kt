package com.louvaio.louvaio_mobile.ministryaudio

import java.io.IOException

/**
 * Pure mixing core (no Android APIs): six PCM16 stereo stems -> one stereo
 * stream, on a single frame-based timeline.
 *
 * * Alignment: every block reads the six stems at the SAME frame position
 *   (`44 + position * 4`), so tracks cannot drift; a seek just moves that one
 *   position, which is atomic for all six by construction and leaves no stale
 *   frames inside the core (only the output device's queue, flushed by the
 *   engine).
 * * Memory: one `chunkFrames * 4` byte buffer per stem plus the caller's output
 *   block; independent of file length. Nothing is allocated while rendering.
 * * Clicks: gain, mute, solo, master and duck changes are smoothed with a
 *   per-sample linear ramp (default 5 ms) instead of jumping.
 * * Clipping: the float sum is hard-limited to the PCM16 range (never wraps).
 *
 * Control setters are thread-safe. [render] and [seek] must be called from a
 * single thread (the engine's render thread, or the owner while idle).
 */
class MixerCore(
    private val sources: List<StemSource>,
    val sampleRate: Int,
    val totalFrames: Long,
    val chunkFrames: Int = DEFAULT_CHUNK_FRAMES,
    rampMillis: Int = DEFAULT_RAMP_MILLIS,
    private val fadeIn: Boolean = true,
) {
    init {
        require(sources.size == STEM_COUNT) { "six sources required" }
        require(chunkFrames in 16..65_536)
    }

    private val buffers = Array(STEM_COUNT) { ByteArray(chunkFrames * WavV1.BYTES_PER_FRAME) }
    private val rampStep = 1f / maxOf(1, sampleRate * rampMillis / 1000)

    private val controlLock = Any()
    private val gain = FloatArray(STEM_COUNT) { 1f }
    private val muted = BooleanArray(STEM_COUNT)
    private val solo = BooleanArray(STEM_COUNT)
    private var master = 1f
    private var duck = 1f

    // Render-thread state.
    private val target = FloatArray(STEM_COUNT)
    private val current = FloatArray(STEM_COUNT)
    private val active = BooleanArray(STEM_COUNT)
    private var masterTarget = 1f
    private var masterCurrent = 0f // starts silent: micro fade-in on start/seek
    private var snapMaster = !fadeIn
    private var initialized = false

    @Volatile
    var positionFrames: Long = 0L
        private set

    /** Approximate working-set bytes (stem buffers only). */
    val workingSetBytes: Long get() = buffers.sumOf { it.size.toLong() }

    fun setGain(index: Int, value: Float) = synchronized(controlLock) {
        gain[checkIndex(index)] = checkUnit(value)
    }

    fun setMuted(index: Int, value: Boolean) = synchronized(controlLock) {
        muted[checkIndex(index)] = value
    }

    fun setSolo(index: Int, value: Boolean) = synchronized(controlLock) {
        solo[checkIndex(index)] = value
    }

    fun setMaster(value: Float) = synchronized(controlLock) { master = checkUnit(value) }

    /** Temporary attenuation (audio-focus ducking), 0..1. */
    fun setDuck(value: Float) = synchronized(controlLock) { duck = checkUnit(value) }

    /** Moves the single shared timeline. Clamped to `[0, totalFrames]`. */
    fun seek(frame: Long) {
        positionFrames = frame.coerceIn(0L, totalFrames)
        masterCurrent = 0f // ramp back in after the discontinuity
        snapMaster = !fadeIn
    }

    /**
     * Renders up to [maxFrames] (<= [chunkFrames]) interleaved stereo frames
     * into [out] and advances the timeline. Returns 0 at the end.
     */
    @Throws(MinistryAudioException::class)
    fun render(out: ShortArray, maxFrames: Int): Int {
        require(maxFrames in 1..chunkFrames && out.size >= maxFrames * 2)
        val start = positionFrames
        val remaining = totalFrames - start
        if (remaining <= 0) return 0
        val n = minOf(maxFrames.toLong(), remaining).toInt()

        snapshotControls()
        val byteCount = n * WavV1.BYTES_PER_FRAME
        for (i in 0 until STEM_COUNT) {
            active[i] = target[i] > 0f || current[i] > 0f
            if (active[i]) {
                sources[i].readFully(
                    WavV1.HEADER_BYTES + start * WavV1.BYTES_PER_FRAME,
                    buffers[i],
                    0,
                    byteCount,
                )
            }
        }

        for (f in 0 until n) {
            masterCurrent = approach(masterCurrent, masterTarget)
            var l = 0f
            var r = 0f
            val idx = f * WavV1.BYTES_PER_FRAME
            for (i in 0 until STEM_COUNT) {
                if (!active[i]) continue
                current[i] = approach(current[i], target[i])
                val g = current[i]
                if (g == 0f) continue
                val b = buffers[i]
                l += sample(b, idx) * g
                r += sample(b, idx + 2) * g
            }
            out[f * 2] = clip(l * masterCurrent)
            out[f * 2 + 1] = clip(r * masterCurrent)
        }
        positionFrames = start + n
        return n
    }

    fun close() {
        for (s in sources) {
            try {
                s.close()
            } catch (_: IOException) {
            }
        }
    }

    private fun snapshotControls() {
        synchronized(controlLock) {
            var anySolo = false
            for (i in 0 until STEM_COUNT) if (solo[i]) anySolo = true
            for (i in 0 until STEM_COUNT) {
                val audible = !muted[i] && (!anySolo || solo[i])
                target[i] = if (audible) gain[i] else 0f
            }
            masterTarget = master * duck
        }
        if (snapMaster) {
            masterCurrent = masterTarget
            snapMaster = false
        }
        if (!initialized) {
            // First block: audible tracks start at their level (the master
            // ramp already provides the fade-in).
            for (i in 0 until STEM_COUNT) current[i] = target[i]
            initialized = true
        }
    }

    private fun approach(value: Float, goal: Float): Float {
        if (value == goal) return value
        return if (value < goal) minOf(goal, value + rampStep) else maxOf(goal, value - rampStep)
    }

    private fun sample(b: ByteArray, idx: Int): Int =
        (b[idx + 1].toInt() shl 8) or (b[idx].toInt() and 0xFF)

    private fun clip(v: Float): Short = when {
        v >= Short.MAX_VALUE -> Short.MAX_VALUE
        v <= Short.MIN_VALUE -> Short.MIN_VALUE
        else -> Math.round(v).toShort()
    }

    private fun checkIndex(i: Int): Int {
        if (i !in 0 until STEM_COUNT) {
            throw MinistryAudioException(MinistryAudioException.INVALID_ARGUMENT, "Faixa inválida.")
        }
        return i
    }

    private fun checkUnit(v: Float): Float {
        if (v.isNaN() || v < 0f || v > 1f) {
            throw MinistryAudioException(MinistryAudioException.INVALID_ARGUMENT, "Valor fora de 0..1.")
        }
        return v
    }

    companion object {
        const val STEM_COUNT = 6
        const val DEFAULT_CHUNK_FRAMES = 1024
        const val DEFAULT_RAMP_MILLIS = 5
    }
}
