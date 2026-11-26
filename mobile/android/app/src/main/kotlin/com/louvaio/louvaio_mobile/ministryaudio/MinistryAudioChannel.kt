package com.louvaio.louvaio_mobile.ministryaudio

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.louvaio.louvaio_mobile.vocal.CallbackDispatcher
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The ONLY platform channel of the ministry audio player. It forwards typed
 * commands to [MinistryAudioBridge] (which runs them off the main thread) and
 * posts replies/events back on the main thread. It accepts no paths and no
 * URLs; see [MinistryAudioBridge] for validation.
 */
class MinistryAudioChannel(
    context: Context,
    messenger: BinaryMessenger,
) {
    private val main = Handler(Looper.getMainLooper())
    private val channel = MethodChannel(messenger, CHANNEL_NAME)
    private val released = AtomicBoolean(false)
    private val bridge = MinistryAudioBridge(
        filesDir = context.applicationContext.filesDir,
        events = { event ->
            main.post { if (!released.get()) channel.invokeMethod("onEvent", event) }
        },
        // Lazy: nothing is decoded or calibrated unless Flutter (flag-gated) sends an MP3 prepare.
        mp3 = Mp3Support(
            decoder = AndroidMp3PcmDecoder(),
            calibration = Mp3DecoderCalibration(
                AndroidMp3PcmDecoder(),
                java.io.File(context.applicationContext.cacheDir, "ministry_audio_mp3_calibration"),
            ) { context.applicationContext.assets.open(it) },
            // Used only when Flutter asks for it (a second, off-by-default build flag).
            incremental = Mp3IncrementalSupport(
                decoder = AndroidMp3PcmDecoder(),
                calibration = Mp3IncrementalCalibration(
                    AndroidMp3PcmDecoder(),
                    java.io.File(context.applicationContext.cacheDir, "ministry_audio_mp3_calibration"),
                ) { context.applicationContext.assets.open(it) },
            ),
        ),
        engineFactory = { listener ->
            // Events are forwarded by the bridge (it posts to main itself).
            createMinistryAudioEngine(context, listener, CallbackDispatcher { it() })
        },
    )

    init {
        channel.setMethodCallHandler { call, result ->
            val args = call.arguments as? Map<*, *>
            bridge.submit(call.method, args) { reply ->
                main.post {
                    if (released.get()) return@post
                    if (reply.isOk) {
                        result.success(reply.value)
                    } else {
                        result.error(reply.errorCode ?: MinistryAudioBridge.INTERNAL, reply.errorMessage, null)
                    }
                }
            }
        }
    }

    /** Playback must not continue when the app leaves the foreground. */
    fun onAppStopped() = bridge.stopCurrentAsync()

    /** Activity destroyed: nothing blocks the main thread. */
    fun dispose() {
        if (!released.compareAndSet(false, true)) return
        channel.setMethodCallHandler(null)
        Thread({ bridge.dispose() }, "ministry-audio-dispose").apply {
            isDaemon = true
            start()
        }
    }

    companion object {
        const val CHANNEL_NAME = "com.louvaio.mobile/ministry_audio_player"
    }
}
