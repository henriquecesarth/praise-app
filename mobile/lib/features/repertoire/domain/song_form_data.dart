import 'package:flutter/foundation.dart';
import 'song_detail.dart';
export 'song_detail.dart' show SongVersion, SongLink, songFieldOmitted, isLegacyOutOfRangeBpm;

/// Typed payload for creating or updating a song in Repertoire.
@immutable
class SongFormData {
  final String title;
  final Object? _artistId;
  final Object? _classificationId;
  final Object? _originalKey;
  final Object? _bpm;
  final Object? _duration;
  final Object? _lyrics;
  final Object? _notes;
  final Object? _chordSheetUrl;
  final Object? _youtubeUrl;
  final Object? _audioUrl;
  final Object? _externalLinks;
  final Object? _versions;

  const SongFormData({
    required this.title,
    Object? artistId = songFieldOmitted,
    Object? classificationId = songFieldOmitted,
    Object? originalKey = songFieldOmitted,
    Object? bpm = songFieldOmitted,
    Object? duration = songFieldOmitted,
    Object? lyrics = songFieldOmitted,
    Object? notes = songFieldOmitted,
    Object? chordSheetUrl = songFieldOmitted,
    Object? youtubeUrl = songFieldOmitted,
    Object? audioUrl = songFieldOmitted,
    Object? externalLinks = songFieldOmitted,
    Object? versions = songFieldOmitted,
  })  : _artistId = artistId,
        _classificationId = classificationId,
        _originalKey = originalKey,
        _bpm = bpm,
        _duration = duration,
        _lyrics = lyrics,
        _notes = notes,
        _chordSheetUrl = chordSheetUrl,
        _youtubeUrl = youtubeUrl,
        _audioUrl = audioUrl,
        _externalLinks = externalLinks,
        _versions = versions;

  String? get artistId =>
      isSongFieldOmitted(_artistId) ? null : _artistId as String?;

  List<SongVersion>? get versions => isSongFieldOmitted(_versions) || _versions == null
      ? null
      : List<SongVersion>.unmodifiable(_versions as List);

  String? get classificationId {
    if (!isSongFieldOmitted(_classificationId)) {
      return _classificationId as String?;
    }
    final vers = versions;
    if (vers != null &&
        vers.isNotEmpty &&
        vers.first.classificationIds.isNotEmpty) {
      return vers.first.classificationIds.first;
    }
    return null;
  }

  String? get originalKey {
    if (!isSongFieldOmitted(_originalKey)) {
      return _originalKey as String?;
    }
    final vers = versions;
    if (vers != null && vers.isNotEmpty) {
      return vers.first.key;
    }
    return null;
  }

  dynamic get bpm {
    if (!isSongFieldOmitted(_bpm)) {
      return parseBpmValue(_bpm);
    }
    final vers = versions;
    if (vers != null && vers.isNotEmpty) {
      return vers.first.bpm;
    }
    return null;
  }

  String? get duration {
    if (!isSongFieldOmitted(_duration)) {
      return _duration as String?;
    }
    final vers = versions;
    if (vers != null && vers.isNotEmpty) {
      return vers.first.duration;
    }
    return null;
  }

  String? get lyrics =>
      isSongFieldOmitted(_lyrics) ? null : _lyrics as String?;

  String? get notes =>
      isSongFieldOmitted(_notes) ? null : _notes as String?;

  String? get chordSheetUrl =>
      isSongFieldOmitted(_chordSheetUrl) ? null : _chordSheetUrl as String?;

  String? get youtubeUrl =>
      isSongFieldOmitted(_youtubeUrl) ? null : _youtubeUrl as String?;

  String? get audioUrl =>
      isSongFieldOmitted(_audioUrl) ? null : _audioUrl as String?;

