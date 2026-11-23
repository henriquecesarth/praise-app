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
