import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/app/shell/app_shell.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/notifications/data/notification_repository.dart';
import 'package:louvaio_mobile/features/notifications/presentation/controllers/notification_providers.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_import_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';
import 'package:mocktail/mocktail.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

class _MockMinistryRepository extends Mock implements MinistryRepository {}

class _MockPreferencesStorage extends Mock implements PreferencesStorage {}

class _MockDashboardRepository extends Mock implements DashboardRepository {}

class _MockScheduleRepository extends Mock implements ScheduleRepository {}

class _MockRepertoireRepository extends Mock implements RepertoireRepository {}

class _MockNotificationRepository extends Mock
    implements NotificationRepository {}

class _FakeSmartChordRepository implements SmartChordRepository {
  final Map<String, SmartChord> _byId;
  _FakeSmartChordRepository(List<SmartChord> chords)
      : _byId = {for (final c in chords) c.id: c};

  @override
  Future<List<SmartChord>> getSmartChords({
    String? search,
    int? page,
    int? limit,
  }) async =>
      _byId.values.toList();

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async =>
      _byId.values.where((c) => c.songId == songId).toList();

  @override
  Future<SmartChord> getSmartChordById(String id) async => _byId[id]!;

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async =>
      _byId.values.first;

  @override
  Future<SmartChord> updateSmartChord(
    String id,
    Map<String, dynamic> payload,
  ) async =>
      _byId[id]!;

  @override
  Future<void> deleteSmartChord(String id) async {}

  @override
  Future<SmartChordImportDraft> importPdfDraft(
    List<int> bytes,
    String filename,
  ) async =>
      const SmartChordImportDraft(
        title: 'PDF Draft',
        content: '[C]Teste',
        warnings: [],
        sourceType: 'pdf',
      );

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async =>
      SmartChordImportDraft(
        title: 'Draft Ministério 1',
        content: text,
        warnings: const [],
        sourceType: 'text',
      );

  @override
  Future<SmartChordImportDraft> importUrlDraft(String url) async =>
      const SmartChordImportDraft(
        title: 'URL Draft',
        content: '[G]Teste',
        warnings: [],
        sourceType: 'url',
      );

  @override
  Future<SmartChordImportDraft> importCapturedUrlDraft(
    String url,
    String capturedHtml,
  ) async =>
      const SmartChordImportDraft(
        title: 'Captured URL Draft',
        content: '[G]Teste',
        warnings: [],
        sourceType: 'url',
      );

  @override
  Future<SmartChordImportDraft> importImageDraft(
    List<int> bytes,
    String filename,
  ) async =>
      const SmartChordImportDraft(
        title: 'Image Draft',
        content: '[D]Teste',
        warnings: [],
        sourceType: 'image',
      );
}

class _FakeSmartChordLinkRepository
    implements SmartChordRepertoireLinkRepository {
  final Map<String, Future<List<SmartChord>> Function()> _handlers = {};
  final List<String> requestedMinistries = [];
  SmartChordRepertoireLink linkToReturn = const SmartChordRepertoireLink.unlinked();
  Future<SmartChordRepertoireLink> Function(String ministryId, String chordId)?
      getLinkHandler;
  Future<SmartChordRepertoireLink> Function(
    String ministryId,
    String chordId,
    String songId,
  )? setLinkHandler;
  Future<void> Function(String ministryId, String chordId)? removeLinkHandler;

  void setHandler(String ministryId, Future<List<SmartChord>> Function() fn) {
    _handlers[ministryId] = fn;
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    requestedMinistries.add(ministryId);
    final handler = _handlers[ministryId];
    if (handler != null) return handler();
    return const [];
  }

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async =>
      getLinkHandler != null
          ? getLinkHandler!(ministryId, chordId)
          : linkToReturn;

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async =>
      setLinkHandler != null
          ? setLinkHandler!(ministryId, chordId, songId)
          : linkToReturn;

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    if (removeLinkHandler != null) {
      await removeLinkHandler!(ministryId, chordId);
    }
  }
}

