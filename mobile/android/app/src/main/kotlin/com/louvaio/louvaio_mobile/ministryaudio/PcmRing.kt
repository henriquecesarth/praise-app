package com.louvaio.louvaio_mobile.ministryaudio

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Bounded PCM16 stereo ring of ONE stem, positioned on the manifest timeline. One producer, one consumer.
 *
 * * The producer blocks while the ring is full (back-pressure); [abort] always wakes it.
 * * The consumer NEVER blocks: it asks [availableFrames] first, and reading data that is not there is an error, never
 *   silence. This is what lets the engine hold the shared clock when any stem is behind.
 * * Data is dropped only by [discardBefore], so a muted stem (which the mixer does not read) still advances.
 */
class PcmRing(capacityFrames: Int) : StemSource {
    private val capacity = capacityFrames * WavV1.BYTES_PER_FRAME
    private val data = ByteArray(capacity)
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()

    // Timeline byte positions: [start, end) is buffered.
    private var start = 0L
    private var end = 0L
    private var aborted = false

    val capacityBytes: Int get() = capacity
    override val sizeBytes: Long get() = Long.MAX_VALUE

    /** Only while no producer is running. */
    fun reset(fromFrame: Long) = lock.withLock {
        start = fromFrame * WavV1.BYTES_PER_FRAME
        end = start
        aborted = false
    }

    @Throws(MinistryAudioException::class)
    fun write(buf: ByteArray, off: Int, len: Int) = lock.withLock {
        var done = 0
        while (done < len) {
            while (!aborted && end - start >= capacity) changed.await()
            if (aborted) throw MinistryAudioException(MinistryAudioException.CANCELLED, "Preparação cancelada.")
            val at = (end % capacity).toInt()
            val n = minOf(len - done, capacity - (end - start).toInt(), capacity - at)
            System.arraycopy(buf, off + done, data, at, n)
            end += n
            done += n
        }
    }

    /** Wakes and stops the producer; the buffered data is no longer served. */
    fun abort() = lock.withLock {
        aborted = true
        changed.signalAll()
    }

    val isAborted: Boolean get() = lock.withLock { aborted }

    /** Frames the ring still holds from [fromFrame] on; 0 if that frame is not buffered. */
    fun availableFrames(fromFrame: Long): Long = lock.withLock {
        val p = fromFrame * WavV1.BYTES_PER_FRAME
        if (aborted || p < start || p > end) 0L else (end - p) / WavV1.BYTES_PER_FRAME
    }

    /** First frame still held (the position the ring is serving). */
    val startFrame: Long get() = lock.withLock { start / WavV1.BYTES_PER_FRAME }

    fun discardBefore(frame: Long) = lock.withLock {
        val p = minOf(frame * WavV1.BYTES_PER_FRAME, end)
        if (p > start) {
            start = p
            changed.signalAll()
        }
    }

    /** [position] is a WAV v1 byte position (44-byte header), as [MixerCore] addresses its sources. */
    override fun readAt(position: Long, dst: ByteArray, offset: Int, length: Int): Int = lock.withLock {
        val p = position - WavV1.HEADER_BYTES
        if (aborted || p < start || p + length > end) {
            throw MinistryAudioException(MinistryAudioException.READ_FAILED, "Áudio ainda não disponível.")
        }
        var done = 0
        while (done < length) {
            val at = ((p + done) % capacity).toInt()
            val n = minOf(length - done, capacity - at)
            System.arraycopy(data, at, dst, offset + done, n)
            done += n
        }
        length
    }

    override fun close() = abort()
}
