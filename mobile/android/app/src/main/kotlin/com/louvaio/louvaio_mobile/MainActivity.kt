package com.louvaio.louvaio_mobile

import android.content.Intent
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Future
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

class MainActivity : FlutterActivity() {

    companion object {
        private const val CHANNEL = "com.louvaio.louvaio_mobile/share_intent"
        private const val READ_TIMEOUT_MS = 15_000L
        private const val MAX_PENDING_SHARES = 8
    }

    // Keep IO bounded even when a remote provider ignores cancellation.
    private val ioExecutor = boundedExecutor("shared-import-io")
    private val cancellationExecutor = boundedExecutor("shared-import-cancel")
    private val mainHandler = Handler(Looper.getMainLooper())
    private var shareIntentHandler: ShareIntentHandler? = null
    private var methodChannel: MethodChannel? = null
    private val requests = ArrayDeque<ShareRequest>()
    private var initialRequest: ShareRequest? = null
    private var initialConsumed = false
    private var initialResult: MethodChannel.Result? = null
    private var destroyed = false
    private var nextRequestId = 0L

    private class ShareRequest(
        val initial: Boolean,
        val id: String,
        val read: ShareIntentHandler.ReadOperation,
    ) {
        var future: Future<*>? = null
        var timeout: Runnable? = null
        var complete = false
        var payload: Map<String, Any?>? = null
    }

    private fun boundedExecutor(name: String) = ThreadPoolExecutor(
        1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(MAX_PENDING_SHARES),
        { runnable -> Thread(runnable, name).apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    )

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        shareIntentHandler = ShareIntentHandler(applicationContext)
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
        // Capture cold launch before setIntent() can replace it on a warm launch.
        initialRequest = enqueueShare(intent?.let { Intent(it) }, initial = true)

        methodChannel?.setMethodCallHandler { call, result ->
            when (call.method) {
                "getInitialShare" -> {
                    if (initialConsumed || initialResult != null) {
                        result.success(null)
                    } else {
                        initialResult = result
                        drainCompletedShares()
                    }
                }
                "clearInitialShare" -> {
                    initialConsumed = true
                    initialRequest?.let { request ->
                        cancelRead(request)
                        request.payload = null
                        request.complete = true
                    }
                    initialResult?.success(null)
                    initialResult = null
                    drainCompletedShares()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        enqueueShare(Intent(intent), initial = false)
    }

    private fun enqueueShare(intent: Intent?, initial: Boolean): ShareRequest? {
        if (destroyed || (!initial && intent?.action != Intent.ACTION_SEND)) return null
        // Bound retained intents/payloads as well as the executor queue.
        if (requests.size >= MAX_PENDING_SHARES) return null
        val request = ShareRequest(initial, (++nextRequestId).toString(), ShareIntentHandler.ReadOperation())
        requests.addLast(request)
        if (!initial) {
            // Dart binds the request to the current session before provider IO.
            methodChannel?.invokeMethod("onShareStarted", mapOf("requestId" to request.id))
        }
        request.timeout = Runnable {
            if (!request.complete) {
                cancelRead(request)
                finishShare(request, mapOf(
                    "type" to "error",
                    "error" to "FILE_READ_TIMEOUT",
                    "errorMessage" to "O aplicativo de origem demorou para responder. Compartilhe o arquivo novamente.",
                ))
            }
        }.also { mainHandler.postDelayed(it, READ_TIMEOUT_MS) }
        try {
            request.future = ioExecutor.submit {
                val payload = try {
                    shareIntentHandler?.processIntent(intent, request.read)
                } catch (_: Exception) {
                    mapOf(
                        "type" to "error",
                        "error" to "FILE_READ_ERROR",
                        "errorMessage" to "Não foi possível ler o conteúdo compartilhado.",
                    )
                }
                mainHandler.post {
                    if (!destroyed && !request.complete) finishShare(request, payload)
                    else discardFiles(request)
                }
            }
        } catch (_: RejectedExecutionException) {
            cancelRead(request)
            finishShare(request, mapOf(
                "type" to "error",
                "error" to "FILE_READ_UNAVAILABLE",
                "errorMessage" to "A leitura do compartilhamento está ocupada. Tente novamente.",
            ))
        }
        return request
    }

    private fun finishShare(request: ShareRequest, payload: Map<String, Any?>?) {
        request.timeout?.let { mainHandler.removeCallbacks(it) }
        request.complete = true
        request.payload = payload?.plus("requestId" to request.id)
        drainCompletedShares()
    }

    private fun drainCompletedShares() {
        while (requests.isNotEmpty() && requests.first().complete) {
            val request = requests.first()
            if (request.initial && !initialConsumed) {
                val result = initialResult ?: return
                initialConsumed = true
                initialResult = null
                initialRequest = null
                result.success(request.payload)
            } else if (!request.initial && request.payload != null) {
                methodChannel?.invokeMethod("onShareReceived", request.payload)
            }
            requests.removeFirst()
        }
    }

    private fun discardFiles(request: ShareRequest) {
        try {
            cancellationExecutor.execute { request.read.discardFiles() }
        } catch (_: RejectedExecutionException) {
            // A cancelled worker also removes its files when provider IO exits.
        }
    }

    private fun cancelRead(request: ShareRequest) {
        request.timeout?.let { mainHandler.removeCallbacks(it) }
        request.read.markCancelled()
        request.future?.cancel(true)
        ioExecutor.purge()
        try {
            // Provider cancellation/close can block too, so keep them off main.
            cancellationExecutor.execute { request.read.cancelResources() }
        } catch (_: RejectedExecutionException) {
            // The worker checks cancellation before/after IO and cleans up.
        }
    }

    override fun onDestroy() {
        destroyed = true
        methodChannel?.setMethodCallHandler(null)
        requests.forEach { cancelRead(it) }
        requests.clear()
        initialResult?.success(null)
        initialResult = null
        ioExecutor.shutdownNow()
        cancellationExecutor.shutdown()
        super.onDestroy()
    }
}
