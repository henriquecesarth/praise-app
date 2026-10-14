import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_form_controller.dart';

class MockRepertoireRepository extends Mock implements RepertoireRepository {}

void main() {
  late MockRepertoireRepository repository;
  late SongFormNotifier notifier;

  setUpAll(() {
    registerFallbackValue(const SongFormData(title: 'Fallback'));
  });

  setUp(() {
    repository = MockRepertoireRepository();
    notifier = SongFormNotifier(repository: repository);
  });

  tearDown(() {
    notifier.dispose();
  });

  group('SongFormNotifier', () {
    const testMinistryId = 'min-1';
    const testUserId = 'user-1';

    test('init loads artists and classifications for ministry', () async {
      when(() => repository.listArtists(testMinistryId))
          .thenAnswer((_) async => [
                const Artist(id: 'a1', ministryId: testMinistryId, name: 'Morada'),
              ]);
      when(() => repository.listClassifications(testMinistryId))
          .thenAnswer((_) async => [
                const Classification(id: 'c1', ministryId: testMinistryId, name: 'Adoracao'),
              ]);

      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      expect(notifier.state.isLoadingRelations, isFalse);
      expect(notifier.state.artists, hasLength(1));
      expect(notifier.state.artists.first.name, equals('Morada'));
      expect(notifier.state.classifications, hasLength(1));
      expect(notifier.state.classifications.first.name, equals('Adoracao'));
    });

    test('createSong succeeds and returns created song', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      const formData = SongFormData(title: 'Nova Musica', originalKey: 'E');
      const expectedDetail = SongDetail(
        id: 's-new-1',
        ministryId: testMinistryId,
        title: 'Nova Musica',
        originalKey: 'E',
      );

      when(() => repository.createSong(testMinistryId, any()))
          .thenAnswer((_) async => expectedDetail);

      final result = await notifier.createSong(formData);

      expect(result.isSuccess, isTrue);
      expect(result.data?.id, equals('s-new-1'));
      expect(result.data?.title, equals('Nova Musica'));
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('createSong maps failure and returns error message', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      when(() => repository.createSong(testMinistryId, any())).thenThrow(
        const AppFailure(message: 'Limite de musicas atingido para o plano atual.', statusCode: 403),
      );

      final result = await notifier.createSong(const SongFormData(title: 'Over Quota'));

      expect(result.isFailure, isTrue);
      expect(result.errorMessage, equals('Limite de musicas atingido para o plano atual.'));
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('updateSong succeeds and returns updated song', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      const formData = SongFormData(title: 'Titulo Atualizado');
      const expectedDetail = SongDetail(
        id: 's-123',
        ministryId: testMinistryId,
        title: 'Titulo Atualizado',
      );

      when(() => repository.updateSong(testMinistryId, 's-123', any()))
          .thenAnswer((_) async => expectedDetail);

      final result = await notifier.updateSong('s-123', formData);

      expect(result.isSuccess, isTrue);
      expect(result.data?.title, equals('Titulo Atualizado'));
    });

    test('deleteSong succeeds and resets submitting', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      when(() => repository.deleteSong(testMinistryId, 's-to-delete'))
          .thenAnswer((_) async {});

      final result = await notifier.deleteSong('s-to-delete');

      expect(result.isSuccess, isTrue);
      expect(notifier.state.isSubmitting, isFalse);
    });

    test('quickCreateArtist creates artist and appends to state', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      const createdArtist = Artist(
        id: 'new-art-id',
        ministryId: testMinistryId,
        name: 'Novo Artista Rapido',
      );

      when(() => repository.createArtist(testMinistryId, 'Novo Artista Rapido'))
          .thenAnswer((_) async => createdArtist);

      final result = await notifier.quickCreateArtist('Novo Artista Rapido');

      expect(result.isSuccess, isTrue);
      expect(result.data?.id, equals('new-art-id'));
      expect(notifier.state.artists, contains(createdArtist));
    });

    test('generation fencing discards async response if tenant changes during flight', () async {
      when(() => repository.listArtists(testMinistryId)).thenAnswer((_) async => []);
      when(() => repository.listClassifications(testMinistryId)).thenAnswer((_) async => []);
      await notifier.init(ministryId: testMinistryId, boundUserId: testUserId);

      final completer = Completer<SongDetail>();
      when(() => repository.createSong(testMinistryId, any()))
          .thenAnswer((_) => completer.future);

      final futureResult = notifier.createSong(const SongFormData(title: 'Fenced Song'));

      // Invalidate tenant while in-flight
      notifier.invalidateTenant();

      completer.complete(const SongDetail(
        id: 's-fenced',
        ministryId: testMinistryId,
        title: 'Fenced Song',
      ));

      final result = await futureResult;

      expect(result.isDiscarded, isTrue);
      expect(result.isSuccess, isFalse);
    });

    test('deleteSong fails if boundUserId is missing and not initialized', () async {
      final result = await notifier.deleteSong('s-1', ministryId: testMinistryId);
      expect(result.isFailure, isTrue);
      expect(result.errorMessage, equals('Usuário não autenticado.'));
    });

    test('deleteSong discards if tenant or session changes during in-flight deletion', () async {
      final completer = Completer<void>();
      when(() => repository.deleteSong(testMinistryId, 's-to-delete'))
          .thenAnswer((_) => completer.future);

      final futureResult = notifier.deleteSong(
        's-to-delete',
        ministryId: testMinistryId,
        boundUserId: testUserId,
      );

      notifier.invalidateTenant();

      completer.complete();

      final result = await futureResult;
      expect(result.isDiscarded, isTrue);
      expect(result.isSuccess, isFalse);
    });
  });
}
