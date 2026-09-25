import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';

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

void main() {
  group('HttpDashboardRepository', () {
    late ApiClient apiClient;
    late HttpDashboardRepository repository;

    setUp(() {
      apiClient = ApiClient(
        environment: const AppEnvironment(
          env: AppEnv.development,
          apiBaseUrl: 'http://localhost:3000/api/v1',
        ),
        logger: const AppLogger(isDebug: false),
      );
      repository = HttpDashboardRepository(apiClient: apiClient);
    });

    group('getSchedules', () {
      test('returns List<DashboardScheduleSummary> on 200 OK', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          expect(options.path, equals('/ministries/min_10/schedules'));
          return ResponseBody.fromString(
            '[{"id": "sch_1", "ministry_id": "min_10", "title": "Culto Domingo", "date": "2026-09-28", "time": "19:00", "participants": []}]',
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final schedules = await repository.getSchedules('min_10');

        expect(schedules.length, equals(1));
        expect(schedules[0].id, equals('sch_1'));
        expect(schedules[0].title, equals('Culto Domingo'));
        expect(schedules[0].date, equals('2026-09-28'));
      });

      test('returns empty list when response is empty', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString('[]', 200, headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          });
        });

        final schedules = await repository.getSchedules('min_empty');
        expect(schedules, isEmpty);
      });

      test('maps 403 error to AppFailure', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"error": {"message": "Acesso não autorizado para este ministério."}}',
            403,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        expect(
          () => repository.getSchedules('min_forbidden'),
          throwsA(
            isA<AppFailure>()
                .having((f) => f.statusCode, 'statusCode', 403)
                .having(
                  (f) => f.message,
                  'message',
                  'Acesso não autorizado para este ministério.',
                ),
          ),
        );
      });
    });

    group('getAnnouncements', () {
      test('returns List<Announcement> on 200 OK and sends limit query param',
          () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          expect(options.path, equals('/ministries/min_20/announcements'));
          expect(options.queryParameters['limit'], equals(20));
          return ResponseBody.fromString(
            '[{"id": "ann_1", "ministry_id": "min_20", "title": "Aviso Urgente", "content": "Ensaio cancelado", "important": true}]',
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        final announcements = await repository.getAnnouncements('min_20');

        expect(announcements.length, equals(1));
        expect(announcements[0].id, equals('ann_1'));
        expect(announcements[0].title, equals('Aviso Urgente'));
        expect(announcements[0].important, isTrue);
      });

      test('returns empty list when response is empty', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString('[]', 200, headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          });
        });

        final announcements = await repository.getAnnouncements('min_empty');
        expect(announcements, isEmpty);
      });

      test('maps 500 error to AppFailure', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((options) async {
          return ResponseBody.fromString(
            '{"error": {"message": "Erro interno no servidor."}}',
            500,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        });

        expect(
          () => repository.getAnnouncements('min_server_err'),
          throwsA(
            isA<AppFailure>()
                .having((f) => f.statusCode, 'statusCode', 500)
                .having(
                  (f) => f.message,
                  'message',
                  'Erro interno no servidor.',
                ),
          ),
        );
      });
    });
  });
}
