import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/schedule_repository.dart';
import '../../domain/ministry_member.dart';
import '../../domain/ministry_role.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_participant.dart';

@immutable
class ScheduleFormState {
  final String? scheduleId;
  final String ministryId;
  final String title;
  final String date; // YYYY-MM-DD civil date
  final String time; // HH:mm local time
  final int durationMinutes;
  final String notes;
  final bool requireConfirmation;
  final List<ScheduleParticipant> participants;
  final List<ScheduleSong> songs;
  final List<ScheduleTimelineItem> timeline;
  final List<MinistryMember> availableMembers;
  final List<MinistryRole> availableRoles;
  final bool isLoadingMembers;
  final bool isSubmitting;
  final bool isDirty;
  final String? error;
  final bool submitSuccess;

  const ScheduleFormState({
    this.scheduleId,
    this.ministryId = '',
    this.title = '',
    this.date = '',
    this.time = '19:00',
    this.durationMinutes = 120,
    this.notes = '',
    this.requireConfirmation = false,
    this.participants = const [],
    this.songs = const [],
    this.timeline = const [],
    this.availableMembers = const [],
    this.availableRoles = const [],
    this.isLoadingMembers = false,
    this.isSubmitting = false,
    this.isDirty = false,
    this.error,
    this.submitSuccess = false,
  });

  bool get isEditing => scheduleId != null;

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

  ScheduleFormState copyWith({
    String? scheduleId,
    String? ministryId,
    String? title,
    String? date,
    String? time,
    int? durationMinutes,
    String? notes,
    bool? requireConfirmation,
    List<ScheduleParticipant>? participants,
    List<ScheduleSong>? songs,
    List<ScheduleTimelineItem>? timeline,
    List<MinistryMember>? availableMembers,
    List<MinistryRole>? availableRoles,
    bool? isLoadingMembers,
    bool? isSubmitting,
    bool? isDirty,
    String? error,
    bool clearError = false,
    bool? submitSuccess,
  }) {
    return ScheduleFormState(
      scheduleId: scheduleId ?? this.scheduleId,
      ministryId: ministryId ?? this.ministryId,
      title: title ?? this.title,
      date: date ?? this.date,
      time: time ?? this.time,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      notes: notes ?? this.notes,
      requireConfirmation: requireConfirmation ?? this.requireConfirmation,
      participants: participants ?? this.participants,
      songs: songs ?? this.songs,
      timeline: timeline ?? this.timeline,
      availableMembers: availableMembers ?? this.availableMembers,
      availableRoles: availableRoles ?? this.availableRoles,
      isLoadingMembers: isLoadingMembers ?? this.isLoadingMembers,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isDirty: isDirty ?? this.isDirty,
      error: clearError ? null : (error ?? this.error),
      submitSuccess: submitSuccess ?? this.submitSuccess,
    );
  }
}

class ScheduleFormNotifier extends StateNotifier<ScheduleFormState> {
  final ScheduleRepository _repository;

  ScheduleFormNotifier({required ScheduleRepository repository})
      : _repository = repository,
        super(const ScheduleFormState());

  /// Initializes the form for creation or editing.
  void init({
    required String ministryId,
    ScheduleDetail? initialSchedule,
  }) {
    final now = DateTime.now();
    final todayCivil =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';

    if (initialSchedule != null) {
      state = ScheduleFormState(
        scheduleId: initialSchedule.id,
        ministryId: ministryId,
        title: initialSchedule.title,
        date: initialSchedule.date,
        time: initialSchedule.time,
        durationMinutes: initialSchedule.durationMinutes ?? 120,
        notes: initialSchedule.notes ?? '',
        requireConfirmation: initialSchedule.requireConfirmation,
        participants: List.of(initialSchedule.participants),
        songs: List.of(initialSchedule.songs),
        timeline: List.of(initialSchedule.timeline),
        isLoadingMembers: true,
        isDirty: false,
      );
    } else {
      state = ScheduleFormState(
        ministryId: ministryId,
        title: 'Culto',
        date: todayCivil,
        time: '19:00',
        durationMinutes: 120,
        notes: '',
        requireConfirmation: false,
        participants: const [],
        songs: const [],
        timeline: const [],
        isLoadingMembers: true,
        isDirty: false,
      );
    }

    _loadMembersAndRoles(ministryId);
  }

  Future<void> _loadMembersAndRoles(String ministryId) async {
    try {
      final results = await Future.wait([
        _repository.getMinistryMembers(ministryId),
        _repository.getMinistryRoles(ministryId),
      ]);

      if (!mounted) return;

      state = state.copyWith(
        availableMembers: results[0] as List<MinistryMember>,
        availableRoles: results[1] as List<MinistryRole>,
        isLoadingMembers: false,
      );
    } catch (e) {
      if (!mounted) return;
      // Do not block form editing if member/role fetch fails; user can retry or enter custom role
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

  /// Submits the form to create or update the schedule.
  /// Returns the saved [ScheduleDetail] on success, or `null` on failure.
  Future<ScheduleDetail?> submit() async {
    if (state.isSubmitting) return null;

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
      'participants': state.participants.map((p) {
        return {
          'id': p.id,
          'name': p.name,
          'role': p.role,
          if (p.userId != null) 'userId': p.userId,
          if (p.confirmed != null) 'confirmed': p.confirmed,
        };
      }).toList(),
      if (state.songs.isNotEmpty)
        'songs': state.songs.map((s) {
          return {
            'id': s.id,
            if (s.title != null) 'title': s.title,
            if (s.artist != null) 'artist': s.artist,
            if (s.key != null) 'key': s.key,
          };
        }).toList(),
      if (state.timeline.isNotEmpty)
        'timeline': state.timeline.map((t) {
          return {
            'id': t.id,
            'title': t.title,
            if (t.time != null) 'time': t.time,
            'type': t.type,
          };
        }).toList(),
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
        isDirty: false,
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
