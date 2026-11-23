import '../../../core/errors/app_failure.dart';

/// Read-only contract models for the ministry audio library (WAV v1 only).
///
/// Mirrors `backend/src/features/ministry_audio/ministry-audio.schema.ts` and
/// `web/src/audio/ministry-audio-contract.ts`. Parsing is strict and fails
/// closed: MP3, `schemaVersion` 2 and any unknown shape are rejected.
class MinistryAudioContract {
  MinistryAudioContract._();

  static const int maxSeconds = 300;
  static const int minSampleRate = 8000;
  static const int maxSampleRate = 48000;
  static const int wavHeaderBytes = 44;
  static const int bytesPerFrame = 4; // 2 channels x 16-bit PCM
  static const String codecPcm = 'pcm_s16le';
  static const String codecMp3 = 'mp3_cbr256';
  static const int maxTextLength = 160;
  static const int maxVersionLength = 120;

  static const String invalidCode = 'AUDIO_CONTRACT_INVALID';
  static const String unsupportedCodecCode = 'AUDIO_CODEC_UNSUPPORTED';
  static const String unsupportedSchemaCode = 'AUDIO_SCHEMA_UNSUPPORTED';

  static final RegExp recordingIdPattern = RegExp(r'^[a-f0-9]{64}$');
  static final RegExp sha256Pattern = RegExp(r'^[a-f0-9]{64}$');
  static final RegExp ministryIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
  static final RegExp cursorPattern = RegExp(r'^[A-Za-z0-9_-]{1,300}$');
}

Never _invalid(String what) => throw AppFailure(
      message: 'Resposta inválida da biblioteca de áudio ($what).',
      statusCode: 500,
      code: MinistryAudioContract.invalidCode,
    );

Map<String, dynamic> _asMap(Object? value, String what) {
  if (value is Map) {
    try {
      return Map<String, dynamic>.from(value);
    } catch (_) {
      _invalid(what);
    }
  }
  _invalid(what);
}

void _exactKeys(Map<String, dynamic> map, Set<String> allowed, String what) {
  for (final key in map.keys) {
    if (!allowed.contains(key)) _invalid('$what: campo desconhecido');
  }
}

int _asInt(Object? value, String what) {
  if (value is int) return value;
  _invalid(what);
}

String _asString(
  Object? value,
  String what, {
  int maxLength = MinistryAudioContract.maxTextLength,
  bool allowEmpty = false,
}) {
  if (value is! String) _invalid(what);
  if ((!allowEmpty && value.isEmpty) || value.length > maxLength) {
    _invalid(what);
  }
  return value;
}

/// The six canonical stems, in canonical order.
enum MinistryStemId {
  vocals,
  drums,
  bass,
  guitar,
  piano,
  other;

  String get wireName => name;

  static MinistryStemId parse(Object? value, String what) {
    if (value is String) {
      for (final id in MinistryStemId.values) {
        if (id.name == value) return id;
      }
    }
    _invalid(what);
  }
}

/// Stem metadata of a WAV v1 manifest (`pcm_s16le`, stereo).
class MinistryAudioStem {
  final MinistryStemId id;
  final int sampleRate;
  final double durationSeconds;
  final int frames;
  final int sizeBytes;
  final String sha256;

  const MinistryAudioStem({
    required this.id,
    required this.sampleRate,
    required this.durationSeconds,
    required this.frames,
    required this.sizeBytes,
    required this.sha256,
  });

  static const _keys = {
    'id',
    'codec',
    'sampleRate',
    'channels',
    'durationSeconds',
    'frames',
    'sizeBytes',
    'sha256',
  };

