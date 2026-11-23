import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:mocktail/mocktail.dart';

import 'ministry_audio_fixtures.dart';

class _MockMinistryRepository extends Mock implements MinistryRepository {}

class _MockPrefs extends Mock
    implements PreferencesStorage, UserMinistrySelectionStorage {}

class _Adapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions) handler;
  final List<RequestOptions> requests = [];
  _Adapter(this.handler);

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<List<int>>? requestStream, Future<void>? cancelFuture) {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });

Matcher get _contextChanged => isA<AppFailure>().having(
    (f) => f.code, 'code', HttpMinistryAudioRepository.contextChangedCode);

const _min1 = Ministry(id: 'min_1', name: 'Alpha', role: 'admin');
const _min2 = Ministry(id: 'min_2', name: 'Beta');

void main() {
  late AuthSessionContext? session;

  ApiClient newApiClient() => ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
        tokenProvider: ({bool forceRefresh = false}) async => 'token',
        sessionContextProvider: () => session,
      );

  setUp(() {
    session = const AuthSessionContext(userId: 'user_1', sessionGeneration: 1);
  });

  group('MinistryContextNotifier stamp', () {
    late _MockMinistryRepository repository;
    late _MockPrefs prefs;
    late MinistryContextNotifier notifier;

    setUp(() {
      repository = _MockMinistryRepository();
      prefs = _MockPrefs();
      when(() => repository.getMyMinistries())
          .thenAnswer((_) async => [_min1, _min2]);
      when(() => prefs.getSelectedMinistryId()).thenReturn('min_1');
      when(() => prefs.setSelectedMinistryId(any())).thenAnswer((_) async {});
      notifier = MinistryContextNotifier(
          repository: repository, preferencesStorage: prefs);
    });

    test('A -> B -> A produces a different stamp with the same ministry id',
        () async {
      await notifier.bootstrap();
      final a1 = notifier.contextStamp!;
      expect(a1.ministryId, 'min_1');
      await notifier.selectMinistry(_min2);
      await notifier.selectMinistry(_min1);
      final a2 = notifier.contextStamp!;
      expect(a2.ministryId, a1.ministryId);
      expect(a2, isNot(a1));
    });

    test('a change that started but is not persisted yet already differs',
        () async {
      await notifier.bootstrap();
      final before = notifier.contextStamp!;
      final write = Completer<void>();
      when(() => prefs.setSelectedMinistryId('min_2'))
          .thenAnswer((_) => write.future);
      final selection = notifier.selectMinistry(_min2);
      // Selection not persisted/applied yet: state still shows min_1.
      expect(notifier.state.selectedMinistry?.id, 'min_1');
      expect(notifier.contextStamp, isNot(before));
      write.complete();
      await selection;
    });

    test('reset invalidates the stamp; disposed notifier has no stamp',
        () async {
      await notifier.bootstrap();
      final before = notifier.contextStamp!;
      await notifier.reset();
      expect(notifier.contextStamp, isNot(before));
      notifier.dispose();
      expect(notifier.contextStamp, isNull);
    });

    test('a rebuilt notifier never collides with an older one', () async {
      final rebuilt = MinistryContextNotifier(
          repository: repository, preferencesStorage: prefs);
      await notifier.bootstrap();
      await rebuilt.bootstrap();
      expect(rebuilt.contextStamp!.generation, notifier.contextStamp!.generation);
      expect(rebuilt.contextStamp!.ministryId, notifier.contextStamp!.ministryId);
      expect(rebuilt.contextStamp, isNot(notifier.contextStamp));
    });
  });

  group('repository wired through providers', () {
    late ProviderContainer container;
    late ApiClient apiClient;
    late _Adapter adapter;
    late Completer<void> gate;
    late _MockMinistryRepository ministries;

    Future<ResponseBody> listBody() async {
      await gate.future;
      return _json({'items': [recordingJson()], 'nextCursor': null});
    }

    setUp(() async {
      gate = Completer<void>();
      apiClient = newApiClient();
      adapter = _Adapter((_) => listBody());
      apiClient.dio.httpClientAdapter = adapter;
      ministries = _MockMinistryRepository();
      when(() => ministries.getMyMinistries())
          .thenAnswer((_) async => [_min1, _min2]);
      container = ProviderContainer(overrides: [
        apiClientProvider.overrideWithValue(apiClient),
        ministryRepositoryProvider.overrideWithValue(ministries),
      ]);
      addTearDown(container.dispose);
      // Two ministries and no saved preference -> needs selection; pick min_1.
      final notifier = container.read(ministryContextNotifierProvider.notifier);
      await notifier.bootstrap();
      await notifier.selectMinistry(_min1);
      expect(container.read(ministryContextNotifierProvider).selectedMinistry?.id,
          'min_1');
    });

    MinistryAudioRepository repo() =>
        container.read(ministryAudioRepositoryProvider);
    MinistryContextNotifier ctx() =>
        container.read(ministryContextNotifierProvider.notifier);

    test('valid result in a stable context', () async {
      gate.complete();
      final page = await repo().listRecordings(ministryId: 'min_1');
      expect(page.items.single.id, recordingId);
      expect(adapter.requests.single.headers['Authorization'], 'Bearer token');
    });

    test('A -> B -> A during a pending request is discarded', () async {
      final pending = repo().listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(_contextChanged));
      await Future<void>.delayed(Duration.zero);
      await ctx().selectMinistry(_min2);
      await ctx().selectMinistry(_min1);
      expect(container.read(ministryContextNotifierProvider).selectedMinistry?.id,
          'min_1');
      gate.complete();
      await check;
    });

    test('user switch during the request is discarded', () async {
      final pending = repo().listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(isA<AppFailure>()));
      await Future<void>.delayed(Duration.zero);
      session = const AuthSessionContext(userId: 'user_2', sessionGeneration: 2);
      gate.complete();
      await check;
    });

    test('logout (reset) during the request is discarded', () async {
      final pending = repo().getPlayback(
          ministryId: 'min_1', recordingId: recordingId);
      final check = expectLater(pending, throwsA(_contextChanged));
      await Future<void>.delayed(Duration.zero);
      await ctx().reset();
      session = null;
      gate.complete();
      await check;
    });

    test('notifier rebuild during the request is discarded', () async {
      final repository = repo();
      final pending = repository.listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(_contextChanged));
      await Future<void>.delayed(Duration.zero);
      container.invalidate(ministryContextNotifierProvider);
      container.read(ministryContextNotifierProvider.notifier); // rebuild
      gate.complete();
      await check;
    });

    test('late error after a ministry switch is not surfaced as current',
        () async {
      adapter = _Adapter((_) async {
        await gate.future;
        return _json({'error': {'message': 'forbidden'}}, 403);
      });
      apiClient.dio.httpClientAdapter = adapter;
      final pending = repo().listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(_contextChanged));
      await Future<void>.delayed(Duration.zero);
      await ctx().selectMinistry(_min2);
      gate.complete();
      await check;
    });

    test('a change started but not persisted discards the request', () async {
      final pending = repo().listRecordings(ministryId: 'min_1');
      final check = expectLater(pending, throwsA(_contextChanged));
      await Future<void>.delayed(Duration.zero);
      // Selection of min_2 starts; no await on its completion.
      final selection = ctx().selectMinistry(_min2);
      gate.complete();
      await check;
      await selection;
    });

    test('no request without a session or without an active ministry',
        () async {
      session = null;
      await expectLater(repo().listRecordings(ministryId: 'min_1'),
          throwsA(isA<AppFailure>()));
      session = const AuthSessionContext(userId: 'user_1', sessionGeneration: 1);
      await ctx().reset();
      await expectLater(
          repo().listRecordings(ministryId: 'min_1'), throwsA(_contextChanged));
      expect(adapter.requests, isEmpty);
    });

    test('only GET reads are issued by the provider-built repository',
        () async {
      gate.complete();
      await repo().listRecordings(ministryId: 'min_1');
      expect(adapter.requests.every((r) => r.method == 'GET'), isTrue);
    });
  });
}