  Map<String, String> get externalLinks =>
      isSongFieldOmitted(_externalLinks) || _externalLinks == null
          ? const {}
          : Map<String, String>.unmodifiable(_externalLinks as Map);

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'title': title.trim(),
    };

    if (!isSongFieldOmitted(_artistId)) {
      final a = artistId;
      map['artist_id'] = (a != null && a.trim().isNotEmpty) ? a.trim() : null;
    }

    if (!isSongFieldOmitted(_classificationId)) {
      final c = _classificationId as String?;
      map['classification_id'] =
          (c != null && c.trim().isNotEmpty) ? c.trim() : null;
    }

    if (!isSongFieldOmitted(_originalKey)) {
      final k = _originalKey as String?;
      map['original_key'] =
          (k != null && k.trim().isNotEmpty) ? k.trim() : null;
    }

    if (!isSongFieldOmitted(_bpm)) {
      if (!isLegacyOutOfRangeBpm(_bpm)) {
        map['bpm'] = parseBpmValue(_bpm);
      }
    }

    if (!isSongFieldOmitted(_duration)) {
      final d = _duration as String?;
      map['duration'] = (d != null && d.trim().isNotEmpty) ? d.trim() : null;
    }

    if (!isSongFieldOmitted(_lyrics)) {
      final l = lyrics;
      map['lyrics'] = (l != null && l.trim().isNotEmpty) ? l.trim() : null;
    }

    if (!isSongFieldOmitted(_notes)) {
      final n = notes;
      map['notes'] = (n != null && n.trim().isNotEmpty) ? n.trim() : null;
    }

    if (!isSongFieldOmitted(_chordSheetUrl)) {
      final u = chordSheetUrl;
      map['chord_sheet_url'] =
          (u != null && u.trim().isNotEmpty) ? u.trim() : null;
    }

    if (!isSongFieldOmitted(_youtubeUrl)) {
      final u = youtubeUrl;
      map['youtube_url'] =
          (u != null && u.trim().isNotEmpty) ? u.trim() : null;
    }

    if (!isSongFieldOmitted(_audioUrl)) {
      final u = audioUrl;
      map['audio_url'] = (u != null && u.trim().isNotEmpty) ? u.trim() : null;
    }

    if (!isSongFieldOmitted(_externalLinks)) {
      map['external_links'] = externalLinks;
    }

    if (!isSongFieldOmitted(_versions) && versions != null) {
      map['versions'] = versions!.map((v) => v.toJson()).toList();
    }

    return map;
  }

  SongFormData copyWith({
    String? title,
    Object? artistId = songFieldOmitted,
    Object? classificationId = songFieldOmitted,
    Object? originalKey = songFieldOmitted,
    Object? bpm = songFieldOmitted,
    Object? duration = songFieldOmitted,
    Object? lyrics = songFieldOmitted,
    Object? notes = songFieldOmitted,
    Object? chordSheetUrl = songFieldOmitted,
    Object? youtubeUrl = songFieldOmitted,
    Object? audioUrl = songFieldOmitted,
    Object? externalLinks = songFieldOmitted,
    Object? versions = songFieldOmitted,
  }) {
    return SongFormData(
      title: title ?? this.title,
      artistId: isSongFieldOmitted(artistId) ? _artistId : artistId,
      classificationId: isSongFieldOmitted(classificationId)
          ? _classificationId
          : classificationId,
      originalKey:
          isSongFieldOmitted(originalKey) ? _originalKey : originalKey,
      bpm: isSongFieldOmitted(bpm) ? _bpm : bpm,
      duration: isSongFieldOmitted(duration) ? _duration : duration,
      lyrics: isSongFieldOmitted(lyrics) ? _lyrics : lyrics,
      notes: isSongFieldOmitted(notes) ? _notes : notes,
      chordSheetUrl:
          isSongFieldOmitted(chordSheetUrl) ? _chordSheetUrl : chordSheetUrl,
      youtubeUrl: isSongFieldOmitted(youtubeUrl) ? _youtubeUrl : youtubeUrl,
      audioUrl: isSongFieldOmitted(audioUrl) ? _audioUrl : audioUrl,
      externalLinks:
          isSongFieldOmitted(externalLinks) ? _externalLinks : externalLinks,
      versions: isSongFieldOmitted(versions) ? _versions : versions,
    );
  }
}
