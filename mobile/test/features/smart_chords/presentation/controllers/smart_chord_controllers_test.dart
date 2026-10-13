import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_detail_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_form_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_list_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';

class FakeSmartChordRepository implements SmartChordRepository {
  List<SmartChord> chordsToReturn = [];
  List<SmartChord> songChordsToReturn = [];
  SmartChord? detailToReturn;
  Exception? errorToThrow;
  Completer<void>? createCompleter;
  Completer<void>? updateCompleter;
  Completer<void>? deleteCompleter;
  int getChordsCallCount = 0;
  int getBySongCallCount = 0;
  int getDetailCallCount = 0;
  int createCallCount = 0;
  int updateCallCount = 0;
  int deleteCallCount = 0;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    getChordsCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return chordsToReturn;
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async {
    getBySongCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    return songChordsToReturn;
  }

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    getDetailCallCount++;
    if (errorToThrow != null) throw errorToThrow!;
    if (detailToReturn != null) return detailToReturn!;
    return SmartChord(
      id: id,
      userId: 'u-1',
      title: 'Fake Chord',
      originalKey: 'C',
      content: '[C]Content',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    );
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    createCallCount++;
    if (createCompleter != null) await createCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChord(
      id: 'sc-created',
      userId: 'u-1',
      title: (payload['title'] as String?) ?? 'New Chord',
      originalKey: (payload['original_key'] as String?) ?? 'C',
      content: (payload['content'] as String?) ?? '',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:00:00Z',
    );
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    updateCallCount++;
    if (updateCompleter != null) await updateCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
    return SmartChord(
      id: id,
      userId: 'u-1',
      title: (payload['title'] as String?) ?? 'Updated Chord',
      originalKey: (payload['original_key'] as String?) ?? 'C',
      content: (payload['content'] as String?) ?? '',
      createdAt: '2026-10-13T00:00:00Z',
      updatedAt: '2026-10-13T00:05:00Z',
    );
  }

  @override
  Future<void> deleteSmartChord(String id) async {
    deleteCallCount++;
    if (deleteCompleter != null) await deleteCompleter!.future;
    if (errorToThrow != null) throw errorToThrow!;
  }
}

