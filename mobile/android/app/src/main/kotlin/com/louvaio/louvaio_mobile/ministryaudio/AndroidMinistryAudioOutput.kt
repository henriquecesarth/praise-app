package com.louvaio.louvaio_mobile.ministryaudio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.louvaio.louvaio_mobile.vocal.AudioFocusController
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import com.louvaio.louvaio_mobile.vocal.NoisyAudioMonitor

/**
 * Android bindings for [MinistryAudioEngine]. Nothing here is reachable from
 * Flutter yet (no MethodChannel is registered in this phase).
 */
fun createMinistryAudioEngine(
    context: Context,
    listener: MinistryAudioListener? = null,
): MinistryAudioEngine = MinistryAudioEngine(
    trackFactory = AndroidStereoTrackFactory(),
    focus = AndroidMinistryFocusController(context),
    noisy = AndroidMinistryNoisyMonitor(context),
    dispatcher = AndroidMainDispatcher(),
    listener = listener,
)

private class AndroidMainDispatcher : CallbackDispatcher {
    private val handler = Handler(Looper.getMainLooper())
    override fun post(action: () -> Unit) {
        handler.post(action)
    }
}

private class AndroidStereoTrack(private val track: AudioTrack) : StereoTrackHandle {
    override fun play() = track.play()
    override fun pause() = track.pause()
    override fun write(data: ShortArray, offsetInShorts: Int, sizeInShorts: Int): Int =
        track.write(data, offsetInShorts, sizeInShorts, AudioTrack.WRITE_BLOCKING)

    override fun stop() = track.stop()
    override fun flush() = track.flush()
    override fun release() = track.release()
    override fun headPositionFrames(): Long = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
}

/** ONE stereo PCM16 AudioTrack for the whole mix. */
private class AndroidStereoTrackFactory : StereoTrackFactory {
    override fun create(sampleRate: Int, bufferFrames: Int): StereoTrackHandle {
        val minBytes = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bytes = maxOf(minBytes, bufferFrames * WavV1.BYTES_PER_FRAME)
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build(),
            )
            .setBufferSizeInBytes(bytes)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        return AndroidStereoTrack(track)
    }
}

private class AndroidMinistryFocusController(context: Context) : AudioFocusController {
    private val manager =
        context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private var request: AudioFocusRequest? = null
    private var legacyListener: AudioManager.OnAudioFocusChangeListener? = null

    @Synchronized
    override fun requestFocus(onFocusChange: (Int) -> Unit): Boolean {
        val am = manager ?: return true
        abandonFocus()
        val listener = AudioManager.OnAudioFocusChangeListener { onFocusChange(it) }
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                .setAcceptsDelayedFocusGain(false)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(listener)
                .build()
            request = req
            am.requestAudioFocus(req)
        } else {
            legacyListener = listener
            @Suppress("DEPRECATION")
            am.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        val granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!granted) {
            request = null
            legacyListener = null
        }
        return granted
    }

    @Synchronized
    override fun abandonFocus() {
        val am = manager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = request
            request = null
            if (req != null) runCatching { am.abandonAudioFocusRequest(req) }
        } else {
            val l = legacyListener
            legacyListener = null
            @Suppress("DEPRECATION")
            if (l != null) runCatching { am.abandonAudioFocus(l) }
        }
    }
}

private class AndroidMinistryNoisyMonitor(context: Context) : NoisyAudioMonitor {
    private val appContext = context.applicationContext
    private var receiver: BroadcastReceiver? = null

    @Synchronized
    override fun register(onBecomingNoisy: () -> Unit) {
        unregister()
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) onBecomingNoisy()
            }
        }
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            appContext.registerReceiver(r, filter)
        }
        receiver = r
    }

    @Synchronized
    override fun unregister() {
        val r = receiver ?: return
        receiver = null
        try {
            appContext.unregisterReceiver(r)
        } catch (_: IllegalArgumentException) {
        }
    }
}
