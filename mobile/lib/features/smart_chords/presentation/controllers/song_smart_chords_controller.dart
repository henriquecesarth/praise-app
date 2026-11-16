import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SongSmartChordsState {
  final String? songId;
  final String? ministryId;
  final String? versionId;
  final bool isLoading;
  final List<SmartChord> items;
  final List<SmartChord> pendingItems;
  final String? errorMessage;
  final int generation;

  const SongSmartChordsState({
    this.songId,
    this.ministryId,
    this.versionId,
    this.isLoading = false,
    this.items = const [],
    this.pendingItems = const [],
    this.errorMessage,
    this.generation = 0,
  });

  bool get isEmpty => !isLoading && errorMessage == null && items.isEmpty;
  bool get hasPendingClassification => pendingItems.isNotEmpty;
  bool get hasError => errorMessage != null;

  SongSmartChordsState copyWith({
    String? songId,
    String? ministryId,
    bool clearMinistryId = false,
    String? versionId,
    bool clearVersionId = false,
    bool? isLoading,
    List<SmartChord>? items,
    List<SmartChord>? pendingItems,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return SongSmartChordsState(
      songId: songId ?? this.songId,
      ministryId: clearMinistryId ? null : (ministryId ?? this.ministryId),
      versionId: clearVersionId ? null : (versionId ?? this.versionId),
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      pendingItems: pendingItems ?? this.pendingItems,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
    );
  }
}

typedef _VersionCacheKey = (String ministryKey, String songId, String versionKey);
typedef _PendingCacheKey = (String ministryKey, String songId);

class SongSmartChordsNotifier extends StateNotifier<SongSmartChordsState> {
  static const int _maxCachedVersions = 200;

  final SmartChordRepository _repository;
  final SmartChordRepertoireLinkRepository? _linkRepository;
  int _currentGeneration = 0;
  int _cacheEpoch = 0;

  final Map<_VersionCacheKey, List<SmartChord>> _versionCache = {};
  final Map<_PendingCacheKey, List<SmartChord>> _pendingCache = {};
  final Map<_VersionCacheKey, Future<List<SmartChord>>>
      _inFlightVersionRequests = {};
  final Map<_PendingCacheKey, Future<List<SmartChord>>>
      _inFlightPendingRequests = {};
  final Map<_PendingCacheKey, int> _songMutationEpoch = {};

  SongSmartChordsNotifier({
    required SmartChordRepository repository,
    SmartChordRepertoireLinkRepository? linkRepository,
  })  : _repository = repository,
        _linkRepository = linkRepository,
        super(const SongSmartChordsState());

  String? _normalizeVersionId(String? versionId) {
    final trimmed = versionId?.trim();
    return (trimmed != null && trimmed.isNotEmpty) ? trimmed : null;
  }

  void _putVersionCache(_VersionCacheKey key, List<SmartChord> value) {
    _versionCache.remove(key);
    _versionCache[key] = List<SmartChord>.unmodifiable(value);
    if (_versionCache.length > _maxCachedVersions) {
      _versionCache.remove(_versionCache.keys.first);
    }
  }

  List<SmartChord> _filterChordsForVersion(
    List<SmartChord> rawList,
    String? normalizedVersionId,
  ) {
    return rawList.where((c) {
      final link = c.repertoireLink;
      if (link != null && link.isPendingClassification) {
        return false;
      }
      if (normalizedVersionId != null) {
        final resolvedVersion = link?.versionId ?? c.versionId;
        if (resolvedVersion != null &&
            resolvedVersion != normalizedVersionId) {
          return false;
        }
      }
      return true;
    }).toList();
  }

  bool hasCachedVersion({
    required String songId,
    String? ministryId,
    String? versionId,
  }) {
    final normalizedVersionId = _normalizeVersionId(versionId);
    final key = (ministryId ?? '', songId, normalizedVersionId ?? '');
    return _versionCache.containsKey(key);
  }

  void invalidateSong(String? ministryId, String songId) {
    final ministryKey = ministryId ?? '';
    final songKey = (ministryKey, songId);
    _songMutationEpoch[songKey] = (_songMutationEpoch[songKey] ?? 0) + 1;
    _versionCache.removeWhere(
      (key, _) => key.$1 == ministryKey && key.$2 == songId,
    );
    _pendingCache.remove(songKey);
    _inFlightVersionRequests.removeWhere(
      (key, _) => key.$1 == ministryKey && key.$2 == songId,
    );
    _inFlightPendingRequests.remove(songKey);
  }

  Future<List<SmartChord>> _fetchVersionChords({
    required String songId,
    required String ministryId,
    required String? normalizedVersionId,
    required bool force,
    required int epoch,
  }) async {
    final key = (ministryId, songId, normalizedVersionId ?? '');
    if (!force && _versionCache.containsKey(key)) {
      return _versionCache[key]!;
    }
    if (!force && _inFlightVersionRequests.containsKey(key)) {
      return _inFlightVersionRequests[key]!;
    }
    final songKey = (ministryId, songId);
    final songEpoch = _songMutationEpoch[songKey] ?? 0;

    final future = () async {
      final rawList = await _linkRepository!.getMySmartChordsForSong(
        ministryId: ministryId,
        songId: songId,
        versionId: normalizedVersionId,
      );
      final filtered = _filterChordsForVersion(rawList, normalizedVersionId);
      if (epoch == _cacheEpoch &&
          (_songMutationEpoch[songKey] ?? 0) == songEpoch) {
        _putVersionCache(key, filtered);
      }
      return filtered;
    }();

    _inFlightVersionRequests[key] = future;
    try {
      return await future;
    } finally {
      if (identical(_inFlightVersionRequests[key], future)) {
        _inFlightVersionRequests.remove(key);
      }
    }
  }

  Future<List<SmartChord>> _fetchPendingChords({
    required String songId,
    required String ministryId,
    required bool force,
    required int epoch,
  }) async {
    final songKey = (ministryId, songId);
    if (!force && _pendingCache.containsKey(songKey)) {
      return _pendingCache[songKey]!;
    }
    if (!force && _inFlightPendingRequests.containsKey(songKey)) {
      return _inFlightPendingRequests[songKey]!;
    }
    final songEpoch = _songMutationEpoch[songKey] ?? 0;

    final future = () async {
      try {
        final rawPending = await _linkRepository!.getMySmartChordsForSong(
          ministryId: ministryId,
          songId: songId,
          linkStatus: 'pending_classification',
        );
        final filtered = rawPending
            .where((c) => c.repertoireLink?.isPendingClassification == true)
            .toList();
        if (epoch == _cacheEpoch &&
            (_songMutationEpoch[songKey] ?? 0) == songEpoch) {
          _pendingCache[songKey] = List<SmartChord>.unmodifiable(filtered);
        }
        return filtered;
      } catch (_) {
        return const <SmartChord>[];
      }
    }();

    _inFlightPendingRequests[songKey] = future;
    try {
      return await future;
    } finally {
      if (identical(_inFlightPendingRequests[songKey], future)) {
        _inFlightPendingRequests.remove(songKey);
      }
    }
  }

  Future<void> load(
    String songId, {
    String? ministryId,
    String? versionId,
    bool force = false,
    bool includePending = true,
  }) async {
    final normalizedVersionId = _normalizeVersionId(versionId);
    final ministryKey = ministryId ?? '';
    final cacheKey = (ministryKey, songId, normalizedVersionId ?? '');
    final songKey = (ministryKey, songId);

    if (force) {
      invalidateSong(ministryId, songId);
    }

    if (!force &&
        state.songId == songId &&
        state.ministryId == ministryId &&
        state.versionId == normalizedVersionId &&
        !state.isLoading &&
        state.errorMessage == null &&
        _versionCache.containsKey(cacheKey)) {
      if (!includePending && state.pendingItems.isNotEmpty) {
        state = state.copyWith(pendingItems: const []);
      }
      return;
    }

    final hasCachedVersion = !force && _versionCache.containsKey(cacheKey);
    final needPendingFetch = ministryId != null &&
        _linkRepository != null &&
        normalizedVersionId != null &&
        includePending &&
        (force || !_pendingCache.containsKey(songKey));

    if (hasCachedVersion) {
      final generation = ++_currentGeneration;
      final cachedItems = _versionCache[cacheKey]!;
      final cachedPending = includePending
          ? (_pendingCache[songKey] ?? const <SmartChord>[])
          : const <SmartChord>[];
      state = state.copyWith(
        songId: songId,
        ministryId: ministryId,
        clearMinistryId: ministryId == null,
        versionId: normalizedVersionId,
        clearVersionId: normalizedVersionId == null,
        items: cachedItems,
        pendingItems: cachedPending,
        isLoading: false,
        clearError: true,
        generation: generation,
      );
      if (!needPendingFetch) {
        return;
      }
      final epoch = _cacheEpoch;
      final pendingList = await _fetchPendingChords(
        songId: songId,
        ministryId: ministryId,
        force: false,
        epoch: epoch,
      );
      if (epoch != _cacheEpoch || generation != _currentGeneration) return;
      if (pendingList.isNotEmpty) {
        state = state.copyWith(pendingItems: pendingList);
      }
      return;
    }

    final generation = ++_currentGeneration;
    final epoch = _cacheEpoch;
    final sameSongAndMinistry =
        state.songId == songId && state.ministryId == ministryId;
    final contextChanged =
        !sameSongAndMinistry || state.versionId != normalizedVersionId;

    state = state.copyWith(
      songId: songId,
      ministryId: ministryId,
      clearMinistryId: ministryId == null,
      versionId: normalizedVersionId,
      clearVersionId: normalizedVersionId == null,
      items: contextChanged ? const [] : state.items,
      pendingItems: !sameSongAndMinistry
          ? const []
          : (includePending
              ? (_pendingCache[songKey] ?? state.pendingItems)
              : const []),
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final List<SmartChord> list;
      List<SmartChord> pendingList = includePending
          ? (_pendingCache[songKey] ?? const <SmartChord>[])
          : const <SmartChord>[];

      if (ministryId != null && _linkRepository != null) {
        final activeFuture = _fetchVersionChords(
          songId: songId,
          ministryId: ministryId,
          normalizedVersionId: normalizedVersionId,
          force: force,
          epoch: epoch,
        );
        if (needPendingFetch) {
          final results = await Future.wait<List<SmartChord>>([
            activeFuture,
            _fetchPendingChords(
              songId: songId,
              ministryId: ministryId,
              force: force,
              epoch: epoch,
            ),
          ]);
          list = results[0];
          pendingList = results[1];
        } else {
          list = await activeFuture;
        }
      } else {
        final songEpoch = _songMutationEpoch[songKey] ?? 0;
        list = await _repository.getSmartChordsBySong(songId);
        if (epoch == _cacheEpoch &&
            (_songMutationEpoch[songKey] ?? 0) == songEpoch) {
          _putVersionCache(cacheKey, list);
        }
      }
      if (epoch != _cacheEpoch || generation != _currentGeneration) return;

      state = state.copyWith(
        isLoading: false,
        items: list,
        pendingItems: pendingList,
        clearError: true,
      );
    } catch (e) {
      if (epoch != _cacheEpoch || generation != _currentGeneration) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
    }
  }

  Future<void> prefetchVersions({
    required String songId,
    required String ministryId,
    required List<String> versionIds,
    bool includePending = false,
  }) async {
    if (_linkRepository == null) return;
    final epoch = _cacheEpoch;
    final uniqueVersionIds = <String>{
      for (final raw in versionIds)
        if (_normalizeVersionId(raw) case final String normalized) normalized,
    };
    if (uniqueVersionIds.isEmpty) return;

    final futures = <Future<void>>[];
    for (final versionId in uniqueVersionIds) {
      final key = (ministryId, songId, versionId);
      if (_versionCache.containsKey(key) ||
          _inFlightVersionRequests.containsKey(key)) {
        continue;
      }
      futures.add(
        _fetchVersionChords(
          songId: songId,
          ministryId: ministryId,
          normalizedVersionId: versionId,
          force: false,
          epoch: epoch,
        ).then<void>((_) {}, onError: (_) {}),
      );
    }

    final songKey = (ministryId, songId);
    if (includePending &&
        !_pendingCache.containsKey(songKey) &&
        !_inFlightPendingRequests.containsKey(songKey)) {
      futures.add(
        _fetchPendingChords(
          songId: songId,
          ministryId: ministryId,
          force: false,
          epoch: epoch,
        ).then<void>((_) {}, onError: (_) {}),
      );
    }

    if (futures.isNotEmpty) {
      await Future.wait(futures);
    }
  }

  Future<void> resolveSongVersions({
    required String songId,
    required String ministryId,
    required String? activeVersionId,
    required List<String> versionIds,
    bool includePending = true,
  }) async {
    final normalizedActive = _normalizeVersionId(activeVersionId);
    final normalizedAll = <String>[
      for (final raw in versionIds)
        if (_normalizeVersionId(raw) case final String v) v,
    ];
    final epoch = _cacheEpoch;
    final unscopedKey = (ministryId, songId, '');
    final songKey = (ministryId, songId);

    if (normalizedActive != null &&
        !_versionCache.containsKey((ministryId, songId, normalizedActive)) &&
        _inFlightVersionRequests.containsKey(unscopedKey)) {
      try {
        await _inFlightVersionRequests[unscopedKey];
      } catch (_) {}
      if (epoch != _cacheEpoch) return;
      if ((state.songId != null && state.songId != songId) ||
          (state.ministryId != null && state.ministryId != ministryId)) {
        return;
      }
    }

    if (normalizedAll.isNotEmpty &&
        _versionCache.containsKey(unscopedKey) &&
        _linkRepository != null) {
      final unscoped = _versionCache[unscopedKey]!;
      final canPartition = unscoped.isNotEmpty &&
          unscoped.every(
            (c) =>
                _normalizeVersionId(
                    c.repertoireLink?.versionId ?? c.versionId) !=
                null,
          );
      if (canPartition) {
        final byVersion = <String, List<SmartChord>>{
          for (final vId in normalizedAll) vId: <SmartChord>[],
        };
        for (final chord in unscoped) {
          final vId = _normalizeVersionId(
            chord.repertoireLink?.versionId ?? chord.versionId,
          );
          if (vId != null && byVersion.containsKey(vId)) {
            byVersion[vId]!.add(chord);
          }
        }
        final songEpoch = _songMutationEpoch[songKey] ?? 0;
        if (epoch == _cacheEpoch &&
            (_songMutationEpoch[songKey] ?? 0) == songEpoch) {
          byVersion.forEach((vId, chords) {
            final key = (ministryId, songId, vId);
            if (!_versionCache.containsKey(key)) {
              _putVersionCache(key, chords);
            }
          });
        }
      }
    }

    final otherVersions =
        normalizedAll.where((v) => v != normalizedActive).toList();
    final isSameSongContext =
        (state.songId == null || state.songId == songId) &&
            (state.ministryId == null || state.ministryId == ministryId);
    final userSwitchedToAnotherValidVersion = state.versionId != null &&
        state.versionId != normalizedActive &&
        normalizedAll.contains(state.versionId);
    final shouldLoadActive = isSameSongContext &&
        normalizedActive != null &&
        !userSwitchedToAnotherValidVersion;

    await Future.wait([
      if (shouldLoadActive)
        load(
          songId,
          ministryId: ministryId,
          versionId: normalizedActive,
          force: false,
          includePending: includePending,
        ),
      if (otherVersions.isNotEmpty)
        prefetchVersions(
          songId: songId,
          ministryId: ministryId,
          versionIds: otherVersions,
          includePending: includePending,
        ),
    ]);
  }

  void removeChord(String chordId) {
    final updated = state.items.where((c) => c.id != chordId).toList();
    final updatedPending =
        state.pendingItems.where((c) => c.id != chordId).toList();
    for (final key in _versionCache.keys.toList()) {
      final list = _versionCache[key]!;
      if (list.any((c) => c.id == chordId)) {
        _versionCache[key] = List<SmartChord>.unmodifiable(
          list.where((c) => c.id != chordId),
        );
      }
    }
    for (final key in _pendingCache.keys.toList()) {
      final list = _pendingCache[key]!;
      if (list.any((c) => c.id == chordId)) {
        _pendingCache[key] = List<SmartChord>.unmodifiable(
          list.where((c) => c.id != chordId),
        );
      }
    }
    state = state.copyWith(items: updated, pendingItems: updatedPending);
  }

  void upsertChord(SmartChord chord) {
    if (chord.songId != state.songId) return;
    final updatedPending =
        state.pendingItems.where((c) => c.id != chord.id).toList();
    final ministryKey = state.ministryId ?? '';
    final songId = chord.songId;
    if (songId != null) {
      final songKey = (ministryKey, songId);
      if (_pendingCache.containsKey(songKey)) {
        _pendingCache[songKey] = List<SmartChord>.unmodifiable(
          _pendingCache[songKey]!.where((c) => c.id != chord.id),
        );
      }
      final chordVerId =
          _normalizeVersionId(chord.repertoireLink?.versionId ?? chord.versionId);
      for (final key in _versionCache.keys.toList()) {
        if (key.$1 != ministryKey || key.$2 != songId) continue;
        final existing = _versionCache[key]!;
        if (chordVerId != null && key.$3 != chordVerId && key.$3.isNotEmpty) {
          if (existing.any((c) => c.id == chord.id)) {
            _versionCache[key] = List<SmartChord>.unmodifiable(
              existing.where((c) => c.id != chord.id),
            );
          }
          continue;
        }
        final idx = existing.indexWhere((c) => c.id == chord.id);
        if (idx >= 0) {
          final next = List<SmartChord>.from(existing);
          next[idx] = chord;
          _versionCache[key] = List<SmartChord>.unmodifiable(next);
        } else if (chordVerId != null && key.$3 == chordVerId) {
          _versionCache[key] =
              List<SmartChord>.unmodifiable([chord, ...existing]);
        }
      }
    }
    if (state.versionId != null &&
        chord.versionId != null &&
        chord.versionId != state.versionId) {
      state = state.copyWith(pendingItems: updatedPending);
      return;
    }
    final index = state.items.indexWhere((c) => c.id == chord.id);
    if (index >= 0) {
      final updated = List<SmartChord>.from(state.items);
      updated[index] = chord;
      state = state.copyWith(items: updated, pendingItems: updatedPending);
    } else {
      state = state.copyWith(
        items: [chord, ...state.items],
        pendingItems: updatedPending,
      );
    }
  }

  void reset() {
    _currentGeneration++;
    _cacheEpoch++;
    _versionCache.clear();
    _pendingCache.clear();
    _inFlightVersionRequests.clear();
    _inFlightPendingRequests.clear();
    _songMutationEpoch.clear();
    state = const SongSmartChordsState();
  }
}
