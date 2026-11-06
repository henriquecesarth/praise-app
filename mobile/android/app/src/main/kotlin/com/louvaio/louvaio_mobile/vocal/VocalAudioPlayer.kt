package com.louvaio.louvaio_mobile.vocal

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.VolumeShaper
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Android AudioTrack adapter for LouvAIO Vocal exercises.
 * Manages streaming playback, 15ms click-free fades, position reporting, and lifecycle teardown.
 */
class VocalAudioPlayer(private val bank: PianoBank) {

    enum class State {
        IDLE, PREPARING, PLAYING, PAUSED, COMPLETED, STOPPED, ERROR
    }

    private val commandExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vocal-command-worker").apply { isDaemon = true }
    }
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    var currentSessionId: Long = 0L
        private set

    @Volatile
    var currentState: State = State.IDLE
        private set

    private var currentMixer: SampledPianoMixer? = null
    private var currentTrack: AudioTrack? = null
    private var renderThread: Thread? = null
    private val stopRenderRequested = AtomicBoolean(false)
    private var basePlaybackHeadOffset: Long = 0L
    private var lastPlaybackHead: Long = 0L

    fun playSequence(
        sessionId: Long,
        notes: List<Int>,
        durations: List<Double>,
        bpm: Int,
        metronome: Boolean,
        result: MethodChannel.Result
    ) {
        commandExecutor.execute {
            try {
                // Stop any existing session
                stopInternal(fadeDurationMs = 15L)

                currentSessionId = sessionId
                currentState = State.PREPARING

                // Ensure piano bank is loaded
                bank.loadAll()

                val mixer = SampledPianoMixer(
                    bank = bank,
                    notes = notes,
                    durations = durations,
                    bpm = bpm,
                    metronomeEnabled = metronome
                )
                currentMixer = mixer

                val sampleRate = mixer.outputSampleRate
                val minBuf = AudioTrack.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                val bufferSize = maxOf(minBuf, SampledPianoMixer.BLOCK_SIZE * 4 * 2)

                val track = AudioTrack(
                    AudioManager.STREAM_MUSIC,
                    sampleRate,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize,
                    AudioTrack.MODE_STREAM
                )

                currentTrack = track
                basePlaybackHeadOffset = 0L
                lastPlaybackHead = 0L
                stopRenderRequested.set(false)

                track.play()
                currentState = State.PLAYING

                // Start audio render loop in dedicated thread
                val activeSession = sessionId
                renderThread = Thread({
                    val block = ShortArray(SampledPianoMixer.BLOCK_SIZE)
                    while (!stopRenderRequested.get() && currentState == State.PLAYING) {
                        val rendered = mixer.renderBlock(block, 0, SampledPianoMixer.BLOCK_SIZE)
                        if (rendered > 0) {
                            var written = 0
                            while (written < rendered && !stopRenderRequested.get()) {
                                val res = track.write(block, written, rendered - written, AudioTrack.WRITE_BLOCKING)
                                if (res < 0) break
                                written += res
                            }
                        } else {
                            // All blocks rendered, wait for hardware playback head to reach end
                            while (!stopRenderRequested.get() && currentState == State.PLAYING) {
                                val played = getPlaybackHeadPosition()
                                if (played >= mixer.totalFrames) {
                                    currentState = State.COMPLETED
                                    break
                                }
                                try {
                                    Thread.sleep(10)
                                } catch (_: InterruptedException) {
                                    break
                                }
                            }
                            break
                        }
                    }
                }, "vocal-audio-stream-$activeSession").apply {
                    priority = Thread.MAX_PRIORITY
                    isDaemon = true
                    start()
                }

                val response = mapOf(
                    "sessionId" to sessionId,
                    "sampleRate" to sampleRate,
                    "totalFrames" to mixer.totalFrames
                )
                mainHandler.post { result.success(response) }
            } catch (e: Exception) {
                currentState = State.ERROR
                mainHandler.post { result.error("AUDIO_ERROR", e.message, null) }
            }
        }
    }

    fun pause(sessionId: Long, result: MethodChannel.Result) {
        commandExecutor.execute {
            if (currentSessionId != sessionId) {
                mainHandler.post { result.success(null) }
                return@execute
            }
            if (currentState != State.PLAYING) {
                mainHandler.post { result.success(null) }
                return@execute
            }
            try {
                fadeVolume(fadeDown = true, durationMs = 15L)
                currentTrack?.pause()
                currentState = State.PAUSED
                mainHandler.post { result.success(null) }
            } catch (e: Exception) {
                mainHandler.post { result.error("PAUSE_ERROR", e.message, null) }
            }
        }
    }

    fun resume(sessionId: Long, result: MethodChannel.Result) {
        commandExecutor.execute {
            if (currentSessionId != sessionId) {
                mainHandler.post { result.success(null) }
                return@execute
            }
            if (currentState != State.PAUSED) {
                mainHandler.post { result.success(null) }
                return@execute
            }
            try {
                currentTrack?.play()
                fadeVolume(fadeDown = false, durationMs = 15L)
                currentState = State.PLAYING
                mainHandler.post { result.success(null) }
            } catch (e: Exception) {
                mainHandler.post { result.error("RESUME_ERROR", e.message, null) }
            }
        }
    }

    fun stop(sessionId: Long?, result: MethodChannel.Result) {
        commandExecutor.execute {
            if (sessionId != null && sessionId != currentSessionId) {
                mainHandler.post { result.success(null) }
                return@execute
            }
            stopInternal(fadeDurationMs = 15L)
            mainHandler.post { result.success(null) }
        }
    }

    fun getPosition(sessionId: Long?, result: MethodChannel.Result) {
        commandExecutor.execute {
            val session = currentSessionId
            if (sessionId != null && sessionId != session) {
                val stale = mapOf(
                    "sessionId" to (sessionId ?: 0L),
                    "playedFrames" to 0L,
                    "totalFrames" to 0L,
                    "state" to "stopped"
                )
                mainHandler.post { result.success(stale) }
                return@execute
            }

            val played = getPlaybackHeadPosition()
            val total = currentMixer?.totalFrames ?: 0L
            val stateName = when (currentState) {
                State.IDLE -> "stopped"
                State.PREPARING -> "preparing"
                State.PLAYING -> "playing"
                State.PAUSED -> "paused"
                State.COMPLETED -> "completed"
                State.STOPPED -> "stopped"
                State.ERROR -> "error"
            }

            val pos = mapOf(
                "sessionId" to session,
                "playedFrames" to played,
                "totalFrames" to total,
                "state" to stateName
            )
            mainHandler.post { result.success(pos) }
        }
    }

    fun release() {
        commandExecutor.execute {
            stopInternal(fadeDurationMs = 5L)
        }
        commandExecutor.shutdown()
        try {
            commandExecutor.awaitTermination(200, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {}
    }

    private fun stopInternal(fadeDurationMs: Long) {
        if (currentState == State.IDLE || currentState == State.STOPPED) return

        stopRenderRequested.set(true)
        val track = currentTrack
        if (track != null) {
            try {
                fadeVolume(fadeDown = true, durationMs = fadeDurationMs)
                track.stop()
                track.flush()
                track.release()
            } catch (_: Exception) {}
        }
        currentTrack = null
        renderThread?.interrupt()
        renderThread = null
        currentMixer = null
        currentState = State.STOPPED
    }

    private fun fadeVolume(fadeDown: Boolean, durationMs: Long) {
        val track = currentTrack ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val curveX = floatArrayOf(0f, 1f)
                val curveY = if (fadeDown) floatArrayOf(1f, 0f) else floatArrayOf(0f, 1f)
                val config = VolumeShaper.Configuration.Builder()
                    .setDuration(durationMs)
                    .setCurve(curveX, curveY)
                    .setInterpolatorType(VolumeShaper.Configuration.INTERPOLATOR_TYPE_LINEAR)
                    .build()
                val shaper = track.createVolumeShaper(config)
                shaper.apply(VolumeShaper.Operation.PLAY)
                Thread.sleep(durationMs)
                return
            } catch (_: Exception) {
                // Fallback to sleep / software
            }
        }
        try {
            Thread.sleep(durationMs)
        } catch (_: InterruptedException) {}
    }

    private fun getPlaybackHeadPosition(): Long {
        val track = currentTrack ?: return lastPlaybackHead
        return try {
            val raw = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
            // Handle 32-bit wrap if necessary
            if (raw < (lastPlaybackHead and 0xFFFFFFFFL) && (lastPlaybackHead and 0xFFFFFFFFL) > 0x7FFFFFFFL) {
                basePlaybackHeadOffset += 0x100000000L
            }
            val total = basePlaybackHeadOffset + raw
            lastPlaybackHead = total
            total
        } catch (_: Exception) {
            lastPlaybackHead
        }
    }
}
