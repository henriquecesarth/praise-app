import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/push_notifications/data/push_device_repository.dart';
import 'package:louvaio_mobile/features/push_notifications/domain/push_notification_payload.dart';
import 'package:louvaio_mobile/features/push_notifications/services/push_notification_service.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/shared_import_payload.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_import.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/share_intent_router.dart';
import 'package:louvaio_mobile/features/smart_chords/services/share_intent_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _AuthRepository implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) => throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _AuthNotifier extends AuthNotifier {
  _AuthNotifier() : super(_AuthRepository()) {
    state = const AuthState.unauthenticated();
  }

  void authenticate(AuthUser user) {
    state = AuthState.authenticated(user);
  }

  void beginLogin() => state = const AuthState.authenticating();
}

class _MinistryRepository implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Preferences implements PreferencesStorage {
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _MinistryNotifier extends MinistryContextNotifier {
  _MinistryNotifier()
    : super(
        repository: _MinistryRepository(),
        preferencesStorage: _Preferences(),
      ) {
    state = const MinistryContextState.initial();
  }

  @override
  Future<void> bootstrap({String? userId}) async {
    state = const MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: _ministry,
      availableMinistries: [_ministry],
    );
  }
}

class _EmptyMinistryNotifier extends _MinistryNotifier {
  _EmptyMinistryNotifier() {
    state = const MinistryContextState(status: MinistryBootstrapStatus.empty);
  }

  @override
  Future<void> bootstrap({String? userId}) async {
    state = const MinistryContextState(status: MinistryBootstrapStatus.empty);
  }
}

const _user = AuthUser(
  id: 'user-keep',
  email: 'keep@test.invalid',
  name: 'Keep',
);
const _ministry = Ministry(
  id: 'min-keep',
  name: 'Keep Ministry',
  slug: 'keep-ministry',
  role: 'leader',
);
const _sharedText = 'G D Em C\nAmazing grace';

class _ShareService implements ShareIntentService {
  final Completer<SharedImportPayload?> initial =
      Completer<SharedImportPayload?>();
  final StreamController<SharedImportPayload> received =
      StreamController<SharedImportPayload>.broadcast();
  final StreamController<String> started = StreamController<String>.broadcast();

  @override
  Future<SharedImportPayload?> getInitialShare() => initial.future;
  @override
  Future<void> clearInitialShare() async {}
  @override
  Stream<String> get onShareStarted => started.stream;
  @override
  Stream<SharedImportPayload> get onShareReceived => received.stream;
  @override
  void dispose() {
    received.close();
    started.close();
  }
}

class _DashboardRepository implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(
    String ministryId,
  ) async => [];
  @override
  Future<List<Announcement>> getAnnouncements(
    String ministryId, {
    int limit = 20,
  }) async => [];
  @override
  Future<Announcement> createAnnouncement(
    String ministryId,
    Map<String, dynamic> data,
  ) => throw UnimplementedError();
}

