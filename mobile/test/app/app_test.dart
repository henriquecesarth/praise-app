import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';

import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';

class MockUser extends Mock implements User {}

class FakeDashboardRepository implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(
          String ministryId) async =>
      [];

  @override
  Future<List<Announcement>> getAnnouncements(String ministryId,
          {int limit = 20}) async =>
      [];
}

class FakeMinistryRepository implements MinistryRepository {
  List<Ministry> ministries;
  FakeMinistryRepository({this.ministries = const []});

  @override
  Future<List<Ministry>> getMyMinistries() async => ministries;
}

class FakeAuthRepository implements AuthRepository {
  final StreamController<User?> _controller =
      StreamController<User?>.broadcast();
  AuthUser? userToReturn;

  FakeAuthRepository({this.userToReturn});

  @override
  Stream<User?> authStateChanges() => _controller.stream;

  void emitUser(User? user) => _controller.add(user);

  @override
  User? get currentFirebaseUser => null;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => 'fake-token';

  @override
  Future<AuthUser> getMe() async {
    if (userToReturn != null) return userToReturn!;
    throw const AppFailure(message: 'Not authenticated');
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    throw UnimplementedError();
  }

  @override
  Future<void> signOut() async {
    _controller.add(null);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('LouvAioApp redirects to LoginScreen when unauthenticated',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final storage = SharedPreferencesStorage(prefs);
    final fakeRepo = FakeAuthRepository();
    final fakeMinistryRepo = FakeMinistryRepository();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          authRepositoryProvider.overrideWithValue(fakeRepo),
          ministryRepositoryProvider.overrideWithValue(fakeMinistryRepo),
        ],
        child: const LouvAioApp(),
      ),
    );

    // Initial state is initializing
    await tester.pump();

    // Emit unauthenticated
    fakeRepo.emitUser(null);
    await tester.pumpAndSettle();

    // Verify Login Screen rendered with real inputs
    expect(find.text('LouvAIO'), findsOneWidget);
    expect(find.text('Acesse seu ministério de louvor'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Entrar'), findsOneWidget);
    expect(find.text('Cadastrar'), findsOneWidget);
    expect(find.text('E-mail'), findsOneWidget);
    expect(find.text('Senha'), findsOneWidget);

    // Explicitly verify obsolete placeholder and shell are NOT rendered
    expect(find.text('Acesso LouvAIO'), findsNothing);
    expect(find.text('Fundação Mobile Pronta'), findsNothing);
    expect(find.text('Voltar ao Início'), findsNothing);
  });

  testWidgets('LouvAioApp displays AppShell when authenticated',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final storage = SharedPreferencesStorage(prefs);
    const testUser = AuthUser(
      id: 'usr_auth_123',
      email: 'henrique@louvaio.com',
      name: 'Henrique Hermogenes',
    );
    final fakeRepo = FakeAuthRepository(userToReturn: testUser);
    final fakeMinistryRepo = FakeMinistryRepository(
      ministries: [
        const Ministry(
          id: 'min_test_1',
          name: 'Ministério de Louvor',
          role: 'admin',
        ),
      ],
    );

    final fakeDashboardRepo = FakeDashboardRepository();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          preferencesStorageProvider.overrideWithValue(storage),
          authRepositoryProvider.overrideWithValue(fakeRepo),
          ministryRepositoryProvider.overrideWithValue(fakeMinistryRepo),
          dashboardRepositoryProvider.overrideWithValue(fakeDashboardRepo),
        ],
        child: const LouvAioApp(),
      ),
    );

    // Initial state is initializing
    await tester.pump();

    // Emit authenticated user
    fakeRepo.emitUser(MockUser());
    await tester.pumpAndSettle();

    // Verify AppShell rendered with user info and ministry context
    expect(find.text('LouvAIO'), findsOneWidget);
    expect(find.textContaining('Olá, Henrique Hermogenes'), findsOneWidget);
    expect(find.text('Ministério de Louvor'), findsWidgets);
    expect(find.text('ADMINISTRADOR'), findsOneWidget);
    // Explicitly verify raw UID is NOT exposed as normal UI
    expect(find.text('ID Autenticado: usr_auth_123'), findsNothing);
  });
}
