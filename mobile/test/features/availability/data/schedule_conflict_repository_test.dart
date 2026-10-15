import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/availability/data/availability_repository.dart';
import 'package:louvaio_mobile/features/availability/domain/availability.dart';

class MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) _handler;
  MockAdapter(this._handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) {
    return _handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonOk(String body) => ResponseBody.fromString(
      body,
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

ResponseBody jsonError(int status, String body) => ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType]
      },
    );

void main() {
  late ApiClient apiClient;
  late HttpAvailabilityRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'https://api.test.louvaio.com/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpAvailabilityRepository(apiClient: apiClient);
  });

  group('ScheduleConflict Domain Models', () {
    test('ScheduleCivilWindow serialization and equality', () {
      final json = {
        'startsAt': '2026-10-25T19:00:00',
        'endsAt': '2026-10-25T21:00:00',
        'durationMinutes': 120,
        'durationSource': 'explicit',
      };

      final window = ScheduleCivilWindow.fromJson(json);
      expect(window.startsAt, '2026-10-25T19:00:00');
      expect(window.endsAt, '2026-10-25T21:00:00');
      expect(window.durationMinutes, 120);
      expect(window.durationSource, 'explicit');
      expect(window.toJson(), json);

      final sameWindow = ScheduleCivilWindow.fromJson(json);
      expect(window, equals(sameWindow));
      expect(window.hashCode, equals(sameWindow.hashCode));
    });

    test('ParticipantConflictDetail serialization and privacy guarantee', () {
      final json = {
        'id': 'unav_123',
        'startsAt': '2026-10-25T18:00:00',
        'endsAt': '2026-10-25T22:00:00',
        'allDay': false,
      };

      final detail = ParticipantConflictDetail.fromJson(json);
      expect(detail.id, 'unav_123');
      expect(detail.startsAt, '2026-10-25T18:00:00');
      expect(detail.endsAt, '2026-10-25T22:00:00');
      expect(detail.allDay, false);
      expect(detail.toJson(), json);

      // Invariant: no reason or note keys present in serialization
      expect(detail.toJson().containsKey('reason'), isFalse);
      expect(detail.toJson().containsKey('notes'), isFalse);
    });

    test('ParticipantConflictResult serialization and mapping', () {
      final json = {
        'participantId': 'mem_1',
        'memberId': 'mem_1',
        'hasConflict': true,
        'unavailabilities': [
          {
            'id': 'unav_1',
            'startsAt': '2026-10-25T00:00:00',
            'endsAt': '2026-10-26T00:00:00',
            'allDay': true,
          }
        ],
      };

      final result = ParticipantConflictResult.fromJson(json);
      expect(result.participantId, 'mem_1');
      expect(result.memberId, 'mem_1');
      expect(result.hasConflict, isTrue);
      expect(result.unavailabilities.length, 1);
      expect(result.unavailabilities.first.id, 'unav_1');
      expect(result.toJson(), json);
    });

    test('ScheduleConflictCheckResponse serialization', () {
      final json = {
        'scheduleWindow': {
          'startsAt': '2026-10-25T19:00:00',
          'endsAt': '2026-10-25T21:00:00',
          'durationMinutes': 120,
          'durationSource': 'explicit',
        },
        'conflicts': [
          {
            'participantId': 'mem_1',
            'memberId': 'mem_1',
            'hasConflict': true,
            'unavailabilities': [
              {
                'id': 'unav_1',
                'startsAt': '2026-10-25T00:00:00',
                'endsAt': '2026-10-26T00:00:00',
                'allDay': true,
              }
            ],
          },
          {
            'participantId': 'mem_2',
            'memberId': 'mem_2',
            'hasConflict': false,
            'unavailabilities': [],
          }
        ],
        'unresolvedParticipantIds': ['unknown_user'],
      };

      final response = ScheduleConflictCheckResponse.fromJson(json);
      expect(response.scheduleWindow.durationMinutes, 120);
      expect(response.conflicts.length, 2);
      expect(response.conflicts[0].hasConflict, isTrue);
      expect(response.conflicts[1].hasConflict, isFalse);
      expect(response.unresolvedParticipantIds, ['unknown_user']);
      expect(response.toJson(), json);
    });

    test('CheckScheduleConflictsPayload serialization', () {
      const payload = CheckScheduleConflictsPayload(
        date: '2026-10-25',
        time: '19:00',
        durationMinutes: 90,
        participantIds: ['mem_1', 'mem_2'],
      );

      final json = payload.toJson();
      expect(json['date'], '2026-10-25');
      expect(json['time'], '19:00');
      expect(json['durationMinutes'], 90);
      expect(json['participantIds'], ['mem_1', 'mem_2']);
    });
  });

  group('HttpAvailabilityRepository.checkScheduleConflicts', () {
    test('successfully posts to endpoint and returns parsed conflicts', () async {
      late RequestOptions capturedOptions;

      final mockResponse = jsonEncode({
        'scheduleWindow': {
          'startsAt': '2026-10-25T19:00:00',
          'endsAt': '2026-10-25T21:00:00',
          'durationMinutes': 120,
          'durationSource': 'explicit',
        },
        'conflicts': [
          {
            'participantId': 'mem_1',
            'memberId': 'mem_1',
            'hasConflict': true,
            'unavailabilities': [
              {
                'id': 'u1',
                'startsAt': '2026-10-25T00:00:00',
                'endsAt': '2026-10-26T00:00:00',
                'allDay': true,
              }
            ],
          },
          {
            'participantId': 'mem_2',
            'memberId': 'mem_2',
            'hasConflict': false,
            'unavailabilities': [],
          }
        ],
        'unresolvedParticipantIds': [],
      });

      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        capturedOptions = options;
        return jsonOk(mockResponse);
      });

      const payload = CheckScheduleConflictsPayload(
        date: '2026-10-25',
        time: '19:00',
        durationMinutes: 120,
        participantIds: ['mem_1', 'mem_2'],
      );

      final result = await repository.checkScheduleConflicts('min_1', payload);

      expect(capturedOptions.method, 'POST');
      expect(
        capturedOptions.path,
        '/ministries/min_1/availability/check-conflicts',
      );
      final body = capturedOptions.data is String
          ? jsonDecode(capturedOptions.data as String) as Map<String, dynamic>
          : capturedOptions.data as Map<String, dynamic>;
      expect(body['date'], '2026-10-25');
      expect(body['time'], '19:00');
      expect(body['durationMinutes'], 120);
      expect(body['participantIds'], ['mem_1', 'mem_2']);

      expect(result.conflicts.length, 2);
      expect(result.conflicts.first.hasConflict, isTrue);
      expect(result.conflicts.last.hasConflict, isFalse);
    });

    test('encapsulates data key if backend wraps response in data object', () async {
      final wrappedResponse = jsonEncode({
        'data': {
          'scheduleWindow': {
            'startsAt': '2026-10-25T19:00:00',
            'endsAt': '2026-10-25T21:00:00',
            'durationMinutes': 120,
            'durationSource': 'explicit',
          },
          'conflicts': [
            {
              'participantId': 'mem_1',
              'memberId': 'mem_1',
              'hasConflict': true,
              'unavailabilities': [],
            }
          ],
          'unresolvedParticipantIds': [],
        }
      });

      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonOk(wrappedResponse);
      });

      const payload = CheckScheduleConflictsPayload(
        date: '2026-10-25',
        time: '19:00',
        participantIds: ['mem_1'],
      );

      final result = await repository.checkScheduleConflicts('min_1', payload);
      expect(result.conflicts.length, 1);
      expect(result.conflicts.first.participantId, 'mem_1');
    });

    test('throws AppFailure on 400 bad request error', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(
          400,
          jsonEncode({
            'error': {'message': 'O limite máximo para verificação de conflitos é de 50 participantes.'}
          }),
        );
      });

      const payload = CheckScheduleConflictsPayload(
        date: '2026-10-25',
        time: '19:00',
        participantIds: ['mem_1'],
      );

      expect(
        () => repository.checkScheduleConflicts('min_1', payload),
        throwsA(isA<AppFailure>().having(
          (f) => f.message,
          'message',
          contains('50 participantes'),
        )),
      );
    });

    test('throws AppFailure on 500 server error', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return jsonError(
          500,
          jsonEncode({
            'error': {'message': 'Erro interno ao verificar conflitos.'}
          }),
        );
      });

      const payload = CheckScheduleConflictsPayload(
        date: '2026-10-25',
        time: '19:00',
        participantIds: ['mem_1'],
      );

      expect(
        () => repository.checkScheduleConflicts('min_1', payload),
        throwsA(isA<AppFailure>()),
      );
    });
  });
}
