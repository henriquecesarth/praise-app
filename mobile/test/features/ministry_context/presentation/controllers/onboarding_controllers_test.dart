import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/invite_code_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry_onboarding.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/create_ministry_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/join_ministry_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';

class MockMinistryRepo implements MinistryRepository {
  int createMinistryCalls = 0;
  int joinMinistryCalls = 0;
  int createInviteCodeCalls = 0;
  int getMyMinistriesCalls = 0;

  Future<Ministry> Function(String name)? onCreateMinistry;
  Future<JoinMinistryResult> Function(String code)? onJoinMinistry;
  Future<MinistryInvite> Function(String ministryId, int expiresInDays)? onCreateInviteCode;
  List<Ministry> ministriesToReturn = [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Ministry>> getMyMinistries() async {
    getMyMinistriesCalls++;
    return ministriesToReturn;
  }

  @override
  Future<Ministry> createMinistry({required String name}) async {
    createMinistryCalls++;
    if (onCreateMinistry != null) {
      return onCreateMinistry!(name);
    }
    return Ministry(id: 'min_created_1', name: name, role: 'admin');
  }

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async {
    joinMinistryCalls++;
    if (onJoinMinistry != null) {
      return onJoinMinistry!(code);
    }
    return const JoinMinistryResult(
      message: 'Ingressou com sucesso',
      ministry: Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
      role: 'member',
    );
  }

  @override
  Future<MinistryInvite> createInviteCode(String ministryId, {int expiresInDays = 7}) async {
    createInviteCodeCalls++;
    if (onCreateInviteCode != null) {
      return onCreateInviteCode!(ministryId, expiresInDays);
    }
    return MinistryInvite(
      id: 'inv_1',
      ministryId: ministryId,
      code: 'PR-TEST1',
      expiresAt: DateTime.now().add(Duration(days: expiresInDays)),
    );
  }
}

class FakePreferencesStorage implements PreferencesStorage {
  String? selectedId;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<void> setSelectedMinistryId(String? id) async {
    selectedId = id;
  }

