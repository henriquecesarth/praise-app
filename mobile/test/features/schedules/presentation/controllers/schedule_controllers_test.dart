import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_comment.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_participant.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_detail_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_form_controller.dart';
import 'package:louvaio_mobile/features/schedules/presentation/controllers/schedule_list_controller.dart';

// ─── Fake repository ──────────────────────────────────────────────────────────

class FakeScheduleRepository implements ScheduleRepository {
  List<ScheduleSummary> schedulesToReturn = [];
  ScheduleDetail? detailToReturn;
  ScheduleDetail? confirmationResult;
  List<ScheduleComment> commentsToReturn = [];
  ScheduleComment? commentToReturn;

  Exception? listException;
  Exception? detailException;
  Exception? confirmationException;
  Exception? commentsException;
  Exception? postCommentException;

  String? lastConfirmedMinistryId;
  String? lastConfirmedScheduleId;
  bool? lastConfirmedValue;

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async {
    if (listException != null) throw listException!;
    return schedulesToReturn;
  }

  @override
  Future<ScheduleDetail> getScheduleDetail(
      String ministryId, String scheduleId) async {
    if (detailException != null) throw detailException!;
    return detailToReturn!;
  }

  @override
  Future<ScheduleDetail> confirmParticipation(
      String ministryId, String scheduleId, bool confirmed) async {
    lastConfirmedMinistryId = ministryId;
    lastConfirmedScheduleId = scheduleId;
    lastConfirmedValue = confirmed;
    if (confirmationException != null) throw confirmationException!;
    return confirmationResult ?? detailToReturn!;
  }

  @override
  Future<List<ScheduleComment>> getComments(
      String ministryId, String scheduleId) async {
    if (commentsException != null) throw commentsException!;
    return commentsToReturn;
  }

  @override
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content) async {
    if (postCommentException != null) throw postCommentException!;
    return commentToReturn!;
  }

  Map<String, dynamic>? lastCreatedData;
  String? lastCreatedMinistryId;
  Map<String, dynamic>? lastUpdatedData;
  String? lastUpdatedMinistryId;
  String? lastUpdatedScheduleId;
  Exception? createException;
  Exception? updateException;
  List<MinistryMember> membersToReturn = [];
  List<MinistryRole> rolesToReturn = [];

  @override
  Future<ScheduleDetail> createSchedule(
      String ministryId, Map<String, dynamic> data) async {
    lastCreatedMinistryId = ministryId;
    lastCreatedData = data;
    if (createException != null) throw createException!;
    return detailToReturn!;
  }

  @override
  Future<ScheduleDetail> updateSchedule(
      String ministryId, String scheduleId, Map<String, dynamic> data) async {
    lastUpdatedMinistryId = ministryId;
    lastUpdatedScheduleId = scheduleId;
    lastUpdatedData = data;
    if (updateException != null) throw updateException!;
    return detailToReturn!;
  }

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async =>
      membersToReturn;

  @override
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async =>
      rolesToReturn;
}

ScheduleSummary makeSummary({
  String id = 's1',
  String ministryId = 'min1',
  String title = 'Culto',
  String date = '2099-01-01',
  String time = '19:00',
}) {
  return ScheduleSummary.fromJson(const {
    'id': 's1',
    'ministry_id': 'min1',
    'title': 'Culto',
    'date': '2099-01-01',
  });
}

ScheduleDetail makeDetail({
  String id = 's1',
  String ministryId = 'min1',
  String title = 'Culto',
  String date = '2099-01-01',
  String updatedAt = '2026-01-01T00:00:00Z',
}) {
  return ScheduleDetail.fromJson(const {
    'id': 's1',
    'ministry_id': 'min1',
    'title': 'Culto',
    'date': '2099-01-01',
    'updated_at': '2026-01-01T00:00:00Z',
  });
}

ScheduleComment makeComment({
  String id = 'c1',
  String scheduleId = 's1',
  String ministryId = 'min1',
  String content = 'Ótimo!',
}) {
  return ScheduleComment.fromJson(const {
    'id': 'c1',
    'schedule_id': 's1',
    'ministry_id': 'min1',
    'user_id': 'u1',
    'user_name': 'Ana',
    'content': 'Ótimo!',
    'created_at': '2026-01-01T10:00:00Z',
  });
}

