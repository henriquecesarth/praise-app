import 'package:flutter/foundation.dart';
import 'classification.dart';

class _SongFieldOmitted {
  const _SongFieldOmitted();
}

const Object songFieldOmitted = _SongFieldOmitted();

/// Checks if a field value is the omitted sentinel.
bool isSongFieldOmitted(Object? value) => value is _SongFieldOmitted;

/// Checks if a BPM value is a legacy out-of-range value that cannot be accepted
/// by current backend write schemas and should be omitted on unrelated edits.
bool isLegacyOutOfRangeBpm(Object? value) {
  if (value == null || isSongFieldOmitted(value)) return false;
  if (value is num) {
    return value <= 0 || value > 999 || value.isNaN || value.isInfinite;
  }
  if (value is String) {
    return value.length > 10;
  }
  return false;
}

/// Parses a numeric or string BPM value.
///
/// When [trimString] is false (default, for stored / API values):
/// - Strings are preserved verbatim as [String] (empty strings become null).
/// - Numeric values are normalized to [int] (if whole) or [double] (if fractional).
///
/// When [trimString] is true (for validating explicit user-entered drafts in forms):
/// - Numeric drafts outside (0..999] are rejected (returns null).
/// - Non-empty string drafts up to 10 characters are accepted.
/// - Whitespace-only or strings longer than 10 characters are rejected (returns null).
dynamic parseBpmValue(Object? raw, {bool trimString = false}) {
  if (raw == null || isSongFieldOmitted(raw)) return null;

  if (raw is num) {
    if (raw.isNaN || raw.isInfinite) return null;
    if (trimString && (raw <= 0 || raw > 999)) return null;
    return (raw == raw.truncateToDouble()) ? raw.toInt() : raw.toDouble();
  }

  if (raw is String) {
    if (!trimString) {
      if (raw.isEmpty) return null;
      return raw;
    }

    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;

    final intVal = int.tryParse(trimmed);
    if (intVal != null) {
      return (intVal > 0 && intVal <= 999) ? intVal : null;
    }

    final doubleVal = double.tryParse(trimmed);
    if (doubleVal != null) {
      if (doubleVal.isNaN || doubleVal.isInfinite || doubleVal <= 0 || doubleVal > 999) {
        return null;
      }
      return (doubleVal == doubleVal.truncateToDouble())
          ? doubleVal.toInt()
          : doubleVal;
    }

    if (trimmed.length <= 10) {
      return trimmed;
    }
    return null;
  }

  return null;
}

/// Represents a resource link attached to a specific song version.
@immutable
class SongLink {
  final String? id;
  final String label;
  final String url;
  final bool isCustom;

  const SongLink({
    this.id,
    required this.label,
    required this.url,
    this.isCustom = false,
  });

  factory SongLink.fromJson(Map<String, dynamic> json) {
    return SongLink(
      id: json['id']?.toString(),
      label: json['label']?.toString() ?? '',
      url: json['url']?.toString() ?? '',
      isCustom: json['isCustom'] == true || json['is_custom'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null && id!.trim().isNotEmpty) 'id': id!.trim(),
      'label': label.trim(),
      'url': url.trim(),
      if (isCustom) 'isCustom': true,
    };
  }

