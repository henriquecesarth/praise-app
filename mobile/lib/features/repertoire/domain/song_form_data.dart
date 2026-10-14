import 'package:flutter/foundation.dart';

/// Typed payload for creating or updating a song in Repertoire.
@immutable
class SongFormData {
  final String title;
  final String? artistId;
  final String? classificationId;
  final String? originalKey;
  final int? bpm;
  final String? duration;
  final String? lyrics;
  final String? chordSheetUrl;
  final String? youtubeUrl;
  final String? audioUrl;
  final Map<String, String> externalLinks;

  const SongFormData({
    required this.title,
    this.artistId,
    this.classificationId,
    this.originalKey,
    this.bpm,
    this.duration,
    this.lyrics,
    this.chordSheetUrl,
    this.youtubeUrl,
    this.audioUrl,
    this.externalLinks = const {},
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'title': title.trim(),
    };

    if (artistId != null && artistId!.trim().isNotEmpty) {
      map['artist_id'] = artistId!.trim();
    } else {
      map['artist_id'] = null;
    }

    if (classificationId != null && classificationId!.trim().isNotEmpty) {
      map['classification_id'] = classificationId!.trim();
    } else {
      map['classification_id'] = null;
    }

    if (originalKey != null && originalKey!.trim().isNotEmpty) {
      map['original_key'] = originalKey!.trim();
    } else {
      map['original_key'] = null;
    }

    if (bpm != null) {
      map['bpm'] = bpm;
    } else {
      map['bpm'] = null;
    }

    if (duration != null && duration!.trim().isNotEmpty) {
      map['duration'] = duration!.trim();
    } else {
      map['duration'] = null;
    }

    if (lyrics != null && lyrics!.trim().isNotEmpty) {
      map['lyrics'] = lyrics!.trim();
    } else {
      map['lyrics'] = null;
    }

    if (chordSheetUrl != null && chordSheetUrl!.trim().isNotEmpty) {
      map['chord_sheet_url'] = chordSheetUrl!.trim();
    } else {
      map['chord_sheet_url'] = null;
    }

    if (youtubeUrl != null && youtubeUrl!.trim().isNotEmpty) {
      map['youtube_url'] = youtubeUrl!.trim();
    } else {
      map['youtube_url'] = null;
    }

    if (audioUrl != null && audioUrl!.trim().isNotEmpty) {
      map['audio_url'] = audioUrl!.trim();
    } else {
      map['audio_url'] = null;
    }

    if (externalLinks.isNotEmpty) {
      map['external_links'] = externalLinks;
    }

    return map;
  }

  SongFormData copyWith({
    String? title,
    String? artistId,
    String? classificationId,
    String? originalKey,
    int? bpm,
    String? duration,
    String? lyrics,
    String? chordSheetUrl,
    String? youtubeUrl,
    String? audioUrl,
    Map<String, String>? externalLinks,
  }) {
    return SongFormData(
      title: title ?? this.title,
      artistId: artistId ?? this.artistId,
      classificationId: classificationId ?? this.classificationId,
      originalKey: originalKey ?? this.originalKey,
      bpm: bpm ?? this.bpm,
      duration: duration ?? this.duration,
      lyrics: lyrics ?? this.lyrics,
      chordSheetUrl: chordSheetUrl ?? this.chordSheetUrl,
      youtubeUrl: youtubeUrl ?? this.youtubeUrl,
      audioUrl: audioUrl ?? this.audioUrl,
      externalLinks: externalLinks ?? this.externalLinks,
    );
  }
}