// ─── ScheduleListNotifier Tests ───────────────────────────────────────────────

void main() {
  group('ScheduleListNotifier', () {
    late FakeScheduleRepository repo;
    late ScheduleListNotifier notifier;

    setUp(() {
      repo = FakeScheduleRepository();
      notifier = ScheduleListNotifier(repository: repo);
    });

    test('initial state is empty', () {
      expect(notifier.state.schedules, isEmpty);
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test('loadForMinistry sets loading and populates schedules', () async {
      repo.schedulesToReturn = [makeSummary()];
      await notifier.loadForMinistry('min1');

      expect(notifier.state.ministryId, equals('min1'));
      expect(notifier.state.schedules.length, equals(1));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.error, isNull);
    });

    test('ministry switch immediately clears old data and sets new ministryId',
        () async {
      repo.schedulesToReturn = [makeSummary()];
      await notifier.loadForMinistry('min1');
      expect(notifier.state.schedules.isNotEmpty, isTrue);

      repo.schedulesToReturn = [];
      final future = notifier.loadForMinistry('min2');
      // Immediately after call: old data cleared, new ministryId set
      expect(notifier.state.ministryId, equals('min2'));
      expect(notifier.state.schedules, isEmpty);
      expect(notifier.state.isLoading, isTrue);

      await future;
      expect(notifier.state.ministryId, equals('min2'));
    });

    test('upcomingSchedules filters past and sorts nearest first', () async {
      final refNow = DateTime(2026, 9, 25);
      repo.schedulesToReturn = [
        ScheduleSummary.fromJson(const {
          'id': 'past',
          'ministry_id': 'm',
          'title': 'Past',
          'date': '2026-09-20',
          'time': '19:00',
        }),
        ScheduleSummary.fromJson(const {
          'id': 'far',
          'ministry_id': 'm',
          'title': 'Far',
          'date': '2026-10-15',
          'time': '19:00',
        }),
        ScheduleSummary.fromJson(const {
          'id': 'near',
          'ministry_id': 'm',
          'title': 'Near',
          'date': '2026-09-28',
          'time': '19:00',
        }),
      ];
      await notifier.loadForMinistry('m');

      final upcoming = notifier.state.upcomingSchedules(refNow);
      expect(upcoming.length, equals(2));
      expect(upcoming.any((s) => s.id == 'past'), isFalse);
      expect(upcoming[0].id, equals('near')); // nearest first
      expect(upcoming[1].id, equals('far'));
    });

    test('pastSchedules filters upcoming and sorts latest first', () async {
      final refNow = DateTime(2026, 9, 25);
      repo.schedulesToReturn = [
        ScheduleSummary.fromJson(const {
          'id': 'past1',
          'ministry_id': 'm',
          'title': 'Past1',
          'date': '2026-09-10',
          'time': '19:00',
        }),
        ScheduleSummary.fromJson(const {
          'id': 'future',
          'ministry_id': 'm',
          'title': 'Future',
          'date': '2026-10-01',
          'time': '19:00',
        }),
        ScheduleSummary.fromJson(const {
          'id': 'past2',
          'ministry_id': 'm',
          'title': 'Past2',
          'date': '2026-09-20',
          'time': '19:00',
        }),
      ];
      await notifier.loadForMinistry('m');

      final past = notifier.state.pastSchedules(refNow);
      expect(past.length, equals(2));
      expect(past.any((s) => s.id == 'future'), isFalse);
      expect(past[0].id, equals('past2')); // latest past first
      expect(past[1].id, equals('past1'));
    });

    test('error from repository is stored in state.error', () async {
      repo.listException = const AppFailure(message: 'Servidor indisponível.');
      await notifier.loadForMinistry('min1');

      expect(notifier.state.error, equals('Servidor indisponível.'));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.schedules, isEmpty);
    });

    test('pull-to-refresh preserves data during reload', () async {
      repo.schedulesToReturn = [makeSummary()];
      await notifier.loadForMinistry('min1');
      expect(notifier.state.schedules.length, equals(1));

      repo.schedulesToReturn = [];
      await notifier.refresh();
      expect(notifier.state.isRefreshing, isFalse);
      expect(notifier.state.schedules, isEmpty);
    });
  });

  // ─── ScheduleDetailNotifier Tests ────────────────────────────────────────────

  group('ScheduleDetailNotifier', () {
    late FakeScheduleRepository repo;
    late ScheduleDetailNotifier notifier;

    setUp(() {
      repo = FakeScheduleRepository();
      notifier = ScheduleDetailNotifier(repository: repo);
    });

    test('load populates schedule on success', () async {
      repo.detailToReturn = makeDetail();
      await notifier.load('min1', 's1');

      expect(notifier.state.schedule, isNotNull);
      expect(notifier.state.schedule!.id, equals('s1'));
      expect(notifier.state.isLoading, isFalse);
    });

    test('load stores error on AppFailure', () async {
      repo.detailException =
          const AppFailure(message: 'Escala não encontrada.', statusCode: 404);
      await notifier.load('min1', 's1');

      expect(notifier.state.schedule, isNull);
      expect(notifier.state.error, equals('Escala não encontrada.'));
    });

    test('confirm sends correct arguments to repository', () async {
      repo.detailToReturn = makeDetail();
      repo.confirmationResult = makeDetail();
      await notifier.load('min1', 's1');
      await notifier.confirm('min1', 's1', true);

      expect(repo.lastConfirmedMinistryId, equals('min1'));
      expect(repo.lastConfirmedScheduleId, equals('s1'));
      expect(repo.lastConfirmedValue, isTrue);
    });

    test('confirm replaces local schedule with authoritative server state',
        () async {
      repo.detailToReturn = makeDetail();
      await notifier.load('min1', 's1');

      final updated = ScheduleDetail.fromJson(const {
        'id': 's1',
        'ministry_id': 'min1',
        'title': 'Culto Atualizado',
        'date': '2099-01-01',
        'updated_at': '2026-01-02T00:00:00Z',
      });
      repo.confirmationResult = updated;
      await notifier.confirm('min1', 's1', true);

      expect(notifier.state.schedule!.title, equals('Culto Atualizado'));
      expect(notifier.state.isConfirming, isFalse);
    });

    test('confirm 403 (not participant) stores confirmationError safely',
        () async {
      repo.detailToReturn = makeDetail();
      await notifier.load('min1', 's1');

      repo.confirmationException = const AppFailure(
        message: 'Você não está listado como participante.',
        statusCode: 403,
      );
      await notifier.confirm('min1', 's1', true);

      expect(notifier.state.confirmationError,
          equals('Você não está listado como participante.'));
      expect(notifier.state.isConfirming, isFalse);
      // Schedule is NOT replaced on error
      expect(notifier.state.schedule, isNotNull);
    });

    test('confirm 400 (past schedule) stores confirmationError safely',
        () async {
      repo.detailToReturn = makeDetail();
      await notifier.load('min1', 's1');

      repo.confirmationException = const AppFailure(
        message: 'Escala já passou.',
        statusCode: 400,
      );
      await notifier.confirm('min1', 's1', true);

      expect(notifier.state.confirmationError, isNotNull);
      expect(notifier.state.confirmationError, contains('passou'));
      expect(notifier.state.isConfirming, isFalse);
    });

    test('stale ministry does not update state after ministry switch',
        () async {
      repo.detailToReturn = makeDetail();
      await notifier.load('min1', 's1');

      // Simulate ministry switch mid-flight by resetting state with new key
      notifier.state = const ScheduleDetailState(
        ministryId: 'min2',
        scheduleId: 's2',
        isLoading: true,
      );

      // Result for old (min1, s1) should be ignored
      await notifier.load('min2', 's2');
      expect(notifier.state.ministryId, equals('min2'));
    });
  });

  // ─── CommentsNotifier Tests ───────────────────────────────────────────────────

  group('CommentsNotifier', () {
    late FakeScheduleRepository repo;
    late CommentsNotifier notifier;

    setUp(() {
      repo = FakeScheduleRepository();
      notifier = CommentsNotifier(repository: repo);
    });

    test('load populates comments chronologically', () async {
      repo.commentsToReturn = [
        ScheduleComment.fromJson(const {
          'id': 'c1',
          'schedule_id': 's1',
          'ministry_id': 'm',
          'user_id': 'u1',
          'user_name': 'Ana',
          'content': 'Primeiro',
          'created_at': '2026-01-01T08:00:00Z',
        }),
        ScheduleComment.fromJson(const {
          'id': 'c2',
          'schedule_id': 's1',
          'ministry_id': 'm',
          'user_id': 'u2',
          'user_name': 'João',
          'content': 'Segundo',
          'created_at': '2026-01-01T09:00:00Z',
        }),
      ];
      await notifier.load('m', 's1');

      expect(notifier.state.comments.length, equals(2));
      expect(notifier.state.comments[0].id, equals('c1'));
      expect(notifier.state.comments[1].id, equals('c2'));
    });

    test('postComment success appends returned comment and returns true',
        () async {
      repo.commentsToReturn = [];
      await notifier.load('m', 's1');

      repo.commentToReturn = makeComment(content: 'Amém!');
      final success = await notifier.postComment('m', 's1', 'Amém!');

      expect(success, isTrue);
      expect(notifier.state.comments.length, equals(1));
      expect(notifier.state.comments.first.content, equals('Ótimo!'));
      expect(notifier.state.isPosting, isFalse);
    });

    test(
        'postComment fails with SUBSCRIPTION_RESTRICTED sets isCommerciallyRestricted',
        () async {
      await notifier.load('m', 's1');
      repo.postCommentException = const AppFailure(
        message: 'Plano expirado.',
        code: 'SUBSCRIPTION_RESTRICTED',
        statusCode: 403,
      );

      final success = await notifier.postComment('m', 's1', 'Teste');

      expect(success, isFalse);
      expect(notifier.state.isCommerciallyRestricted, isTrue);
      expect(notifier.state.postError, equals('Plano expirado.'));
    });

    test(
        'postComment fails with SUBSCRIPTION_SUSPENDED sets isCommerciallyRestricted',
        () async {
      await notifier.load('m', 's1');
      repo.postCommentException = const AppFailure(
        message: 'Conta suspensa.',
        code: 'SUBSCRIPTION_SUSPENDED',
        statusCode: 403,
      );

      final success = await notifier.postComment('m', 's1', 'Teste');

      expect(success, isFalse);
      expect(notifier.state.isCommerciallyRestricted, isTrue);
    });

    test('postComment empty content returns false without calling repository',
        () async {
      await notifier.load('m', 's1');
      final success = await notifier.postComment('m', 's1', '   ');
      expect(success, isFalse);
      expect(notifier.state.comments, isEmpty);
    });

    test('postComment content exceeding 1000 chars returns false', () async {
      await notifier.load('m', 's1');
      final tooLong = 'x' * 1001;
      final success = await notifier.postComment('m', 's1', tooLong);
      expect(success, isFalse);
    });

    test('load error stored in state.error', () async {
      repo.commentsException =
          const AppFailure(message: 'Falha ao carregar comentários.');
      await notifier.load('m', 's1');

      expect(notifier.state.error, equals('Falha ao carregar comentários.'));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.comments, isEmpty);
    });

    test('ministry switch clears comment state', () async {
      repo.commentsToReturn = [makeComment()];
      await notifier.load('min1', 's1');
      expect(notifier.state.comments.isNotEmpty, isTrue);

      repo.commentsToReturn = [];
      final future = notifier.load('min2', 's2');
      expect(notifier.state.ministryId, equals('min2'));
      expect(notifier.state.scheduleId, equals('s2'));
      expect(notifier.state.comments, isEmpty);
      await future;
    });
  });

  group('ScheduleFormNotifier', () {
    late FakeScheduleRepository repo;
    late ScheduleFormNotifier notifier;

    setUp(() {
      repo = FakeScheduleRepository();
      repo.membersToReturn = [
        const MinistryMember(id: 'm1', userId: 'u1', name: 'Alice'),
        const MinistryMember(id: 'm2', userId: 'u2', name: 'Bob'),
      ];
      repo.rolesToReturn = [
        const MinistryRole(id: 'r1', name: 'Vocal'),
        const MinistryRole(id: 'r2', name: 'Bateria'),
      ];
      notifier = ScheduleFormNotifier(repository: repo);
    });

    test('init for new schedule sets default values and loads members/roles', () async {
      notifier.init(ministryId: 'min_test');

      expect(notifier.state.isEditing, isFalse);
      expect(notifier.state.ministryId, equals('min_test'));
      expect(notifier.state.title, equals('Culto'));
      expect(notifier.state.time, equals('19:00'));
      expect(notifier.state.durationMinutes, equals(120));
      expect(notifier.state.requireConfirmation, isFalse);
      expect(notifier.state.isDirty, isFalse);

      await Future.delayed(Duration.zero);

      expect(notifier.state.availableMembers.length, equals(2));
      expect(notifier.state.availableRoles.length, equals(2));
      expect(notifier.state.isLoadingMembers, isFalse);
    });

    test('init with initialSchedule populates existing data', () async {
      const existing = ScheduleDetail(
        id: 'sch_42',
        ministryId: 'min_test',
        title: 'Ensaio Geral',
        date: '2026-11-15',
        time: '20:00',
        durationMinutes: 90,
        notes: 'Trazer partituras',
        requireConfirmation: true,
        participants: [
          ScheduleParticipant(id: 'p1', userId: 'u1', name: 'Alice', role: 'Vocal'),
        ],
      );

      notifier.init(ministryId: 'min_test', initialSchedule: existing);

      expect(notifier.state.isEditing, isTrue);
      expect(notifier.state.scheduleId, equals('sch_42'));
      expect(notifier.state.title, equals('Ensaio Geral'));
      expect(notifier.state.date, equals('2026-11-15'));
      expect(notifier.state.time, equals('20:00'));
      expect(notifier.state.durationMinutes, equals(90));
      expect(notifier.state.notes, equals('Trazer partituras'));
      expect(notifier.state.requireConfirmation, isTrue);
      expect(notifier.state.participants.length, equals(1));
      expect(notifier.state.isDirty, isFalse);
    });

    test('setters update state and mark form dirty', () {
      notifier.init(ministryId: 'min_test');

      notifier.setTitle('Vigília');
      expect(notifier.state.title, equals('Vigília'));
      expect(notifier.state.isDirty, isTrue);

      notifier.setDate('2026-12-31');
      expect(notifier.state.date, equals('2026-12-31'));

      notifier.setTime('22:00');
      expect(notifier.state.time, equals('22:00'));

      notifier.setDurationMinutes(240);
      expect(notifier.state.durationMinutes, equals(240));

      notifier.setNotes('Trazer agasalho');
      expect(notifier.state.notes, equals('Trazer agasalho'));

      notifier.setRequireConfirmation(true);
      expect(notifier.state.requireConfirmation, isTrue);
    });

    test('addParticipant prevents duplicates and returns false', () {
      notifier.init(ministryId: 'min_test');

      const member = MinistryMember(id: 'm1', userId: 'u1', name: 'Alice');
      final firstAdded = notifier.addParticipant(member, 'Vocal');
      expect(firstAdded, isTrue);
      expect(notifier.state.participants.length, equals(1));
      expect(notifier.state.participants.first.name, equals('Alice'));
      expect(notifier.state.participants.first.role, equals('Vocal'));

      // Try adding same member again
      final secondAdded = notifier.addParticipant(member, 'Backing');
      expect(secondAdded, isFalse);
      expect(notifier.state.participants.length, equals(1));
    });

    test('removeParticipant and updateParticipantRole modify list', () {
      notifier.init(ministryId: 'min_test');
      const member1 = MinistryMember(id: 'm1', userId: 'u1', name: 'Alice');
      const member2 = MinistryMember(id: 'm2', userId: 'u2', name: 'Bob');

      notifier.addParticipant(member1, 'Vocal');
      notifier.addParticipant(member2, 'Baixo');
      expect(notifier.state.participants.length, equals(2));

      notifier.updateParticipantRole(0, 'Ministro de Louvor');
      expect(notifier.state.participants[0].role, equals('Ministro de Louvor'));

      notifier.removeParticipant(0);
      expect(notifier.state.participants.length, equals(1));
      expect(notifier.state.participants.first.name, equals('Bob'));
    });

    test('submit rejects empty title with validation error', () async {
      notifier.init(ministryId: 'min_test');
      notifier.setTitle('   ');

      final result = await notifier.submit();
      expect(result, isNull);
      expect(notifier.state.error, contains('título da escala é obrigatório'));
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('submit creates schedule via repository and returns result', () async {
      repo.detailToReturn = const ScheduleDetail(
        id: 'sch_created',
        ministryId: 'min_test',
        title: 'Culto Noturno',
        date: '2026-10-10',
      );

      notifier.init(ministryId: 'min_test');
      notifier.setTitle('Culto Noturno');
      notifier.setDate('2026-10-10');
      notifier.setTime('18:00');

      final result = await notifier.submit();

      expect(result, isNotNull);
      expect(result!.id, equals('sch_created'));
      expect(repo.lastCreatedMinistryId, equals('min_test'));
      expect(repo.lastCreatedData?['title'], equals('Culto Noturno'));
      expect(repo.lastCreatedData?['date'], equals('2026-10-10'));
      expect(notifier.state.submitSuccess, isTrue);
      expect(notifier.state.isDirty, isFalse);
    });

    test('submit updates existing schedule via updateSchedule', () async {
      const initial = ScheduleDetail(
        id: 'sch_existing',
        ministryId: 'min_test',
        title: 'Culto Original',
        date: '2026-10-10',
      );
      repo.detailToReturn = const ScheduleDetail(
        id: 'sch_existing',
        ministryId: 'min_test',
        title: 'Culto Editado',
        date: '2026-10-10',
      );

      notifier.init(ministryId: 'min_test', initialSchedule: initial);
      notifier.setTitle('Culto Editado');

      final result = await notifier.submit();

      expect(result, isNotNull);
      expect(repo.lastUpdatedMinistryId, equals('min_test'));
      expect(repo.lastUpdatedScheduleId, equals('sch_existing'));
      expect(repo.lastUpdatedData?['title'], equals('Culto Editado'));
      expect(notifier.state.submitSuccess, isTrue);
    });

    test('submit stores AppFailure message when repository fails', () async {
      repo.createException = const AppFailure(
        message: 'Acesso negado: apenas líderes podem criar escalas.',
        statusCode: 403,
      );

      notifier.init(ministryId: 'min_test');
      notifier.setTitle('Culto');
      notifier.setDate('2026-10-10');

      final result = await notifier.submit();

      expect(result, isNull);
      expect(notifier.state.error, contains('Acesso negado'));
      expect(notifier.state.isSubmitting, isFalse);
      expect(notifier.state.submitSuccess, isFalse);
    });

    test('song management: addSong, prevent duplicates, updateSongKey, removeSong, reorderSongs', () {
      notifier.init(ministryId: 'min_test');
      expect(notifier.state.songs, isEmpty);

      const song1 = ScheduleSong(id: 's1', title: 'Porque Ele Vive', artist: 'Harpa', key: 'G');
      const song2 = ScheduleSong(id: 's2', title: 'Vitorioso és', artist: 'Gabriel Guedes', key: 'A');
      const song3 = ScheduleSong(id: 's3', title: 'Bondade de Deus', artist: 'Isaias Saad', key: 'C');

      // Add song 1
      final added1 = notifier.addSong(song1);
      expect(added1, isTrue);
      expect(notifier.state.songs.length, equals(1));
      expect(notifier.state.isSongSelected('s1'), isTrue);

      // Duplicate prevention
      final addedDuplicate = notifier.addSong(song1);
      expect(addedDuplicate, isFalse);
      expect(notifier.state.songs.length, equals(1));

      // Add song 2 and 3
      notifier.addSong(song2);
      notifier.addSong(song3);
      expect(notifier.state.songs.length, equals(3));
      expect(notifier.state.songs[0].id, equals('s1'));
      expect(notifier.state.songs[1].id, equals('s2'));
      expect(notifier.state.songs[2].id, equals('s3'));

      // Update key
      notifier.updateSongKey(0, 'Ab');
      expect(notifier.state.songs[0].key, equals('Ab'));

      // Reorder: move index 2 to index 0
      notifier.reorderSongs(2, 0);
      expect(notifier.state.songs[0].id, equals('s3'));
      expect(notifier.state.songs[1].id, equals('s1'));
      expect(notifier.state.songs[2].id, equals('s2'));

      // Remove song at index 1
      notifier.removeSong(1);
      expect(notifier.state.songs.length, equals(2));
      expect(notifier.state.songs[0].id, equals('s3'));
      expect(notifier.state.songs[1].id, equals('s2'));
      expect(notifier.state.isSongSelected('s1'), isFalse);
    });

    test('timeline management: addTimelineItem, updateTimelineItem, reorderTimeline, removeTimelineItem', () {
      notifier.init(ministryId: 'min_test');
      expect(notifier.state.timeline, isEmpty);

      const t1 = ScheduleTimelineItem(id: 't1', title: 'Abertura', time: '19:00', type: 'prayer');
      const t2 = ScheduleTimelineItem(id: 't2', title: 'Louvor', time: '19:15', type: 'worship');
      const t3 = ScheduleTimelineItem(id: 't3', title: 'Palavra', time: '19:45', type: 'word');

      notifier.addTimelineItem(t1);
      notifier.addTimelineItem(t2);
      notifier.addTimelineItem(t3);
      expect(notifier.state.timeline.length, equals(3));

      // Update item
      notifier.updateTimelineItem(0, t1.copyWith(title: 'Oração Inicial'));
      expect(notifier.state.timeline[0].title, equals('Oração Inicial'));

      // Reorder timeline: move 0 to after 1
      notifier.reorderTimeline(0, 2);
      expect(notifier.state.timeline[0].id, equals('t2'));
      expect(notifier.state.timeline[1].id, equals('t1'));
      expect(notifier.state.timeline[2].id, equals('t3'));

      // Remove item
      notifier.removeTimelineItem(1);
      expect(notifier.state.timeline.length, equals(2));
      expect(notifier.state.timeline[0].id, equals('t2'));
      expect(notifier.state.timeline[1].id, equals('t3'));
    });

    test('clothing & palette management: addClothingPiece, updateClothingPiece, removeClothingPiece, setColorPalette', () {
      notifier.init(ministryId: 'min_test');
      expect(notifier.state.clothingPieces, isEmpty);
      expect(notifier.state.colorPalette, isNull);

      notifier.setColorPalette('Tons Terrosos');
      expect(notifier.state.colorPalette, equals('Tons Terrosos'));

      const piece1 = ScheduleClothingPiece(description: 'Camisa preta', colorHex: '#000000');
      const piece2 = ScheduleClothingPiece(description: 'Calça jeans', colorHex: '#1E3A8A');

      notifier.addClothingPiece(piece1);
      notifier.addClothingPiece(piece2);
      expect(notifier.state.clothingPieces.length, equals(2));

      notifier.updateClothingPiece(0, piece1.copyWith(description: 'Camisa social preta'));
      expect(notifier.state.clothingPieces[0].description, equals('Camisa social preta'));

      notifier.removeClothingPiece(1);
      expect(notifier.state.clothingPieces.length, equals(1));
      expect(notifier.state.clothingPieces[0].description, equals('Camisa social preta'));

      notifier.setColorPalette(null);
      expect(notifier.state.colorPalette, isNull);
    });

    test('submit serializes content fields (songs, timeline, clothing, palette) into create payload', () async {
      repo.detailToReturn = const ScheduleDetail(
        id: 'sch_content_test',
        ministryId: 'min_test',
        title: 'Culto de Celebração',
        date: '2026-10-15',
      );

      notifier.init(ministryId: 'min_test');
      notifier.setTitle('Culto de Celebração');
      notifier.setDate('2026-10-15');
      notifier.setTime('19:00');

      notifier.addSong(const ScheduleSong(id: 'song_1', title: 'Graça', key: 'E'));
      notifier.addTimelineItem(const ScheduleTimelineItem(id: 'tl_1', title: 'Momento de Louvor', type: 'worship'));
      notifier.addClothingPiece(const ScheduleClothingPiece(description: 'Branco', colorHex: '#FFFFFF'));
      notifier.setColorPalette('Preto e Branco');

      final result = await notifier.submit();
      expect(result, isNotNull);

      final payload = repo.lastCreatedData!;
      expect(payload['title'], equals('Culto de Celebração'));
      expect(payload['colorPalette'], equals('Preto e Branco'));

      final songs = payload['songs'] as List;
      expect(songs.length, equals(1));
      expect(songs.first['id'], equals('song_1'));
      expect(songs.first['title'], equals('Graça'));
      expect(songs.first['key'], equals('E'));

      final timeline = payload['timeline'] as List;
      expect(timeline.length, equals(1));
      expect(timeline.first['id'], equals('tl_1'));
      expect(timeline.first['title'], equals('Momento de Louvor'));
      expect(timeline.first['type'], equals('worship'));

      final clothing = payload['clothingPieces'] as List;
      expect(clothing.length, equals(1));
      expect(clothing.first['description'], equals('Branco'));
      expect(clothing.first['colorHex'], equals('#FFFFFF'));
    });
  });
}
