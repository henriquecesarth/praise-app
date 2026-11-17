package com.louvaio.louvaio_mobile.audio

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Intent
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.OperationCanceledException
import android.os.StatFs
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.ErrnoException
import android.system.OsConstants
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class RehearsalPackageSafHandler(private val activity: Activity) {

    companion object {
        const val CHANNEL_NAME = "com.louvaio.mobile/rehearsal_package_saf"
        const val REQ_PICK_REHEARSAL_PACKAGE = 8811
        const val REQ_EXPORT_REHEARSAL_PACKAGE = 8812

        const val DEFAULT_MAX_BYTES = 2147483648L // 2 GiB
        const val DEFAULT_REQUIRED_RESERVE_BYTES = 268435456L // 256 MiB

        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val PROGRESS_BYTE_INTERVAL = 512L * 1024L
        private const val PROGRESS_TIME_INTERVAL_MS = 100L
        private const val RESERVE_CHECK_INTERVAL_BYTES = 2L * 1024L * 1024L
        private const val EXPORT_EXTENSION = ".louvaio-rehearsal.zip"

        fun sanitizeExportFileName(rawName: String?): String {
            val base = (rawName ?: "")
                .substringAfterLast('/')
                .substringAfterLast('\\')
                .replace(Regex("[\\u0000-\\u001F\\u007F]"), "")
                .replace(Regex("[<>:\"|?*]"), "_")
                .trim()
                .trim('.', '_')

            val withoutExt = when {
                base.endsWith(EXPORT_EXTENSION, ignoreCase = true) ->
                    base.dropLast(EXPORT_EXTENSION.length)
                base.endsWith(".zip", ignoreCase = true) ->
                    base.dropLast(4)
                else -> base
            }.trim('.', '_').take(80)

            val stem = if (withoutExt.isEmpty()) "ensaio_louvaio" else withoutExt
            return "$stem$EXPORT_EXTENSION"
        }

        internal fun isInsideFilesDir(candidateCanonical: File, filesCanonical: File): Boolean {
            val prefix = filesCanonical.path.let {
                if (it.endsWith(File.separator)) it else it + File.separator
            }
            return candidateCanonical.path.startsWith(prefix)
        }
    }

    private sealed class PendingRequest(
        val operationId: String,
        val signal: CancellationSignal,
        val result: MethodChannel.Result,
    ) {
        class Pick(
            operationId: String,
            val targetCanonical: File,
            val filesCanonical: File,
            val maxBytes: Long,
            val requiredReserveBytes: Long,
            signal: CancellationSignal,
            result: MethodChannel.Result,
        ) : PendingRequest(operationId, signal, result)

        class Export(
            operationId: String,
            val sourceCanonical: File,
            signal: CancellationSignal,
            result: MethodChannel.Result,
        ) : PendingRequest(operationId, signal, result)
    }

    private class StageAbortException(
        val code: String,
        override val message: String,
    ) : Exception(message)

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "rehearsal-package-saf-io").apply { isDaemon = true }
    }
    private val activeOperations = ConcurrentHashMap<String, CancellationSignal>()

    private var channel: MethodChannel? = null
    private var pendingRequest: PendingRequest? = null

    @Volatile
    private var destroyed = false

    fun attachChannel(methodChannel: MethodChannel) {
        channel = methodChannel
        methodChannel.setMethodCallHandler { call, result ->
            handleMethodCall(call, result)
        }
    }

    fun handleMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (destroyed) {
            result.error("HANDLER_DISPOSED", "Manipulador SAF foi encerrado.", null)
            return
        }

        when (call.method) {
            "getStorageInfo" -> handleGetStorageInfo(result)
            "pickAndStagePackage" -> handlePickAndStagePackage(call, result)
            "exportPackageToUri" -> handleExportPackageToUri(call, result)
            "cancelOperation" -> handleCancelOperation(call, result)
            else -> result.notImplemented()
        }
    }

    private fun handleGetStorageInfo(result: MethodChannel.Result) {
        try {
            val filesDir = ensureFilesDirCanonical()
            val statFs = StatFs(filesDir.path)
            result.success(
                mapOf(
                    "filesDirPath" to filesDir.canonicalPath,
                    "availableBytes" to statFs.availableBytes,
                    "totalBytes" to statFs.totalBytes,
                ),
            )
        } catch (ex: Exception) {
            result.error(
                "STORAGE_INFO_FAILED",
                ex.message ?: "Não foi possível consultar o armazenamento interno.",
                null,
            )
        }
    }

    private fun handlePickAndStagePackage(call: MethodCall, result: MethodChannel.Result) {
        val operationId = call.argument<String>("operationId")?.trim()
        val targetStageFilePath = call.argument<String>("targetStageFilePath")?.trim()
        val maxBytes = call.argument<Number>("maxBytes")?.toLong() ?: DEFAULT_MAX_BYTES
        val requiredReserveBytes =
            call.argument<Number>("requiredReserveBytes")?.toLong() ?: DEFAULT_REQUIRED_RESERVE_BYTES

        if (operationId.isNullOrEmpty() || targetStageFilePath.isNullOrEmpty() || maxBytes <= 0L || requiredReserveBytes < 0L) {
            result.error(
                "INVALID_ARGUMENTS",
                "Parâmetros inválidos para pickAndStagePackage.",
                null,
            )
            return
        }

        val filesCanonical: File
        val targetCanonical: File
        try {
            filesCanonical = ensureFilesDirCanonical()
            targetCanonical = File(targetStageFilePath).canonicalFile
        } catch (ex: IOException) {
            result.error(
                "INVALID_TARGET_PATH",
                ex.message ?: "Target staging path must reside inside app-private filesDir",
                null,
            )
            return
        }

        if (!isInsideFilesDir(targetCanonical, filesCanonical) || (targetCanonical.exists() && targetCanonical.isDirectory)) {
            result.error(
                "INVALID_TARGET_PATH",
                "Target staging path must reside inside app-private filesDir",
                null,
            )
            return
        }

        if (pendingRequest != null || activeOperations.isNotEmpty()) {
            result.error(
                "OPERATION_IN_PROGRESS",
                "Já existe uma operação SAF em andamento.",
                null,
            )
            return
        }

        val signal = CancellationSignal()
        activeOperations[operationId] = signal
        pendingRequest = PendingRequest.Pick(
            operationId = operationId,
            targetCanonical = targetCanonical,
            filesCanonical = filesCanonical,
            maxBytes = maxBytes,
            requiredReserveBytes = requiredReserveBytes,
            signal = signal,
            result = result,
        )

        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf(
                    "application/zip",
                    "application/octet-stream",
                    "application/x-zip-compressed",
                ),
            )
        }

        try {
            activity.startActivityForResult(intent, REQ_PICK_REHEARSAL_PACKAGE)
        } catch (ex: Exception) {
            pendingRequest = null
            activeOperations.remove(operationId, signal)
            val code = if (ex is ActivityNotFoundException) "PICKER_UNAVAILABLE" else "PICKER_LAUNCH_FAILED"
            result.error(code, ex.message ?: "Não foi possível abrir o seletor de arquivos.", null)
        }
    }

    private fun handleExportPackageToUri(call: MethodCall, result: MethodChannel.Result) {
        val operationId = call.argument<String>("operationId")?.trim()
        val sourceFilePath = call.argument<String>("sourceFilePath")?.trim()
        val suggestedFileName = call.argument<String>("suggestedFileName")

        if (operationId.isNullOrEmpty() || sourceFilePath.isNullOrEmpty()) {
            result.error(
                "INVALID_ARGUMENTS",
                "Parâmetros inválidos para exportPackageToUri.",
                null,
            )
            return
        }

        val filesCanonical: File
        val sourceCanonical: File
        try {
            filesCanonical = ensureFilesDirCanonical()
            sourceCanonical = File(sourceFilePath).canonicalFile
        } catch (ex: IOException) {
            result.error(
                "INVALID_SOURCE_PATH",
                ex.message ?: "Source file path must reside inside app-private filesDir",
                null,
            )
            return
        }

        if (!isInsideFilesDir(sourceCanonical, filesCanonical)) {
            result.error(
                "INVALID_SOURCE_PATH",
                "Source file path must reside inside app-private filesDir",
                null,
            )
            return
        }

        if (!sourceCanonical.exists() || !sourceCanonical.isFile) {
            result.error(
                "SOURCE_NOT_FOUND",
                "Arquivo de pacote para exportação não encontrado.",
                null,
            )
            return
        }

        if (pendingRequest != null || activeOperations.isNotEmpty()) {
            result.error(
                "OPERATION_IN_PROGRESS",
                "Já existe uma operação SAF em andamento.",
                null,
            )
            return
        }

        val safeTitle = sanitizeExportFileName(suggestedFileName)
        val signal = CancellationSignal()
        activeOperations[operationId] = signal
        pendingRequest = PendingRequest.Export(
            operationId = operationId,
            sourceCanonical = sourceCanonical,
            signal = signal,
            result = result,
        )

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/zip"
            putExtra(Intent.EXTRA_TITLE, safeTitle)
        }

        try {
            activity.startActivityForResult(intent, REQ_EXPORT_REHEARSAL_PACKAGE)
        } catch (ex: Exception) {
            pendingRequest = null
            activeOperations.remove(operationId, signal)
            val code = if (ex is ActivityNotFoundException) "PICKER_UNAVAILABLE" else "PICKER_LAUNCH_FAILED"
            result.error(code, ex.message ?: "Não foi possível abrir o seletor de salvamento.", null)
        }
    }

    private fun handleCancelOperation(call: MethodCall, result: MethodChannel.Result) {
        val operationId = call.argument<String>("operationId")?.trim()
        if (operationId.isNullOrEmpty()) {
            activeOperations.values.forEach { it.cancel() }
            pendingRequest?.signal?.cancel()
        } else {
            activeOperations[operationId]?.cancel()
            pendingRequest?.takeIf { it.operationId == operationId }?.signal?.cancel()
        }
        result.success(true)
    }

    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQ_PICK_REHEARSAL_PACKAGE && requestCode != REQ_EXPORT_REHEARSAL_PACKAGE) {
            return false
        }

        val request = pendingRequest
        pendingRequest = null
        if (request == null) {
            return true
        }

        val expectedType = when (requestCode) {
            REQ_PICK_REHEARSAL_PACKAGE -> request is PendingRequest.Pick
            REQ_EXPORT_REHEARSAL_PACKAGE -> request is PendingRequest.Export
            else -> false
        }
        if (!expectedType) {
            activeOperations.remove(request.operationId, request.signal)
            if (!destroyed) {
                request.result.success(mapOf("status" to "cancelled"))
            }
            return true
        }

        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null || request.signal.isCanceled || destroyed) {
            activeOperations.remove(request.operationId, request.signal)
            if (!destroyed) {
                request.result.success(mapOf("status" to "cancelled"))
            }
            return true
        }

        try {
            ioExecutor.execute {
                val payload = try {
                    when (request) {
                        is PendingRequest.Pick -> executeStagingCopy(request, uri)
                        is PendingRequest.Export -> executeExportCopy(request, uri)
                    }
                } finally {
                    activeOperations.remove(request.operationId, request.signal)
                }

                mainHandler.post {
                    if (!destroyed) {
                        request.result.success(payload)
                    }
                }
            }
        } catch (_: RejectedExecutionException) {
            activeOperations.remove(request.operationId, request.signal)
            if (!destroyed) {
                request.result.success(mapOf("status" to "cancelled"))
            }
        }

        return true
    }

    private fun executeStagingCopy(request: PendingRequest.Pick, uri: Uri): Map<String, Any?> {
        val resolver = activity.applicationContext.contentResolver
        val signal = request.signal
        val targetCanonical = request.targetCanonical
        val filesCanonical = request.filesCanonical

        try {
            checkCancelled(signal)

            var displayName: String? = null
            var declaredSize: Long? = null
            try {
                resolver.query(
                    uri,
                    arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                    null,
                    null,
                    null,
                )?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                            displayName = cursor.getString(nameIdx)
                        }
                        val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                            val rawSize = cursor.getLong(sizeIdx)
                            if (rawSize >= 0L) {
                                declaredSize = rawSize
                            }
                        }
                    }
                }
            } catch (ex: SecurityException) {
                throw ex
            } catch (ex: OperationCanceledException) {
                throw ex
            } catch (_: Exception) {
                // Metadata columns are untrusted optional hints; proceed cleanly if omitted by provider.
            }

            if (!filesCanonical.exists()) {
                filesCanonical.mkdirs()
            }
            val preCopyAvailable = StatFs(filesCanonical.path).availableBytes
            if (preCopyAvailable < request.requiredReserveBytes) {
                return errorMap(
                    "INSUFFICIENT_STORAGE",
                    "Espaço livre insuficiente para iniciar importação segura.",
                )
            }
            val sizeHint = declaredSize
            if (sizeHint != null && sizeHint > request.maxBytes) {
                return errorMap(
                    "PACKAGE_TOO_LARGE",
                    "Arquivo selecionado excede o limite de 2 GiB.",
                )
            }
            if (sizeHint != null && sizeHint > 0L && preCopyAvailable < sizeHint + request.requiredReserveBytes) {
                return errorMap(
                    "INSUFFICIENT_STORAGE",
                    "Espaço disponível insuficiente com reserva de segurança obrigatória.",
                )
            }

            val parentDir = targetCanonical.parentFile
            if (parentDir != null && !parentDir.exists() && !parentDir.mkdirs()) {
                throw IOException("Não foi possível criar diretório de staging.")
            }

            var bytesCopied = 0L
            var lastReserveCheckBytes = 0L
            var lastProgressBytes = 0L
            var lastProgressMs = SystemClock.uptimeMillis()

            openInputStreamWithCancellation(resolver, uri, signal).use { input ->
                FileOutputStream(targetCanonical).use { output ->
                    val buffer = ByteArray(COPY_BUFFER_SIZE)
                    while (true) {
                        checkCancelled(signal)
                        val read = input.read(buffer)
                        if (read == -1) break
                        if (read == 0) continue

                        bytesCopied += read
                        if (bytesCopied > request.maxBytes) {
                            throw StageAbortException(
                                "PACKAGE_TOO_LARGE",
                                "Fluxo excedeu o limite máximo de 2 GiB (tamanho declarado possivelmente falsificado).",
                            )
                        }

                        output.write(buffer, 0, read)

                        if (bytesCopied - lastReserveCheckBytes >= RESERVE_CHECK_INTERVAL_BYTES) {
                            lastReserveCheckBytes = bytesCopied
                            if (StatFs(filesCanonical.path).availableBytes < request.requiredReserveBytes) {
                                throw StageAbortException(
                                    "INSUFFICIENT_STORAGE",
                                    "Reserva mínima de espaço em disco atingida durante cópia.",
                                )
                            }
                        }

                        val now = SystemClock.uptimeMillis()
                        if (bytesCopied - lastProgressBytes >= PROGRESS_BYTE_INTERVAL ||
                            now - lastProgressMs >= PROGRESS_TIME_INTERVAL_MS
                        ) {
                            lastProgressBytes = bytesCopied
                            lastProgressMs = now
                            emitProgress(
                                operationId = request.operationId,
                                phase = "staging_copy",
                                bytesProcessed = bytesCopied,
                                totalBytes = sizeHint,
                                signal = signal,
                            )
                        }
                    }

                    checkCancelled(signal)
                    if (bytesCopied == 0L) {
                        throw StageAbortException(
                            "EMPTY_OR_CORRUPTED",
                            "O arquivo selecionado está vazio ou não pôde ser lido.",
                        )
                    }

                    output.flush()
                    output.fd.sync()
                }
            }

            val availableBytesAfter = StatFs(filesCanonical.path).availableBytes
            if (availableBytesAfter < request.requiredReserveBytes) {
                deleteFileQuietly(targetCanonical)
                return errorMap(
                    "INSUFFICIENT_STORAGE",
                    "Reserva mínima de espaço em disco atingida durante cópia.",
                )
            }

            if (bytesCopied > lastProgressBytes) {
                emitProgress(
                    operationId = request.operationId,
                    phase = "staging_copy",
                    bytesProcessed = bytesCopied,
                    totalBytes = sizeHint ?: bytesCopied,
                    signal = signal,
                )
            }

            return mapOf(
                "status" to "staged",
                "stagedFilePath" to targetCanonical.path,
                "bytesCopied" to bytesCopied,
                "untrustedDisplayName" to displayName,
                "untrustedDeclaredSize" to declaredSize,
                "availableBytesAfter" to availableBytesAfter,
            )
        } catch (_: OperationCanceledException) {
            deleteFileQuietly(targetCanonical)
            return mapOf("status" to "cancelled")
        } catch (ex: StageAbortException) {
            deleteFileQuietly(targetCanonical)
            return errorMap(ex.code, ex.message)
        } catch (_: SecurityException) {
            deleteFileQuietly(targetCanonical)
            return errorMap(
                "PERMISSION_DENIED",
                "Permissão negada ou revogada pelo provedor de documentos.",
            )
        } catch (_: FileNotFoundException) {
            deleteFileQuietly(targetCanonical)
            return errorMap(
                "SOURCE_UNAVAILABLE",
                "Arquivo movido, removido ou indisponível no provedor.",
            )
        } catch (ex: IOException) {
            deleteFileQuietly(targetCanonical)
            return if (isEnospc(ex)) {
                errorMap(
                    "INSUFFICIENT_STORAGE",
                    "Espaço em disco esgotado durante a cópia do pacote.",
                )
            } else {
                errorMap(
                    "READ_INTERRUPTED",
                    "Leitura do arquivo interrompida antes da conclusão.",
                )
            }
        } catch (ex: Exception) {
            deleteFileQuietly(targetCanonical)
            return errorMap(
                "READ_INTERRUPTED",
                ex.message ?: "Falha inesperada ao ler arquivo selecionado.",
            )
        }
    }

    private fun executeExportCopy(request: PendingRequest.Export, destUri: Uri): Map<String, Any?> {
        val resolver = activity.applicationContext.contentResolver
        val signal = request.signal
        val sourceCanonical = request.sourceCanonical

        try {
            checkCancelled(signal)
            if (!sourceCanonical.exists() || !sourceCanonical.isFile) {
                return errorMap(
                    "SOURCE_NOT_FOUND",
                    "Arquivo de pacote para exportação não encontrado.",
                )
            }

            val totalBytes = sourceCanonical.length()
            var totalWritten = 0L
            var lastProgressBytes = 0L
            var lastProgressMs = SystemClock.uptimeMillis()

            FileInputStream(sourceCanonical).use { input ->
                openOutputStreamWithCancellation(resolver, destUri, signal).use { output ->
                    val buffer = ByteArray(COPY_BUFFER_SIZE)
                    while (true) {
                        checkCancelled(signal)
                        val read = input.read(buffer)
                        if (read == -1) break
                        if (read == 0) continue

                        output.write(buffer, 0, read)
                        totalWritten += read

                        val now = SystemClock.uptimeMillis()
                        if (totalWritten - lastProgressBytes >= PROGRESS_BYTE_INTERVAL ||
                            now - lastProgressMs >= PROGRESS_TIME_INTERVAL_MS
                        ) {
                            lastProgressBytes = totalWritten
                            lastProgressMs = now
                            emitProgress(
                                operationId = request.operationId,
                                phase = "exporting",
                                bytesProcessed = totalWritten,
                                totalBytes = totalBytes,
                                signal = signal,
                            )
                        }
                    }

                    checkCancelled(signal)
                    output.flush()
                }
            }

            if (totalWritten > lastProgressBytes) {
                emitProgress(
                    operationId = request.operationId,
                    phase = "exporting",
                    bytesProcessed = totalWritten,
                    totalBytes = totalBytes,
                    signal = signal,
                )
            }

            return mapOf(
                "status" to "exported",
                "bytesWritten" to totalWritten,
            )
        } catch (_: OperationCanceledException) {
            deleteDocumentQuietly(resolver, destUri)
            return mapOf("status" to "cancelled")
        } catch (_: SecurityException) {
            deleteDocumentQuietly(resolver, destUri)
            return errorMap(
                "PERMISSION_DENIED",
                "Permissão negada ou revogada pelo provedor de destino.",
            )
        } catch (_: FileNotFoundException) {
            deleteDocumentQuietly(resolver, destUri)
            return errorMap(
                "DESTINATION_UNAVAILABLE",
                "Destino indisponível para gravação.",
            )
        } catch (ex: IOException) {
            deleteDocumentQuietly(resolver, destUri)
            return if (isEnospc(ex)) {
                errorMap(
                    "INSUFFICIENT_STORAGE",
                    "Espaço em disco esgotado ao exportar o pacote.",
                )
            } else {
                errorMap(
                    "WRITE_INTERRUPTED",
                    "Gravação do arquivo interrompida antes da conclusão.",
                )
            }
        } catch (ex: Exception) {
            deleteDocumentQuietly(resolver, destUri)
            return errorMap(
                "WRITE_INTERRUPTED",
                ex.message ?: "Falha inesperada ao exportar o pacote.",
            )
        }
    }

    private fun openInputStreamWithCancellation(
        resolver: ContentResolver,
        uri: Uri,
        signal: CancellationSignal,
    ): InputStream {
        val afd: AssetFileDescriptor? = try {
            resolver.openAssetFileDescriptor(uri, "r", signal)
        } catch (_: UnsupportedOperationException) {
            null
        }
        if (afd != null) {
            try {
                return afd.createInputStream()
            } catch (ex: Throwable) {
                try {
                    afd.close()
                } catch (_: Exception) {
                }
                throw ex
            }
        }
        return resolver.openInputStream(uri)
            ?: throw FileNotFoundException("Provedor retornou fluxo de entrada nulo.")
    }

    private fun openOutputStreamWithCancellation(
        resolver: ContentResolver,
        uri: Uri,
        signal: CancellationSignal,
    ): OutputStream {
        val afd: AssetFileDescriptor? = try {
            resolver.openAssetFileDescriptor(uri, "wt", signal)
        } catch (_: UnsupportedOperationException) {
            null
        } catch (_: IllegalArgumentException) {
            try {
                resolver.openAssetFileDescriptor(uri, "w", signal)
            } catch (_: UnsupportedOperationException) {
                null
            }
        }
        if (afd != null) {
            try {
                return afd.createOutputStream()
            } catch (ex: Throwable) {
                try {
                    afd.close()
                } catch (_: Exception) {
                }
                throw ex
            }
        }
        return try {
            resolver.openOutputStream(uri, "wt")
        } catch (_: IllegalArgumentException) {
            resolver.openOutputStream(uri, "w")
        } ?: throw FileNotFoundException("Provedor retornou fluxo de saída nulo.")
    }

    private fun emitProgress(
        operationId: String,
        phase: String,
        bytesProcessed: Long,
        totalBytes: Long?,
        signal: CancellationSignal,
    ) {
        if (destroyed || signal.isCanceled) return
        mainHandler.post {
            if (destroyed || signal.isCanceled) return@post
            channel?.invokeMethod(
                "onOperationProgress",
                mapOf(
                    "operationId" to operationId,
                    "phase" to phase,
                    "bytesProcessed" to bytesProcessed,
                    "totalBytes" to totalBytes,
                ),
            )
        }
    }

    private fun ensureFilesDirCanonical(): File {
        val filesDir = activity.applicationContext.filesDir
        if (!filesDir.exists()) {
            filesDir.mkdirs()
        }
        return filesDir.canonicalFile
    }

    private fun checkCancelled(signal: CancellationSignal) {
        if (destroyed || signal.isCanceled || Thread.currentThread().isInterrupted) {
            throw OperationCanceledException()
        }
    }

    private fun isEnospc(error: Throwable): Boolean {
        var current: Throwable? = error
        var depth = 0
        while (current != null && depth < 10) {
            if (current is ErrnoException && current.errno == OsConstants.ENOSPC) {
                return true
            }
            val msg = current.message
            if (msg != null && (msg.contains("ENOSPC", ignoreCase = true) || msg.contains("No space left", ignoreCase = true))) {
                return true
            }
            current = current.cause
            depth++
        }
        return false
    }

    private fun deleteFileQuietly(file: File) {
        try {
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Exception) {
        }
    }

    private fun deleteDocumentQuietly(resolver: ContentResolver, uri: Uri) {
        try {
            DocumentsContract.deleteDocument(resolver, uri)
        } catch (_: Exception) {
        }
    }

    private fun errorMap(code: String, message: String): Map<String, Any?> = mapOf(
        "status" to "error",
        "code" to code,
        "message" to message,
    )

    fun dispose() {
        destroyed = true
        pendingRequest?.let { req ->
            pendingRequest = null
            req.signal.cancel()
            try {
                req.result.success(mapOf("status" to "cancelled"))
            } catch (_: Exception) {
            }
        }
        activeOperations.values.forEach { it.cancel() }
        activeOperations.clear()
        channel?.setMethodCallHandler(null)
        channel = null
        ioExecutor.shutdownNow()
    }
}
