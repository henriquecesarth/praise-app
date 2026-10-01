import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/schedule_repository.dart';
import '../../domain/ministry_member.dart';
import '../../domain/ministry_role.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_participant.dart';

/// Snapshot of editable schedule form values used for pristine/dirty state comparison.
@immutable
class ScheduleFormSnapshot {
  final String title;
  final String date;
  final String time;
  final int durationMinutes;
  final String notes;
  final bool requireConfirmation;
  final bool isVisible;
  final String? colorPalette;
  final List<ScheduleParticipant> participants;
  final List<ScheduleSong> songs;
  final List<ScheduleTimelineItem> timeline;
  final List<ScheduleClothingPiece> clothingPieces;

  const ScheduleFormSnapshot({
    required this.title,
    required this.date,
    required this.time,
    required this.durationMinutes,
    required this.notes,
    required this.requireConfirmation,
    required this.isVisible,
    this.colorPalette,
    required this.participants,
    required this.songs,
    required this.timeline,
    required this.clothingPieces,
  });

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! ScheduleFormSnapshot || runtimeType != other.runtimeType) {
      return false;
    }
    return title.trim() == other.title.trim() &&
        date == other.date &&
        time == other.time &&
        durationMinutes == other.durationMinutes &&
        notes.trim() == other.notes.trim() &&
        requireConfirmation == other.requireConfirmation &&
        isVisible == other.isVisible &&
        (colorPalette?.trim() ?? '') == (other.colorPalette?.trim() ?? '') &&
        listEquals(participants, other.participants) &&
        listEquals(songs, other.songs) &&
        listEquals(timeline, other.timeline) &&
        listEquals(clothingPieces, other.clothingPieces);
  }

  @override
  int get hashCode => Object.hash(
        title.trim(),
        date,
        time,
        durationMinutes,
        notes.trim(),
        requireConfirmation,
        isVisible,
        colorPalette?.trim() ?? '',
        Object.hashAll(participants),
        Object.hashAll(songs),
        Object.hashAll(timeline),
        Object.hashAll(clothingPieces),
      );
}

@immutable
class ScheduleFormState {
  final String? scheduleId;
  final String ministryId;
  final String boundUserId;
  final bool isInvalidated;
  final String title;
  final String date; // YYYY-MM-DD civil date
  final String time; // HH:mm local time
  final int durationMinutes;
  final String notes;
  final bool requireConfirmation;
  final bool isVisible;
  final List<ScheduleParticipant> participants;
  final List<ScheduleSong> songs;
  final List<ScheduleTimelineItem> timeline;
  final List<ScheduleClothingPiece> clothingPieces;
  final String? colorPalette;
  final List<MinistryMember> availableMembers;
  final List<MinistryRole> availableRoles;
  final bool isLoadingMembers;
  final bool isSubmitting;
  final ScheduleFormSnapshot? initialSnapshot;
  final String? error;
  final bool submitSuccess;

  const ScheduleFormState({
    this.scheduleId,
    this.ministryId = '',
    this.boundUserId = '',
    this.isInvalidated = false,
    this.title = '',
    this.date = '',
    this.time = '19:00',
    this.durationMinutes = 120,
    this.notes = '',
    this.requireConfirmation = false,
    this.isVisible = true,
    this.participants = const [],
    this.songs = const [],
    this.timeline = const [],
    this.clothingPieces = const [],
    this.colorPalette,
    this.availableMembers = const [],
    this.availableRoles = const [],
    this.isLoadingMembers = false,
    this.isSubmitting = false,
    this.initialSnapshot,
    this.error,
    this.submitSuccess = false,
  });

  bool get isEditing => scheduleId != null;

  ScheduleFormSnapshot get currentSnapshot => ScheduleFormSnapshot(
        title: title,
        date: date,
        time: time,
        durationMinutes: durationMinutes,
        notes: notes,
        requireConfirmation: requireConfirmation,
        isVisible: isVisible,
        colorPalette: colorPalette,
        participants: participants,
        songs: songs,
        timeline: timeline,
        clothingPieces: clothingPieces,
      );