class _SmartChordRepository implements SmartChordRepository {
  String? receivedText;
  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    receivedText = text;
    return const SmartChordImportDraft(
      title: 'Shared note',
      content: _sharedText,
      warnings: [],
      sourceType: 'text',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _SmartChordLinkRepository implements SmartChordRepertoireLinkRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PushDeviceRepository implements PushDeviceRepository {
  @override
  Future<bool> registerDevice({
    required String fcmToken,
    required String platform,
    String? appVersion,
    String? deviceModel,
  }) async => false;
  @override
  Future<bool> unregisterDevice({required String fcmToken}) async => true;
}

class _PushService extends PushNotificationService {
  _PushService()
    : super(
        pushDeviceRepo: _PushDeviceRepository(),
        logger: const AppLogger(isDebug: false),
      );

  @override
  bool get isInitialized => true;
  @override
  Future<void> initialize() async {}
  @override
  Future<bool> syncTokenWithBackend({
    String? appVersion,
    String? deviceModel,
  }) async => false;
  @override
  void setNotificationTapHandler(NotificationTapCallback handler) {}
  @override
  void setForegroundMessageHandler(
    void Function(PushNotificationPayload payload) handler,
  ) {}
}

class _ShareRouterHarness {
  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
  final _AuthNotifier auth = _AuthNotifier();
  final _EmptyMinistryNotifier ministry = _EmptyMinistryNotifier();
  final _ShareService service = _ShareService();
  final _SmartChordRepository chordRepository = _SmartChordRepository();
  late final ProviderContainer container;
  late final ShareIntentRouter router;

  _ShareRouterHarness({required bool authenticated}) {
    if (authenticated) auth.authenticate(_user);
    container = ProviderContainer(
      overrides: [
        authNotifierProvider.overrideWith((ref) => auth),
        ministryContextNotifierProvider.overrideWith((ref) => ministry),
        smartChordRepositoryProvider.overrideWithValue(chordRepository),
        smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
          _SmartChordLinkRepository(),
        ),
      ],
    );
    router = ShareIntentRouter(
      ref: container,
      navigatorKey: navigatorKey,
      service: service,
      logger: const AppLogger(isDebug: false),
    );
  }

  Widget buildApp() => UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      navigatorKey: navigatorKey,
      home: const Scaffold(body: Center(child: Text('Home'))),
    ),
  );

  void dispose() {
    router.dispose();
    container.dispose();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'authenticated empty-ministry user opens personal import hub directly',
    (tester) async {
      final harness = _ShareRouterHarness(authenticated: true);
      await tester.pumpWidget(harness.buildApp());
      expect(harness.ministry.state.isEmpty, isTrue);
      expect(harness.ministry.state.selectedMinistry, isNull);
      expect(harness.ministry.state.availableMinistries, isEmpty);

      await harness.router.handlePayload(
        const SharedImportPayload.text(_sharedText),
      );
      await tester.pump();
      await tester.pump();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(harness.chordRepository.receivedText, _sharedText);
      expect(harness.ministry.state.isEmpty, isTrue);
      expect(harness.ministry.state.selectedMinistry, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      harness.dispose();
    },
  );

  testWidgets(
    'pending personal share dispatches after authentication with empty ministry',
    (tester) async {
      final harness = _ShareRouterHarness(authenticated: false);
      await tester.pumpWidget(harness.buildApp());
      await harness.router.handlePayload(
        const SharedImportPayload.text(_sharedText),
      );
      expect(harness.router.pendingPayload?.text, _sharedText);
      expect(find.byType(SmartChordImportScreen), findsNothing);

      harness.auth.authenticate(_user);
      await harness.router.dispatchPendingIfReady();
      await tester.pump();
      await tester.pump();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(harness.chordRepository.receivedText, _sharedText);
      expect(harness.router.pendingPayload, isNull);
      expect(harness.ministry.state.isEmpty, isTrue);
      expect(harness.ministry.state.selectedMinistry, isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      harness.dispose();
    },
  );

  for (final emptyMinistry in [false, true]) {
    testWidgets(
      'cold share waits for auth and ministry (empty=$emptyMinistry), then opens import after Navigator mounts',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final preferences = await SharedPreferences.getInstance();
        final auth = _AuthNotifier();
        final ministry = emptyMinistry
            ? _EmptyMinistryNotifier()
            : _MinistryNotifier();
        final shareService = _ShareService();
        final chordRepository = _SmartChordRepository();
        final container = ProviderContainer(
          overrides: [
            preferencesStorageProvider.overrideWithValue(
              SharedPreferencesStorage(preferences),
            ),
            authNotifierProvider.overrideWith((ref) => auth),
            ministryContextNotifierProvider.overrideWith((ref) => ministry),
            shareIntentServiceProvider.overrideWithValue(shareService),
            dashboardRepositoryProvider.overrideWithValue(
              _DashboardRepository(),
            ),
            smartChordRepositoryProvider.overrideWithValue(chordRepository),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
              _SmartChordLinkRepository(),
            ),
            pushNotificationServiceProvider.overrideWithValue(_PushService()),
          ],
        );

        // Construct the real app router before a Navigator exists, as on a cold launch.
        final router = container.read(routerProvider);
        await tester.pump();
        shareService.initial.complete(
          const SharedImportPayload.text(_sharedText),
        );
        await tester.pump();
        await tester.pump();
        final shareRouter = container.read(shareIntentRouterProvider);
        expect(shareRouter.pendingPayload?.text, _sharedText);
        expect(router.routerDelegate.navigatorKey.currentState, isNull);

        // Authentication and ministry bootstrap can finish before the first app frame.
        auth.authenticate(_user);
        expect(ministry.state.isEmpty, emptyMinistry);
        expect(ministry.state.isReady, !emptyMinistry);
        expect(router.routerDelegate.navigatorKey.currentState, isNull);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const LouvAioApp(),
          ),
        );
        for (var frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 100));
        }

        expect(find.byType(SmartChordImportScreen), findsOneWidget);
        expect(chordRepository.receivedText, _sharedText);
        expect(
          tester
              .widgetList<TextField>(find.byType(TextField))
              .any((field) => field.controller?.text == _sharedText),
          isTrue,
        );

        container.dispose();
      },
    );
  }

  for (final initiallyAuthenticated in [false, true]) {
    testWidgets(
      'real router clears pending share on logout before user B with no ministry (started authenticated=$initiallyAuthenticated)',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final preferences = await SharedPreferences.getInstance();
        final auth = _AuthNotifier();
        if (initiallyAuthenticated) auth.authenticate(_user);
        final ministry = _EmptyMinistryNotifier();
        final service = _ShareService();
        final chords = _SmartChordRepository();
        final container = ProviderContainer(
          overrides: [
            preferencesStorageProvider.overrideWithValue(
              SharedPreferencesStorage(preferences),
            ),
            authNotifierProvider.overrideWith((ref) => auth),
            ministryContextNotifierProvider.overrideWith((ref) => ministry),
            shareIntentServiceProvider.overrideWithValue(service),
            dashboardRepositoryProvider.overrideWithValue(
              _DashboardRepository(),
            ),
            smartChordRepositoryProvider.overrideWithValue(chords),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
              _SmartChordLinkRepository(),
            ),
            pushNotificationServiceProvider.overrideWithValue(_PushService()),
          ],
        );
        container.read(routerProvider);
        await tester.pump();
        service.initial.complete(null);
        await tester.pump();
        final shares = container.read(shareIntentRouterProvider);
        // No Navigator yet: even authenticated personal shares remain pending.
        await shares.handlePayload(const SharedImportPayload.text(_sharedText));
        expect(shares.pendingPayload?.text, _sharedText);
        if (!initiallyAuthenticated) auth.beginLogin();

        // Exercise AuthNotifier.logout and the real router listener; never call
        // clearPendingPayload directly from this regression test.
        await auth.logout();
        expect(shares.pendingPayload, isNull);
        auth.authenticate(
          const AuthUser(id: 'user-b', email: 'b@test.invalid', name: 'B'),
        );
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const LouvAioApp(),
          ),
        );
        for (var frame = 0; frame < 12; frame++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(auth.state.user?.id, 'user-b');
        expect(ministry.state.isEmpty, isTrue);
        expect(find.byType(SmartChordImportScreen), findsNothing);
        expect(chords.receivedText, isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        container.dispose();
      },
    );
  }
}
