import 'package:flutter/foundation.dart';
import 'classification.dart';

/// Full detail model representing a song for native viewing.
/// Matches the backend DTO Song.
@immutable
class SongDetail {
  final String id;
  final String ministryId;
  final String title;
  final String? artistName;
  final SongClassificationRef? classification;
  final String? originalKey;
  final int? bpm;
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

  const SongDetail({
    required this.id,
    required this.ministryId,
    required this.title,
    this.artistName,
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
  });

  factory SongDetail.fromJson(Map<String, dynamic> json) {
    // Artist handling: object { id, name } or string or null
    String? resolvedArtist;
    final rawArtist = json['artist'];
    if (rawArtist is Map) {
      resolvedArtist = rawArtist['name']?.toString();
    } else if (rawArtist is String && rawArtist.isNotEmpty) {
      resolvedArtist = rawArtist;
    }

    // Classification handling: object { id, name, color } or null
    SongClassificationRef? resolvedClassification;
    final rawClass = json['classification'];
    if (rawClass is Map<String, dynamic>) {
      resolvedClassification = SongClassificationRef.fromJson(rawClass);
    } else if (rawClass is Map) {
      resolvedClassification = SongClassificationRef.fromJson(
        Map<String, dynamic>.from(rawClass),
      );
    }

    final youtubeUrl = json['youtube_url']?.toString();
    final hasYoutube = json['has_youtube'] == true ||
        (youtubeUrl != null && youtubeUrl.trim().isNotEmpty);

    // External links handling: map of string to string
    final externalLinks = <String, String>{};
    final rawLinks = json['external_links'];
    if (rawLinks is Map) {
      rawLinks.forEach((key, value) {
        if (key != null && value != null) {
          externalLinks[key.toString()] = value.toString();
        }
      });
    }

    return SongDetail(
      id: json['id']?.toString() ?? '',
      ministryId: json['ministry_id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      artistName: resolvedArtist,
      classification: resolvedClassification,
      originalKey: json['original_key']?.toString(),
      bpm: json['bpm'] != null ? (json['bpm'] as num).toInt() : null,
      duration: json['duration']?.toString(),
      hasYoutube: hasYoutube,
      youtubeUrl: youtubeUrl,
      audioUrl: json['audio_url']?.toString(),
      lyrics: json['lyrics']?.toString(),
      chordSheetUrl: json['chord_sheet_url']?.toString(),
      externalLinks: externalLinks,
      notes: json['notes']?.toString(),
      updatedAt: json['updated_at']?.toString(),
      createdAt: json['created_at']?.toString(),
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

  /// Check if any link (YouTube, audio, chord sheet, external links) is available.
  bool get hasAnyLinks =>
      (youtubeUrl != null && youtubeUrl!.trim().isNotEmpty) ||
      (chordSheetUrl != null && chordSheetUrl!.trim().isNotEmpty) ||
      (audioUrl != null && audioUrl!.trim().isNotEmpty) ||
      externalLinks.isNotEmpty;

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
