package com.louvaio.louvaio_mobile.vocal

import kotlin.math.*

/**
 * Pure DSP sampled piano and metronome mixer.
 * Renders 44100Hz mono PCM16 in deterministic blocks of 256 frames.
 */
class SampledPianoMixer(
    private val bank: PianoBank,
    val notes: List<Int>,
    val durations: List<Double>,
    val bpm: Int,
    val metronomeEnabled: Boolean,
    val outputSampleRate: Int = 44100
) {
    companion object {
        const val BLOCK_SIZE = 256
        const val MAX_VOICES = 8
        const val MASTER_GAIN = 0.35f
        const val SINC_TAPS = 16
        const val SINC_PHASES = 1024
        const val FADE_FRAMES_15MS = 661 // 0.015 * 44100
        const val METRONOME_LEVEL = 0.07f

        // Cache precalculated sinc interpolation tables by semitone delta (-12..+12)
        private val sincTableCache = HashMap<Int, Array<FloatArray>>()

        @Synchronized
        fun getSincTable(semitoneDelta: Int): Array<FloatArray> {
            return sincTableCache.getOrPut(semitoneDelta) {
                val step = 2.0.pow(semitoneDelta / 12.0)
                val cutoff = 0.95 * minOf(1.0, 1.0 / step)
                Array(SINC_PHASES) { p ->
                    val frac = p.toDouble() / SINC_PHASES.toDouble()
                    val weights = DoubleArray(SINC_TAPS)
                    var sum = 0.0
                    for (k in 0 until SINC_TAPS) {
                        val x = (k - 7) - frac
                        val hann = if (abs(x) <= 8.0) 0.5 * (1.0 + cos(2.0 * Math.PI * x / 16.0)) else 0.0
                        val sinc = if (abs(x) < 1e-9) 1.0 else sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x)
                        val w = sinc * hann
                        weights[k] = w
                        sum += w
                    }
                    val normalized = FloatArray(SINC_TAPS)
                    val invSum = if (abs(sum) > 1e-12) 1.0 / sum else 1.0
                    for (k in 0 until SINC_TAPS) {
                        normalized[k] = (weights[k] * invSum).toFloat()
                    }
                    normalized
                }
            }
        }
    }

    data class NoteEvent(
        val midi: Int,
        val startFrame: Long,
        val heldFrames: Long,
        val attackFrames: Long,
        val releaseFrames: Long,
        val velocity: Int = 112
    )

    data class MetronomeClick(
        val startFrame: Long,
        val frequency: Double,
        val attackFrames: Long,
        val decayFrames: Long,
        val totalFrames: Long
    )

    private class ActiveVoice(
        val midi: Int,
        val startFrame: Long,
        val heldFrames: Long,
        val attackFrames: Long,
        val releaseFrames: Long,
        val level: Float,
        val sample: PianoBank.Sample,
        val phaseStep: Double,
        val sincTable: Array<FloatArray>
    ) {
        var phase: Double = 0.0
        var isStealing: Boolean = false
        var stealStartFrame: Long = 0L
        var stealStartGain: Float = 0f
        var stealDurationFrames: Long = FADE_FRAMES_15MS.toLong()

        fun isEnded(currentFrame: Long): Boolean {
            if (isStealing) {
                return currentFrame >= stealStartFrame + stealDurationFrames
            }
            return currentFrame >= startFrame + heldFrames + releaseFrames
        }

        fun currentGain(currentFrame: Long): Float {
            val noteFrame = currentFrame - startFrame
            if (noteFrame < 0) return 0f

            val baseGain = if (noteFrame < attackFrames) {
                level * (noteFrame.toFloat() / attackFrames.toFloat())
            } else if (noteFrame < heldFrames) {
                level
            } else {
                val relFrame = noteFrame - heldFrames
                if (relFrame >= releaseFrames) 0f
                else level * (1.0f - relFrame.toFloat() / releaseFrames.toFloat())
            }

            if (isStealing) {
                val stealFrame = currentFrame - stealStartFrame
                if (stealFrame >= stealDurationFrames) return 0f
                val stealFade = 1.0f - (stealFrame.toFloat() / stealDurationFrames.toFloat())
                return stealStartGain * stealFade
            }

            return baseGain
        }

        fun startSteal(currentFrame: Long) {
            if (isStealing) return
            stealStartGain = currentGain(currentFrame)
            stealStartFrame = currentFrame
            isStealing = true
        }

        fun renderSample(currentFrame: Long): Float {
            val gain = currentGain(currentFrame)
            if (gain <= 0.00001f) {
                advancePhase()
                return 0f
            }

            val data = sample.data
            val loopStart = sample.loopStartFrame
            val loopEnd = sample.loopEndFrame
            val isLooping = loopStart != null && loopEnd != null && loopEnd > loopStart

            val intPart = phase.toInt()
            val fracPart = phase - intPart
            val phaseIdx = (fracPart * SINC_PHASES).toInt().coerceIn(0, SINC_PHASES - 1)
            val kernel = sincTable[phaseIdx]

            var interpolated = 0f
            val loopLen = if (isLooping) loopEnd!! - loopStart!! else 0

            for (k in 0 until SINC_TAPS) {
                var sampleIdx = intPart + (k - 7)
                if (isLooping) {
                    if (sampleIdx >= loopEnd!!) {
                        sampleIdx = loopStart!! + ((sampleIdx - loopStart) % loopLen)
                    } else if (sampleIdx < loopStart && phase >= loopStart) {
                        // Wrapped back before loopStart
                        val under = loopStart - sampleIdx
                        sampleIdx = loopEnd - (under % loopLen)
                    }
                }

                val s = if (sampleIdx in 0 until data.size) data[sampleIdx] else 0f
                interpolated += s * kernel[k]
            }

            advancePhase()
            return interpolated * gain
        }

        private fun advancePhase() {
            phase += phaseStep
            val loopStart = sample.loopStartFrame
            val loopEnd = sample.loopEndFrame
            if (loopStart != null && loopEnd != null && loopEnd > loopStart) {
                val loopLen = (loopEnd - loopStart).toDouble()
                if (phase >= loopEnd.toDouble()) {
                    phase = loopStart.toDouble() + ((phase - loopStart.toDouble()) % loopLen)
                }
            }
        }
    }

    val noteEvents: List<NoteEvent>
    val metronomeClicks: List<MetronomeClick>
    val totalFrames: Long

    private val activeVoices = ArrayList<ActiveVoice>(MAX_VOICES + 2)
    private var nextNoteIndex = 0
    private var nextMetronomeIndex = 0
    private var renderedFrameCount: Long = 0L
    var clippedSamplesCount: Long = 0L
        private set

    // Master fade for pause/resume/stop ramps
    private var masterFadeGain: Float = 1.0f
    private var masterFadeTarget: Float = 1.0f
    private var masterFadeStep: Float = 0.0f
    private var masterFadeRemainingFrames: Int = 0

    init {
        // Build note events
        val parsedNotes = ArrayList<NoteEvent>()
        var cumBeats = 0.0
        val attackSec = 0.003
        val releaseSec = bank.releaseSeconds

        for (i in notes.indices) {
            val midi = notes[i]
            val durationBeats = durations[i]
            val startFrame = Math.round(cumBeats * 60.0 / bpm * outputSampleRate)
            if (midi >= 0) {
                val heldSec = durationBeats * 60.0 / bpm * 0.82
                val attackDuration = minOf(attackSec, heldSec / 2.0)
                val heldFrames = Math.round(heldSec * outputSampleRate).coerceAtLeast(1)
                val attackFrames = Math.round(attackDuration * outputSampleRate).coerceAtLeast(1)
                val releaseFrames = Math.round(releaseSec * outputSampleRate).coerceAtLeast(1)
                parsedNotes.add(
                    NoteEvent(
                        midi = midi,
                        startFrame = startFrame,
                        heldFrames = heldFrames,
                        attackFrames = attackFrames,
                        releaseFrames = releaseFrames
                    )
                )
            }
            cumBeats += durationBeats
        }
        noteEvents = parsedNotes

        // Build metronome events
        val parsedClicks = ArrayList<MetronomeClick>()
        if (metronomeEnabled) {
            val totalBeats = durations.sum()
            val totalBeatsCount = ceil(totalBeats).toInt()
            val attackFrames = Math.round(0.001 * outputSampleRate).coerceAtLeast(1)
            val decayFrames = Math.round(0.035 * outputSampleRate).coerceAtLeast(1)
            val clickTotalFrames = Math.round(0.040 * outputSampleRate).coerceAtLeast(1)

            for (b in 0 until totalBeatsCount) {
                val startFrame = Math.round(b.toDouble() * 60.0 / bpm * outputSampleRate)
                val freq = if (b % 4 == 0) 1200.0 else 850.0
                parsedClicks.add(
                    MetronomeClick(
                        startFrame = startFrame,
                        frequency = freq,
                        attackFrames = attackFrames,
                        decayFrames = decayFrames,
                        totalFrames = clickTotalFrames
                    )
                )
            }
        }
        metronomeClicks = parsedClicks

        // Calculate totalFrames: max of (total nominal frames, last note-off + release, last metronome end)
        var maxEndFrame = Math.round(cumBeats * 60.0 / bpm * outputSampleRate)
        for (event in noteEvents) {
            val noteEnd = event.startFrame + event.heldFrames + event.releaseFrames
            if (noteEnd > maxEndFrame) maxEndFrame = noteEnd
        }
        for (click in metronomeClicks) {
            val clickEnd = click.startFrame + click.totalFrames
            if (clickEnd > maxEndFrame) maxEndFrame = clickEnd
        }
        totalFrames = maxEndFrame
    }

    val isFinished: Boolean
        get() = renderedFrameCount >= totalFrames && activeVoices.isEmpty()

    val currentFrame: Long
        get() = renderedFrameCount

    fun setMasterFade(targetGain: Float, durationFrames: Int) {
        masterFadeTarget = targetGain.coerceIn(0f, 1f)
        if (durationFrames <= 0) {
            masterFadeGain = masterFadeTarget
            masterFadeRemainingFrames = 0
            masterFadeStep = 0f
        } else {
            masterFadeRemainingFrames = durationFrames
            masterFadeStep = (masterFadeTarget - masterFadeGain) / durationFrames.toFloat()
        }
    }

    fun renderBlock(output: ShortArray, offset: Int = 0, count: Int = BLOCK_SIZE): Int {
        if (isFinished && masterFadeGain <= 0.0001f) return 0
        val framesToRender = minOf(count, (totalFrames + FADE_FRAMES_15MS - renderedFrameCount).toInt().coerceAtLeast(0))
        if (framesToRender <= 0 && activeVoices.isEmpty()) return 0

        val actualCount = minOf(count, if (framesToRender > 0) framesToRender else count)
        if (actualCount <= 0) return 0

        for (i in 0 until actualCount) {
            val frame = renderedFrameCount

            // 1. Admit new notes starting at this frame
            while (nextNoteIndex < noteEvents.size && noteEvents[nextNoteIndex].startFrame <= frame) {
                val event = noteEvents[nextNoteIndex]
                startVoice(event, frame)
                nextNoteIndex++
            }

            // 2. Synthesize metronome for this frame
            var metronomeSample = 0f
            if (metronomeEnabled) {
                for (click in metronomeClicks) {
                    val rel = frame - click.startFrame
                    if (rel in 0 until click.totalFrames) {
                        val env = if (rel < click.attackFrames) {
                            METRONOME_LEVEL * (rel.toFloat() / click.attackFrames.toFloat())
                        } else if (rel < click.attackFrames + click.decayFrames) {
                            val decayRel = rel - click.attackFrames
                            val ratio = (decayRel.toDouble() / click.decayFrames.toDouble()).coerceIn(0.0, 1.0)
                            // Exponential ramp down from 0.07 to 0.0001
                            METRONOME_LEVEL * (0.0001 / METRONOME_LEVEL).pow(ratio).toFloat()
                        } else {
                            0f
                        }
                        val t = rel.toDouble() / outputSampleRate.toDouble()
                        metronomeSample += env * sin(2.0 * Math.PI * click.frequency * t).toFloat()
                    }
                }
            }

            // 3. Render and sum all active voices
            var voicesSum = 0f
            var vIdx = 0
            while (vIdx < activeVoices.size) {
                val voice = activeVoices[vIdx]
                if (voice.isEnded(frame)) {
                    activeVoices.removeAt(vIdx)
                } else {
                    voicesSum += voice.renderSample(frame)
                    vIdx++
                }
            }

            // 4. Update master fade
            if (masterFadeRemainingFrames > 0) {
                masterFadeGain += masterFadeStep
                masterFadeRemainingFrames--
                if (masterFadeRemainingFrames == 0) masterFadeGain = masterFadeTarget
            }

            // 5. Final mix with master gain and headroom bounds
            val mixFloat = (voicesSum + metronomeSample) * MASTER_GAIN * masterFadeGain
            if (mixFloat > 1.0f || mixFloat < -1.0f) {
                clippedSamplesCount++
            }
            val clamped = mixFloat.coerceIn(-1.0f, 1.0f)
            output[offset + i] = (clamped * 32767.0f).toInt().toShort()

            renderedFrameCount++
        }

        return actualCount
    }

    private fun startVoice(event: NoteEvent, frame: Long) {
        val region = bank.findRegion(event.midi) ?: return
        val sample = bank.getSample(region.root) ?: return

        // If at voice limit (8), steal oldest voice with a 15ms ramp to zero
        if (activeVoices.size >= MAX_VOICES) {
            val oldest = activeVoices.minByOrNull { it.startFrame }
            oldest?.startSteal(frame)
        }

        val semitoneDelta = event.midi - region.root
        val phaseStep = (sample.sampleRate.toDouble() / outputSampleRate.toDouble()) * 2.0.pow(semitoneDelta / 12.0)
        val sincTable = getSincTable(semitoneDelta)
        val level = 0.32f * (event.velocity.toFloat() / 127.0f).pow(1.5f)

        val voice = ActiveVoice(
            midi = event.midi,
            startFrame = frame,
            heldFrames = event.heldFrames,
            attackFrames = event.attackFrames,
            releaseFrames = event.releaseFrames,
            level = level,
            sample = sample,
            phaseStep = phaseStep,
            sincTable = sincTable
        )
        activeVoices.add(voice)
    }
}