  factory MinistryAudioStem.fromJson(Object? json) {
    final map = _asMap(json, 'faixa');
    final codec = map['codec'];
    if (codec == MinistryAudioContract.codecMp3) {
      throw const AppFailure(
        message: 'Este formato de áudio (MP3) ainda não é suportado no app.',
        statusCode: 422,
        code: MinistryAudioContract.unsupportedCodecCode,
      );
    }
    if (codec != MinistryAudioContract.codecPcm) _invalid('codec da faixa');
    _exactKeys(map, _keys, 'faixa');

    final id = MinistryStemId.parse(map['id'], 'id da faixa');
    final sampleRate = _asInt(map['sampleRate'], 'taxa de amostragem');
    if (sampleRate < MinistryAudioContract.minSampleRate ||
        sampleRate > MinistryAudioContract.maxSampleRate) {
      _invalid('taxa de amostragem');
    }
    if (map['channels'] != 2) _invalid('canais');

    final rawDuration = map['durationSeconds'];
    if (rawDuration is! num || !rawDuration.isFinite) _invalid('duração');
    final duration = rawDuration.toDouble();
    if (duration <= 0 || duration > MinistryAudioContract.maxSeconds) {
      _invalid('duração');
    }

    final frames = _asInt(map['frames'], 'frames');
    if (frames <= 0 ||
        frames > MinistryAudioContract.maxSampleRate * MinistryAudioContract.maxSeconds ||
        frames > sampleRate * MinistryAudioContract.maxSeconds) {
      _invalid('frames');
    }
    final sizeBytes = _asInt(map['sizeBytes'], 'tamanho');
    if (sizeBytes !=
        MinistryAudioContract.wavHeaderBytes +
            frames * MinistryAudioContract.bytesPerFrame) {
      _invalid('tamanho incompatível com os frames');
    }
    if ((duration - frames / sampleRate).abs() > 1e-8) {
      _invalid('duração incompatível com os frames');
    }
    final sha = map['sha256'];
    if (sha is! String || !MinistryAudioContract.sha256Pattern.hasMatch(sha)) {
      _invalid('sha256');
    }

    return MinistryAudioStem(
      id: id,
      sampleRate: sampleRate,
      durationSeconds: duration,
      frames: frames,
      sizeBytes: sizeBytes,
      sha256: sha,
    );
  }
}

/// Identifier of the separation model that produced the stems.
class MinistryAudioModel {
  final String id;
  final String version;

  const MinistryAudioModel({required this.id, required this.version});

  factory MinistryAudioModel.fromJson(Object? json) {
    final map = _asMap(json, 'modelo');
    _exactKeys(map, const {'id', 'version'}, 'modelo');
    return MinistryAudioModel(
      id: _asString(map['id'], 'id do modelo',
          maxLength: MinistryAudioContract.maxVersionLength),
      version: _asString(map['version'], 'versão do modelo',
          maxLength: MinistryAudioContract.maxVersionLength),
    );
  }
}

/// WAV v1 manifest: exactly six unique stems sharing sample rate and frames.
class MinistryAudioManifest {
  final String recordingId;
  final String recordingVersion;
  final MinistryAudioModel model;

  /// Stems in canonical order (vocals, drums, bass, guitar, piano, other).
  final List<MinistryAudioStem> stems;

  MinistryAudioManifest._({
    required this.recordingId,
    required this.recordingVersion,
    required this.model,
    required List<MinistryAudioStem> stems,
  }) : stems = List.unmodifiable(stems);

  int get sampleRate => stems.first.sampleRate;
  int get frames => stems.first.frames;
  double get durationSeconds => stems.first.durationSeconds;

  static const _keys = {
    'schemaVersion',
    'recordingId',
    'recordingVersion',
    'model',
    'stems',
  };

