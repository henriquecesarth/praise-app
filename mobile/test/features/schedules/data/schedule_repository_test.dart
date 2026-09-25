import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/schedules/data/schedule_repository.dart';

class MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) _handler;
  MockAdapter(this._handler);

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<List<int>>? requestStream, Future<void>? cancelFuture) {
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

ResponseBody jsonCreated(String body) => ResponseBody.fromString(
      body,
      201,
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
  late HttpScheduleRepository repository;

  setUp(() {
    apiClient = ApiClient(
      environment: const AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://localhost:3000/api/v1',
      ),
      logger: const AppLogger(isDebug: false),
    );
    repository = HttpScheduleRepository(apiClient: apiClient);
  });

  group('HttpScheduleRepository', () {
    group('listSchedules', () {
      test('maps 200 response to list of ScheduleSummary', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min1/schedules'));
          return jsonOk(
            '[{"id":"s1","ministry_id":"min1","title":"Culto","date":"2026-10-01","time":"19:00","participants":[]}]',
          );
        });

        final list = await repository.listSchedules('min1');
        expect(list.length, equals(1));
        expect(list[0].id, equals('s1'));
        expect(list[0].title, equals('Culto'));
      });

      test('returns empty list for empty array response', () async {
        apiClient.dio.httpClientAdapter =
            MockAdapter((_) async => jsonOk('[]'));

        final list = await repository.listSchedules('min1');
        expect(list, isEmpty);
      });

      test('throws AppFailure on 403', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async =>
            jsonError(403, '{"error":{"message":"Acesso negado."}}'));

        expect(
          () => repository.listSchedules('min1'),
          throwsA(isA<AppFailure>()
              .having((f) => f.statusCode, 'statusCode', 403)
              .having((f) => f.message, 'message', 'Acesso negado.')),
        );
      });
    });

    group('getScheduleDetail', () {
      test('maps 200 response to ScheduleDetail', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min1/schedules/s1'));
          return jsonOk(
            '{"id":"s1","ministry_id":"min1","title":"Culto","date":"2026-10-01","time":"19:00","duration_minutes":90,"participants":[],"songs":[],"timeline":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}',
          );
        });

        final detail = await repository.getScheduleDetail('min1', 's1');
        expect(detail.id, equals('s1'));
        expect(detail.durationMinutes, equals(90));
      });

      test('throws AppFailure on 404', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async =>
            jsonError(404, '{"error":{"message":"Escala não encontrada."}}'));

        expect(
          () => repository.getScheduleDetail('min1', 'missing'),
          throwsA(isA<AppFailure>().having((f) => f.statusCode, 'status', 404)),
        );
      });
    });

    group('confirmParticipation', () {
      test('sends PATCH with { confirmed: bool } body and maps response',
          () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(
              opts.path, equals('/ministries/min1/schedules/s1/confirmation'));
          expect(opts.method, equals('PATCH'));
          expect((opts.data as Map<String, dynamic>)['confirmed'], isTrue);
          return jsonOk(
            '{"id":"s1","ministry_id":"min1","title":"Culto","date":"2026-10-01","updated_at":"2026-01-02T00:00:00Z","participants":[{"id":"p1","name":"Ana","role":"Vocal","confirmed":true}],"songs":[],"timeline":[]}',
          );
        });

        final detail =
            await repository.confirmParticipation('min1', 's1', true);
        expect(detail.id, equals('s1'));
        expect(detail.participants.first.confirmed, isTrue);
      });

      test('throws AppFailure on 403 (not a participant)', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async => jsonError(
            403,
            '{"error":{"message":"Você não está listado como participante."}}'));

        expect(
          () => repository.confirmParticipation('min1', 's1', true),
          throwsA(isA<AppFailure>()
              .having((f) => f.statusCode, 'status', 403)
              .having((f) => f.message, 'message',
                  'Você não está listado como participante.')),
        );
      });

      test('throws AppFailure on 400 (past schedule)', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async => jsonError(
            400,
            '{"error":{"message":"Não é possível alterar confirmação de escala passada."}}'));

        expect(
          () => repository.confirmParticipation('min1', 's1', false),
          throwsA(isA<AppFailure>().having((f) => f.statusCode, 'status', 400)),
        );
      });
    });

    group('getComments', () {
      test('maps 200 response to list of ScheduleComment', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min1/schedules/s1/comments'));
          return jsonOk(
            '[{"id":"c1","schedule_id":"s1","ministry_id":"min1","user_id":"u1","user_name":"Ana","content":"Ótimo!","created_at":"2026-01-01T10:00:00Z"}]',
          );
        });

        final comments = await repository.getComments('min1', 's1');
        expect(comments.length, equals(1));
        expect(comments[0].content, equals('Ótimo!'));
        expect(comments[0].userName, equals('Ana'));
      });

      test('returns empty list for empty response', () async {
        apiClient.dio.httpClientAdapter =
            MockAdapter((_) async => jsonOk('[]'));

        final comments = await repository.getComments('min1', 's1');
        expect(comments, isEmpty);
      });
    });

    group('postComment', () {
      test('sends POST with { content } and maps 201 response', () async {
        apiClient.dio.httpClientAdapter = MockAdapter((opts) async {
          expect(opts.path, equals('/ministries/min1/schedules/s1/comments'));
          expect(opts.method, equals('POST'));
          expect(
              (opts.data as Map<String, dynamic>)['content'], equals('Amém!'));
          return jsonCreated(
            '{"id":"c2","schedule_id":"s1","ministry_id":"min1","user_id":"u2","user_name":"João","content":"Amém!","created_at":"2026-01-01T11:00:00Z"}',
          );
        });

        final comment = await repository.postComment('min1', 's1', 'Amém!');
        expect(comment.id, equals('c2'));
        expect(comment.content, equals('Amém!'));
      });

      test('throws AppFailure with SUBSCRIPTION_RESTRICTED code on 403',
          () async {
        apiClient.dio.httpClientAdapter = MockAdapter((_) async => jsonError(
            403,
            '{"error":{"message":"Plano expirado.","details":{"code":"SUBSCRIPTION_RESTRICTED"}}}'));

        expect(
          () => repository.postComment('min1', 's1', 'Teste'),
          throwsA(isA<AppFailure>()
              .having((f) => f.statusCode, 'status', 403)
              .having((f) => f.code, 'code', 'SUBSCRIPTION_RESTRICTED')),
        );
      });
    });
  });
}
