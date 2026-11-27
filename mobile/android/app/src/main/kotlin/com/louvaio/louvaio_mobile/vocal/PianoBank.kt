package com.louvaio.louvaio_mobile.vocal

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Loads and decodes FreePats Upright KW piano samples into memory.
 * Decoded once to FloatArray (approx 9.86 MB) and reused across sessions.
 */
class PianoBank(private val assetLoader: (String) -> InputStream) {

    data class Region(
        val low: Int,
        val high: Int,
        val root: Int,
        val fileName: String,
        val loopStartSeconds: Double?,
        val loopEndSeconds: Double?
    )

    data class Sample(
        val root: Int,
        val data: FloatArray,
        val sampleRate: Int,
        val loopStartFrame: Int?,
        val loopEndFrame: Int?
    ) {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (javaClass != other?.javaClass) return false
            other as Sample
            return root == other.root && sampleRate == other.sampleRate
        }

        override fun hashCode(): Int {
            return 31 * root + sampleRate
        }
    }

    val supportedMidiLow: Int
    val supportedMidiHigh: Int
    val releaseSeconds: Double
    val regions: List<Region>
    private val samplesByRoot = HashMap<Int, Sample>()

    init {
        val manifestJson = assetLoader("manifest.json").use { input ->
            input.bufferedReader(Charsets.UTF_8).readText()
        }
        val rootObj = JSONObject(manifestJson)
        val supportedMidiArray = rootObj.getJSONArray("supportedMidi")
        supportedMidiLow = supportedMidiArray.getInt(0)
        supportedMidiHigh = supportedMidiArray.getInt(1)
        releaseSeconds = rootObj.optDouble("releaseSeconds", 0.6)

        val regionsArray = rootObj.getJSONArray("regions")
        val parsedRegions = ArrayList<Region>(regionsArray.length())
        for (i in 0 until regionsArray.length()) {
            val regObj = regionsArray.getJSONObject(i)
            val filePath = regObj.getString("file")
            val fileName = filePath.substringAfterLast('/')
            val loopStart = if (regObj.has("loopStartSeconds")) regObj.getDouble("loopStartSeconds") else null
            val loopEnd = if (regObj.has("loopEndSeconds")) regObj.getDouble("loopEndSeconds") else null
            parsedRegions.add(
                Region(
                    low = regObj.getInt("low"),
                    high = regObj.getInt("high"),
                    root = regObj.getInt("root"),
                    fileName = fileName,
                    loopStartSeconds = loopStart,
                    loopEndSeconds = loopEnd
                )
            )
        }
        regions = parsedRegions
    }

    @Synchronized
    fun loadAll() {
        if (samplesByRoot.size == regions.size) return
        for (region in regions) {
            if (!samplesByRoot.containsKey(region.root)) {
                val sample = loadWav(region)
                samplesByRoot[region.root] = sample
            }
        }
    }

    fun findRegion(midi: Int): Region? {
        return regions.firstOrNull { midi in it.low..it.high }
    }

    fun getSample(root: Int): Sample? {
        return samplesByRoot[root]
    }

    private fun loadWav(region: Region): Sample {
        val bytes = assetLoader(region.fileName).use { input ->
            readAllBytes(input)
        }
        if (bytes.size < 44) throw IllegalArgumentException("WAV file too small: ${region.fileName}")

        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val riff = ByteArray(4)
        buffer.get(riff)
        if (String(riff) != "RIFF") throw IllegalArgumentException("Missing RIFF header in ${region.fileName}")
        val fileSize = buffer.int
        val wave = ByteArray(4)
        buffer.get(wave)
        if (String(wave) != "WAVE") throw IllegalArgumentException("Missing WAVE header in ${region.fileName}")

        var audioFormat = 0
        var numChannels = 0
        var sampleRate = 0
        var bitsPerSample = 0
        var pcmData: FloatArray? = null

        while (buffer.remaining() >= 8) {
            val chunkIdBytes = ByteArray(4)
            buffer.get(chunkIdBytes)
            val chunkId = String(chunkIdBytes)
            val chunkSize = buffer.int

            when (chunkId) {
                "fmt " -> {
                    audioFormat = buffer.short.toInt() and 0xFFFF
                    numChannels = buffer.short.toInt() and 0xFFFF
                    sampleRate = buffer.int
                    buffer.int // byteRate
                    buffer.short // blockAlign
                    bitsPerSample = buffer.short.toInt() and 0xFFFF
                    val remaining = chunkSize - 16
                    if (remaining > 0) buffer.position(buffer.position() + remaining)
                }
                "data" -> {
                    if (audioFormat != 1) throw IllegalArgumentException("Unsupported non-PCM format $audioFormat in ${region.fileName}")
                    if (numChannels != 1) throw IllegalArgumentException("Unsupported channel count $numChannels (expected mono) in ${region.fileName}")
                    if (sampleRate != 44100) throw IllegalArgumentException("Unsupported sample rate $sampleRate (expected 44100) in ${region.fileName}")
                    if (bitsPerSample != 16) throw IllegalArgumentException("Unsupported bit depth $bitsPerSample (expected 16-bit) in ${region.fileName}")

                    val numSamples = chunkSize / 2
                    val floats = FloatArray(numSamples)
                    for (s in 0 until numSamples) {
                        floats[s] = buffer.short.toFloat() / 32768.0f
                    }
                    pcmData = floats
                    if (chunkSize % 2 != 0 && buffer.hasRemaining()) {
                        buffer.get() // pad byte
                    }
                }
                else -> {
                    buffer.position(buffer.position() + chunkSize)
                    if (chunkSize % 2 != 0 && buffer.hasRemaining()) {
                        buffer.get()
                    }
                }
            }
        }

        val samples = pcmData ?: throw IllegalArgumentException("Missing data chunk in ${region.fileName}")

        var loopStartFrame: Int? = null
        var loopEndFrame: Int? = null
        if (region.loopStartSeconds != null && region.loopEndSeconds != null) {
            val start = Math.round(region.loopStartSeconds * sampleRate).toInt()
            val end = Math.round(region.loopEndSeconds * sampleRate).toInt()
            applyLoopCrossfade(samples, sampleRate, start, end)
            loopStartFrame = start
            loopEndFrame = end
        }

        return Sample(
            root = region.root,
            data = samples,
            sampleRate = sampleRate,
            loopStartFrame = loopStartFrame,
            loopEndFrame = loopEndFrame
        )
    }

    private fun applyLoopCrossfade(data: FloatArray, sampleRate: Int, start: Int, end: Int) {
        val width = minOf(Math.round(sampleRate * 0.01).toInt(), start, (end - start) / 4)
        if (width < 2 || end > data.size) throw IllegalArgumentException("Invalid piano sample loop")
        for (i in 0 until width) {
            val blend = i.toFloat() / (width - 1).toFloat()
            data[end - width + i] = data[end - width + i] * (1.0f - blend) + data[start - width + i] * blend
        }
    }

    private fun readAllBytes(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(16384)
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }
}
