package com.louvaio.louvaio_mobile.ministryaudio

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/** Outbound events (state changes). May be called from any thread. */
fun interface MinistryBridgeEvents {
    fun emit(event: Map<String, Any?>)
}

/** Optional MP3 capability (experimental): decoder, per-device calibration gate and free-space source. */
class Mp3Support(
    val decoder: Mp3PcmDecoder,
    val calibration: Mp3Gate,
    val usableSpace: (File) -> Long = { it.usableSpace },
)

/**
 * Typed command surface between Flutter and [MinistryAudioEngine].
 *
 * Security model:
 * * Flutter never sends a path. It sends opaque identifiers
 *   (`userId`, `ministryId`, `recordingId`) that are validated against strict
 *   patterns; the directory is rebuilt here from the app-private `filesDir`
 *   with the SAME layout the Dart cache uses, then [MinistryAudioPaths]
 *   canonicalizes it (no `..`, no symlink escapes) before any file is opened.
 * * No URL, token or header is accepted (unknown arguments are rejected).
 * * Errors carry only a stable code and a fixed, path-free message.
 *
 * Threading: every state-changing command runs on ONE worker thread (never the
 * main thread; they open files and may wait for the render thread), in order.
 * Pure queries run inline. Each prepared engine belongs to a session id chosen
 * by Flutter; commands for any other id fail with STALE_SESSION and events of a
 * replaced session are dropped.
 */