  SongLink copyWith({
    String? id,
    String? label,
    String? url,
    bool? isCustom,
  }) {
    return SongLink(
      id: id ?? this.id,
      label: label ?? this.label,
      url: url ?? this.url,
      isCustom: isCustom ?? this.isCustom,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SongLink &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          label == other.label &&
          url == other.url &&
          isCustom == other.isCustom;

  @override
  int get hashCode =>
      id.hashCode ^ label.hashCode ^ url.hashCode ^ isCustom.hashCode;
}

/// Represents a musical version (arrangement) of a repertoire song.
@immutable
class SongVersion {
  final String? id;
  final String name;
  final Object? _classificationIds;
  final Object? _notes;
  final Object? _key;
  final Object? _bpm;
  final Object? _duration;
  final Object? _links;

  const SongVersion({
    this.id,
    required this.name,
    Object? classificationIds = songFieldOmitted,
    Object? notes = songFieldOmitted,
    Object? key = songFieldOmitted,
    Object? bpm = songFieldOmitted,
    Object? duration = songFieldOmitted,
    Object? links = songFieldOmitted,
  })  : _classificationIds = classificationIds,
        _notes = notes,
        _key = key,
        _bpm = bpm,
        _duration = duration,
        _links = links;

  List<String> get classificationIds =>
      (_classificationIds is _SongFieldOmitted || _classificationIds == null)
          ? const []
          : List<String>.unmodifiable(_classificationIds as List);

  String? get notes =>
      _notes is _SongFieldOmitted ? null : _notes as String?;

  String? get key => _key is _SongFieldOmitted ? null : _key as String?;

  dynamic get bpm => parseBpmValue(_bpm);

  String? get duration =>
      _duration is _SongFieldOmitted ? null : _duration as String?;

  List<SongLink> get links =>
      (_links is _SongFieldOmitted || _links == null)
          ? const []
          : List<SongLink>.unmodifiable(_links as List);

  factory SongVersion.fromJson(Map<String, dynamic> json, {int index = 0}) {
    final rawId = json['id']?.toString().trim();
    final id = (rawId != null && rawId.isNotEmpty) ? rawId : 'v_${index + 1}';

    final rawName = json['name']?.toString().trim();
    final name = (rawName != null && rawName.isNotEmpty)
        ? rawName
        : (index == 0 ? 'Original' : 'Versão ${index + 1}');

    List<String> parsedClassificationIds = const [];
    final rawClassIds = json['classificationIds'] ?? json['classification_ids'];
    if (rawClassIds is List) {
      parsedClassificationIds = rawClassIds
          .where((e) => e != null && e.toString().trim().isNotEmpty)
          .map((e) => e.toString().trim())
          .toList();
    } else {
      final singleClassId =
          (json['classificationId'] ?? json['classification_id'])
              ?.toString()
              .trim();
      if (singleClassId != null && singleClassId.isNotEmpty) {
        parsedClassificationIds = [singleClassId];
      }
    }

    final rawNotes = json['notes']?.toString();
    final notes =
        (rawNotes != null && rawNotes.trim().isNotEmpty) ? rawNotes : null;

    final rawKey = json.containsKey('key')
        ? json['key']
        : (json.containsKey('original_key')
            ? json['original_key']
            : json['originalKey']);
    final key = (rawKey != null && rawKey.toString().trim().isNotEmpty)
        ? rawKey.toString().trim()
        : null;

    final dynamic bpm = parseBpmValue(json['bpm']);

    final rawDuration = json['duration']?.toString();
    final duration = (rawDuration != null && rawDuration.trim().isNotEmpty)
        ? rawDuration.trim()
        : null;

    List<SongLink> parsedLinks = const [];
    final rawLinks = json['links'];
    if (rawLinks is List) {
      parsedLinks = rawLinks
          .whereType<Map>()
          .map((m) => SongLink.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    }

    return SongVersion(
      id: id,
      name: name,
      classificationIds: parsedClassificationIds,
      notes: notes,
      key: key,
      bpm: bpm,
      duration: duration,
      links: parsedLinks,
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      if (id != null && id!.trim().isNotEmpty) 'id': id!.trim(),
      'name': name.trim(),
    };

    if (_classificationIds is! _SongFieldOmitted) {
      final ids = classificationIds;
      map['classificationIds'] = ids;
      map['classification_ids'] = ids;
    }

    if (_notes is! _SongFieldOmitted) {
      final n = notes;
      map['notes'] = (n != null && n.trim().isNotEmpty) ? n.trim() : null;
    }

    if (_key is! _SongFieldOmitted) {
      final k = key;
      map['key'] = (k != null && k.trim().isNotEmpty) ? k.trim() : null;
    }

    if (_bpm is! _SongFieldOmitted) {
      if (!isLegacyOutOfRangeBpm(_bpm)) {
        map['bpm'] = bpm;
      }
    }

    if (_duration is! _SongFieldOmitted) {
      final d = duration;
      map['duration'] = (d != null && d.trim().isNotEmpty) ? d.trim() : null;
    }

    if (_links is! _SongFieldOmitted) {
      map['links'] = links
          .where((l) => l.label.trim().isNotEmpty && l.url.trim().isNotEmpty)
          .map((l) => l.toJson())
          .toList();
    }

    return map;
  }

  SongVersion copyWith({
    Object? id = songFieldOmitted,
    String? name,
    Object? classificationIds = songFieldOmitted,
    Object? notes = songFieldOmitted,
    Object? key = songFieldOmitted,
    Object? bpm = songFieldOmitted,
    Object? duration = songFieldOmitted,
    Object? links = songFieldOmitted,
  }) {
    return SongVersion(
      id: id is _SongFieldOmitted ? this.id : id as String?,
      name: name ?? this.name,
      classificationIds: classificationIds is _SongFieldOmitted
          ? _classificationIds
          : classificationIds,
      notes: notes is _SongFieldOmitted ? _notes : notes,
      key: key is _SongFieldOmitted ? _key : key,
      bpm: bpm is _SongFieldOmitted ? _bpm : bpm,
      duration: duration is _SongFieldOmitted ? _duration : duration,
      links: links is _SongFieldOmitted ? _links : links,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SongVersion &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          listEquals(classificationIds, other.classificationIds) &&
          notes == other.notes &&
          key == other.key &&
          bpm == other.bpm &&
          duration == other.duration &&
          listEquals(links, other.links);

  @override
  int get hashCode =>
      id.hashCode ^
      name.hashCode ^
      Object.hashAll(classificationIds) ^
      notes.hashCode ^
      key.hashCode ^
      bpm.hashCode ^
      duration.hashCode ^
      Object.hashAll(links);
}

/// Full detail model representing a song for native viewing.
/// Matches the backend DTO Song.
@immutable
class SongDetail {
  final String id;
  final String ministryId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? classificationId;
  final SongClassificationRef? classification;
  final String? originalKey;
  final dynamic bpm;
  final String? duration;
  final bool hasYoutube;
  final String? youtubeUrl;
  final String? audioUrl;
  final String? lyrics;
  final String? chordSheetUrl;
  final Map<String, String> externalLinks;
  final String? notes;
  final String? updatedAt;
  final String? createdAt;
  final List<SongVersion> versions;

  const SongDetail({
    required this.id,
    required this.ministryId,
    required this.title,
    this.artistId,
    this.artistName,
    this.classificationId,
    this.classification,
    this.originalKey,
    this.bpm,
    this.duration,
    this.hasYoutube = false,
    this.youtubeUrl,
    this.audioUrl,
    this.lyrics,
    this.chordSheetUrl,
    this.externalLinks = const {},
    this.notes,
    this.updatedAt,
    this.createdAt,
    this.versions = const [],
  });

  /// Returns persisted [versions], or synthesizes a single fallback 'Original'
  /// version from legacy flat fields when [versions] is empty.
  List<SongVersion> get effectiveVersions {
    if (versions.isNotEmpty) return versions;
    return [_synthesizeDefaultVersion()];
  }

  SongVersion _synthesizeDefaultVersion({String? versionNotes}) {
    final defaultLinks = <SongLink>[];
    if (chordSheetUrl != null && chordSheetUrl!.trim().isNotEmpty) {
      defaultLinks.add(SongLink(label: 'Cifra', url: chordSheetUrl!.trim()));
    }
    if (youtubeUrl != null && youtubeUrl!.trim().isNotEmpty) {
      defaultLinks.add(SongLink(label: 'Vídeo', url: youtubeUrl!.trim()));
    }
    if (audioUrl != null && audioUrl!.trim().isNotEmpty) {
      defaultLinks.add(SongLink(label: 'Áudio', url: audioUrl!.trim()));
    }
    externalLinks.forEach((k, v) {
      if (v.trim().isNotEmpty) {
        final lower = k.trim().toLowerCase();
        final isCustom = ![
          'letra',
          'letras',
          'cifra',
          'áudio',
          'audio',
          'vídeo',
          'video',
        ].contains(lower);
        defaultLinks.add(
          SongLink(label: k.trim(), url: v.trim(), isCustom: isCustom),
        );
      }
    });

    final classIds =
        (classificationId != null && classificationId!.trim().isNotEmpty)
            ? <String>[classificationId!.trim()]
            : const <String>[];

    final resolvedKey =
        (originalKey != null && originalKey!.trim().isNotEmpty)
            ? originalKey!.trim()
            : null;

    return SongVersion(
      id: id.trim().isNotEmpty ? '${id.trim()}_v1' : 'v1',
      name: 'Original',
      classificationIds: classIds,
      notes: versionNotes,
      key: resolvedKey,
      bpm: bpm,
      duration:
          (duration != null && duration!.trim().isNotEmpty) ? duration!.trim() : null,
      links: defaultLinks,
    );
  }

  factory SongDetail.fromJson(Map<String, dynamic> json) {
    final songId = json['id']?.toString() ?? '';

    // Artist handling: object { id, name } or string or null.
    // Free-text artists ({id: '', name: '...'}) normalize artistId to null
    // while preserving artistName.
    String? resolvedArtist;
    final rawArtistId = json['artist_id']?.toString().trim();
    String? resolvedArtistId =
        (rawArtistId != null && rawArtistId.isNotEmpty) ? rawArtistId : null;
    final rawArtist = json['artist'];
    if (rawArtist is Map) {
      final mapName = rawArtist['name']?.toString().trim();
      if (mapName != null && mapName.isNotEmpty) {
        resolvedArtist = mapName;
      }
      final mapId = rawArtist['id']?.toString().trim();
      if (resolvedArtistId == null && mapId != null && mapId.isNotEmpty) {
        resolvedArtistId = mapId;
      }
    } else if (rawArtist is String && rawArtist.trim().isNotEmpty) {
      resolvedArtist = rawArtist.trim();
    }
    final fallbackArtistName = json['artist_name']?.toString().trim();
    if (resolvedArtist == null &&
        fallbackArtistName != null &&
        fallbackArtistName.isNotEmpty) {
      resolvedArtist = fallbackArtistName;
    }

    // Classification handling: object { id, name, color } or null
    String? resolvedClassificationId = json['classification_id']?.toString();
    SongClassificationRef? resolvedClassification;
    final rawClass = json['classification'];
    if (rawClass is Map<String, dynamic>) {
      resolvedClassification = SongClassificationRef.fromJson(rawClass);
      resolvedClassificationId ??= resolvedClassification.id;
    } else if (rawClass is Map) {
      resolvedClassification = SongClassificationRef.fromJson(
        Map<String, dynamic>.from(rawClass),
      );
      resolvedClassificationId ??= resolvedClassification.id;
    }

    // External links handling: map of string to string
    final externalLinks = <String, String>{};
    final rawLinks = json['external_links'];
    if (rawLinks is Map) {
      rawLinks.forEach((key, value) {
        if (key != null && value != null && value.toString().trim().isNotEmpty) {
          externalLinks[key.toString()] = value.toString();
        }
      });
    }

    final rawFlatKey = json['original_key']?.toString();
    final flatKey = (rawFlatKey != null && rawFlatKey.trim().isNotEmpty)
        ? rawFlatKey.trim()
        : null;

    final dynamic flatBpm = parseBpmValue(json['bpm']);

    final flatDuration = json['duration']?.toString();
    final flatYoutubeUrl = json['youtube_url']?.toString();
    final flatAudioUrl = json['audio_url']?.toString();
    final flatChordSheetUrl = json['chord_sheet_url']?.toString();

    // Parse versions array or synthesize legacy default version
    List<SongVersion> parsedVersions = [];
    final rawVersions = json['versions'];
    if (rawVersions is List && rawVersions.isNotEmpty) {
      int idx = 0;
      for (final item in rawVersions) {
        if (item is Map) {
          parsedVersions.add(
            SongVersion.fromJson(
              Map<String, dynamic>.from(item),
              index: idx,
            ),
          );
          idx++;
        }
      }
    }

    if (parsedVersions.isEmpty) {
      final defaultLinks = <SongLink>[];
      if (flatChordSheetUrl != null && flatChordSheetUrl.trim().isNotEmpty) {
        defaultLinks.add(
          SongLink(label: 'Cifra', url: flatChordSheetUrl.trim()),
        );
      }
      if (flatYoutubeUrl != null && flatYoutubeUrl.trim().isNotEmpty) {
        defaultLinks.add(SongLink(label: 'Vídeo', url: flatYoutubeUrl.trim()));
      }
      if (flatAudioUrl != null && flatAudioUrl.trim().isNotEmpty) {
        defaultLinks.add(SongLink(label: 'Áudio', url: flatAudioUrl.trim()));
      }
      externalLinks.forEach((k, v) {
        if (v.trim().isNotEmpty) {
          final lower = k.trim().toLowerCase();
          final isCustom = ![
            'letra',
            'letras',
            'cifra',
            'áudio',
            'audio',
            'vídeo',
            'video',
          ].contains(lower);
          defaultLinks.add(
            SongLink(label: k.trim(), url: v.trim(), isCustom: isCustom),
          );
        }
      });

      final legacyClassIds = <String>[];
      if (resolvedClassificationId != null &&
          resolvedClassificationId.trim().isNotEmpty) {
        legacyClassIds.add(resolvedClassificationId.trim());
      } else if (json['classification_ids'] is List) {
        for (final c in json['classification_ids'] as List) {
          if (c != null && c.toString().trim().isNotEmpty) {
            legacyClassIds.add(c.toString().trim());
          }
        }
      }

      parsedVersions = [
        SongVersion(
          id: songId.trim().isNotEmpty ? '${songId.trim()}_v1' : 'v1',
          name: 'Original',
          classificationIds: legacyClassIds,
          notes: json['version_notes']?.toString(),
          key: flatKey,
          bpm: flatBpm,
          duration: (flatDuration != null && flatDuration.trim().isNotEmpty)
              ? flatDuration.trim()
              : null,
          links: defaultLinks,
        ),
      ];
    }

    final primary = parsedVersions.first;
    final effectiveKey = flatKey ?? primary.key;
    final effectiveBpm = flatBpm ?? primary.bpm;
    final effectiveDuration =
        (flatDuration != null && flatDuration.trim().isNotEmpty)
            ? flatDuration
            : primary.duration;
    final effectiveClassificationId =
        (resolvedClassificationId != null &&
                resolvedClassificationId.trim().isNotEmpty)
            ? resolvedClassificationId
            : (primary.classificationIds.isNotEmpty
                ? primary.classificationIds.first
                : null);

    String? findPrimaryLink(List<String> labels) {
      for (final l in primary.links) {
        if (labels.contains(l.label.trim().toLowerCase()) &&
            l.url.trim().isNotEmpty) {
          return l.url.trim();
        }
      }
      return null;
    }

    final effectiveYoutubeUrl =
        (flatYoutubeUrl != null && flatYoutubeUrl.trim().isNotEmpty)
            ? flatYoutubeUrl
            : findPrimaryLink(const ['vídeo', 'video', 'youtube']);
    final effectiveAudioUrl =
        (flatAudioUrl != null && flatAudioUrl.trim().isNotEmpty)
            ? flatAudioUrl
            : findPrimaryLink(const ['áudio', 'audio', 'mp3']);
    final effectiveChordSheetUrl =
        (flatChordSheetUrl != null && flatChordSheetUrl.trim().isNotEmpty)
            ? flatChordSheetUrl
            : findPrimaryLink(const ['cifra', 'chord', 'chords']);

    final hasYoutube = json['has_youtube'] == true ||
        (effectiveYoutubeUrl != null && effectiveYoutubeUrl.trim().isNotEmpty);

    return SongDetail(
      id: songId,
      ministryId: json['ministry_id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      artistId: resolvedArtistId,
      artistName: resolvedArtist,
      classificationId: effectiveClassificationId,
      classification: resolvedClassification,
      originalKey: effectiveKey,
      bpm: effectiveBpm,
      duration: effectiveDuration,
      hasYoutube: hasYoutube,
      youtubeUrl: effectiveYoutubeUrl,
      audioUrl: effectiveAudioUrl,
      lyrics: json['lyrics']?.toString(),
      chordSheetUrl: effectiveChordSheetUrl,
      externalLinks: externalLinks,
      notes: json['notes']?.toString(),
      updatedAt: json['updated_at']?.toString(),
      createdAt: json['created_at']?.toString(),
      versions: parsedVersions,
    );
  }

  /// Display helper for artist or fallback.
  String get displayArtist =>
      (artistName != null && artistName!.trim().isNotEmpty)
          ? artistName!
          : 'Artista não informado';

  /// Display helper for musical key badge.
  String? get displayKey {
    if (originalKey == null || originalKey!.trim().isEmpty) return null;
    return originalKey!.trim();
  }

  /// Check if readable lyrics are present.
  bool get hasLyrics => lyrics != null && lyrics!.trim().isNotEmpty;

  /// Check if notes are present.
  bool get hasNotes => notes != null && notes!.trim().isNotEmpty;

  /// Check if any link (YouTube, audio, chord sheet, external links, or version links) is available.
  bool get hasAnyLinks =>
      (youtubeUrl != null && youtubeUrl!.trim().isNotEmpty) ||
      (chordSheetUrl != null && chordSheetUrl!.trim().isNotEmpty) ||
      (audioUrl != null && audioUrl!.trim().isNotEmpty) ||
      externalLinks.isNotEmpty ||
      effectiveVersions.any(
        (v) => v.links.any((l) => l.url.trim().isNotEmpty),
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SongDetail &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode;
}