  /// Dynamic dirty check using snapshot comparison.
  /// When changes are reverted to initial values, state returns to pristine (false).
  /// If the form is invalidated due to tenant mismatch, returns false to bypass discard dialogs.
  bool get isDirty {
    if (isInvalidated) return false;
    if (initialSnapshot == null) return false;
    return currentSnapshot != initialSnapshot;
  }

  /// Check whether [memberId] or [userId] is already assigned as a participant.
  bool isMemberSelected(String memberId, [String? userId]) {
    return participants.any((p) {
      if (p.id == memberId) return true;
      if (userId != null &&
          userId.isNotEmpty &&
          p.userId != null &&
          p.userId == userId) {
        return true;
      }
      return false;
    });
  }

  /// Check whether a song with [songId] is already added to the schedule.
  bool isSongSelected(String songId) {
    return songs.any((s) => s.id == songId);
  }

  ScheduleFormState copyWith({
    String? scheduleId,
    String? ministryId,
    String? boundUserId,
    bool? isInvalidated,
    String? title,
    String? date,
    String? time,
    int? durationMinutes,
    String? notes,
    bool? requireConfirmation,
    bool? isVisible,
    List<ScheduleParticipant>? participants,
    List<ScheduleSong>? songs,
    List<ScheduleTimelineItem>? timeline,
    List<ScheduleClothingPiece>? clothingPieces,
    String? colorPalette,
    bool clearColorPalette = false,
    List<MinistryMember>? availableMembers,
    List<MinistryRole>? availableRoles,
    bool? isLoadingMembers,
    bool? isSubmitting,
    bool? isDirty,
    ScheduleFormSnapshot? initialSnapshot,
    String? error,
    bool clearError = false,
    bool? submitSuccess,
  }) {
    return ScheduleFormState(
      scheduleId: scheduleId ?? this.scheduleId,
      ministryId: ministryId ?? this.ministryId,
      boundUserId: boundUserId ?? this.boundUserId,
      isInvalidated: isInvalidated ?? this.isInvalidated,
      title: title ?? this.title,
      date: date ?? this.date,
      time: time ?? this.time,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      notes: notes ?? this.notes,
      requireConfirmation: requireConfirmation ?? this.requireConfirmation,
      isVisible: isVisible ?? this.isVisible,
      participants: participants ?? this.participants,
      songs: songs ?? this.songs,
      timeline: timeline ?? this.timeline,
      clothingPieces: clothingPieces ?? this.clothingPieces,
      colorPalette:
          clearColorPalette ? null : (colorPalette ?? this.colorPalette),
      availableMembers: availableMembers ?? this.availableMembers,
      availableRoles: availableRoles ?? this.availableRoles,
      isLoadingMembers: isLoadingMembers ?? this.isLoadingMembers,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      initialSnapshot: initialSnapshot ?? this.initialSnapshot,
      error: clearError ? null : (error ?? this.error),
      submitSuccess: submitSuccess ?? this.submitSuccess,
    );
  }
}

class ScheduleFormNotifier extends StateNotifier<ScheduleFormState> {
  final ScheduleRepository _repository;
  int _requestSequence = 0;

  ScheduleFormNotifier({required ScheduleRepository repository})
      : _repository = repository,
        super(const ScheduleFormState());