class MinistryAudioBridge(
    private val filesDir: File,
    private val events: MinistryBridgeEvents,
    private val engineFactory: (MinistryAudioListener) -> MinistryAudioEngine,
    private val mp3: Mp3Support? = null,
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, COMMAND_THREAD).apply { isDaemon = true }
    },
) {
    class Reply(val value: Map<String, Any?>?, val errorCode: String?, val errorMessage: String?) {
        val isOk: Boolean get() = errorCode == null
    }

    private class BridgeSession(val id: String, val engine: MinistryAudioEngine) {
        val gains = DoubleArray(StemId.values().size) { 1.0 }
        val muted = BooleanArray(StemId.values().size)
        val solo = BooleanArray(StemId.values().size)
        @Volatile var master = 1.0
        @Volatile var sampleRate = 0
        @Volatile var frames = 0L

        /** Private decoded PCM of an MP3 recording; deleted only after the engine is confirmed gone. */
        @Volatile var tempDir: File? = null
    }

    private class PrepareToken(val id: String) {
        @Volatile var cancelled = false
    }

    private val lock = Any()
    private var current: BridgeSession? = null
    private var disposed = false

    @Volatile private var preparing: PrepareToken? = null
    private var sweptAll = false

    // ------------------------------------------------------------------ entry

    /** Asynchronous entry point for the platform channel. */
    fun submit(method: String, args: Map<*, *>?, callback: (Reply) -> Unit) {
        if (method == M_CLOSE) cancelPreparing(args)
        if (method == M_SNAPSHOT) {
            callback(run(method, args))
            return
        }
        try {
            executor.execute { callback(run(method, args)) }
        } catch (_: RejectedExecutionException) {
            callback(fail(MinistryAudioException.INVALID_STATE, "Áudio indisponível."))
        }
    }

    /** Synchronous variant (tests). */
    fun callBlocking(method: String, args: Map<*, *>? = null): Reply {
        if (method == M_CLOSE) cancelPreparing(args)
        if (method == M_SNAPSHOT) return run(method, args)
        return try {
            executor.submit<Reply> { run(method, args) }.get()
        } catch (_: RejectedExecutionException) {
            fail(MinistryAudioException.INVALID_STATE, "Áudio indisponível.")
        }
    }

    /** A close for the session whose MP3 is being decoded interrupts the decoding instead of waiting behind it. */
    private fun cancelPreparing(args: Map<*, *>?) {
        val id = args?.get(K_SESSION) as? String ?: return
        preparing?.takeIf { it.id == id }?.cancelled = true
    }

    private fun run(method: String, args: Map<*, *>?): Reply = try {
        Reply(dispatch(method, args ?: emptyMap<String, Any?>()), null, null)
    } catch (e: MinistryAudioException) {
        fail(e.code, e.message ?: "Falha de áudio.")
    } catch (_: Throwable) {
        fail(INTERNAL, "Falha interna de áudio.")
    }

    private fun fail(code: String, message: String) = Reply(null, code, message)

    private fun dispatch(method: String, a: Map<*, *>): Map<String, Any?>? {
        synchronized(lock) { if (disposed) invalid("Áudio encerrado.") }
        return when (method) {
            M_PREPARE -> prepare(a)
            M_CLOSE -> close(a)
            M_PLAY -> with(a, setOf(K_SESSION)) { it.engine.play() }
            M_PAUSE -> with(a, setOf(K_SESSION)) { it.engine.pause() }
            M_RESUME -> with(a, setOf(K_SESSION)) { it.engine.resume() }
            M_STOP -> with(a, setOf(K_SESSION)) { s ->
                if (!s.engine.stop()) {
                    throw MinistryAudioException(
                        MinistryAudioException.SHUTDOWN_PENDING,
                        "O áudio ainda está encerrando.",
                    )
                }
            }
            M_SEEK -> with(a, setOf(K_SESSION, K_FRAME)) { it.engine.seekToFrame(longArg(a, K_FRAME)) }
            M_SET_GAIN -> with(a, setOf(K_SESSION, K_STEM, K_VALUE)) {
                val stem = stemArg(a)
                val v = unitArg(a, K_VALUE)
                it.engine.setTrackGain(stem, v.toFloat())
                it.gains[stem.ordinal] = v
            }
            M_SET_MUTED -> with(a, setOf(K_SESSION, K_STEM, K_ENABLED)) {
                val stem = stemArg(a)
                val v = boolArg(a, K_ENABLED)
                it.engine.setTrackMuted(stem, v)
                it.muted[stem.ordinal] = v
            }
            M_SET_SOLO -> with(a, setOf(K_SESSION, K_STEM, K_ENABLED)) {
                val stem = stemArg(a)
                val v = boolArg(a, K_ENABLED)
                it.engine.setTrackSolo(stem, v)
                it.solo[stem.ordinal] = v
            }
            M_SET_MASTER -> with(a, setOf(K_SESSION, K_VALUE)) {
                val v = unitArg(a, K_VALUE)
                it.engine.setMasterVolume(v.toFloat())
                it.master = v
            }
            M_SNAPSHOT -> snapshot(a)
            else -> throw MinistryAudioException(MinistryAudioException.UNKNOWN_COMMAND, "Comando desconhecido.")
        }
    }

    // --------------------------------------------------------------- commands

    private fun prepare(a: Map<*, *>): Map<String, Any?> {
        val isMp3 = a.containsKey(K_CODEC)
        exactKeys(
            a,
            if (isMp3) setOf(K_SESSION, K_USER, K_MINISTRY, K_RECORDING, K_RATE, K_FRAMES, K_CODEC, K_DELAY, K_PADDING, K_MPEG)
            else setOf(K_SESSION, K_USER, K_MINISTRY, K_RECORDING, K_RATE, K_FRAMES),
        )
        val id = sessionIdArg(a)
        val user = idArg(a, K_USER)
        val ministry = idArg(a, K_MINISTRY)
        val recording = a[K_RECORDING] as? String
        if (recording == null || !RECORDING_ID.matches(recording)) arg("recordingId inválido.")
        val rate = longArg(a, K_RATE)
        val frames = longArg(a, K_FRAMES)
        if (rate !in 8_000L..48_000L || frames <= 0L) arg("Manifesto de áudio inválido.")
        var alignment: Mp3Alignment? = null
        if (isMp3) {
            if (a[K_CODEC] != MP3_CODEC) throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "Codec não suportado.")
            if (rate != 44_100L && rate != 48_000L || frames > rate * 300L) arg("Manifesto de áudio inválido.")
            val al = Mp3Alignment(
                longArg(a, K_DELAY).coerceIn(-1L, 1_000_000L).toInt(),
                longArg(a, K_PADDING).coerceIn(-1L, 1_000_000L).toInt(),
                longArg(a, K_MPEG).coerceIn(-1L, 1_000_000L).toInt(),
            )
            if (!al.isConsistent(frames)) arg("Alinhamento MP3 inválido.")
            alignment = al
        }

        // A previous session must be CONFIRMED closed (worker gone, files
        // closed) before anything new is opened.
        val previous = synchronized(lock) { current }
        if (previous != null) {
            if (!closeSession(previous)) {
                throw MinistryAudioException(
                    MinistryAudioException.SHUTDOWN_PENDING,
                    "O áudio anterior ainda está encerrando.",
                )
            }
            synchronized(lock) { if (current === previous) current = null }
        }

        val ministryRoot = File(
            File(filesDir, "$LIB_DIR/$LAYOUT_DIR/users/${namespace(USER_DOMAIN, user)}/ministries"),
            namespace(MINISTRY_DOMAIN, ministry),
        )
        val directory = File(ministryRoot, "recordings/$recording")

        // Nothing is open at this point: stale decoded PCM (process death, unconfirmed shutdown) is ours to remove.
        sweepTemp(ministryRoot)

        var loadDir = directory
        var tempDir: File? = null
        if (alignment != null) {
            val support = mp3 ?: throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "MP3 indisponível.")
            val token = PrepareToken(id)
            preparing = token
            try {
                support.calibration.requireVerified()
                val dir = File(File(ministryRoot, TEMP_DIR), id)
                tempDir = dir
                decodeStems(support, directory, ministryRoot, dir, rate.toInt(), frames, alignment, token)
                loadDir = dir
            } catch (e: Throwable) {
                tempDir?.let { deleteTree(it) } // no engine holds these files yet
                throw e
            } finally {
                preparing = null
            }
        }

        var ref: BridgeSession? = null
        val engine = engineFactory { state, code ->
            val own = ref
            val s = synchronized(lock) { current }
            // Events of a replaced / closed session are dropped (`own` is
            // still null for the events emitted while loading).
            if (own == null || (s != null && s === own)) {
                events.emit(
                    mapOf(
                        "event" to "state",
                        K_SESSION to id,
                        "state" to state.name.lowercase(),
                        "errorCode" to code,
                    ),
                )
            }
        }
        val session = BridgeSession(id, engine)
        session.tempDir = tempDir
        synchronized(lock) { current = session }
        ref = session
        try {
            val h = engine.load(loadDir, ministryRoot, rate.toInt(), frames)
            session.sampleRate = h.sampleRate
            session.frames = h.frames
        } catch (e: Throwable) {
            val confirmed = runCatching { engine.dispose() }.getOrDefault(false)
            if (confirmed) {
                tempDir?.let { deleteTree(it) }
                synchronized(lock) { if (current === session) current = null }
            }
            throw e
        }
        return mapOf(K_SESSION to id, "sampleRate" to session.sampleRate, "frames" to session.frames)
    }

    private fun close(a: Map<*, *>): Map<String, Any?> {
        exactKeys(a, setOf(K_SESSION))
        val id = sessionIdArg(a)
        val s = synchronized(lock) { current }
        if (s == null || s.id != id) return mapOf("closed" to true) // already gone
        val closed = closeSession(s)
        if (closed) synchronized(lock) { if (current === s) current = null }
        return mapOf("closed" to closed)
    }

    /** True only when the worker is gone and the files are closed. */
    private fun closeSession(s: BridgeSession): Boolean {
        val ok = runCatching { s.engine.dispose() }.getOrDefault(false)
        // Decoded PCM is deleted ONLY once the engine is confirmed gone (files closed).
        if (ok) s.tempDir?.let {
            deleteTree(it)
            s.tempDir = null
        }
        return ok
    }

    // ------------------------------------------------------- MP3 decoded PCM

    /**
     * Decodes the six stems one at a time into [dir]/stem_<id>.wav. Each stem is written as `.part` and renamed only
     * when complete and exactly sized, so the engine never sees a partial set. Reserves space first.
     */
    private fun decodeStems(
        support: Mp3Support,
        source: File,
        allowedRoot: File,
        dir: File,
        rate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        token: PrepareToken,
    ) {
        val files = MinistryAudioPaths.resolve(source, allowedRoot, "mp3")
        val perStem = WavV1.HEADER_BYTES + frames * WavV1.BYTES_PER_FRAME
        val needed = perStem * StemId.values().size + SPACE_RESERVE_BYTES
        dir.mkdirs()
        if (!dir.isDirectory) throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Pasta temporária indisponível.")
        if (support.usableSpace(dir) < needed) {
            throw MinistryAudioException(MinistryAudioException.INSUFFICIENT_SPACE, "Espaço insuficiente para preparar o áudio.")
        }
        for (stem in StemId.values()) {
            if (token.cancelled) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
            val part = File(dir, "${stem.fileName}.part")
            Mp3StemDecoder.decodeToWav(files.getValue(stem), part, rate, frames, alignment, support.decoder) { token.cancelled }
            if (!part.renameTo(File(dir, stem.fileName))) {
                part.delete()
                throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Falha ao gravar o áudio temporário.")
            }
        }
    }

    /** Removes decoded PCM of this ministry (and, once per process, of every account/ministry we own). */
    private fun sweepTemp(ministryRoot: File) {
        deleteTree(File(ministryRoot, TEMP_DIR))
        val all = synchronized(lock) { if (sweptAll) false else { sweptAll = true; true } }
        if (!all) return
        val users = File(filesDir, "$LIB_DIR/$LAYOUT_DIR/users")
        users.listFiles()?.forEach { u ->
            File(u, "ministries").listFiles()?.forEach { m -> deleteTree(File(m, TEMP_DIR)) }
        }
    }

    private fun deleteTree(f: File) {
        if (!f.exists()) return
        runCatching {
            // Never follow links out of our private tree.
            if (java.nio.file.Files.isSymbolicLink(f.toPath())) {
                f.delete()
                return
            }
            f.listFiles()?.forEach { deleteTree(it) }
            f.delete()
        }
    }

    private fun with(
        a: Map<*, *>,
        keys: Set<String>,
        block: (BridgeSession) -> Unit,
    ): Map<String, Any?> {
        exactKeys(a, keys)
        val s = requireCurrent(sessionIdArg(a))
        block(s)
        return mapOf(K_SESSION to s.id)
    }

    private fun snapshot(a: Map<*, *>): Map<String, Any?> {
        exactKeys(a, setOf(K_SESSION))
        val s = requireCurrent(sessionIdArg(a))
        val e = s.engine
        return mapOf(
            K_SESSION to s.id,
            "state" to e.state.name.lowercase(),
            "errorCode" to e.lastErrorCode,
            "positionFrames" to e.positionFrames,
            "durationFrames" to s.frames,
            "sampleRate" to s.sampleRate,
            "gains" to s.gains.toList(),
            "muted" to s.muted.toList(),
            "solo" to s.solo.toList(),
            "master" to s.master,
        )
    }

    private fun requireCurrent(id: String): BridgeSession {
        val s = synchronized(lock) { current }
        if (s == null || s.id != id) {
            throw MinistryAudioException(MinistryAudioException.STALE_SESSION, "Sessão de áudio encerrada.")
        }
        return s
    }

    // ------------------------------------------------------------- lifecycle

    /** Stops playback of the current session (app left the foreground). */
    fun stopCurrentAsync() {
        try {
            executor.execute {
                val s = synchronized(lock) { current }
                if (s != null) runCatching { s.engine.stop() }
            }
        } catch (_: RejectedExecutionException) {
        }
    }

    /**
     * Closes everything (Activity destroyed). Runs on the worker so the main
     * thread never waits. Returns false when the worker could not be confirmed
     * gone; the engine then closes its own files when the thread ends.
     */
    fun dispose(): Boolean {
        synchronized(lock) { disposed = true }
        preparing?.cancelled = true
        val result = try {
            executor.submit<Boolean> {
                val s = synchronized(lock) { current }
                val ok = s?.let { closeSession(it) } ?: true
                synchronized(lock) { if (ok) current = null }
                ok
            }.get(DISPOSE_WAIT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (_: Throwable) {
            false
        }
        executor.shutdown()
        return result
    }

    // ------------------------------------------------------------ validation

    private fun exactKeys(a: Map<*, *>, allowed: Set<String>) {
        for (k in a.keys) if (k !is String || k !in allowed) arg("Argumento não permitido.")
        for (k in allowed) if (!a.containsKey(k) || a[k] == null) arg("Argumento obrigatório ausente.")
    }

    private fun sessionIdArg(a: Map<*, *>): String {
        val v = a[K_SESSION] as? String
        if (v == null || !SESSION_ID.matches(v)) arg("sessionId inválido.")
        return v
    }

    private fun idArg(a: Map<*, *>, key: String): String {
        val v = a[key] as? String
        if (v == null || !ID.matches(v)) arg("Identificador inválido.")
        return v
    }

    private fun longArg(a: Map<*, *>, key: String): Long {
        val v = a[key]
        if (v !is Int && v !is Long && v !is Short) arg("Número inteiro esperado.")
        return (v as Number).toLong()
    }

    private fun unitArg(a: Map<*, *>, key: String): Double {
        val v = (a[key] as? Number)?.toDouble()
        if (v == null || v.isNaN() || v.isInfinite() || v < 0.0 || v > 1.0) arg("Valor fora de 0..1.")
        return v
    }

    private fun boolArg(a: Map<*, *>, key: String): Boolean =
        a[key] as? Boolean ?: arg("Booleano esperado.")

    private fun stemArg(a: Map<*, *>): StemId {
        val v = a[K_STEM] as? String
        return StemId.values().firstOrNull { it.wireName == v } ?: arg("Faixa inválida.")
    }

    private fun arg(message: String): Nothing =
        throw MinistryAudioException(MinistryAudioException.INVALID_ARGUMENT, message)

    private fun invalid(message: String): Nothing =
        throw MinistryAudioException(MinistryAudioException.INVALID_STATE, message)

    private fun namespace(domain: String, id: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest((domain + id).toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val COMMAND_THREAD = "ministry-audio-command"
        const val INTERNAL = "AUDIO_NATIVE_INTERNAL"

        const val M_PREPARE = "prepare"
        const val M_CLOSE = "close"
        const val M_PLAY = "play"
        const val M_PAUSE = "pause"
        const val M_RESUME = "resume"
        const val M_STOP = "stop"
        const val M_SEEK = "seek"
        const val M_SET_GAIN = "setTrackGain"
        const val M_SET_MUTED = "setTrackMuted"
        const val M_SET_SOLO = "setTrackSolo"
        const val M_SET_MASTER = "setMasterVolume"
        const val M_SNAPSHOT = "snapshot"

        private const val K_SESSION = "sessionId"
        private const val K_USER = "userId"
        private const val K_MINISTRY = "ministryId"
        private const val K_RECORDING = "recordingId"
        private const val K_RATE = "sampleRate"
        private const val K_FRAMES = "frames"
        private const val K_CODEC = "codec"
        private const val K_DELAY = "encoderDelayFrames"
        private const val K_PADDING = "paddingFrames"
        private const val K_MPEG = "mpegAudioFrames"
        const val MP3_CODEC = "mp3_cbr256"
        const val TEMP_DIR = "pcm_tmp"
        private const val SPACE_RESERVE_BYTES = 64L * 1024 * 1024
        private const val K_FRAME = "frame"
        private const val K_STEM = "stem"
        private const val K_VALUE = "value"
        private const val K_ENABLED = "enabled"

        // Same layout/domains as the Dart MinistryAudioStorageStatus.
        private const val LIB_DIR = "ministry_audio_library"
        private const val LAYOUT_DIR = "v1"
        private const val USER_DOMAIN = "louvaio-ministry-audio-user-v1:"
        private const val MINISTRY_DOMAIN = "louvaio-ministry-audio-ministry-v1:"
        private const val DISPOSE_WAIT_MS = 4_000L

        private val SESSION_ID = Regex("^[A-Za-z0-9_-]{8,64}$")
        private val ID = Regex("^[A-Za-z0-9_-]{1,128}$")
        private val RECORDING_ID = Regex("^[a-f0-9]{64}$")
    }
}