void main() {
  late FakeSmartChordRepository repository;

  setUp(() {
    repository = FakeSmartChordRepository();
  });

  group('SmartChordListNotifier', () {
    test('load loads chords successfully and sets state', () async {
      repository.chordsToReturn = [
        const SmartChord(
          id: 'sc-1',
          userId: 'u-1',
          title: 'Oceanos',
          originalKey: 'D',
          content: '[D]Tua graça',
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
        ),
      ];

      final notifier = SmartChordListNotifier(repository: repository);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isEmpty, isTrue);

      await notifier.load();

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isSuccess, isTrue);
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.title, 'Oceanos');
      expect(repository.getChordsCallCount, 1);
    });

    test('load records error when repository throws AppFailure', () async {
      repository.errorToThrow = const AppFailure(message: 'Falha de rede.', statusCode: 500);

      final notifier = SmartChordListNotifier(repository: repository);
      await notifier.load();

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.errorMessage, 'Falha de rede.');
    });

    test('removeChord and upsertChord manipulate in-memory list', () {
      final notifier = SmartChordListNotifier(repository: repository);
      const c1 = SmartChord(
        id: '1',
        userId: 'u',
        title: 'Song 1',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      );
      const c2 = SmartChord(
        id: '2',
        userId: 'u',
        title: 'Song 2',
        originalKey: 'D',
        content: '',
        createdAt: '',
        updatedAt: '',
      );

      notifier.upsertChord(c1);
      expect(notifier.state.items.length, 1);

      notifier.upsertChord(c2);
      expect(notifier.state.items.length, 2);

      notifier.removeChord('1');
      expect(notifier.state.items.length, 1);
      expect(notifier.state.items.first.id, '2');
    });

    test('reset clears all state', () {
      final notifier = SmartChordListNotifier(repository: repository);
      notifier.upsertChord(const SmartChord(
        id: '1',
        userId: 'u',
        title: 'S',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      ));
      expect(notifier.state.items.isNotEmpty, isTrue);

      notifier.reset();
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.search, '');
    });
  });

  group('SongSmartChordsNotifier', () {
    test('load fetches chords for songId', () async {
      repository.songChordsToReturn = [
        const SmartChord(
          id: 'sc-song',
          userId: 'u',
          songId: 'song-99',
          title: 'Chord for Song',
          originalKey: 'E',
          content: '',
          createdAt: '',
          updatedAt: '',
        ),
      ];

      final notifier = SongSmartChordsNotifier(repository: repository);
      await notifier.load('song-99');

      expect(notifier.state.items.length, 1);
      expect(notifier.state.songId, 'song-99');
      expect(notifier.state.items.first.id, 'sc-song');
      expect(repository.getBySongCallCount, 1);
    });

    test('reset clears state', () {
      final notifier = SongSmartChordsNotifier(repository: repository);
      notifier.reset();
      expect(notifier.state.items, isEmpty);
      expect(notifier.state.songId, isNull);
    });
  });

  group('SmartChordDetailNotifier', () {
    test('load fetches chord details and resets semitones to 0', () async {
      repository.detailToReturn = const SmartChord(
        id: 'sc-10',
        userId: 'u',
        title: 'Vitorioso',
        originalKey: 'G',
        content: '[G]Vitorioso...',
        createdAt: '',
        updatedAt: '',
      );

      final notifier = SmartChordDetailNotifier(repository: repository);
      await notifier.load('sc-10');

      expect(notifier.state.chord?.title, 'Vitorioso');
      expect(notifier.state.semitones, 0);
      expect(notifier.state.isNotFound, isFalse);
    });

    test('load sets isNotFound on 404 AppFailure', () async {
      repository.errorToThrow = const AppFailure(message: 'Não encontrada.', statusCode: 404);

      final notifier = SmartChordDetailNotifier(repository: repository);
      await notifier.load('missing-id');

      expect(notifier.state.isNotFound, isTrue);
      expect(notifier.state.hasError, isTrue);
    });

    test('transposeBy adjusts semitones within -11..+11 range', () {
      final notifier = SmartChordDetailNotifier(repository: repository);
      expect(notifier.state.semitones, 0);

      notifier.transposeBy(2);
      expect(notifier.state.semitones, 2);

      notifier.transposeBy(-5);
      expect(notifier.state.semitones, -3);

      notifier.setSemitones(15); // Exceeds upper clamp
      expect(notifier.state.semitones, 11);

      notifier.setSemitones(-20); // Exceeds lower clamp
      expect(notifier.state.semitones, -11);

      notifier.resetTransposition();
      expect(notifier.state.semitones, 0);
    });
  });

  group('SmartChordFormNotifier', () {
    test('createSmartChord calls repository and sets isSuccess', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: '',
        userId: '',
        title: 'Nova Cifra',
        originalKey: 'A',
        content: '[A]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final created = await notifier.createSmartChord(chord);

      expect(created, isNotNull);
      expect(created!.id, 'sc-created');
      expect(notifier.state.isSuccess, isTrue);
      expect(repository.createCallCount, 1);
    });

    test('guards against double-submit on create', () async {
      repository.createCompleter = Completer<void>();
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: '',
        userId: '',
        title: 'Nova Cifra',
        originalKey: 'A',
        content: '[A]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final firstCall = notifier.createSmartChord(chord);
      expect(notifier.state.isSubmitting, isTrue);

      final secondCall = await notifier.createSmartChord(chord);
      expect(secondCall, isNull); // Second call rejected immediately
      expect(repository.createCallCount, 1);

      repository.createCompleter!.complete();
      final result1 = await firstCall;
      expect(result1, isNotNull);
    });

    test('updateSmartChord calls repository', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      const chord = SmartChord(
        id: 'sc-1',
        userId: 'u',
        title: 'Cifra Editada',
        originalKey: 'B',
        content: '[B]Texto',
        createdAt: '',
        updatedAt: '',
      );

      final updated = await notifier.updateSmartChord('sc-1', chord);

      expect(updated, isNotNull);
      expect(updated!.id, 'sc-1');
      expect(repository.updateCallCount, 1);
    });

    test('deleteSmartChord calls repository and returns true', () async {
      final notifier = SmartChordFormNotifier(repository: repository);
      final success = await notifier.deleteSmartChord('sc-1');

      expect(success, isTrue);
      expect(repository.deleteCallCount, 1);
    });

    test('records errorMessage when repository throws', () async {
      repository.errorToThrow = const AppFailure(message: 'Erro ao salvar cifra.', statusCode: 400);
      final notifier = SmartChordFormNotifier(repository: repository);

      final result = await notifier.createSmartChord(const SmartChord(
        id: '',
        userId: '',
        title: 'X',
        originalKey: 'C',
        content: '',
        createdAt: '',
        updatedAt: '',
      ));

      expect(result, isNull);
      expect(notifier.state.errorMessage, 'Erro ao salvar cifra.');
      expect(notifier.state.isSubmitting, isFalse);
    });
  });
}
