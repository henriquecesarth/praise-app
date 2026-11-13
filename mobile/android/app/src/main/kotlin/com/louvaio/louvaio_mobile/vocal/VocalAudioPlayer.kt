package com.louvaio.louvaio_mobile.vocal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.VolumeShaper
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock

interface AudioTrackHandle {
    fun play()
    fun pause()
    fun write(audioData: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int
    fun stop()
    fun flush()
    fun release()
    fun getPlaybackHeadPositionFrames(): Long
    fun fadeVolume(fadeDown: Boolean, durationMs: Long)
    fun setVolumeLevel(gain: Float)
}

interface AudioTrackFactory {
    fun create(sampleRate: Int, bufferSizeBytes: Int): AudioTrackHandle
}

interface AudioFocusController {
    fun requestFocus(onFocusChange: (Int) -> Unit): Boolean
    fun abandonFocus()
}

interface NoisyAudioMonitor {
    fun register(onBecomingNoisy: () -> Unit)
    fun unregister()
}

fun interface CallbackDispatcher {
    fun post(action: () -> Unit)
}

private class AndroidCallbackDispatcher : CallbackDispatcher {
    private val mainHandler = Handler(Looper.getMainLooper())
    override fun post(action: () -> Unit) {
        mainHandler.post(action)
    }
}

private class AndroidAudioTrackHandle(
    private val track: AudioTrack
) : AudioTrackHandle {
    override fun play() {
        track.play()
    }

    override fun pause() {
        track.pause()
    }

    override fun write(audioData: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int {
        return track.write(audioData, offsetInShorts, sizeInShorts, AudioTrack.WRITE_BLOCKING)
    }

    override fun stop() {
        track.stop()
    }

    override fun flush() {
        track.flush()
    }

    override fun release() {
        track.release()
    }

    override fun getPlaybackHeadPositionFrames(): Long {
        return track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
    }

    override fun setVolumeLevel(gain: Float) {
        track.setVolume(gain.coerceIn(0f, 1f))
    }

    override fun fadeVolume(fadeDown: Boolean, durationMs: Long) {
        if (durationMs <= 0L) return
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
                // Fallback to gain / sleep below
            }
        }
        try {
            track.setVolume(if (fadeDown) 0f else 1f)
            Thread.sleep(durationMs)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: Exception) {}
    }
}

private class AndroidAudioTrackFactory : AudioTrackFactory {
    override fun create(sampleRate: Int, bufferSizeBytes: Int): AudioTrackHandle {
        val minBuf = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        ).coerceAtLeast(bufferSizeBytes)
        val effectiveBufferSize = maxOf(minBuf, bufferSizeBytes)

        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        val format = AudioFormat.Builder()
            .setSampleRate(sampleRate)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        val track = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setBufferSizeInBytes(effectiveBufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        return AndroidAudioTrackHandle(track)
    }
}

private class AndroidAudioFocusController(context: Context) : AudioFocusController {
    private val audioManager =
        context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private var activeListener: AudioManager.OnAudioFocusChangeListener? = null
    private var focusRequest: AudioFocusRequest? = null

    @Synchronized
    override fun requestFocus(onFocusChange: (Int) -> Unit): Boolean {
        val manager = audioManager ?: return true
        abandonFocus()
        val listener = AudioManager.OnAudioFocusChangeListener { change ->
            onFocusChange(change)
        }
        activeListener = listener

        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(listener)
                .build()
            focusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                listener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
        }

        val granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!granted) {
            focusRequest = null
            activeListener = null
        }
        return granted
    }

    @Synchronized
    override fun abandonFocus() {
        val manager = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = focusRequest
            focusRequest = null
            if (req != null) {
                try {
                    manager.abandonAudioFocusRequest(req)
                } catch (_: Exception) {}
            }
        } else {
            val listener = activeListener
            if (listener != null) {
                try {
                    @Suppress("DEPRECATION")
                    manager.abandonAudioFocus(listener)
                } catch (_: Exception) {}
            }
        }
        activeListener = null
    }
}

private class AndroidNoisyAudioMonitor(context: Context) : NoisyAudioMonitor {
    private val appContext = context.applicationContext
    private var receiver: BroadcastReceiver? = null

    @Synchronized
    override fun register(onBecomingNoisy: () -> Unit) {
        unregister()
        val br = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                    onBecomingNoisy()
                }
            }
        }
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(br, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            appContext.registerReceiver(br, filter)
        }
        receiver = br
    }

    @Synchronized
    override fun unregister() {
        val current = receiver ?: return
        receiver = null
        try {
            appContext.unregisterReceiver(current)
        } catch (_: IllegalArgumentException) {
            // Ignore if already unregistered by OS lifecycle.
        }
    }
}

