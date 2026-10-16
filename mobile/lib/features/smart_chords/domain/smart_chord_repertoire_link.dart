class SmartChordSongLink {
  final String id;
  final String userId;
  final String smartChordId;
  final String ministryId;
  final String songId;
  final String createdAt;
  final String updatedAt;

  const SmartChordSongLink({
    required this.id,
    required this.userId,
    required this.smartChordId,
    required this.ministryId,
    required this.songId,
    this.createdAt = '',
    this.updatedAt = '',
  });

  factory SmartChordSongLink.fromJson(Map<String, dynamic> json) {
    return SmartChordSongLink(
      id: (json['id'] as String?) ?? '',
      userId: (json['user_id'] as String?) ?? (json['userId'] as String?) ?? '',
      smartChordId: (json['smart_chord_id'] as String?) ?? (json['smartChordId'] as String?) ?? '',
      ministryId: (json['ministry_id'] as String?) ?? (json['ministryId'] as String?) ?? '',
      songId: (json['song_id'] as String?) ?? (json['songId'] as String?) ?? '',
      createdAt: (json['created_at'] as String?) ?? (json['createdAt'] as String?) ?? '',
      updatedAt: (json['updated_at'] as String?) ?? (json['updatedAt'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'smart_chord_id': smartChordId,
      'ministry_id': ministryId,
      'song_id': songId,
      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordSongLink &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          userId == other.userId &&
          smartChordId == other.smartChordId &&
          ministryId == other.ministryId &&
          songId == other.songId;

  @override
  int get hashCode =>
      id.hashCode ^
      userId.hashCode ^
      smartChordId.hashCode ^
      ministryId.hashCode ^
      songId.hashCode;
}

class SmartChordSongSummary {
  final String id;
  final String ministryId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? originalKey;

  const SmartChordSongSummary({
    required this.id,
    this.ministryId = '',
    required this.title,
    this.artistId,
    this.artistName,
    this.originalKey,
  });

  factory SmartChordSongSummary.fromJson(Map<String, dynamic> json) {
    return SmartChordSongSummary(
      id: (json['id'] as String?) ?? '',
      ministryId: (json['ministry_id'] as String?) ?? (json['ministryId'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      artistId: json['artist_id'] as String? ?? json['artistId'] as String?,
      artistName: json['artist_name'] as String? ?? json['artistName'] as String?,
      originalKey: json['original_key'] as String? ?? json['originalKey'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ministry_id': ministryId,
      'title': title,
      if (artistId != null) 'artist_id': artistId,
      if (artistName != null) 'artist_name': artistName,
      if (originalKey != null) 'original_key': originalKey,
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordSongSummary &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          title == other.title;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode ^ title.hashCode;
}

class SmartChordRepertoireLink {
  final SmartChordSongLink? link;
  final SmartChordSongSummary? song;

  const SmartChordRepertoireLink({
    this.link,
    this.song,
  });

  bool get isLinked => link != null && song != null;
  String? get songId => link?.songId ?? song?.id;
  String? get songTitle => song?.title;
  String? get artistName => song?.artistName;
  String? get originalKey => song?.originalKey;

  factory SmartChordRepertoireLink.fromJson(Map<String, dynamic> json) {
    return SmartChordRepertoireLink(
      link: json['link'] != null
          ? SmartChordSongLink.fromJson(json['link'] as Map<String, dynamic>)
          : null,
      song: json['song'] != null
          ? SmartChordSongSummary.fromJson(json['song'] as Map<String, dynamic>)
          : null,
    );
  }

  const SmartChordRepertoireLink.unlinked()
      : link = null,
        song = null;

  Map<String, dynamic> toJson() {
    return {
      'link': link?.toJson(),
      'song': song?.toJson(),
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordRepertoireLink &&
          runtimeType == other.runtimeType &&
          link == other.link &&
          song == other.song;

  @override
  int get hashCode => link.hashCode ^ song.hashCode;
}
