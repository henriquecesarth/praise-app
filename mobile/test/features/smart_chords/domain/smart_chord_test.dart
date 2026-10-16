import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';

void main() {
  group('SmartChord Domain Entity', () {
    test('parses from JSON correctly with nested maps', () {
      final json = {
        'id': 'sc-123',
        'user_id': 'user-456',
        'title': 'Grandes Coisas',
        'artist_id': 'art-1',
        'song_id': 'song-1',
        'original_key': 'G',
        'content': '[G]Tu és Deus...',
        'created_at': '2026-10-13T10:00:00Z',
        'updated_at': '2026-10-13T10:05:00Z',
        'artist': {'id': 'art-1', 'name': 'Fernandinho'},
        'song': {'id': 'song-1', 'title': 'Grandes Coisas'},
      };

      final chord = SmartChord.fromJson(json);

      expect(chord.id, 'sc-123');
      expect(chord.userId, 'user-456');
      expect(chord.title, 'Grandes Coisas');
      expect(chord.artistId, 'art-1');
      expect(chord.songId, 'song-1');
      expect(chord.originalKey, 'G');
      expect(chord.content, '[G]Tu és Deus...');
      expect(chord.createdAt, '2026-10-13T10:00:00Z');
      expect(chord.updatedAt, '2026-10-13T10:05:00Z');
      expect(chord.artistName, 'Fernandinho');
      expect(chord.songTitle, 'Grandes Coisas');
      expect(chord.hasLinkedSong, isTrue);
      expect(chord.hasLinkedArtist, isTrue);
    });

    test('parses from JSON with flat fallback names and defaults', () {
      final json = {
        'id': 'sc-124',
        'user_id': 'user-456',
        'title': 'Avivamento',
        'artist_name': 'Gabriela Rocha',
        'song_title': 'Lugar Secreto',
      };

      final chord = SmartChord.fromJson(json);

      expect(chord.id, 'sc-124');
      expect(chord.originalKey, 'C'); // default
      expect(chord.content, ''); // default
      expect(chord.artistName, 'Gabriela Rocha');
      expect(chord.songTitle, 'Lugar Secreto');
      expect(chord.artistId, isNull);
      expect(chord.songId, isNull);
      expect(chord.hasLinkedSong, isFalse);
      expect(chord.hasLinkedArtist, isFalse);
    });

    test('toRequestPayload trims fields, handles artist_name and omits blank references', () {
      const chord = SmartChord(
        id: 'sc-1',
        userId: 'u-1',
        title: '  Oceanos  ',
        originalKey: '  D  ',
        content: '[D]Tua graça...',
        artistName: '  Hillsong  ',
        artistId: '   ',
        songId: ' s-1 ',
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
      );

      final payload = chord.toRequestPayload();

      expect(payload['title'], 'Oceanos');
      expect(payload['original_key'], 'D');
      expect(payload['content'], '[D]Tua graça...');
      expect(payload['artist_name'], 'Hillsong');
      expect(payload['artist_id'], isNull);
      expect(payload['song_id'], 's-1');
    });

    test('copyWith updates fields and supports clearing', () {
      const original = SmartChord(
        id: 'sc-1',
        userId: 'u-1',
        title: 'Caminho no Deserto',
        artistId: 'a-1',
        songId: 's-1',
        originalKey: 'C',
        content: '[C]Aqui estás',
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
        artistName: 'Soraya Moraes',
        songTitle: 'Caminho no Deserto',
      );

      final updated = original.copyWith(
        title: 'Caminho no Deserto (Ao Vivo)',
        originalKey: 'D',
        clearArtistId: true,
        clearArtistName: true,
      );

      expect(updated.id, 'sc-1');
      expect(updated.title, 'Caminho no Deserto (Ao Vivo)');
      expect(updated.originalKey, 'D');
      expect(updated.artistId, isNull);
      expect(updated.artistName, isNull);
      expect(updated.songId, 's-1');
      expect(updated.songTitle, 'Caminho no Deserto');
    });

    test('equality and hashCode compare core values', () {
      const c1 = SmartChord(
        id: '1',
        userId: 'u',
        title: 'A',
        originalKey: 'C',
        content: 'x',
        createdAt: 't',
        updatedAt: 't',
      );
      const c2 = SmartChord(
        id: '1',
        userId: 'u',
        title: 'A',
        originalKey: 'C',
        content: 'x',
        createdAt: 't',
        updatedAt: 't',
      );

      expect(c1, equals(c2));
      expect(c1.hashCode, equals(c2.hashCode));
    });
  });
}
