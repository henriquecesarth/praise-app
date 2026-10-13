class SmartChord {
  final String id;
  final String userId;
  final String title;
  final String? artistId;
  final String? songId;
  final String originalKey;
  final String content;
  final String createdAt;
  final String updatedAt;
  final String? artistName;
  final String? songTitle;

  const SmartChord({
    required this.id,
    required this.userId,
    required this.title,
    this.artistId,
    this.songId,
    required this.originalKey,
    required this.content,
    required this.createdAt,
    required this.updatedAt,
    this.artistName,
    this.songTitle,
  });

  bool get hasLinkedSong => songId != null && songId!.trim().isNotEmpty;
  bool get hasLinkedArtist => artistId != null && artistId!.trim().isNotEmpty;

  factory SmartChord.fromJson(Map<String, dynamic> json) {
    String? resolvedArtistName;
    if (json['artist'] is Map<String, dynamic>) {
      resolvedArtistName = (json['artist'] as Map<String, dynamic>)['name'] as String?;
    } else if (json['artist_name'] is String) {
      resolvedArtistName = json['artist_name'] as String;
    }

    String? resolvedSongTitle;
    if (json['song'] is Map<String, dynamic>) {
      resolvedSongTitle = (json['song'] as Map<String, dynamic>)['title'] as String?;
    } else if (json['song_title'] is String) {
      resolvedSongTitle = json['song_title'] as String;
    }

    return SmartChord(
      id: (json['id'] as String?) ?? '',
      userId: (json['user_id'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      artistId: json['artist_id'] as String?,
      songId: json['song_id'] as String?,
      originalKey: (json['original_key'] as String?) ?? 'C',
      content: (json['content'] as String?) ?? '',
      createdAt: (json['created_at'] as String?) ?? '',
      updatedAt: (json['updated_at'] as String?) ?? '',
      artistName: resolvedArtistName,
      songTitle: resolvedSongTitle,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'title': title,
      if (artistId != null) 'artist_id': artistId,
      if (songId != null) 'song_id': songId,
      'original_key': originalKey,
      'content': content,
      'created_at': createdAt,
      'updated_at': updatedAt,
      if (artistName != null) 'artist': {'id': artistId, 'name': artistName},
      if (songTitle != null) 'song': {'id': songId, 'title': songTitle},
    };
  }

  Map<String, dynamic> toRequestPayload() {
    return {
      'title': title.trim(),
      'original_key': originalKey.trim(),
      'content': content,
      'artist_id': (artistId != null && artistId!.trim().isNotEmpty) ? artistId!.trim() : null,
      'song_id': (songId != null && songId!.trim().isNotEmpty) ? songId!.trim() : null,
    };
  }

  SmartChord copyWith({
    String? id,
    String? userId,
    String? title,
    String? artistId,
    bool clearArtistId = false,
    String? songId,
    bool clearSongId = false,
    String? originalKey,
    String? content,
    String? createdAt,
    String? updatedAt,
    String? artistName,
    bool clearArtistName = false,
    String? songTitle,
    bool clearSongTitle = false,
  }) {
    return SmartChord(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      title: title ?? this.title,
      artistId: clearArtistId ? null : (artistId ?? this.artistId),
      songId: clearSongId ? null : (songId ?? this.songId),
      originalKey: originalKey ?? this.originalKey,
      content: content ?? this.content,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      artistName: clearArtistName ? null : (artistName ?? this.artistName),
      songTitle: clearSongTitle ? null : (songTitle ?? this.songTitle),
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is SmartChord &&
        other.id == id &&
        other.userId == userId &&
        other.title == title &&
        other.artistId == artistId &&
        other.songId == songId &&
        other.originalKey == originalKey &&
        other.content == content &&
        other.createdAt == createdAt &&
        other.updatedAt == updatedAt;
  }

  @override
  int get hashCode {
    return Object.hash(
      id,
      userId,
      title,
      artistId,
      songId,
      originalKey,
      content,
      createdAt,
      updatedAt,
    );
  }
}
