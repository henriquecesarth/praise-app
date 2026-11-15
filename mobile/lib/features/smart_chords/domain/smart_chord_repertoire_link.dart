class SmartChordSongVersionSummary {
  final String id;
  final String name;
  final String? key;

  const SmartChordSongVersionSummary({
    required this.id,
    required this.name,
    this.key,
  });

  factory SmartChordSongVersionSummary.fromJson(Map<String, dynamic> json) {
    return SmartChordSongVersionSummary(
      id: ((json['id'] as String?) ?? '').trim(),
      name: ((json['name'] as String?) ?? 'Original').trim().isEmpty
          ? 'Original'
          : ((json['name'] as String?) ?? 'Original').trim(),
      key: (json['key'] as String?) ??
          (json['original_key'] as String?) ??
          (json['originalKey'] as String?),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      if (key != null) 'key': key,
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordSongVersionSummary &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          key == other.key;

  @override
  int get hashCode => Object.hash(id, name, key);
}

class SmartChordSongLink {
  final String id;
  final String userId;
  final String smartChordId;
  final String ministryId;
  final String songId;
  final String? versionId;
  final String linkStatus;
  final String? pendingReason;
  final String createdAt;
  final String updatedAt;

  const SmartChordSongLink({
    required this.id,
    required this.userId,
    required this.smartChordId,
    required this.ministryId,
    required this.songId,
    this.versionId,
    this.linkStatus = 'active',
    this.pendingReason,
    this.createdAt = '',
    this.updatedAt = '',
  });

  bool get isPendingClassification => linkStatus == 'pending_classification';
  bool get isActive => !isPendingClassification;
  bool get hasResolvedVersion =>
      versionId != null && versionId!.trim().isNotEmpty && !isPendingClassification;

  factory SmartChordSongLink.fromJson(Map<String, dynamic> json) {
    final rawStatus =
        (json['link_status'] as String?) ?? (json['linkStatus'] as String?) ?? 'active';
    final normalizedStatus =
        rawStatus == 'pending_classification' ? 'pending_classification' : 'active';
    final rawVersionId =
        (json['version_id'] as String?) ?? (json['versionId'] as String?);
    final resolvedVersionId = (rawVersionId != null &&
            rawVersionId.trim().isNotEmpty &&
            normalizedStatus != 'pending_classification')
        ? rawVersionId.trim()
        : null;

    return SmartChordSongLink(
      id: (json['id'] as String?) ?? '',
      userId: (json['user_id'] as String?) ?? (json['userId'] as String?) ?? '',
      smartChordId: (json['smart_chord_id'] as String?) ?? (json['smartChordId'] as String?) ?? '',
      ministryId: (json['ministry_id'] as String?) ?? (json['ministryId'] as String?) ?? '',
      songId: (json['song_id'] as String?) ?? (json['songId'] as String?) ?? '',
      versionId: resolvedVersionId,
      linkStatus: normalizedStatus,
      pendingReason:
          (json['pending_reason'] as String?) ?? (json['pendingReason'] as String?),
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
      'version_id': versionId,
      'link_status': linkStatus,
      if (pendingReason != null) 'pending_reason': pendingReason,
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
          songId == other.songId &&
          versionId == other.versionId &&
          linkStatus == other.linkStatus &&
          pendingReason == other.pendingReason;

  @override
  int get hashCode => Object.hash(
        id,
        userId,
        smartChordId,
        ministryId,
        songId,
        versionId,
        linkStatus,
        pendingReason,
      );
}

class SmartChordSongSummary {
  final String id;
  final String ministryId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? originalKey;
  final List<SmartChordSongVersionSummary> versions;

  const SmartChordSongSummary({
    required this.id,
    this.ministryId = '',
    required this.title,
    this.artistId,
    this.artistName,
    this.originalKey,
    this.versions = const [],
  });

  List<SmartChordSongVersionSummary> get effectiveVersions {
    if (versions.isNotEmpty) return versions;
    final trimmedId = id.trim();
    if (trimmedId.isEmpty) return const [];
    return [
      SmartChordSongVersionSummary(
        id: '${trimmedId}_v1',
        name: 'Original',
        key: originalKey,
      ),
    ];
  }

  factory SmartChordSongSummary.fromJson(Map<String, dynamic> json) {
    final parsedVersions = <SmartChordSongVersionSummary>[];
    if (json['versions'] is List) {
      for (final raw in (json['versions'] as List)) {
        if (raw is Map<String, dynamic>) {
          final v = SmartChordSongVersionSummary.fromJson(raw);
          if (v.id.isNotEmpty) {
            parsedVersions.add(v);
          }
        }
      }
    }

    return SmartChordSongSummary(
      id: (json['id'] as String?) ?? '',
      ministryId: (json['ministry_id'] as String?) ?? (json['ministryId'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      artistId: json['artist_id'] as String? ?? json['artistId'] as String?,
      artistName: json['artist_name'] as String? ?? json['artistName'] as String?,
      originalKey: json['original_key'] as String? ?? json['originalKey'] as String?,
      versions: parsedVersions,
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
      if (versions.isNotEmpty)
        'versions': versions.map((v) => v.toJson()).toList(),
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
  final SmartChordSongLink? pendingLink;
  final bool requiresVersionSelection;

  const SmartChordRepertoireLink({
    this.link,
    this.song,
    this.pendingLink,
    this.requiresVersionSelection = false,
  });

  SmartChordSongLink? get effectiveLink => link ?? pendingLink;
  bool get isPendingClassification =>
      (link?.isPendingClassification ?? false) ||
      (pendingLink != null && link == null) ||
      requiresVersionSelection;
  bool get isLinked =>
      link != null && song != null && !link!.isPendingClassification;
  bool get hasAnySongAssociation =>
      song != null && (link != null || pendingLink != null);
  String? get songId => link?.songId ?? pendingLink?.songId ?? song?.id;
  String? get versionId =>
      (link != null && !link!.isPendingClassification) ? link!.versionId : null;
  String? get songTitle => song?.title;
  String? get artistName => song?.artistName;
  String? get originalKey => song?.originalKey;

  SmartChordSongVersionSummary? get linkedVersion {
    final targetId = versionId;
    if (targetId == null || song == null) return null;
    for (final v in song!.effectiveVersions) {
      if (v.id == targetId) return v;
    }
    return null;
  }

  factory SmartChordRepertoireLink.fromJson(Map<String, dynamic> json) {
    final parsedLink = json['link'] is Map<String, dynamic>
        ? SmartChordSongLink.fromJson(json['link'] as Map<String, dynamic>)
        : null;
    final rawPending = json['pending_link'] ?? json['pendingLink'];
    final parsedPending = rawPending is Map<String, dynamic>
        ? SmartChordSongLink.fromJson(rawPending)
        : null;
    final parsedSong = json['song'] is Map<String, dynamic>
        ? SmartChordSongSummary.fromJson(json['song'] as Map<String, dynamic>)
        : null;
    final requiresSelection = (json['requires_version_selection'] as bool?) ??
        (json['requiresVersionSelection'] as bool?) ??
        (parsedPending != null && parsedLink == null);

    return SmartChordRepertoireLink(
      link: parsedLink,
      song: parsedSong,
      pendingLink: parsedPending,
      requiresVersionSelection: requiresSelection,
    );
  }

  const SmartChordRepertoireLink.unlinked()
      : link = null,
        song = null,
        pendingLink = null,
        requiresVersionSelection = false;

  Map<String, dynamic> toJson() {
    return {
      'link': link?.toJson(),
      'song': song?.toJson(),
      if (pendingLink != null) 'pending_link': pendingLink?.toJson(),
      if (requiresVersionSelection)
        'requires_version_selection': requiresVersionSelection,
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordRepertoireLink &&
          runtimeType == other.runtimeType &&
          link == other.link &&
          song == other.song &&
          pendingLink == other.pendingLink &&
          requiresVersionSelection == other.requiresVersionSelection;

  @override
  int get hashCode =>
      Object.hash(link, song, pendingLink, requiresVersionSelection);
}