  /// Initializes the form for creation or editing.
  void init({
    required String ministryId,
    String boundUserId = '',
    ScheduleDetail? initialSchedule,
  }) {
    final generation = ++_requestSequence;
    final now = DateTime.now();
    final todayCivil =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    final ScheduleFormSnapshot snapshot;
    if (initialSchedule != null) {
      snapshot = ScheduleFormSnapshot(
        title: initialSchedule.title,
        date: initialSchedule.date,
        time: initialSchedule.time,
        durationMinutes: initialSchedule.durationMinutes ?? 120,
        notes: initialSchedule.notes ?? '',
        requireConfirmation: initialSchedule.requireConfirmation,
        isVisible: initialSchedule.isVisible,
        colorPalette: initialSchedule.colorPalette,
        participants: List.of(initialSchedule.participants),
        songs: List.of(initialSchedule.songs),
        timeline: List.of(initialSchedule.timeline),
        clothingPieces: List.of(initialSchedule.clothingPieces),
      );

      state = ScheduleFormState(
        scheduleId: initialSchedule.id,
        ministryId: ministryId,
        boundUserId: boundUserId,
        isInvalidated: false,
        title: initialSchedule.title,
        date: initialSchedule.date,
        time: initialSchedule.time,
        durationMinutes: initialSchedule.durationMinutes ?? 120,
        notes: initialSchedule.notes ?? '',
        requireConfirmation: initialSchedule.requireConfirmation,
        isVisible: initialSchedule.isVisible,
        participants: List.of(initialSchedule.participants),
        songs: List.of(initialSchedule.songs),
        timeline: List.of(initialSchedule.timeline),
        clothingPieces: List.of(initialSchedule.clothingPieces),
        colorPalette: initialSchedule.colorPalette,
        isLoadingMembers: true,
        initialSnapshot: snapshot,
      );
    } else {
      snapshot = ScheduleFormSnapshot(
        title: 'Culto',
        date: todayCivil,
        time: '19:00',
        durationMinutes: 120,
        notes: '',
        requireConfirmation: false,
        isVisible: true,
        colorPalette: null,
        participants: const [],
        songs: const [],
        timeline: const [],
        clothingPieces: const [],
      );

      state = ScheduleFormState(
        ministryId: ministryId,
        boundUserId: boundUserId,
        isInvalidated: false,
        title: 'Culto',
        date: todayCivil,
        time: '19:00',
        durationMinutes: 120,
        notes: '',
        requireConfirmation: false,
        isVisible: true,
        participants: const [],
        songs: const [],
        timeline: const [],
        clothingPieces: const [],
        colorPalette: null,
        isLoadingMembers: true,
        initialSnapshot: snapshot,
      );
    }

    _loadMembersAndRoles(ministryId, generation);
  }

  /// Invalidates the form permanently when a tenant mismatch or session logout occurs.
  void invalidateTenant() {
    _requestSequence++;
    state = state.copyWith(
      isInvalidated: true,
      error: 'Sessão ou ministério alterado. A edição foi cancelada.',
    );
  }

  Future<void> _loadMembersAndRoles(String ministryId, int generation) async {
    try {
      final results = await Future.wait([
        _repository.getMinistryMembers(ministryId),
        _repository.getMinistryRoles(ministryId),
      ]);

      if (!mounted || generation != _requestSequence || state.isInvalidated) {
        return;
      }

      state = state.copyWith(
        availableMembers: results[0] as List<MinistryMember>,
        availableRoles: results[1] as List<MinistryRole>,
        isLoadingMembers: false,
      );
    } catch (e) {
      if (!mounted || generation != _requestSequence || state.isInvalidated) {
        return;
      }
      state = state.copyWith(
        isLoadingMembers: false,
      );
    }
  }

  void setTitle(String value) {
    if (state.title == value) return;
    state = state.copyWith(title: value, isDirty: true, clearError: true);
  }

  void setDate(String value) {
    if (state.date == value) return;
    state = state.copyWith(date: value, isDirty: true, clearError: true);
  }

  void setTime(String value) {
    if (state.time == value) return;
    state = state.copyWith(time: value, isDirty: true, clearError: true);
  }

  void setDurationMinutes(int value) {
    final clamped = value.clamp(15, 1440);
    if (state.durationMinutes == clamped) return;
    state = state.copyWith(
        durationMinutes: clamped, isDirty: true, clearError: true);
  }

  void setNotes(String value) {
    if (state.notes == value) return;
    state = state.copyWith(notes: value, isDirty: true, clearError: true);
  }

  void setRequireConfirmation(bool value) {
    if (state.requireConfirmation == value) return;
    state = state.copyWith(
      requireConfirmation: value,
      isDirty: true,
      clearError: true,
    );
  }

  void setIsVisible(bool value) {
    if (state.isVisible == value) return;
    state = state.copyWith(
      isVisible: value,
      isDirty: true,
      clearError: true,
    );
  }

  /// Adds a participant to the schedule.
  /// Returns `false` if the member is already scheduled (duplicate prevented).
  bool addParticipant(MinistryMember member, String role) {
    if (state.isMemberSelected(member.id, member.userId)) {
      return false;
    }

    final newParticipant = ScheduleParticipant(
      id: member.id,
      userId: member.userId,
      name: member.name,
      role: role.trim().isEmpty ? 'Integrante' : role.trim(),
    );

    state = state.copyWith(
      participants: [...state.participants, newParticipant],
      isDirty: true,
      clearError: true,
    );
    return true;
  }

