package com.louvaio.louvaio_mobile

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    companion object {
        private const val CHANNEL = "com.louvaio.louvaio_mobile/share_intent"
    }

    private var shareIntentHandler: ShareIntentHandler? = null
    private var methodChannel: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        shareIntentHandler = ShareIntentHandler(this)
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)

        methodChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "getInitialShare" -> {
                    val payload = shareIntentHandler?.consumeInitialShare(intent)
                    result.success(payload)
                }
                "clearInitialShare" -> {
                    shareIntentHandler?.clearInitialShare()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val payload = shareIntentHandler?.processIntent(intent)
        if (payload != null) {
            methodChannel?.invokeMethod("onShareReceived", payload)
        }
    }
}
