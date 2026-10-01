import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';

void main() {
  group('M11-R2 Lossless Song Preservation', () {
    test('preserves opaque unknown web fields during deserialization and serialization', () {
      final webSongJson = <String, dynamic>{
        'id': 'song-web-1',
        'title': 'A Bênção',
        'artist': 'Gabriel Guedes',
        'key': 'Bb',
        'bpm': 70,
        'customTag': 'Abertura',
        'chordsUrl': 'https://chords.example.com/bencao',
        'arrangement': {
          'intro': 'Piano solo',
          'bridge': 'Full band dynamic crescendo',
        },
      };

      final song = ScheduleSong.fromJson(webSongJson);
      expect(song.id, equals('song-web-1'));
      expect(song.title, equals('A Bênção'));
      expect(song.artist, equals('Gabriel Guedes'));
      expect(song.key, equals('Bb'));

      final serialized = song.toJson();
      expect(serialized['id'], equals('song-web-1'));
      expect(serialized['title'], equals('A Bênção'));
      expect(serialized['artist'], equals('Gabriel Guedes'));
      expect(serialized['key'], equals('Bb'));
      expect(serialized['bpm'], equals(70));
      expect(serialized['customTag'], equals('Abertura'));
      expect(serialized['chordsUrl'], equals('https://chords.example.com/bencao'));
      expect(serialized['arrangement'], equals({
        'intro': 'Piano solo',
        'bridge': 'Full band dynamic crescendo',
      }));
    });

    test('changing song key preserves unknown fields losslessly', () {
      final webSongJson = <String, dynamic>{
        'id': 'song-web-2',
        'title': 'Ousado Amor',
        'artist': 'Isaias Saad',
        'key': 'Gb',
        'cifraclub_id': 98765,
        'youtube_embed': 'https://youtube.com/watch?v=12345',
      };

      final song = ScheduleSong.fromJson(webSongJson);
      final updatedSong = song.copyWith(key: 'G');

      expect(updatedSong.key, equals('G'));
      final serialized = updatedSong.toJson();
      expect(serialized['key'], equals('G'));
      expect(serialized['cifraclub_id'], equals(98765));
      expect(serialized['youtube_embed'], equals('https://youtube.com/watch?v=12345'));
    });

    test('reordering song list preserves unknown fields for all items', () {
      final song1Json = <String, dynamic>{
        'id': 's1',
        'title': 'Song 1',
        'custom_metric': 'high_energy',
      };
      final song2Json = <String, dynamic>{
        'id': 's2',
        'title': 'Song 2',
        'tempo_marking': 'Adagio',
      };

      final list = [
        ScheduleSong.fromJson(song1Json),
        ScheduleSong.fromJson(song2Json),
      ];

      // Reorder: song 2 first, then song 1
      final reordered = [list[1], list[0]];
      final s0 = reordered[0].toJson();
      final s1 = reordered[1].toJson();

      expect(s0['id'], equals('s2'));
      expect(s0['tempo_marking'], equals('Adagio'));
      expect(s1['id'], equals('s1'));
      expect(s1['custom_metric'], equals('high_energy'));
    });
  });

  group('M11-R2 Canonical Clothing Preservation', () {
    test('preserves id, name, description, and multiple colors losslessly', () {
      final canonicalJson = <String, dynamic>{
        'id': 'cloth-42',
        'name': 'Camisa e Blazer',
        'description': 'Camisa social com blazer escuro',
        'colors': ['#1E3A8A', '#000000', '#FFFFFF'],
      };

      final piece = ScheduleClothingPiece.fromJson(canonicalJson);
      expect(piece.id, equals('cloth-42'));
      expect(piece.name, equals('Camisa e Blazer'));
      expect(piece.description, equals('Camisa social com blazer escuro'));
      expect(piece.colors, equals(['#1E3A8A', '#000000', '#FFFFFF']));
      expect(piece.colorHex, equals('#1E3A8A')); // Primary color fallback

      final serialized = piece.toJson();
      expect(serialized['id'], equals('cloth-42'));
      expect(serialized['name'], equals('Camisa e Blazer'));
      expect(serialized['description'], equals('Camisa social com blazer escuro'));
      expect(serialized['colors'], equals(['#1E3A8A', '#000000', '#FFFFFF']));
    });

    test('editing piece name/description retains existing multi-color array', () {
      final canonicalJson = <String, dynamic>{
        'id': 'cloth-99',
        'description': 'Vestido longo',
        'colors': ['#991B1B', '#D97706'],
      };

      final piece = ScheduleClothingPiece.fromJson(canonicalJson);
      final updated = piece.copyWith(description: 'Vestido midi');

      final serialized = updated.toJson();
      expect(serialized['id'], equals('cloth-99'));
      expect(serialized['description'], equals('Vestido midi'));
      expect(serialized['colors'], equals(['#991B1B', '#D97706']));
    });

    test('newly created piece outputs canonical format with colors array', () {
      const piece = ScheduleClothingPiece(
        id: 'new-piece-1',
        name: 'Calça Jeans',
        description: 'Calça jeans escura sem rasgos',
        colors: ['#1E3A8A'],
      );

      final json = piece.toJson();
      expect(json['id'], equals('new-piece-1'));
      expect(json['name'], equals('Calça Jeans'));
      expect(json['colors'], equals(['#1E3A8A']));
    });
  });

  group('M11-R2 isVisible Round-Trip', () {
    test('ScheduleDetail preserves isVisible true and false', () {
      final sVisible = ScheduleDetail.fromJson(const {
        'id': 's-vis-1',
        'ministry_id': 'm1',
        'title': 'Culto Domingo Manhã',
        'date': '2026-10-18',
        'is_visible': true,
      });
      expect(sVisible.isVisible, isTrue);

      final sHidden = ScheduleDetail.fromJson(const {
        'id': 's-vis-2',
        'ministry_id': 'm1',
        'title': 'Culto Domingo Noite',
        'date': '2026-10-18',
        'isVisible': false,
      });
      expect(sHidden.isVisible, isFalse);

      final sDefault = ScheduleDetail.fromJson(const {
        'id': 's-vis-3',
        'ministry_id': 'm1',
        'title': 'Culto Quarta',
        'date': '2026-10-21',
      });
      expect(sDefault.isVisible, isTrue); // Default is true
    });
  });
}