  /// Removes the participant at [index].
  void removeParticipant(int index) {
    if (index < 0 || index >= state.participants.length) return;
    final updated = List<ScheduleParticipant>.from(state.participants)
      ..removeAt(index);
    state = state.copyWith(
      participants: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Updates the role of a participant at [index].
  void updateParticipantRole(int index, String newRole) {
    if (index < 0 || index >= state.participants.length) return;
    final p = state.participants[index];
    final updatedList = List<ScheduleParticipant>.from(state.participants);
    updatedList[index] = p.copyWith(role: newRole.trim());
    state = state.copyWith(
      participants: updatedList,
      isDirty: true,
      clearError: true,
    );
  }

  // ─── Repertoire / Songs Management ─────────────────────────────────────

  /// Adds a song to the schedule songs list.
  /// Returns `false` if the song is already added (duplicate prevented).
  bool addSong(ScheduleSong song) {
    if (state.isSongSelected(song.id)) {
      return false;
    }
    state = state.copyWith(
      songs: [...state.songs, song],
      isDirty: true,
      clearError: true,
    );
    return true;
  }

  /// Removes the song at [index].
  void removeSong(int index) {
    if (index < 0 || index >= state.songs.length) return;
    final updated = List<ScheduleSong>.from(state.songs)..removeAt(index);
    state = state.copyWith(
      songs: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Reorders songs from [oldIndex] to [newIndex].
  void reorderSongs(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= state.songs.length) return;
    var target = newIndex;
    if (oldIndex < target) {
      target -= 1;
    }
    if (target < 0 || target >= state.songs.length) return;
    final updated = List<ScheduleSong>.from(state.songs);
    final item = updated.removeAt(oldIndex);
    updated.insert(target, item);
    state = state.copyWith(
      songs: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Updates the musical key of the song at [index].
  void updateSongKey(int index, String? newKey) {
    if (index < 0 || index >= state.songs.length) return;
    final updated = List<ScheduleSong>.from(state.songs);
    final trimmed = newKey?.trim();
    updated[index] = updated[index].copyWith(
      key: trimmed?.isEmpty == true ? null : trimmed,
    );
    state = state.copyWith(
      songs: updated,
      isDirty: true,
      clearError: true,
    );
  }

  // ─── Timeline / Roteiro Management ─────────────────────────────────────

  /// Adds a timeline item to the schedule.
  void addTimelineItem(ScheduleTimelineItem item) {
    state = state.copyWith(
      timeline: [...state.timeline, item],
      isDirty: true,
      clearError: true,
    );
  }

  /// Updates the timeline item at [index].
  void updateTimelineItem(int index, ScheduleTimelineItem item) {
    if (index < 0 || index >= state.timeline.length) return;
    final updated = List<ScheduleTimelineItem>.from(state.timeline);
    updated[index] = item;
    state = state.copyWith(
      timeline: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Removes the timeline item at [index].
  void removeTimelineItem(int index) {
    if (index < 0 || index >= state.timeline.length) return;
    final updated = List<ScheduleTimelineItem>.from(state.timeline)
      ..removeAt(index);
    state = state.copyWith(
      timeline: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Reorders timeline items from [oldIndex] to [newIndex].
  void reorderTimeline(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= state.timeline.length) return;
    var target = newIndex;
    if (oldIndex < target) {
      target -= 1;
    }
    if (target < 0 || target >= state.timeline.length) return;
    final updated = List<ScheduleTimelineItem>.from(state.timeline);
    final item = updated.removeAt(oldIndex);
    updated.insert(target, item);
    state = state.copyWith(
      timeline: updated,
      isDirty: true,
      clearError: true,
    );
  }

  // ─── Clothing / Vestimenta Management ──────────────────────────────────

  /// Adds a clothing piece.
  void addClothingPiece(ScheduleClothingPiece piece) {
    state = state.copyWith(
      clothingPieces: [...state.clothingPieces, piece],
      isDirty: true,
      clearError: true,
    );
  }

  /// Updates the clothing piece at [index].
  void updateClothingPiece(int index, ScheduleClothingPiece piece) {
    if (index < 0 || index >= state.clothingPieces.length) return;
    final updated = List<ScheduleClothingPiece>.from(state.clothingPieces);
    updated[index] = piece;
    state = state.copyWith(
      clothingPieces: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Removes the clothing piece at [index].
  void removeClothingPiece(int index) {
    if (index < 0 || index >= state.clothingPieces.length) return;
    final updated = List<ScheduleClothingPiece>.from(state.clothingPieces)
      ..removeAt(index);
    state = state.copyWith(
      clothingPieces: updated,
      isDirty: true,
      clearError: true,
    );
  }

  /// Sets the color palette name or description.
  void setColorPalette(String? palette) {
    final trimmed = palette?.trim();
    state = state.copyWith(
      colorPalette: trimmed,
      clearColorPalette: trimmed == null || trimmed.isEmpty,
      isDirty: true,
      clearError: true,
    );
  }

  // ─── Form Submission ───────────────────────────────────────────────────

  /// Submits the form to create or update the schedule.
  /// Returns the saved [ScheduleDetail] on success, or `null` on failure.
  Future<ScheduleDetail?> submit({
    String? currentMinistryId,
    String? currentUserId,
  }) async {
    if (state.isSubmitting) return null;

    if (state.isInvalidated) {
      state = state.copyWith(
        error: 'Sessão ou ministério alterado. A edição foi cancelada.',
      );
      return null;
    }

    if (currentMinistryId != null &&
        currentMinistryId.isNotEmpty &&
        currentMinistryId != state.ministryId) {
      invalidateTenant();
      return null;
    }

    if (currentUserId != null &&
        currentUserId.isNotEmpty &&
        state.boundUserId.isNotEmpty &&
        currentUserId != state.boundUserId) {
      invalidateTenant();
      return null;
    }

    final trimmedTitle = state.title.trim();
    if (trimmedTitle.isEmpty) {
      state = state.copyWith(error: 'O título da escala é obrigatório.');
      return null;
    }

    if (state.date.trim().isEmpty) {
      state = state.copyWith(error: 'A data da escala é obrigatória.');
      return null;
    }

    if (state.time.trim().isEmpty) {
      state = state.copyWith(error: 'O horário da escala é obrigatório.');
      return null;
    }

    state = state.copyWith(isSubmitting: true, clearError: true);

    final duration = state.durationMinutes.clamp(15, 1440);

    final payload = <String, dynamic>{
      'title': trimmedTitle,
      'date': state.date,
      'time': state.time,
      'durationMinutes': duration,
      'notes': state.notes.trim(),
      'requireConfirmation': state.requireConfirmation,
      'isVisible': state.isVisible,
      'is_visible': state.isVisible,
      'participants': state.participants.map((p) {
        return {
          'id': p.id,
          'name': p.name,
          'role': p.role,
          if (p.userId != null) 'userId': p.userId,
          if (p.confirmed != null) 'confirmed': p.confirmed,
        };
      }).toList(),
      'songs': state.songs.map((s) => s.toJson()).toList(),
      'timeline': state.timeline.map((t) => t.toJson()).toList(),
      'clothingPieces': state.clothingPieces.map((p) => p.toJson()).toList(),
      if (state.colorPalette != null && state.colorPalette!.trim().isNotEmpty)
        'colorPalette': state.colorPalette!.trim(),
    };

    try {
      final ScheduleDetail result;
      if (state.isEditing) {
        result = await _repository.updateSchedule(
          state.ministryId,
          state.scheduleId!,
          payload,
        );
      } else {
        result = await _repository.createSchedule(
          state.ministryId,
          payload,
        );
      }

      state = state.copyWith(
        isSubmitting: false,
        submitSuccess: true,
        initialSnapshot: state.currentSnapshot,
        clearError: true,
      );
      return result;
    } on AppFailure catch (f) {
      state = state.copyWith(
        isSubmitting: false,
        error: f.message,
      );
      return null;
    } catch (e) {
      state = state.copyWith(
        isSubmitting: false,
        error: 'Erro ao salvar escala: $e',
      );
      return null;
    }
  }
}
