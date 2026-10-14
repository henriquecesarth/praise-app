import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';

void main() {
  group('SongFormData Domain Model', () {
    test('toJson includes all non-null fields and maps duration', () {
      const data = SongFormData(
        title: 'Grande E o Senhor',
        artistId: 'art-1',
        classificationId: 'class-1',
        originalKey: 'G',
        bpm: 72,
        duration: '05:10',
        lyrics: 'Grande e o Senhor e mui digno de louvor...',
        youtubeUrl: 'https://youtube.com/watch?v=123',
        audioUrl: 'https://storage.louvaio.test/audio/123.mp3',
        chordSheetUrl: 'https://storage.louvaio.test/chords/123.pdf',
        externalLinks: {'spotify': 'https://open.spotify.com/track/123'},
      );

      final json = data.toJson();

      expect(json['title'], equals('Grande E o Senhor'));
      expect(json['artist_id'], equals('art-1'));
      expect(json['classification_id'], equals('class-1'));
      expect(json['original_key'], equals('G'));
      expect(json['bpm'], equals(72));
      expect(json['duration'], equals('05:10'));
      expect(json['lyrics'], contains('Grande e o Senhor'));
      expect(json['youtube_url'], equals('https://youtube.com/watch?v=123'));
      expect(json['audio_url'], equals('https://storage.louvaio.test/audio/123.mp3'));
      expect(json['chord_sheet_url'], equals('https://storage.louvaio.test/chords/123.pdf'));
      expect(json['external_links'], equals({'spotify': 'https://open.spotify.com/track/123'}));
    });

    test('toJson with minimal required fields sets optional keys to null and omits external_links', () {
      const data = SongFormData(title: 'Apenas Titulo');

      final json = data.toJson();

      expect(json['title'], equals('Apenas Titulo'));
      expect(json['artist_id'], isNull);
      expect(json['classification_id'], isNull);
      expect(json['original_key'], isNull);
      expect(json['bpm'], isNull);
      expect(json['duration'], isNull);
      expect(json['lyrics'], isNull);
      expect(json['youtube_url'], isNull);
      expect(json['audio_url'], isNull);
      expect(json['chord_sheet_url'], isNull);
      expect(json.containsKey('external_links'), isFalse);
    });

    test('copyWith produces updated copy without mutating original', () {
      const data = SongFormData(
        title: 'Original Title',
        bpm: 120,
      );

      final updated = data.copyWith(
        title: 'New Title',
        originalKey: 'D',
      );

      expect(updated.title, equals('New Title'));
      expect(updated.originalKey, equals('D'));
      expect(updated.bpm, equals(120));
      expect(data.title, equals('Original Title'));
      expect(data.originalKey, isNull);
    });
  });
}