  @override
  String? getSelectedMinistryId() => selectedId;
}

void main() {
  group('M17 Onboarding Controllers', () {
    late MockMinistryRepo repository;
    late FakePreferencesStorage prefsStorage;
    late MinistryContextNotifier contextNotifier;

    setUp(() {
      repository = MockMinistryRepo();
      prefsStorage = FakePreferencesStorage();
      contextNotifier = MinistryContextNotifier(
        repository: repository,
        preferencesStorage: prefsStorage,
      );
    });

    group('CreateMinistryNotifier', () {
      late CreateMinistryNotifier controller;

      setUp(() {
        controller = CreateMinistryNotifier(
          repository: repository,
          contextNotifier: contextNotifier,
        );
      });

      test('validates ministry name: rejects blank, whitespace, and >100 characters', () async {
        final rEmpty = await controller.createMinistry('');
        expect(rEmpty.isFailure, isTrue);
        expect(rEmpty.errorMessage, contains('obrigatório'));
        expect(repository.createMinistryCalls, 0);

        final rSpaces = await controller.createMinistry('    ');
        expect(rSpaces.isFailure, isTrue);
        expect(rSpaces.errorMessage, contains('obrigatório'));
        expect(repository.createMinistryCalls, 0);

        final rLong = await controller.createMinistry('A' * 101);
        expect(rLong.isFailure, isTrue);
        expect(rLong.errorMessage, contains('100 caracteres'));
        expect(repository.createMinistryCalls, 0);
      });

      test('duplicate submit protection: concurrent calls make at most one repository call', () async {
        repository.onCreateMinistry = (name) async {
          await Future.delayed(const Duration(milliseconds: 50));
          return Ministry(id: 'min_dup_1', name: name, role: 'admin');
        };

        repository.ministriesToReturn = [
          const Ministry(id: 'min_dup_1', name: 'Ministério Concorrente', role: 'admin'),
        ];

        // Fire two concurrent calls
        final future1 = controller.createMinistry('Ministério Concorrente');
        final future2 = controller.createMinistry('Ministério Concorrente');

        final results = await Future.wait<OnboardingMutationResult<Ministry>>([future1, future2]);

        expect(repository.createMinistryCalls, 1);
        final succeeded = results.where((r) => r.isSuccess).length;
        final discarded = results.where((r) => r.isDiscarded).length;
        expect(succeeded, 1);
        expect(discarded, 1);
      });

      test('happy path: creates ministry, updates context, and transitions to ready', () async {
        repository.ministriesToReturn = [
          const Ministry(id: 'min_created_1', name: 'Novo Ministério', role: 'admin'),
        ];

        final result = await controller.createMinistry('Novo Ministério');

        expect(result.isSuccess, isTrue);
        expect(result.data?.id, 'min_created_1');
        expect(contextNotifier.state.isReady, isTrue);
        expect(contextNotifier.state.selectedMinistry?.id, 'min_created_1');
      });

      test('CREATE_POST_SUCCESS_REFRESH_RETRY_DOES_NOT_REPEAT_CREATE: partial failure retries convergence without re-POST', () async {
        // Initial getMyMinistries returns empty (simulate delayed replica or network hiccup on refresh)
        repository.ministriesToReturn = [];

        final result = await controller.createMinistry('Ministério Resiliente');

        // Created on backend, but not yet converged into context
        expect(result.isRefreshFailure, isTrue);
        expect(controller.state.createdMinistry, isNotNull);
        expect(controller.state.createdMinistry?.name, 'Ministério Resiliente');
        expect(repository.createMinistryCalls, 1);

        // Now replica catches up
        repository.ministriesToReturn = [
          const Ministry(id: 'min_created_1', name: 'Ministério Resiliente', role: 'admin'),
        ];

        // Retry convergence
        final retryResult = await controller.retryConvergence();

        expect(retryResult.isSuccess, isTrue);
        // CRITICAL: repository.createMinistry was NOT called a second time
        expect(repository.createMinistryCalls, 1);
        expect(contextNotifier.state.isReady, isTrue);
        expect(contextNotifier.state.selectedMinistry?.id, 'min_created_1');
      });

      test('session fencing: in-flight create discarded on session reset (User A -> User B)', () async {
        repository.onCreateMinistry = (name) async {
          await Future.delayed(const Duration(milliseconds: 50));
          return Ministry(id: 'min_user_a', name: name, role: 'admin');
        };

        final future = controller.createMinistry('Ministério do User A');

        // User A logs out while request in-flight
        controller.reset();

        final result = await future;

        expect(result.isDiscarded, isTrue);
        // Controller state must remain pristine
        expect(controller.state.isSubmitting, isFalse);
        expect(controller.state.createdMinistry, isNull);
        expect(controller.state.errorMessage, isNull);
      });
    });

    group('JoinMinistryNotifier', () {
      late JoinMinistryNotifier controller;

      setUp(() {
        controller = JoinMinistryNotifier(
          repository: repository,
          contextNotifier: contextNotifier,
        );
      });

      test('normalizes input: trims whitespace and capitalizes lowercase code', () async {
        repository.ministriesToReturn = [
          const Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
        ];

        String? receivedCode;
        repository.onJoinMinistry = (code) async {
          receivedCode = code;
          return const JoinMinistryResult(
            message: 'Sucesso',
            ministry: Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
            role: 'member',
          );
        };

        final result = await controller.joinMinistry('  pr-abc123  ');

        expect(result.isSuccess, isTrue);
        expect(receivedCode, 'PR-ABC123');
      });

      test('duplicate submit protection on join: concurrent attempts make at most one call', () async {
        repository.onJoinMinistry = (code) async {
          await Future.delayed(const Duration(milliseconds: 50));
          return const JoinMinistryResult(
            message: 'Sucesso',
            ministry: Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
            role: 'member',
          );
        };

        repository.ministriesToReturn = [
          const Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
        ];

        final future1 = controller.joinMinistry('PR-JOIN1');
        final future2 = controller.joinMinistry('PR-JOIN1');

        final results = await Future.wait<OnboardingMutationResult<JoinMinistryResult>>([future1, future2]);

        expect(repository.joinMinistryCalls, 1);
        final succeeded = results.where((r) => r.isSuccess).length;
        final discarded = results.where((r) => r.isDiscarded).length;
        expect(succeeded, 1);
        expect(discarded, 1);
      });

      test('JOIN_POST_SUCCESS_REFRESH_RETRY: partial failure retries convergence without re-POSTing join', () async {
        repository.ministriesToReturn = [];

        final result = await controller.joinMinistry('PR-TARGET');

        expect(result.isRefreshFailure, isTrue);
        expect(controller.state.joinedMinistry, isNotNull);
        expect(repository.joinMinistryCalls, 1);

        // Authoritative memberships update
        repository.ministriesToReturn = [
          const Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
        ];

        final retryResult = await controller.retryConvergence();

        expect(retryResult.isSuccess, isTrue);
        // CRITICAL: join endpoint was NOT called again
        expect(repository.joinMinistryCalls, 1);
        expect(contextNotifier.state.selectedMinistry?.id, 'min_joined_1');
      });

      test('session fencing: in-flight join discarded on reset', () async {
        repository.onJoinMinistry = (code) async {
          await Future.delayed(const Duration(milliseconds: 50));
          return const JoinMinistryResult(
            message: 'Sucesso',
            ministry: Ministry(id: 'min_joined_1', name: 'Ministério Ingressado', role: 'member'),
            role: 'member',
          );
        };

        final future = controller.joinMinistry('PR-STALE');
        controller.reset();

        final result = await future;
        expect(result.isDiscarded, isTrue);
        expect(controller.state.isSubmitting, isFalse);
      });
    });

    group('InviteCodeNotifier', () {
      late InviteCodeNotifier controller;

      setUp(() {
        controller = InviteCodeNotifier(
          repository: repository,
        );
      });

      test('generateInvite calls repository and updates state with 7-day expiration', () async {
        final result = await controller.generateInvite('min_alpha');

        expect(repository.createInviteCodeCalls, 1);
        expect(result.isSuccess, isTrue);
        expect(result.data?.code, 'PR-TEST1');
        expect(controller.state.invite?.code, 'PR-TEST1');
        expect(controller.state.isLoading, isFalse);
        expect(controller.state.errorMessage, isNull);
      });

      test('tenant switch fencing: reset wipes active invite and increments sequence', () async {
        await controller.generateInvite('min_alpha');
        expect(controller.state.invite, isNotNull);

        controller.reset();

        expect(controller.state.invite, isNull);
        expect(controller.state.isLoading, isFalse);
        expect(controller.state.errorMessage, isNull);
      });

      test('tenant switch during generation: response for Alpha is discarded after switch to Beta', () async {
        repository.onCreateInviteCode = (ministryId, expiresInDays) async {
          await Future.delayed(const Duration(milliseconds: 50));
          return MinistryInvite(
            id: 'inv_alpha',
            ministryId: ministryId,
            code: 'PR-ALPHA',
            expiresAt: DateTime.now().add(const Duration(days: 7)),
          );
        };

        final future = controller.generateInvite('min_alpha');

        // User switches to Beta before Alpha generation resolves
        controller.updateContext(ministryId: 'min_beta');

        final result = await future;

        expect(result.isDiscarded, isTrue);
        // Controller must not hold Alpha invite data
        expect(controller.state.invite, isNull);
      });

      test('maps 403 Forbidden to administrator permission error', () async {
        repository.onCreateInviteCode = (ministryId, expiresInDays) async {
          throw const AppFailure(
            message: 'Apenas administradores podem gerar códigos de convite.',
            statusCode: 403,
          );
        };

        final result = await controller.generateInvite('min_member_only');

        expect(result.isFailure, isTrue);
        expect(controller.state.errorMessage, contains('administradores'));
      });
    });
  });
}