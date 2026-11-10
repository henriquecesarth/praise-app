import AVFoundation
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var vocalAudioPlayer: IOSVocalAudioPlayer?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)

    if let registrar = self.registrar(forPlugin: "LouvaioVocalAudioPlugin"),
       let controller = window?.rootViewController as? FlutterViewController {
      let player = IOSVocalAudioPlayer(registrar: registrar)
      self.vocalAudioPlayer = player
      let channel = FlutterMethodChannel(
        name: "com.louvaio.mobile/vocal_audio",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        self?.handleVocalAudioCall(call: call, result: result)
      }
    }

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAppBackgrounded),
      name: UIApplication.willResignActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAppBackgrounded),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  @objc private func handleAppBackgrounded() {
    vocalAudioPlayer?.stop(sessionId: nil)
  }

  private func handleVocalAudioCall(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard let player = vocalAudioPlayer else {
      result(FlutterError(code: "UNAVAILABLE", message: "Vocal audio player unavailable.", details: nil))
      return
    }
    let args = call.arguments as? [String: Any]
    let sessionId = (args?["sessionId"] as? NSNumber)?.intValue

    switch call.method {
    case "playSequence":
      let rawNotes = (args?["notes"] as? [NSNumber])?.map { $0.intValue } ?? []
      let rawDurations = (args?["durations"] as? [NSNumber])?.map { $0.doubleValue } ?? []
      let bpm = ((args?["bpm"] as? NSNumber)?.intValue ?? 80).clamped(to: 40...220)
      let metronome = (args?["metronome"] as? Bool) ?? true
      let sid = sessionId ?? 0

      if rawNotes.isEmpty ||
          rawNotes.count > 2500 ||
          rawNotes.count != rawDurations.count ||
          rawDurations.contains(where: { !$0.isFinite || $0 <= 0 || $0 > 16 }) ||
          rawNotes.contains(where: { $0 != -1 && ($0 < 48 || $0 > 88) }) {
        result(FlutterError(code: "INVALID_SEQUENCE", message: "Invalid vocal sequence.", details: nil))
        return
      }
      player.playSequence(
        sessionId: sid,
        notes: rawNotes,
        durations: rawDurations,
        bpm: bpm,
        metronome: metronome,
        result: result
      )
    case "pause":
      player.pause(sessionId: sessionId)
      result(nil)
    case "resume":
      player.resume(sessionId: sessionId)
      result(nil)
    case "stop":
      player.stop(sessionId: sessionId)
      result(nil)
    case "position":
      result(player.getPosition(sessionId: sessionId))
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

private extension Comparable {
  func clamped(to limits: ClosedRange<Self>) -> Self {
    return min(max(self, limits.lowerBound), limits.upperBound)
  }
}

private struct IOSPianoRegion {
  let root: Int
  let low: Int
  let high: Int
  let file: String
}

private final class IOSVocalAudioPlayer {
  private let registrar: FlutterPluginRegistrar
  private let queue = DispatchQueue(label: "com.louvaio.mobile.vocal_audio", qos: .userInitiated)
  private let sampleRate: Double = 44100.0

  private var regions: [IOSPianoRegion] = []
  private var samples: [Int: [Float]] = [:]
  private var bankLoaded = false

  private var engine: AVAudioEngine?
  private var playerNode: AVAudioPlayerNode?
  private var currentSessionId: Int = 0
  private var state: String = "idle"
  private var totalFrames: Int64 = 0
  private var startHostTime: UInt64 = 0
  private var accumulatedFramesBeforePause: Int64 = 0

  init(registrar: FlutterPluginRegistrar) {
    self.registrar = registrar
  }

  private func ensureBankLoaded() throws {
    if bankLoaded { return }
    let manifestKey = registrar.lookupKey(forAsset: "assets/audio/upright-kw/manifest.json")
    guard let manifestPath = Bundle.main.path(forResource: manifestKey, ofType: nil),
          let manifestData = try? Data(contentsOf: URL(fileURLWithPath: manifestPath)),
          let json = try? JSONSerialization.jsonObject(with: manifestData) as? [String: Any],
          let rawRegions = json["regions"] as? [[String: Any]] else {
      throw NSError(domain: "IOSVocalAudioPlayer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to load piano manifest"])
    }

    var parsedRegions: [IOSPianoRegion] = []
    for item in rawRegions {
      guard let root = (item["root"] as? NSNumber)?.intValue,
            let low = (item["low"] as? NSNumber)?.intValue,
            let high = (item["high"] as? NSNumber)?.intValue,
            let file = item["file"] as? String else { continue }
      parsedRegions.append(IOSPianoRegion(root: root, low: low, high: high, file: file))

      let wavKey = registrar.lookupKey(forAsset: "assets/audio/upright-kw/\(file)")
      if let wavPath = Bundle.main.path(forResource: wavKey, ofType: nil),
         let pcm = Self.decodeWavMonoFloat(path: wavPath) {
        samples[root] = pcm
      }
    }
    regions = parsedRegions
    bankLoaded = true
  }

  private static func decodeWavMonoFloat(path: String) -> [Float]? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count > 44 else {
      return nil
    }
    return data.withUnsafeBytes { rawBuffer -> [Float]? in
      guard let base = rawBuffer.baseAddress else { return nil }
      var offset = 12
      var channels = 1
      var bitsPerSample = 16
      while offset + 8 <= data.count {
        let chunkSize = Int(base.load(fromByteOffset: offset + 4, as: UInt32.self).littleEndian)
        let id0 = base.load(fromByteOffset: offset, as: UInt8.self)
        let id1 = base.load(fromByteOffset: offset + 1, as: UInt8.self)
        let id2 = base.load(fromByteOffset: offset + 2, as: UInt8.self)
        let id3 = base.load(fromByteOffset: offset + 3, as: UInt8.self)
        let dataOffset = offset + 8

        if id0 == 0x66 && id1 == 0x6D && id2 == 0x74 && id3 == 0x20 { // "fmt "
          if dataOffset + 16 <= data.count {
            channels = max(1, Int(base.load(fromByteOffset: dataOffset + 2, as: UInt16.self).littleEndian))
            bitsPerSample = Int(base.load(fromByteOffset: dataOffset + 14, as: UInt16.self).littleEndian)
          }
        } else if id0 == 0x64 && id1 == 0x61 && id2 == 0x74 && id3 == 0x61 { // "data"
          guard bitsPerSample == 16 else { return nil }
          let availableBytes = min(chunkSize, data.count - dataOffset)
          let frameStep = 2 * channels
          let frameCount = availableBytes / frameStep
          var out = [Float](repeating: 0, count: frameCount)
          for f in 0..<frameCount {
            var sum: Float = 0
            for c in 0..<channels {
              let sampleOffset = dataOffset + f * frameStep + c * 2
              let sample = base.load(fromByteOffset: sampleOffset, as: Int16.self).littleEndian
              sum += Float(sample) / 32768.0
            }
            out[f] = sum / Float(channels)
          }
          return out
        }
        offset = dataOffset + chunkSize + (chunkSize % 2)
      }
      return nil
    }
  }

  func playSequence(
    sessionId: Int,
    notes: [Int],
    durations: [Double],
    bpm: Int,
    metronome: Bool,
    result: @escaping FlutterResult
  ) {
    queue.async { [weak self] in
      guard let self = self else { return }
      self.stopInternal()
      self.currentSessionId = sessionId
      self.state = "loading"

      do {
        try self.ensureBankLoaded()
        let rendered = self.renderSequenceBuffer(
          notes: notes,
          durations: durations,
          bpm: bpm,
          metronome: metronome
        )
        guard let format = AVAudioFormat(standardFormatWithSampleRate: self.sampleRate, channels: 1),
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(max(1, rendered.count))) else {
          throw NSError(domain: "IOSVocalAudioPlayer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to allocate PCM buffer"])
        }
        pcmBuffer.frameLength = AVAudioFrameCount(rendered.count)
        if let channelData = pcmBuffer.floatChannelData?[0] {
          for i in 0..<rendered.count {
            channelData[i] = rendered[i]
          }
        }

        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try AVAudioSession.sharedInstance().setActive(true)

        let eng = AVAudioEngine()
        let node = AVAudioPlayerNode()
        eng.attach(node)
        eng.connect(node, to: eng.mainMixerNode, format: format)
        try eng.start()

        self.engine = eng
        self.playerNode = node
        self.totalFrames = Int64(rendered.count)
        self.accumulatedFramesBeforePause = 0
        self.startHostTime = mach_absolute_time()
        self.state = "playing"

        node.scheduleBuffer(pcmBuffer, at: nil, options: []) { [weak self] in
          self?.queue.async {
            guard let self = self, self.currentSessionId == sessionId else { return }
            if self.state == "playing" {
              self.state = "completed"
            }
          }
        }
        node.play()

        DispatchQueue.main.async {
          result([
            "sessionId": sessionId,
            "sampleRate": Int(self.sampleRate),
            "totalFrames": rendered.count,
          ])
        }
      } catch {
        self.state = "error"
        DispatchQueue.main.async {
          result(FlutterError(code: "AUDIO_INIT_FAILED", message: error.localizedDescription, details: nil))
        }
      }
    }
  }

  private func renderSequenceBuffer(
    notes: [Int],
    durations: [Double],
    bpm: Int,
    metronome: Bool
  ) -> [Float] {
    let secondsPerBeat = 60.0 / Double(bpm)
    var totalBeats = 0.0
    for d in durations { totalBeats += d }
    let tailSeconds = 0.35
    let totalSamples = max(1, Int(ceil((totalBeats * secondsPerBeat + tailSeconds) * sampleRate)))
    var mix = [Float](repeating: 0, count: totalSamples)

    var cursorBeats = 0.0
    for i in 0..<notes.count {
      let midi = notes[i]
      let durBeats = durations[i]
      let startFrame = Int(cursorBeats * secondsPerBeat * sampleRate)
      let noteFrames = Int(durBeats * secondsPerBeat * sampleRate)
      cursorBeats += durBeats

      if midi < 48 || midi > 88 { continue }
      guard let region = regions.first(where: { midi >= $0.low && midi <= $0.high }) ?? regions.first,
            let sample = samples[region.root], !sample.isEmpty else { continue }

      let ratio = pow(2.0, Double(midi - region.root) / 12.0)
      let releaseFrames = Int(0.18 * sampleRate)
      let maxRenderFrames = min(totalSamples - startFrame, noteFrames + releaseFrames)
      if maxRenderFrames <= 0 { continue }

      for f in 0..<maxRenderFrames {
        let srcPos = Double(f) * ratio
        let srcIdx = Int(srcPos)
        if srcIdx + 1 >= sample.count { break }
        let frac = Float(srcPos - Double(srcIdx))
        let val = sample[srcIdx] * (1.0 - frac) + sample[srcIdx + 1] * frac

        var env: Float = 0.35
        if f < 64 {
          env *= Float(f) / 64.0
        } else if f > noteFrames {
          let relProgress = Float(f - noteFrames) / Float(max(1, releaseFrames))
          env *= max(0.0, 1.0 - relProgress)
        }
        mix[startFrame + f] += val * env
      }
    }

    if metronome {
      let totalWholeBeats = Int(floor(totalBeats))
      let clickFrames = Int(0.018 * sampleRate)
      for b in 0...totalWholeBeats {
        let startFrame = Int(Double(b) * secondsPerBeat * sampleRate)
        if startFrame >= totalSamples { break }
        let freq = (b % 4 == 0) ? 1320.0 : 880.0
        let limit = min(clickFrames, totalSamples - startFrame)
        for f in 0..<limit {
          let env = Float(1.0 - Double(f) / Double(clickFrames))
          let wave = Float(sin(2.0 * Double.pi * freq * Double(f) / sampleRate))
          mix[startFrame + f] += wave * env * 0.14
        }
      }
    }

    for i in 0..<mix.count {
      mix[i] = max(-0.98, min(0.98, mix[i]))
    }
    return mix
  }

  func pause(sessionId: Int?) {
    queue.sync {
      if let sid = sessionId, sid != currentSessionId { return }
      guard state == "playing", let node = playerNode else { return }
      accumulatedFramesBeforePause = currentPlayedFramesInternal()
      node.pause()
      state = "paused"
    }
  }

  func resume(sessionId: Int?) {
    queue.sync {
      if let sid = sessionId, sid != currentSessionId { return }
      guard state == "paused", let node = playerNode else { return }
      startHostTime = mach_absolute_time()
      node.play()
      state = "playing"
    }
  }

  func stop(sessionId: Int?) {
    queue.sync {
      if let sid = sessionId, sid != currentSessionId { return }
      stopInternal()
    }
  }

  private func stopInternal() {
    playerNode?.stop()
    engine?.stop()
    playerNode = nil
    engine = nil
    state = "stopped"
    accumulatedFramesBeforePause = 0
  }

  private func currentPlayedFramesInternal() -> Int64 {
    if state == "completed" { return totalFrames }
    if state == "paused" { return min(totalFrames, accumulatedFramesBeforePause) }
    guard state == "playing" else { return 0 }
    var timebase = mach_timebase_info_data_t()
    mach_timebase_info(&timebase)
    let elapsedNano = Double(mach_absolute_time() &- startHostTime) * Double(timebase.numer) / Double(timebase.denom)
    let elapsedSec = elapsedNano / 1_000_000_000.0
    let frames = accumulatedFramesBeforePause + Int64(elapsedSec * sampleRate)
    return min(totalFrames, max(0, frames))
  }

  func getPosition(sessionId: Int?) -> [String: Any] {
    return queue.sync {
      if let sid = sessionId, sid != currentSessionId {
        return [
          "sessionId": sid,
          "playedFrames": 0,
          "totalFrames": 0,
          "sampleRate": Int(sampleRate),
          "state": "stopped",
        ]
      }
      let played = currentPlayedFramesInternal()
      if state == "playing" && totalFrames > 0 && played >= totalFrames {
        state = "completed"
      }
      return [
        "sessionId": currentSessionId,
        "playedFrames": played,
        "totalFrames": totalFrames,
        "sampleRate": Int(sampleRate),
        "state": state,
      ]
    }
  }
}
