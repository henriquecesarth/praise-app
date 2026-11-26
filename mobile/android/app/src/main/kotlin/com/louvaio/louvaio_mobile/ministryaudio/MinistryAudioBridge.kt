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
    /** Stems decoded at the same time. 3 was measured on the TB-J616F; never one codec per stem. 1 = reference. */
    val parallelStems: Int = DEFAULT_PARALLEL_STEMS,
    /** M22-S4.2, experimental: used only when the prepare command asks for it. */
    val incremental: Mp3IncrementalSupport? = null,
) {
    companion object {
        const val DEFAULT_PARALLEL_STEMS = 3
    }
}

/** Streaming MP3 playback: raw window decoder and its own per-device calibration. */
class Mp3IncrementalSupport(
    val decoder: Mp3WindowDecoder,
    val calibration: Mp3Gate,
    val prefillTimeoutMs: Long = 10_000L,
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

    /** Prepares submitted and not finished yet (queued or decoding), so a close/dispose can cancel any of them. */
    private val pendingPrepares = java.util.concurrent.CopyOnWriteArrayList<PrepareToken>()
    private var sweptAll = false

    /** Producers of a failed streaming prepare that could not be confirmed gone: nothing is "closed" until they are. */
    @Volatile
    private var orphan: StreamingFeed? = null

    // ------------------------------------------------------------------ entry

    /** Asynchronous entry point for the platform channel. */
    fun submit(method: String, args: Map<*, *>?, callback: (Reply) -> Unit) {
        if (method == M_CLOSE) cancelPreparing(args)
        if (method == M_SNAPSHOT) {
            callback(run(method, args))
            return
        }
        val token = register(method, args)
        try {
            executor.execute { callback(run(method, args, token)) }
        } catch (_: RejectedExecutionException) {
            token?.let { pendingPrepares.remove(it) }
            callback(fail(MinistryAudioException.INVALID_STATE, "Áudio indisponível."))
        }
    }

    /** Synchronous variant (tests). */
    fun callBlocking(method: String, args: Map<*, *>? = null): Reply {
        if (method == M_CLOSE) cancelPreparing(args)
        if (method == M_SNAPSHOT) return run(method, args)
        val token = register(method, args)
        return try {
            executor.submit<Reply> { run(method, args, token) }.get()
        } catch (_: RejectedExecutionException) {
            token?.let { pendingPrepares.remove(it) }
            fail(MinistryAudioException.INVALID_STATE, "Áudio indisponível.")
        }
    }

    private fun register(method: String, args: Map<*, *>?): PrepareToken? {
        if (method != M_PREPARE) return null
        val id = args?.get(K_SESSION) as? String ?: return null
        return PrepareToken(id).also { pendingPrepares.add(it) }
    }

    /** A close for a session still being prepared interrupts the decoding instead of waiting behind it. */
    private fun cancelPreparing(args: Map<*, *>?) {
        val id = args?.get(K_SESSION) as? String ?: return
        pendingPrepares.forEach { if (it.id == id) it.cancelled = true }
    }

    private fun run(method: String, args: Map<*, *>?, token: PrepareToken? = null): Reply = try {
        Reply(dispatch(method, args ?: emptyMap<String, Any?>(), token), null, null)
    } catch (e: MinistryAudioException) {
        fail(e.code, e.message ?: "Falha de áudio.")
    } catch (_: Throwable) {
        fail(INTERNAL, "Falha interna de áudio.")
    } finally {
        token?.let { pendingPrepares.remove(it) }
    }

    private fun fail(code: String, message: String) = Reply(null, code, message)

    private fun dispatch(method: String, a: Map<*, *>, token: PrepareToken?): Map<String, Any?>? {
        synchronized(lock) { if (disposed) invalid("Áudio encerrado.") }
        return when (method) {
            M_PREPARE -> prepare(a, token)
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

    private fun prepare(a: Map<*, *>, pending: PrepareToken?): Map<String, Any?> {
        val isMp3 = a.containsKey(K_CODEC)
        val wantsStreaming = isMp3 && a.containsKey(K_STRATEGY)
        val base = setOf(K_SESSION, K_USER, K_MINISTRY, K_RECORDING, K_RATE, K_FRAMES)
        val mp3Keys = base + setOf(K_CODEC, K_DELAY, K_PADDING, K_MPEG)
        exactKeys(
            a,
            when {
                wantsStreaming -> mp3Keys + setOf(K_STRATEGY, K_STEMS)
                isMp3 -> mp3Keys
                else -> base
            },
        )
        val expectations = if (wantsStreaming) stemExpectationsArg(a) else null
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

        // A prepare cancelled while it was still queued must not replace (and so close) the current session.
        if (pending?.cancelled == true) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")

        if (!releaseOrphan()) {
            throw MinistryAudioException(MinistryAudioException.SHUTDOWN_PENDING, "O áudio anterior ainda está encerrando.")
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
        var streaming: StreamingFeed? = null
        // Frame indexes of the validated files, for the full decode when streaming falls back.
        val verified = HashMap<File, Mp3StreamIndex>()
        val mustCheckInput = expectations != null
        val report = LinkedHashMap<String, Any?>()
        if (alignment != null && expectations != null) {
            val token = pending ?: PrepareToken(id)
            streaming = openStreaming(directory, ministryRoot, rate.toInt(), frames, alignment, expectations, token, report, verified)
        }
        if (expectations != null) report["strategy"] = if (streaming != null) STRATEGY_INCREMENTAL else STRATEGY_FULL
        if (alignment != null && streaming == null) {
            val support = mp3 ?: throw MinistryAudioException(MinistryAudioException.MP3_UNSUPPORTED, "MP3 indisponível.")
            val token = pending ?: PrepareToken(id)
            try {
                if (token.cancelled) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
                val decoderName = support.calibration.requireVerified { token.cancelled }
                val dir = File(File(ministryRoot, TEMP_DIR), id)
                tempDir = dir
                decodeStems(support, directory, ministryRoot, dir, rate.toInt(), frames, alignment, decoderName, token, verified.takeIf { mustCheckInput })
                // Falling back from streaming: the full decode reopened the files by path, so they must still be the
                // ones of the manifest.
                expectations?.let { requireUnchanged(directory, ministryRoot, it, token) }
                loadDir = dir
            } catch (e: Throwable) {
                tempDir?.let { deleteTree(it) } // no engine holds these files yet
                throw e
            }
        }

        var ref: BridgeSession? = null
        val engine = try {
            engineFactory { state, code ->
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
        } catch (e: Throwable) {
            // No engine owns the producers or the decoded files yet.
            streaming?.let { if (!it.close()) orphan = it }
            tempDir?.let { deleteTree(it) }
            throw e
        }
        val session = BridgeSession(id, engine)
        session.tempDir = tempDir
        synchronized(lock) { current = session }
        ref = session
        try {
            if (streaming != null) {
                engine.loadStreaming(streaming)
                session.sampleRate = rate.toInt()
                session.frames = frames
            } else {
                val h = engine.load(loadDir, ministryRoot, rate.toInt(), frames)
                session.sampleRate = h.sampleRate
                session.frames = h.frames
            }
        } catch (e: Throwable) {
            // The engine owns the feed only once loaded.
            streaming?.let { if (!it.close()) orphan = it }
            val confirmed = runCatching { engine.dispose() }.getOrDefault(false)
            if (confirmed) {
                tempDir?.let { deleteTree(it) }
                synchronized(lock) { if (current === session) current = null }
            }
            throw e
        }
        return mapOf<String, Any?>(K_SESSION to id, "sampleRate" to session.sampleRate, "frames" to session.frames) + report
    }

    // ----------------------------------------------------- streaming (M22-S4.2)

    /**
     * Everything that must hold before any audio: the six compressed files validated byte by byte against the manifest,
     * this device calibrated, and one second of aligned PCM buffered on all six stems. Returns null ONLY when the device
     * cannot stream (calibration or codec resources), so the caller may use the full decode with its own checks. A
     * corrupt, tampered or divergent file throws: it never falls back.
     */
    private fun openStreaming(
        directory: File,
        allowedRoot: File,
        rate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        expectations: Map<StemId, Mp3StemExpectation>,
        token: PrepareToken,
        report: MutableMap<String, Any?>,
        verified: MutableMap<File, Mp3StreamIndex>,
    ): StreamingFeed? {
        fun cancelled() = MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
        fun millisSince(t: Long) = (System.nanoTime() - t) / 1_000_000

        var started = System.nanoTime()
        val files = MinistryAudioPaths.resolve(directory, allowedRoot, "mp3")
        val stems = StemId.values().map { stem ->
            if (token.cancelled) throw cancelled()
            val file = files.getValue(stem)
            IncrementalStem(
                file,
                Mp3StreamIndexer.index(file, rate, frames, alignment, expectations.getValue(stem)) { token.cancelled },
            )
        }
        if (stems.map { it.index.encoder }.distinct().size != 1) {
            throw MinistryAudioException(MinistryAudioException.MP3_INVALID, "Faixas de codificadores diferentes.")
        }
        report["indexMs"] = millisSince(started)
        stems.forEach { verified[it.file] = it.index }

        // Only after the bytes were verified: a device that cannot stream still never plays unverified files.
        val support = mp3?.incremental
        if (support == null) {
            report["fallbackReason"] = "unavailable"
            return null
        }

        started = System.nanoTime()
        val decoderName = try {
            support.calibration.requireVerified { token.cancelled }
        } catch (e: MinistryAudioException) {
            if (e.code != MinistryAudioException.MP3_ALIGNMENT_UNVERIFIED) throw e
            report["fallbackReason"] = "calibration"
            return null
        }
        report["calibrationMs"] = millisSince(started)

        started = System.nanoTime()
        val feed = IncrementalPcmFeed(stems, rate, frames, alignment, support.decoder, decoderName)
        var ready = false
        try {
            feed.position(0)
            while (!feed.isReady(0, rate)) {
                if (token.cancelled) throw cancelled()
                feed.failure()?.let { throw it }
                if (millisSince(started) > support.prefillTimeoutMs) {
                    throw MinistryAudioException(MinistryAudioException.MP3_DECODE_FAILED, "Decodificação sem progresso.")
                }
                Thread.sleep(2)
            }
            report["codecOpenMs"] = feed.codecOpenMillis
            report["prefillMs"] = millisSince(started)
            report["ringBytes"] = feed.ringBytesTotal
            if (token.cancelled) throw cancelled()
            ready = true
            return feed
        } catch (e: Mp3CodecUnavailableException) {
            report["fallbackReason"] = "codec_unavailable"
            return null
        } finally {
            if (!ready && !feed.close()) {
                orphan = feed
                throw MinistryAudioException(MinistryAudioException.SHUTDOWN_PENDING, "O áudio ainda está encerrando.")
            }
        }
    }

    /** Every compressed frame reaching the codec must be the validated one, even if the file changes while decoding. */
    private fun checking(decoder: Mp3PcmDecoder, index: Mp3StreamIndex) = object : Mp3PcmDecoder {
        override fun decode(file: File, onInfo: (Mp3StreamInfo) -> Unit, sink: PcmSink, cancelled: () -> Boolean) =
            decoder.decodeChecked(file, index.inputCheck(0), onInfo, sink, cancelled)
    }

    private fun requireUnchanged(
        directory: File,
        allowedRoot: File,
        expectations: Map<StemId, Mp3StemExpectation>,
        token: PrepareToken,
    ) {
        val files = MinistryAudioPaths.resolve(directory, allowedRoot, "mp3")
        for (stem in StemId.values()) {
            val expected = expectations.getValue(stem)
            val digest = MessageDigest.getInstance("SHA-256")
            var size = 0L
            files.getValue(stem).inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    if (token.cancelled) {
                        throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
                    }
                    val n = input.read(buffer)
                    if (n < 0) break
                    digest.update(buffer, 0, n)
                    size += n
                }
            }
            val sha = digest.digest().joinToString("") { "%02x".format(it) }
            if (size != expected.sizeBytes || sha != expected.sha256) {
                throw MinistryAudioException(MinistryAudioException.MP3_INVALID, "Arquivo alterado durante a preparação.")
            }
        }
    }

    private fun releaseOrphan(): Boolean {
        val o = orphan ?: return true
        if (!o.close()) return false
        orphan = null
        return true
    }

    private fun stemExpectationsArg(a: Map<*, *>): Map<StemId, Mp3StemExpectation> {
        if (a[K_STRATEGY] != STRATEGY_INCREMENTAL) arg("Estratégia inválida.")
        val stems = a[K_STEMS] as? Map<*, *> ?: arg("Faixas ausentes.")
        if (stems.size != StemId.values().size) arg("Faixas inválidas.")
        return StemId.values().associateWith { id ->
            val entry = stems[id.wireName] as? Map<*, *> ?: arg("Faixa ausente.")
            exactKeys(entry, setOf(K_SIZE, K_SHA))
            val size = longArg(entry, K_SIZE)
            val sha = entry[K_SHA] as? String
            if (size <= 0 || sha == null || !SHA256.matches(sha)) arg("Faixa inválida.")
            Mp3StemExpectation(size, sha)
        }
    }

    private fun close(a: Map<*, *>): Map<String, Any?> {
        exactKeys(a, setOf(K_SESSION))
        val id = sessionIdArg(a)
        val s = synchronized(lock) { current }
        if (s == null || s.id != id) return mapOf("closed" to releaseOrphan()) // already gone
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
     * Decodes the six stems, at most [Mp3Support.parallelStems] at a time, into [dir]/stem_<id>.wav. Each stem is
     * written as `.part` and renamed only when complete and exactly sized, so the engine never sees a partial set.
     * Reserves space first. Returns or throws ONLY after every decoding thread has finished: the caller deletes files
     * and (in Dart) releases the cache lease on that guarantee.
     */
    private fun decodeStems(
        support: Mp3Support,
        source: File,
        allowedRoot: File,
        dir: File,
        rate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        decoderName: String,
        token: PrepareToken,
        /** Null for the plain full decode; otherwise every stem must be decoded against its validated index. */
        verified: Map<File, Mp3StreamIndex>?,
    ) {
        val files = MinistryAudioPaths.resolve(source, allowedRoot, "mp3")
        val perStem = WavV1.HEADER_BYTES + frames * WavV1.BYTES_PER_FRAME
        val needed = perStem * StemId.values().size + SPACE_RESERVE_BYTES
        dir.mkdirs()
        if (!dir.isDirectory) throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Pasta temporária indisponível.")
        if (support.usableSpace(dir) < needed) {
            throw MinistryAudioException(MinistryAudioException.INSUFFICIENT_SPACE, "Espaço insuficiente para preparar o áudio.")
        }
        fun attempt(parallel: Int) =
            decodeAttempt(support, files, dir, rate, frames, alignment, decoderName, token, parallel, verified)
        val parallel = support.parallelStems.coerceIn(1, StemId.values().size)
        try {
            attempt(parallel)
        } catch (e: MinistryAudioException) {
            // The calibration opens one codec at a time: a device may not have resources for several. Every decoder
            // of the failed attempt has already stopped, so retry once, sequentially, from an empty directory.
            if (parallel == 1 || e.code != MinistryAudioException.MP3_DECODE_FAILED || token.cancelled) throw e
            dir.listFiles()?.forEach { deleteTree(it) }
            attempt(1)
        }
    }

    private fun decodeAttempt(
        support: Mp3Support,
        files: Map<StemId, File>,
        dir: File,
        rate: Int,
        frames: Long,
        alignment: Mp3Alignment,
        decoderName: String,
        token: PrepareToken,
        parallel: Int,
        verified: Map<File, Mp3StreamIndex>?,
    ) {
        val queue = java.util.concurrent.ConcurrentLinkedQueue(StemId.values().toList())
        // The first real failure wins and stops the other workers; their CANCELLED is a consequence, not the cause.
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val stop = { token.cancelled || failure.get() != null }
        val work = Runnable {
            try {
                while (!stop()) {
                    val stem = queue.poll() ?: break
                    val part = File(dir, "${stem.fileName}.part")
                    val file = files.getValue(stem)
                    val decoder = if (verified == null) {
                        support.decoder
                    } else {
                        // A path that no longer resolves to a validated file is refused, never decoded unchecked.
                        checking(
                            support.decoder,
                            verified[file] ?: throw MinistryAudioException(
                                MinistryAudioException.MP3_INVALID,
                                "Arquivo alterado durante a preparação.",
                            ),
                        )
                    }
                    Mp3StemDecoder.decodeToWav(file, part, rate, frames, alignment, decoder, decoderName, stop)
                    if (!part.renameTo(File(dir, stem.fileName))) {
                        part.delete()
                        throw MinistryAudioException(MinistryAudioException.WRITE_FAILED, "Falha ao gravar o áudio temporário.")
                    }
                }
            } catch (e: Throwable) {
                failure.compareAndSet(null, e)
            }
        }
        val workers = ArrayList<Thread>()
        try {
            repeat(parallel) { i ->
                workers.add(Thread(work, "$DECODE_THREAD-$i").apply { isDaemon = true; start() })
            }
        } catch (e: Throwable) {
            failure.compareAndSet(null, e) // the workers already started must stop before anything is deleted
        } finally {
            joinAll(workers)
        }
        if (token.cancelled) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
        failure.get()?.let { throw it }
    }

    /** Unconditional join: an interrupt is remembered, never a reason to walk away from a live decoder. */
    private fun joinAll(threads: List<Thread>) {
        var interrupted = false
        for (t in threads) {
            while (t.isAlive) {
                try {
                    t.join()
                } catch (_: InterruptedException) {
                    interrupted = true
                }
            }
        }
        if (interrupted) Thread.currentThread().interrupt()
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
        pendingPrepares.forEach { it.cancelled = true }
        val result = try {
            executor.submit<Boolean> {
                val s = synchronized(lock) { current }
                val ok = (s?.let { closeSession(it) } ?: true) && releaseOrphan()
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
        const val DECODE_THREAD = "ministry-audio-decode"

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
        private const val K_STRATEGY = "strategy"
        private const val K_STEMS = "stems"
        private const val K_SIZE = "sizeBytes"
        private const val K_SHA = "sha256"
        const val STRATEGY_INCREMENTAL = "incremental"
        const val STRATEGY_FULL = "full"
        private val SHA256 = Regex("^[a-f0-9]{64}$")
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
