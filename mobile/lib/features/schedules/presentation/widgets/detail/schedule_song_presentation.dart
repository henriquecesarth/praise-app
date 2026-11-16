import 'package:flutter/material.dart';
import '../../../../repertoire/domain/classification.dart';
import '../../../../repertoire/domain/song_detail.dart';
import '../../../../repertoire/domain/song_summary.dart';
import '../../../domain/schedule.dart';

/// Resolved presentation view-model for a song scheduled in an event.
///
/// Combines schedule snapshot fields (`ScheduleSong` + `rawJson`) with
/// optional enriched repertoire `SongSummary` metadata without inventing data.
@immutable
class ScheduleSongPresentation {
  final int index;
  final ScheduleSong song;
  final String ordinalLabel;
  final String title;
  final String? artist;
  final String? versionName;
  final String? keyLabel;
  final String? classificationName;
  final Color? classificationColor;
  final bool hasChord;
  final bool hasLyrics;
  final String? audioUrl;
  final bool hasAudio;
  final String? youtubeUrl;
  final bool hasYoutube;

  const ScheduleSongPresentation({
    required this.index,
    required this.song,
    required this.ordinalLabel,
    required this.title,
    this.artist,
    this.versionName,
    this.keyLabel,
    this.classificationName,
    this.classificationColor,
    required this.hasChord,
    required this.hasLyrics,
    this.audioUrl,
    required this.hasAudio,
    this.youtubeUrl,
    required this.hasYoutube,
  });

  static String? _nonEmpty(dynamic raw) {
    if (raw is! String) return null;
    final trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  static Color? _parseColor(String? rawHex) => parseHexColor(rawHex);

  static SongVersion? _matchVersion(ScheduleSong song, SongSummary? summary) {
    if (summary == null || summary.versions.isEmpty) return null;
    final verId = song.versionId?.trim();
    if (verId != null && verId.isNotEmpty) {
      for (final v in summary.versions) {
        if ((v.id ?? '').trim() == verId) return v;
      }
    }
    return summary.versions.first;
  }

  factory ScheduleSongPresentation.fromScheduleSong({
    required int index,
    required ScheduleSong song,
    SongSummary? summary,
  }) {
    final raw = song.rawJson;
    final matchedVersion = _matchVersion(song, summary);

    // Classification (object map, string fallback, or enriched SongSummary)
    String? clsName;
    Color? clsColor;
    final rawCls = raw['classification'];
    if (rawCls is Map) {
      clsName = _nonEmpty(rawCls['name']);
      clsColor = _parseColor(_nonEmpty(rawCls['color']));
    } else {
      clsName = _nonEmpty(rawCls) ??
          _nonEmpty(raw['classificationName']) ??
          _nonEmpty(raw['classification_name']) ??
          _nonEmpty(raw['category']);
      clsColor = _parseColor(_nonEmpty(raw['classificationColor']));
    }
    if (clsName == null && summary?.classification != null) {
      clsName = _nonEmpty(summary!.classification!.name);
      clsColor ??= summary.classification!.displayColor;
    }

    // Links stored directly on active version or song snapshot
    String? findVersionLink(List<String> labels) {
      final version = matchedVersion;
      if (version == null) return null;
      for (final link in version.links) {
        final lower = link.label.trim().toLowerCase();
        if (labels.contains(lower) && link.url.trim().isNotEmpty) {
          return link.url.trim();
        }
      }
      return null;
    }

    String? findExternalLinks(List<String> keys) {
      final rawExt = raw['external_links'] ?? raw['externalLinks'];
      if (rawExt is! Map) return null;
      for (final k in keys) {
        final v = _nonEmpty(rawExt[k]);
        if (v != null) return v;
      }
      return null;
    }

    final youtubeUrl = _nonEmpty(raw['youtube_url'] ?? raw['youtubeUrl']) ??
        findExternalLinks(const ['youtube', 'video', 'vídeo']) ??
        findVersionLink(const ['vídeo', 'video', 'youtube']) ??
        _nonEmpty(summary?.youtubeUrl);
    final hasYoutube = youtubeUrl != null ||
        raw['has_youtube'] == true ||
        raw['hasYoutube'] == true ||
        (summary?.hasYoutube ?? false);

    final audioUrl = _nonEmpty(raw['audio_url'] ?? raw['audioUrl']) ??
        findExternalLinks(const ['audio', 'áudio']) ??
        findVersionLink(const ['áudio', 'audio']) ??
        _nonEmpty(summary?.audioUrl);
    final hasAudio =
        audioUrl != null || raw['has_audio'] == true || raw['hasAudio'] == true;

    final chordUrl =
        _nonEmpty(raw['chord_sheet_url'] ?? raw['chordSheetUrl']) ??
            findExternalLinks(const ['cifra', 'chord', 'chordSheet']) ??
            findVersionLink(const ['cifra']) ??
            _nonEmpty(summary?.chordSheetUrl);
    final smartChordsCount = raw['smart_chords_count'] ?? raw['smartChordsCount'];
    final hasChord = chordUrl != null ||
        raw['has_chord'] == true ||
        raw['hasChord'] == true ||
        raw['has_smart_chords'] == true ||
        raw['hasSmartChords'] == true ||
        (smartChordsCount is num && smartChordsCount > 0);

    final hasLyrics = raw['has_lyrics'] == true ||
        raw['hasLyrics'] == true ||
        _nonEmpty(raw['lyrics']) != null ||
        (summary?.hasLyrics ?? false);

    final resolvedTitle = _nonEmpty(song.title) ??
        _nonEmpty(summary?.title) ??
        'Música ${index + 1}';
    final resolvedArtist =
        _nonEmpty(song.artist) ?? _nonEmpty(summary?.artistName);
    final resolvedVersionName =
        _nonEmpty(song.versionName) ?? _nonEmpty(matchedVersion?.name);
    final resolvedKey = _nonEmpty(song.key) ??
        _nonEmpty(matchedVersion?.key) ??
        _nonEmpty(summary?.displayKey);

    return ScheduleSongPresentation(
      index: index,
      song: song,
      ordinalLabel: '${index + 1}ª',
      title: resolvedTitle,
      artist: resolvedArtist,
      versionName: resolvedVersionName,
      keyLabel: resolvedKey,
      classificationName: clsName,
      classificationColor: clsColor,
      hasChord: hasChord,
      hasLyrics: hasLyrics,
      audioUrl: audioUrl,
      hasAudio: hasAudio,
      youtubeUrl: youtubeUrl,
      hasYoutube: hasYoutube,
    );
  }
}
