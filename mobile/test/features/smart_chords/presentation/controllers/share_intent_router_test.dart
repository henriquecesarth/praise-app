import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/shared_import_payload.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/share_intent_router.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/views/smart_chord_import_screen.dart';
import 'package:louvaio_mobile/features/smart_chords/services/share_intent_service.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword({required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> signUp({required String name, required String email, required String password}) => throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakePreferencesStorage implements PreferencesStorage {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier([
    AuthState initialState = const AuthState.authenticated(
      AuthUser(id: 'user_123', email: 'musician@louvaio.test', name: 'Musician'),
    ),
  ]) : super(_FakeAuthRepo()) {
    state = initialState;
  }

  void setUser(AuthUser? user) {
    if (user != null) {
      state = AuthState.authenticated(user);
    } else {
      state = const AuthState.unauthenticated();
    }
  }
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier([
    MinistryContextState initialState = const MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(
        id: 'min_456',
        name: 'Louvor Central',
        slug: 'louvor-central',
        role: 'leader',
      ),
      availableMinistries: [
        Ministry(
          id: 'min_456',
          name: 'Louvor Central',
          slug: 'louvor-central',
          role: 'leader',
        ),
      ],
    ),
  ]) : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = initialState;
  }

  void setMinistry(Ministry? ministry) {
    state = state.copyWith(
      status: ministry != null ? MinistryBootstrapStatus.ready : MinistryBootstrapStatus.empty,
      selectedMinistry: ministry,
      clearSelectedMinistry: ministry == null,
    );
  }
}

class FakeShareIntentService implements ShareIntentService {
  SharedImportPayload? initialPayload;
  final StreamController<SharedImportPayload> _controller =
      StreamController<SharedImportPayload>.broadcast();
  bool cleared = false;
  bool disposed = false;

  @override
  Future<SharedImportPayload?> getInitialShare() async => initialPayload;

  @override
  Future<void> clearInitialShare() async {
    cleared = true;
    initialPayload = null;
  }

  @override
  Stream<SharedImportPayload> get onShareReceived => _controller.stream;

  void emitWarmShare(SharedImportPayload payload) {
    _controller.add(payload);
  }

  @override
  void dispose() {
    disposed = true;
    _controller.close();
  }
}

void main() {
  late FakeAuthNotifier fakeAuth;
  late FakeMinistryContextNotifier fakeMinistry;
  late FakeShareIntentService fakeService;
  late GlobalKey<NavigatorState> navigatorKey;
  late AppLogger logger;

  const testUser = AuthUser(
    id: 'user_123',
    email: 'musician@louvaio.test',
    name: 'Musician',
  );

  const testMinistry = Ministry(
    id: 'min_456',
    name: 'Louvor Central',
    slug: 'louvor-central',
    role: 'leader',
  );

  setUp(() {
    fakeService = FakeShareIntentService();
    fakeAuth = FakeAuthNotifier();
    fakeMinistry = FakeMinistryContextNotifier();
    navigatorKey = GlobalKey<NavigatorState>();
    logger = const AppLogger(isDebug: false);
  });

  tearDown(() {
    fakeService.dispose();
  });

  Widget buildTestApp({
    required WidgetTester tester,
    required ProviderContainer container,
    required Widget child,
  }) {
    return UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        navigatorKey: navigatorKey,
        home: Scaffold(body: child),
      ),
    );
  }

  group('ShareIntentRouter Tests', () {
    testWidgets('unauthenticated session: holds pending payload without navigating',
        (tester) async {
      fakeAuth.setUser(null);

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => fakeAuth),
          ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = ShareIntentRouter(
        ref: container,
        navigatorKey: navigatorKey,
        service: fakeService,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Home Screen'),
        ),
      );
      await tester.pumpAndSettle();

      const payload = SharedImportPayload.text('G D Em C');
      await router.handlePayload(payload);
      await tester.pumpAndSettle();

      // Verify payload is held and NOT navigated
      expect(router.pendingPayload, isNotNull);
      expect(router.pendingPayload?.text, 'G D Em C');
      expect(find.byType(SmartChordImportScreen), findsNothing);
      expect(find.text('Home Screen'), findsOneWidget);
    });

    testWidgets('authenticated session: navigates to SmartChordImportScreen with shared payload',
        (tester) async {
      fakeAuth.setUser(testUser);
      fakeMinistry.setMinistry(testMinistry);

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => fakeAuth),
          ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = ShareIntentRouter(
        ref: container,
        navigatorKey: navigatorKey,
        service: fakeService,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Dashboard Screen'),
        ),
      );
      await tester.pumpAndSettle();

      const payload = SharedImportPayload.text('D A Bm G');
      await router.handlePayload(payload);
      await tester.pumpAndSettle();

      // Verify navigation occurred to SmartChordImportScreen with payload
      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(router.pendingPayload, isNull);
    });

    testWidgets('warm start: handles onShareReceived while app is running',
        (tester) async {
      fakeAuth.setUser(testUser);
      fakeMinistry.setMinistry(testMinistry);

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => fakeAuth),
          ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = ShareIntentRouter(
        ref: container,
        navigatorKey: navigatorKey,
        service: fakeService,
        logger: logger,
      );
      router.initialize();

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Active Screen'),
        ),
      );
      await tester.pumpAndSettle();

      // Emit warm share event
      fakeService.emitWarmShare(const SharedImportPayload.text('E B C#m A'));
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);
    });

    testWidgets('login dispatch: unauthenticated held payload dispatches upon login & ministry ready',
        (tester) async {
      fakeAuth.setUser(null);
      fakeMinistry.setMinistry(null);

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => fakeAuth),
          ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = ShareIntentRouter(
        ref: container,
        navigatorKey: navigatorKey,
        service: fakeService,
        logger: logger,
      );

      await tester.pumpWidget(
        buildTestApp(
          tester: tester,
          container: container,
          child: const Text('Login Screen'),
        ),
      );
      await tester.pumpAndSettle();

      // Share intent received before authentication
      const payload = SharedImportPayload.text('A E F#m D');
      await router.handlePayload(payload);
      expect(router.pendingPayload, isNotNull);
      expect(find.byType(SmartChordImportScreen), findsNothing);

      // User logs in and ministry becomes ready
      fakeAuth.setUser(testUser);
      fakeMinistry.setMinistry(testMinistry);
      await tester.pumpAndSettle();

      // Dispatch pending
      await router.dispatchPendingIfReady();
      await tester.pumpAndSettle();

      expect(find.byType(SmartChordImportScreen), findsOneWidget);
      expect(router.pendingPayload, isNull);
    });

    testWidgets('session safety: clearPendingPayload clears held payload on logout',
        (tester) async {
      fakeAuth.setUser(null);

      final container = ProviderContainer(
        overrides: [
          authNotifierProvider.overrideWith((ref) => fakeAuth),
          ministryContextNotifierProvider.overrideWith((ref) => fakeMinistry),
          rootNavigatorKeyProvider.overrideWithValue(navigatorKey),
        ],
      );

      final router = ShareIntentRouter(
        ref: container,
        navigatorKey: navigatorKey,
        service: fakeService,
        logger: logger,
      );

      await router.handlePayload(const SharedImportPayload.text('Confidential Chords'));
      expect(router.pendingPayload, isNotNull);

      // User logs out or switches
      router.clearPendingPayload();
      expect(router.pendingPayload, isNull);
    });
  });
}