  factory MinistryAudioManifest.fromJson(Object? json) {
    final map = _asMap(json, 'manifesto');
    final schema = map['schemaVersion'];
    if (schema != 1) {
      throw AppFailure(
        message: schema == 2
            ? 'Este formato de áudio (schema v2) ainda não é suportado no app.'
            : 'Versão de manifesto de áudio desconhecida.',
        statusCode: 422,
        code: MinistryAudioContract.unsupportedSchemaCode,
      );
    }
    _exactKeys(map, _keys, 'manifesto');

    final recordingId = map['recordingId'];
    if (recordingId is! String ||
        !MinistryAudioContract.recordingIdPattern.hasMatch(recordingId)) {
      _invalid('id da gravação');
    }
    final version = _asString(map['recordingVersion'], 'versão da gravação',
        maxLength: MinistryAudioContract.maxVersionLength);
    final model = MinistryAudioModel.fromJson(map['model']);

    final rawStems = map['stems'];
    if (rawStems is! List || rawStems.length != MinistryStemId.values.length) {
      _invalid('seis faixas são obrigatórias');
    }
    final byId = <MinistryStemId, MinistryAudioStem>{};
    for (final raw in rawStems) {
      final stem = MinistryAudioStem.fromJson(raw);
      if (byId.containsKey(stem.id)) _invalid('faixa duplicada');
      byId[stem.id] = stem;
    }
    final ordered = [for (final id in MinistryStemId.values) byId[id]!];
    final first = ordered.first;
    for (final stem in ordered) {
      if (stem.sampleRate != first.sampleRate || stem.frames != first.frames) {
        _invalid('faixas com taxa ou frames diferentes');
      }
    }
    return MinistryAudioManifest._(
      recordingId: recordingId,
      recordingVersion: version,
      model: model,
      stems: ordered,
    );
  }
}

enum MinistryAudioStatus { published, archived }

/// Listing entry of a recording (metadata only).
class MinistryAudioRecording {
  final String id;
  final String title;
  final String artist;
  final String version;
  final MinistryAudioStatus status;
  final int updatedAt;

  const MinistryAudioRecording({
    required this.id,
    required this.title,
    required this.artist,
    required this.version,
    required this.status,
    required this.updatedAt,
  });

  factory MinistryAudioRecording.fromJson(Object? json) {
    final map = _asMap(json, 'gravação');
    _exactKeys(map,
        const {'id', 'title', 'artist', 'version', 'status', 'updatedAt'},
        'gravação');
    final id = map['id'];
    if (id is! String || !MinistryAudioContract.recordingIdPattern.hasMatch(id)) {
      _invalid('id da gravação');
    }
    final MinistryAudioStatus status;
    switch (map['status']) {
      case 'published':
        status = MinistryAudioStatus.published;
      case 'archived':
        status = MinistryAudioStatus.archived;
      default:
        _invalid('status da gravação');
    }
    final updatedAt = _asInt(map['updatedAt'], 'data de atualização');
    if (updatedAt < 0) _invalid('data de atualização');
    return MinistryAudioRecording(
      id: id,
      title: _asString(map['title'], 'título'),
      artist: _asString(map['artist'], 'artista', allowEmpty: true),
      version: _asString(map['version'], 'versão',
          maxLength: MinistryAudioContract.maxVersionLength),
      status: status,
      updatedAt: updatedAt,
    );
  }
}

/// One page of the recordings listing.
class MinistryAudioPage {
  final List<MinistryAudioRecording> items;
  final String? nextCursor;

  MinistryAudioPage._({
    required List<MinistryAudioRecording> items,
    required this.nextCursor,
  }) : items = List.unmodifiable(items);

  bool get hasMore => nextCursor != null;

  factory MinistryAudioPage.fromJson(Object? json) {
    final map = _asMap(json, 'página');
    _exactKeys(map, const {'items', 'nextCursor'}, 'página');
    final rawItems = map['items'];
    if (rawItems is! List) _invalid('itens');
    final cursor = map['nextCursor'];
    if (cursor != null &&
        (cursor is! String ||
            !MinistryAudioContract.cursorPattern.hasMatch(cursor))) {
      _invalid('cursor');
    }
    return MinistryAudioPage._(
      items: [for (final raw in rawItems) MinistryAudioRecording.fromJson(raw)],
      nextCursor: cursor as String?,
    );
  }
}

enum MinistryAudioTransfer { direct, legacy }

/// Temporary transfer target for one stem (signed URL + headers).
///
/// Memory-only: it has no serialization and must never be persisted or
/// logged. [toString] redacts everything.
class MinistryAudioTransferTarget {
  final MinistryStemId id;
  final MinistryAudioTransfer transfer;

  /// Absolute URL (`direct`) or API-relative path (`legacy`, relative to the
  /// ministry `audio-library` base). Contains a credential: do not log.
  final String url;
  final Map<String, String> headers;

  MinistryAudioTransferTarget._({
    required this.id,
    required this.transfer,
    required this.url,
    required Map<String, String> headers,
  }) : headers = Map.unmodifiable(headers);