SmartChord _chord(String id, String title, {String songId = 'song-1'}) =>
    SmartChord(
      id: id,
      userId: 'usr-1',
      songId: songId,
      title: title,
      originalKey: 'C',
      content: '[$id]$title',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    );

void main() {
  group('Phase B — Flutter Ministry Invalidation & SongSmartChords Scoping', () {
    test(
      'SongSmartChordsNotifier chaves cache por ministryId e descarta resposta atrasada',
      () async {
        final fakeRepo = _FakeSmartChordRepository([_chord('sc-1', 'Fallback')]);
        final fakeLinkRepo = _FakeSmartChordLinkRepository();

        final completerMin1 = Completer<List<SmartChord>>();
        fakeLinkRepo.setHandler('min_1', () async => [_chord('sc-min1', 'Cifra Min 1')]);
        fakeLinkRepo.setHandler('min_2', () async => [_chord('sc-min2', 'Cifra Min 2')]);

        final notifier = SongSmartChordsNotifier(
          repository: fakeRepo,
          linkRepository: fakeLinkRepo,
        );

        await notifier.load('song-1', ministryId: 'min_1');
        expect(notifier.state.items.map((c) => c.id), ['sc-min1']);
        expect(notifier.state.ministryId, 'min_1');

        // Same songId under a different ministry must NOT reuse cached min_1 chords
        // and must clear stale items immediately while loading min_2.
        fakeLinkRepo.setHandler('min_2', () async {
          expect(
            notifier.state.items,
            isEmpty,
            reason: 'Cifras do ministério anterior não devem ficar visíveis durante troca',
          );
          return [_chord('sc-min2', 'Cifra Min 2')];
        });

        await notifier.load('song-1', ministryId: 'min_2');
        expect(notifier.state.items.map((c) => c.id), ['sc-min2']);
        expect(notifier.state.ministryId, 'min_2');
        expect(fakeLinkRepo.requestedMinistries, ['min_1', 'min_2']);

        // Late in-flight min_1 response must be discarded after switching to min_2.
        fakeLinkRepo.setHandler('min_1', () => completerMin1.future);
        fakeLinkRepo.setHandler('min_2', () async => [_chord('sc-min2-fresh', 'Fresh Min 2')]);

        final staleFuture = notifier.load('song-2', ministryId: 'min_1');
        await notifier.load('song-2', ministryId: 'min_2');
        completerMin1.complete([_chord('sc-min1-stale', 'Stale Min 1')]);
        await staleFuture;

        expect(notifier.state.items.map((c) => c.id), ['sc-min2-fresh']);
        expect(notifier.state.ministryId, 'min_2');
      },
    );

    testWidgets(
      'AppShell invalida todos os providers de SmartChords e SongForm ao trocar de ministério',
      (tester) async {
        const testUser = AuthUser(
          id: 'usr-1',
          email: 'membro@louvaio.com',
          name: 'Membro LouvAIO',
        );
        const ministry1 = Ministry(
          id: 'min_1',
          name: 'Ministério A',
          role: 'admin',
        );
        const ministry2 = Ministry(
          id: 'min_2',
          name: 'Ministério B',
          role: 'member',
        );

        final authRepo = _MockAuthRepository();
        final ministryRepo = _MockMinistryRepository();
        final prefs = _MockPreferencesStorage();
        final dashRepo = _MockDashboardRepository();
        final schedRepo = _MockScheduleRepository();
        final repRepo = _MockRepertoireRepository();
        final notifRepo = _MockNotificationRepository();
        final chordRepo = _FakeSmartChordRepository([_chord('sc-1', 'Cifra Min 1')]);
        final linkRepo = _FakeSmartChordLinkRepository()
          ..linkToReturn = const SmartChordRepertoireLink(
            link: SmartChordSongLink(
              id: 'lnk-1',
              userId: 'usr-1',
              smartChordId: 'sc-1',
              ministryId: 'min_1',
              songId: 'song-1',
            ),
            song: SmartChordSongSummary(
              id: 'song-1',
              ministryId: 'min_1',
              title: 'Música Min 1',
            ),
          )
          ..setHandler('min_1', () async => [_chord('sc-1', 'Cifra Min 1')])
          ..setHandler('min_2', () async => []);

        when(() => authRepo.authStateChanges()).thenAnswer((_) => const Stream.empty());
        when(() => authRepo.signOut()).thenAnswer((_) async {});
        when(() => prefs.getSelectedMinistryId()).thenReturn('min_1');
        when(() => prefs.setSelectedMinistryId(any())).thenAnswer((_) async {});
        when(() => dashRepo.getSchedules(any())).thenAnswer((_) async => const []);
        when(() => dashRepo.getAnnouncements(any())).thenAnswer((_) async => const []);
        when(() => repRepo.listArtists('min_1')).thenAnswer(
          (_) async => const [
            Artist(id: 'art-1', ministryId: 'min_1', name: 'Artista Min 1'),
          ],
        );
        when(() => repRepo.listArtists('min_2')).thenAnswer((_) async => const []);
        when(() => repRepo.listClassifications(any())).thenAnswer(
          (_) async => const <Classification>[],
        );
        when(() => notifRepo.getUnreadCount()).thenAnswer((_) async => 0);

        late MinistryContextNotifier ministryNotifier;

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              appEnvironmentProvider.overrideWithValue(
                const AppEnvironment(
                  env: AppEnv.production,
                  apiBaseUrl: 'https://api.louvaio.com/api/v1',
                ),
              ),
              preferencesStorageProvider.overrideWithValue(prefs),
              authRepositoryProvider.overrideWithValue(authRepo),
              ministryRepositoryProvider.overrideWithValue(ministryRepo),
              dashboardRepositoryProvider.overrideWithValue(dashRepo),
              scheduleRepositoryProvider.overrideWithValue(schedRepo),
              repertoireRepositoryProvider.overrideWithValue(repRepo),
              notificationRepositoryProvider.overrideWithValue(notifRepo),
              smartChordRepositoryProvider.overrideWithValue(chordRepo),
              smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
              authNotifierProvider.overrideWith((ref) {
                final n = AuthNotifier(authRepo);
                n.state = const AuthState.authenticated(testUser);
                return n;
              }),
              ministryContextNotifierProvider.overrideWith((ref) {
                ministryNotifier = MinistryContextNotifier(
                  repository: ministryRepo,
                  preferencesStorage: prefs,
                );
                ministryNotifier.state = const MinistryContextState(
                  status: MinistryBootstrapStatus.ready,
                  availableMinistries: [ministry1, ministry2],
                  selectedMinistry: ministry1,
                );
                return ministryNotifier;
              }),
            ],
            child: const MaterialApp(home: AppShell()),
          ),
        );

        await tester.pumpAndSettle();

        final container = ProviderScope.containerOf(
          tester.element(find.byType(AppShell)),
        );

        // Keep active listeners so Riverpod invalidation immediately refreshes/resets them.
        container.listen(songSmartChordsNotifierProvider, (_, __) {});
        container.listen(smartChordRepertoireLinkNotifierProvider, (_, __) {});
        container.listen(smartChordListNotifierProvider, (_, __) {});
        container.listen(smartChordDetailNotifierProvider, (_, __) {});
        container.listen(songFormNotifierProvider, (_, __) {});
        container.listen(smartChordFormNotifierProvider, (_, __) {});
        container.listen(smartChordImportNotifierProvider, (_, __) {});

        // Seed state under ministry1
        await container
            .read(songSmartChordsNotifierProvider.notifier)
            .load('song-1', ministryId: 'min_1');
        await container
            .read(smartChordRepertoireLinkNotifierProvider.notifier)
            .load(ministryId: 'min_1', chordId: 'sc-1');
        await container.read(smartChordListNotifierProvider.notifier).load();
        await container.read(smartChordDetailNotifierProvider.notifier).load('sc-1');
        await container
            .read(songFormNotifierProvider.notifier)
            .init(ministryId: 'min_1', boundUserId: 'usr-1');
        await container
            .read(smartChordImportNotifierProvider.notifier)
            .importText('[C]Texto Min 1');

        expect(container.read(songSmartChordsNotifierProvider).items, isNotEmpty);
        expect(container.read(smartChordRepertoireLinkNotifierProvider).link, isNotNull);
        expect(container.read(smartChordListNotifierProvider).items, isNotEmpty);
        expect(container.read(smartChordDetailNotifierProvider).chord, isNotNull);
        expect(container.read(songFormNotifierProvider).artists, isNotEmpty);
        expect(container.read(smartChordImportNotifierProvider).draft, isNotNull);

        // Switch ministry to min_2
        await ministryNotifier.selectMinistry(ministry2);
        await tester.pumpAndSettle();

        expect(container.read(songSmartChordsNotifierProvider).items, isEmpty);
        expect(container.read(songSmartChordsNotifierProvider).songId, isNull);
        expect(container.read(smartChordRepertoireLinkNotifierProvider).link, isNull);
        expect(container.read(smartChordRepertoireLinkNotifierProvider).ministryId, isNull);
        expect(container.read(smartChordListNotifierProvider).items, isEmpty);
        expect(container.read(smartChordDetailNotifierProvider).chord, isNull);
        expect(container.read(songFormNotifierProvider).artists, isEmpty);
        expect(container.read(songFormNotifierProvider.notifier).boundMinistryId, isNull);
        expect(container.read(smartChordImportNotifierProvider).draft, isNull);
        expect(
          container.read(smartChordImportNotifierProvider).status,
          ImportStatus.initial,
        );
      },
    );

    test(
      'SmartChordRepertoireLinkNotifier limpa link ao trocar ministério e ignora setLink/unlink após reset()',
      () async {
        final fakeRepo = _FakeSmartChordLinkRepository();
        const linkedMin1 = SmartChordRepertoireLink(
          link: SmartChordSongLink(
            id: 'lnk-1',
            userId: 'usr-1',
            smartChordId: 'sc-1',
            ministryId: 'min_1',
            songId: 'song-1',
          ),
          song: SmartChordSongSummary(
            id: 'song-1',
            ministryId: 'min_1',
            title: 'Canção Min 1',
          ),
        );
        final min2Completer = Completer<SmartChordRepertoireLink>();
        final setCompleter = Completer<SmartChordRepertoireLink>();
        final unlinkCompleter = Completer<void>();

        fakeRepo.getLinkHandler = (minId, _) async =>
            minId == 'min_1' ? linkedMin1 : min2Completer.future;
        fakeRepo.setLinkHandler = (_, __, ___) => setCompleter.future;
        fakeRepo.removeLinkHandler = (_, __) => unlinkCompleter.future;

        final notifier = SmartChordRepertoireLinkNotifier(repository: fakeRepo);
        await notifier.load(ministryId: 'min_1', chordId: 'sc-1');
        expect(notifier.state.isLinked, isTrue);
        expect(notifier.state.link?.songTitle, 'Canção Min 1');

        // Start loading min_2 -> link from min_1 must be cleared immediately while loading
        final loadMin2Future = notifier.load(ministryId: 'min_2', chordId: 'sc-1');
        expect(notifier.state.isLoading, isTrue);
        expect(notifier.state.link, isNull);
        expect(notifier.state.ministryId, 'min_2');

        min2Completer.complete(const SmartChordRepertoireLink.unlinked());
        await loadMin2Future;
        expect(notifier.state.isLinked, isFalse);

        // Start in-flight setLink, then reset() before API completes -> must NOT restore link
        final setFuture = notifier.setLink(
          ministryId: 'min_2',
          chordId: 'sc-1',
          songId: 'song-2',
        );
        expect(notifier.state.isSaving, isTrue);
        notifier.reset();
        setCompleter.complete(linkedMin1);
        expect(await setFuture, isFalse);
        expect(notifier.state.link, isNull);
        expect(notifier.state.ministryId, isNull);

        // Start in-flight unlink, then reset() before API completes -> must NOT leave unlinked object
        final unlinkFuture = notifier.unlink(ministryId: 'min_2', chordId: 'sc-1');
        notifier.reset();
        unlinkCompleter.complete();
        expect(await unlinkFuture, isFalse);
        expect(notifier.state.link, isNull);
        expect(notifier.state.ministryId, isNull);
      },
    );
  });
}