/**
 * Android AudioTrack adapter for LouvAIO Vocal exercises.
 * Manages streaming playback, 15ms click-free fades, audio focus, headset disconnection,
 * thread-safe teardown (pause/interrupt/join before stop/flush/release), and position reporting.
 */
class VocalAudioPlayer internal constructor(
    private val bank: PianoBank,
    private val trackFactory: AudioTrackFactory,
    private val focusController: AudioFocusController? = null,
    private val noisyMonitor: NoisyAudioMonitor? = null,
    private val dispatcher: CallbackDispatcher = CallbackDispatcher { it() },
    private val tailStallTimeoutMs: Long = DEFAULT_TAIL_STALL_TIMEOUT_MS
) {

    constructor(bank: PianoBank) : this(bank, null)

    constructor(bank: PianoBank, context: Context?) : this(
        bank = bank,
        trackFactory = AndroidAudioTrackFactory(),
        focusController = context?.let { AndroidAudioFocusController(it) },
        noisyMonitor = context?.let { AndroidNoisyAudioMonitor(it) },
        dispatcher = AndroidCallbackDispatcher(),
        tailStallTimeoutMs = DEFAULT_TAIL_STALL_TIMEOUT_MS
    )

    enum class State {
        IDLE, PREPARING, PLAYING, PAUSED, COMPLETED, STOPPED, ERROR
    }

    private companion object {
        const val DEFAULT_TAIL_STALL_TIMEOUT_MS = 1500L
        const val RENDER_THREAD_JOIN_MS = 600L
        const val DUCKED_VOLUME = 0.25f
        const val FULL_VOLUME = 1.0f
    }

    private val commandExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "vocal-command-worker").apply { isDaemon = true }
    }
    private val released = AtomicBoolean(false)
    private val pauseLock = ReentrantLock()
    private val pauseCondition = pauseLock.newCondition()
    private val completionLock = Any()
    private val headLock = Any()

    @Volatile
    var currentSessionId: Long = 0L
        private set

    @Volatile
    var currentState: State = State.IDLE
        private set

    @Volatile
    private var currentMixer: SampledPianoMixer? = null

    @Volatile
    private var currentTrack: AudioTrackHandle? = null

    private var renderThread: Thread? = null
    private val stopRenderRequested = AtomicBoolean(false)
    private var basePlaybackHeadOffset: Long = 0L
    private var lastPlaybackHead: Long = 0L

    private fun submitCommand(onRejected: () -> Unit = {}, block: () -> Unit) {
        if (released.get()) {
            onRejected()
            return
        }
        try {
            commandExecutor.execute {
                if (released.get()) {
                    onRejected()
                    return@execute
                }
                block()
            }
        } catch (_: RejectedExecutionException) {
            onRejected()
        }
    }

    private fun signalPauseLock() {
        pauseLock.lock()
        try {
            pauseCondition.signalAll()
        } finally {
            pauseLock.unlock()
        }
    }

    fun playSequence(
        sessionId: Long,
        notes: List<Int>,
        durations: List<Double>,
        bpm: Int,
        metronome: Boolean,
        result: MethodChannel.Result
    ) {
        val rejected = {
            dispatcher.post { result.error("PLAYER_RELEASED", "Player liberado.", null) }
        }
        submitCommand(onRejected = rejected) {
            try {
                // Stop any existing session before claiming new session state.
                stopInternal(fadeDurationMs = 15L)

                currentSessionId = sessionId
                currentState = State.PREPARING

                val activeSession = sessionId
                if (focusController != null && !focusController.requestFocus { change ->
                        handleAudioFocusChange(activeSession, change)
                    }
                ) {
                    currentState = State.ERROR
                    dispatcher.post {
                        result.error(
                            "AUDIO_FOCUS_DENIED",
                            "Não foi possível obter foco de áudio para reprodução.",
                            null
                        )
                    }
                    return@submitCommand
                }

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
                val requestedBufferSize = SampledPianoMixer.BLOCK_SIZE * 4 * 2
                val track = trackFactory.create(sampleRate, requestedBufferSize)

                synchronized(headLock) {
                    currentTrack = track
                    basePlaybackHeadOffset = 0L
                    lastPlaybackHead = 0L
                }
                stopRenderRequested.set(false)

                track.setVolumeLevel(FULL_VOLUME)
                noisyMonitor?.register {
                    handleBecomingNoisy(activeSession)
                }

                track.play()
                currentState = State.PLAYING

                renderThread = Thread({
                    runRenderLoop(activeSession, mixer, track)
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
                dispatcher.post { result.success(response) }
            } catch (e: Exception) {
                stopInternal(fadeDurationMs = 0L)
                currentState = State.ERROR
                dispatcher.post { result.error("AUDIO_ERROR", e.message, null) }
            }
        }
    }

    private fun runRenderLoop(
        activeSession: Long,
        mixer: SampledPianoMixer,
        track: AudioTrackHandle
    ) {
        val block = ShortArray(SampledPianoMixer.BLOCK_SIZE)
        while (!stopRenderRequested.get()) {
            val stateNow = currentState
            if (stateNow == State.PAUSED) {
                waitWhilePaused()
                continue
            }
            if (stateNow != State.PLAYING) break

            val rendered = mixer.renderBlock(block, 0, SampledPianoMixer.BLOCK_SIZE)
            if (rendered > 0) {
                var written = 0
                while (written < rendered && !stopRenderRequested.get()) {
                    val writeState = currentState
                    if (writeState == State.PAUSED) {
                        waitWhilePaused()
                        continue
                    }
                    if (writeState != State.PLAYING) break

                    val res = track.write(block, written, rendered - written)
                    if (res > 0) {
                        written += res
                    } else if (currentState == State.PAUSED) {
                        waitWhilePaused()
                    } else {
                        break
                    }
                }
            } else {
                var lastObservedHead = getPlaybackHeadPosition()
                var lastProgressAtMs = System.currentTimeMillis()

                while (!stopRenderRequested.get()) {
                    val tailState = currentState
                    if (tailState == State.PAUSED) {
                        lastProgressAtMs = System.currentTimeMillis()
                        waitWhilePaused()
                        continue
                    }
                    if (tailState != State.PLAYING) break

                    val played = getPlaybackHeadPosition()
                    if (played >= mixer.totalFrames) {
                        markCompleted(activeSession)
                        break
                    }
                    val now = System.currentTimeMillis()
                    if (played > lastObservedHead) {
                        lastObservedHead = played
                        lastProgressAtMs = now
                    } else if (now - lastProgressAtMs >= tailStallTimeoutMs) {
                        markCompleted(activeSession)
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
    }

    private fun waitWhilePaused() {
        pauseLock.lock()
        try {
            if (!stopRenderRequested.get() && currentState == State.PAUSED) {
                pauseCondition.await(25L, TimeUnit.MILLISECONDS)
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            pauseLock.unlock()
        }
    }

    private fun markCompleted(sessionId: Long) {
        var didComplete = false
        synchronized(completionLock) {
            if (!stopRenderRequested.get() &&
                currentSessionId == sessionId &&
                currentState == State.PLAYING
            ) {
                currentState = State.COMPLETED
                didComplete = true
            }
        }
        if (didComplete) {
            focusController?.abandonFocus()
            noisyMonitor?.unregister()
        }
    }

    private fun handleAudioFocusChange(sessionId: Long, focusChange: Int) {
        submitCommand {
            if (currentSessionId != sessionId) return@submitCommand
            when (focusChange) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    stopInternal(fadeDurationMs = 15L)
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    pauseInternal(sessionId)
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    if (currentState == State.PLAYING) {
                        currentTrack?.setVolumeLevel(DUCKED_VOLUME)
                    }
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    if (currentState == State.PLAYING) {
                        currentTrack?.setVolumeLevel(FULL_VOLUME)
                    }
                }
            }
        }
    }

    private fun handleBecomingNoisy(sessionId: Long) {
        submitCommand {
            if (currentSessionId == sessionId &&
                (currentState == State.PLAYING ||
                    currentState == State.PAUSED ||
                    currentState == State.PREPARING)
            ) {
                stopInternal(fadeDurationMs = 5L)
            }
        }
    }

    private fun pauseInternal(sessionId: Long) {
        if (currentSessionId != sessionId || currentState != State.PLAYING) return
        val track = currentTrack ?: return
        track.fadeVolume(fadeDown = true, durationMs = 15L)
        var transitionedToPaused = false
        synchronized(completionLock) {
            if (!stopRenderRequested.get() &&
                currentSessionId == sessionId &&
                currentState == State.PLAYING
            ) {
                currentState = State.PAUSED
                transitionedToPaused = true
            }
        }
        if (!transitionedToPaused) return
        try {
            track.pause()
        } catch (_: Exception) {}
        noisyMonitor?.unregister()
    }

    fun pause(sessionId: Long, result: MethodChannel.Result) {
        submitCommand(onRejected = { dispatcher.post { result.success(null) } }) {
            if (currentSessionId != sessionId || currentState != State.PLAYING) {
                dispatcher.post { result.success(null) }
                return@submitCommand
            }
            try {
                pauseInternal(sessionId)
                dispatcher.post { result.success(null) }
            } catch (e: Exception) {
                dispatcher.post { result.error("PAUSE_ERROR", e.message, null) }
            }
        }
    }

    fun resume(sessionId: Long, result: MethodChannel.Result) {
        submitCommand(onRejected = { dispatcher.post { result.success(null) } }) {
            if (currentSessionId != sessionId || currentState != State.PAUSED) {
                dispatcher.post { result.success(null) }
                return@submitCommand
            }
            try {
                val activeSession = sessionId
                if (focusController != null && !focusController.requestFocus { change ->
                        handleAudioFocusChange(activeSession, change)
                    }
                ) {
                    dispatcher.post {
                        result.error(
                            "AUDIO_FOCUS_DENIED",
                            "Não foi possível recuperar foco de áudio.",
                            null
                        )
                    }
                    return@submitCommand
                }
                val track = currentTrack
                if (track == null) {
                    dispatcher.post { result.success(null) }
                    return@submitCommand
                }
                noisyMonitor?.register {
                    handleBecomingNoisy(activeSession)
                }
                track.setVolumeLevel(FULL_VOLUME)
                track.play()
                track.fadeVolume(fadeDown = false, durationMs = 15L)
                synchronized(completionLock) {
                    if (!stopRenderRequested.get() &&
                        currentSessionId == sessionId &&
                        currentState == State.PAUSED
                    ) {
                        currentState = State.PLAYING
                    }
                }
                signalPauseLock()
                dispatcher.post { result.success(null) }
            } catch (e: Exception) {
                dispatcher.post { result.error("RESUME_ERROR", e.message, null) }
            }
        }
    }

    fun stop(sessionId: Long?, result: MethodChannel.Result) {
        submitCommand(onRejected = { dispatcher.post { result.success(null) } }) {
            if (sessionId != null && sessionId != currentSessionId) {
                dispatcher.post { result.success(null) }
                return@submitCommand
            }
            stopInternal(fadeDurationMs = 15L)
            dispatcher.post { result.success(null) }
        }
    }

    fun getPosition(sessionId: Long?, result: MethodChannel.Result) {
        val buildStopped = { id: Long? ->
            mapOf(
                "sessionId" to (id ?: 0L),
                "playedFrames" to 0L,
                "totalFrames" to 0L,
                "sampleRate" to 44100,
                "state" to "stopped"
            )
        }
        submitCommand(onRejected = { dispatcher.post { result.success(buildStopped(sessionId)) } }) {
            val session = currentSessionId
            if (sessionId != null && sessionId != session) {
                dispatcher.post { result.success(buildStopped(sessionId)) }
                return@submitCommand
            }

            val played = getPlaybackHeadPosition()
            val mixer = currentMixer
            val total = mixer?.totalFrames ?: 0L
            val sampleRate = mixer?.outputSampleRate ?: 44100
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
                "sampleRate" to sampleRate,
                "state" to stateName
            )
            dispatcher.post { result.success(pos) }
        }
    }

    fun release() {
        if (!released.compareAndSet(false, true)) return
        val latch = CountDownLatch(1)
        try {
            commandExecutor.execute {
                try {
                    stopInternal(fadeDurationMs = 5L)
                } finally {
                    latch.countDown()
                }
            }
            latch.await(900L, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
        } finally {
            commandExecutor.shutdown()
            try {
                commandExecutor.awaitTermination(200L, TimeUnit.MILLISECONDS)
            } catch (_: Exception) {}
        }
    }

    private fun stopInternal(fadeDurationMs: Long) {
        if (currentState == State.IDLE ||
            (currentState == State.STOPPED && currentTrack == null && renderThread == null)
        ) {
            focusController?.abandonFocus()
            noisyMonitor?.unregister()
            return
        }

        stopRenderRequested.set(true)
        val track = currentTrack
        val thread = renderThread

        if (track != null && currentState == State.PLAYING && fadeDurationMs > 0L) {
            track.fadeVolume(fadeDown = true, durationMs = fadeDurationMs)
        }

        if (track != null) {
            try {
                track.pause()
            } catch (_: Exception) {}
        }

        signalPauseLock()

        thread?.interrupt()
        if (thread != null && Thread.currentThread() !== thread) {
            try {
                thread.join(RENDER_THREAD_JOIN_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        synchronized(headLock) {
            currentTrack = null
        }

        if (track != null) {
            try {
                track.stop()
            } catch (_: Exception) {}
            try {
                track.flush()
            } catch (_: Exception) {}
            try {
                track.release()
            } catch (_: Exception) {}
        }

        renderThread = null
        currentMixer = null
        focusController?.abandonFocus()
        noisyMonitor?.unregister()
        currentState = State.STOPPED
    }

    private fun getPlaybackHeadPosition(): Long = synchronized(headLock) {
        val track = currentTrack ?: return@synchronized lastPlaybackHead
        return@synchronized try {
            val raw = track.getPlaybackHeadPositionFrames() and 0xFFFFFFFFL
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