  @override
  String toString() => 'MinistryAudioTransferTarget(${id.name}, ${transfer.name}, <redacted>)';
}

/// Response of `GET /:recordingId/playback`. No bytes are downloaded here.
class MinistryAudioPlayback {
  final MinistryAudioManifest manifest;
  final MinistryAudioTransfer transfer;

  /// Epoch milliseconds after which the temporary targets stop working.
  final int expiresAt;

  /// Targets in canonical stem order.
  final List<MinistryAudioTransferTarget> tracks;

  MinistryAudioPlayback._({
    required this.manifest,
    required this.transfer,
    required this.expiresAt,
    required List<MinistryAudioTransferTarget> tracks,
  }) : tracks = List.unmodifiable(tracks);

  bool isExpired(int nowMillis) => expiresAt <= nowMillis;

  @override
  String toString() =>
      'MinistryAudioPlayback(${manifest.recordingId}, ${transfer.name}, <redacted>)';

  static const _keys = {'manifest', 'tracks', 'expiresAt', 'transfer'};

  factory MinistryAudioPlayback.fromJson(Object? json) {
    final map = _asMap(json, 'reprodução');
    _exactKeys(map, _keys, 'reprodução');
    final manifest = MinistryAudioManifest.fromJson(map['manifest']);

    final rawTransfer = map['transfer'];
    final MinistryAudioTransfer transfer;
    if (rawTransfer == null) {
      transfer = MinistryAudioTransfer.legacy;
    } else if (rawTransfer == 'direct') {
      transfer = MinistryAudioTransfer.direct;
    } else {
      _invalid('modo de transferência');
    }
    final expiresAt = _asInt(map['expiresAt'], 'expiração');
    if (expiresAt <= 0) _invalid('expiração');

    final rawTracks = map['tracks'];
    if (rawTracks is! List || rawTracks.length != MinistryStemId.values.length) {
      _invalid('seis URLs de faixa são obrigatórias');
    }
    final byId = <MinistryStemId, MinistryAudioTransferTarget>{};
    for (final raw in rawTracks) {
      final target = _parseTrack(raw, transfer, manifest.recordingId);
      if (byId.containsKey(target.id)) _invalid('URL de faixa duplicada');
      byId[target.id] = target;
    }
    return MinistryAudioPlayback._(
      manifest: manifest,
      transfer: transfer,
      expiresAt: expiresAt,
      tracks: [for (final id in MinistryStemId.values) byId[id]!],
    );
  }

  static MinistryAudioTransferTarget _parseTrack(
    Object? raw,
    MinistryAudioTransfer transfer,
    String recordingId,
  ) {
    final map = _asMap(raw, 'URL de faixa');
    _exactKeys(map, const {'id', 'url', 'headers'}, 'URL de faixa');
    final id = MinistryStemId.parse(map['id'], 'id da URL de faixa');
    final url = map['url'];
    if (url is! String || url.isEmpty || url.length > 4096) _invalid('URL');

    if (transfer == MinistryAudioTransfer.direct) {
      final uri = Uri.tryParse(url);
      final ok = uri != null &&
          uri.hasAuthority &&
          uri.host.isNotEmpty &&
          uri.userInfo.isEmpty &&
          (uri.scheme == 'https' || uri.scheme == 'http');
      if (!ok) _invalid('URL de transferência direta');
    } else {
      final prefix = '/$recordingId/stems/${id.name}?ticket=';
      if (!url.startsWith(prefix) ||
          url.length == prefix.length ||
          url.contains('..')) {
        _invalid('URL de transferência legada');
      }
    }

    final rawHeaders = map['headers'];
    final headers = <String, String>{};
    if (rawHeaders != null) {
      if (rawHeaders is! Map) _invalid('cabeçalhos');
      for (final entry in rawHeaders.entries) {
        final key = entry.key;
        final value = entry.value;
        if (key is! String || value is! String) _invalid('cabeçalhos');
        headers[key] = value;
      }
    }
    return MinistryAudioTransferTarget._(
      id: id,
      transfer: transfer,
      url: url,
      headers: headers,
    );
  }
}
