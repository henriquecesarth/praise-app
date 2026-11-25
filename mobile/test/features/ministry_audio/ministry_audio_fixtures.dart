/// Local fixtures for the ministry audio contract (WAV v1). No network.
library;

const stemIds = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
final recordingId = 'a' * 64;
final otherRecordingId = 'b' * 64;

Map<String, dynamic> stemJson(
  String id, {
  int sampleRate = 44100,
  int frames = 88200,
  Map<String, dynamic>? override,
}) {
  final json = <String, dynamic>{
    'id': id,
    'codec': 'pcm_s16le',
    'sampleRate': sampleRate,
    'channels': 2,
    'durationSeconds': frames / sampleRate,
    'frames': frames,
    'sizeBytes': 44 + frames * 4,
    'sha256': 'c' * 64,
  };
  if (override != null) json.addAll(override);
  return json;
}

Map<String, dynamic> manifestJson({
  String? id,
  List<Map<String, dynamic>>? stems,
  Map<String, dynamic>? override,
}) {
  final json = <String, dynamic>{
    'schemaVersion': 1,
    'recordingId': id ?? recordingId,
    'recordingVersion': 'v1',
    'model': {'id': 'htdemucs_6s', 'version': '1'},
    'stems': stems ?? [for (final s in stemIds) stemJson(s)],
  };
  if (override != null) json.addAll(override);
  return json;
}

Map<String, dynamic> directPlaybackJson({String? id}) => {
      'manifest': manifestJson(id: id),
      'expiresAt': 1900000000000,
      'transfer': 'direct',
      'tracks': [
        for (final s in stemIds)
          {
            'id': s,
            'url': 'https://r2.example.test/bucket/$s?X-Signature=SECRET$s',
            'headers': {'x-amz-test': 'token-$s'},
          },
      ],
    };

Map<String, dynamic> legacyPlaybackJson({String? id}) {
  final rid = id ?? recordingId;
  return {
    'manifest': manifestJson(id: rid),
    'expiresAt': 1900000000000,
    'tracks': [
      for (final s in stemIds)
        {'id': s, 'url': '/$rid/stems/$s?ticket=1900000000000.SECRETSIG$s'},
    ],
  };
}

Map<String, dynamic> recordingJson({String? id, String title = 'Música'}) => {
      'id': id ?? recordingId,
      'title': title,
      'artist': 'Artista',
      'version': 'Original',
      'status': 'published',
      'updatedAt': 1700000000000,
    };


// ---------------------------------------------------------------- MP3 (M22-S4)

/// MPEG frames needed for `delay + frames`, rounded up to whole 1152-sample frames.
int mp3MpegFrames(int frames, int delay) => ((delay + frames) / 1152).ceil();

/// Valid CBR 256 kbps size for [mpegFrames] audio frames plus the Info frame.
int mp3SizeFor(int sampleRate, int mpegFrames) =>
    (mpegFrames + 1) * ((144 * 256000) ~/ sampleRate);

Map<String, dynamic> mp3AlignmentJson({
  int frames = 3000,
  int delay = 1105,
  int? padding,
  int? mpeg,
}) {
  final m = mpeg ?? mp3MpegFrames(frames, delay);
  return {
    'encoderDelayFrames': delay,
    'paddingFrames': padding ?? (m * 1152 - delay - frames),
    'mpegAudioFrames': m,
    'infoFrame': true,
  };
}

Map<String, dynamic> mp3StemJson(
  String id, {
  int sampleRate = 44100,
  int frames = 3000,
  int delay = 1105,
  String? sha,
  int? size,
  Map<String, dynamic>? alignment,
  Map<String, dynamic>? override,
}) {
  final a = alignment ?? mp3AlignmentJson(frames: frames, delay: delay);
  final json = <String, dynamic>{
    'id': id,
    'codec': 'mp3_cbr256',
    'sampleRate': sampleRate,
    'channels': 2,
    'bitrateKbps': 256,
    'durationSeconds': frames / sampleRate,
    'frames': frames,
    'sizeBytes': size ?? mp3SizeFor(sampleRate, a['mpegAudioFrames'] as int),
    'sha256': sha ?? 'c' * 64,
    'alignment': a,
  };
  if (override != null) json.addAll(override);
  return json;
}

Map<String, dynamic> mp3ManifestJson({
  String? id,
  List<Map<String, dynamic>>? stems,
  Map<String, dynamic>? override,
}) =>
    manifestJson(
      id: id,
      stems: stems ?? [for (final s in stemIds) mp3StemJson(s)],
      override: {'schemaVersion': 2, ...?override},
    );

Map<String, dynamic> mp3PlaybackJson({String? id, Map<String, dynamic>? manifest}) => {
      ...directPlaybackJson(id: id),
      'manifest': manifest ?? mp3ManifestJson(id: id),
    };