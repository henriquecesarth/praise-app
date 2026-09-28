import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';

void main() {
  group('Repertoire Domain Models', () {
    group('Classification & parseHexColor', () {
      test('parses valid 6-char hex color string with leading hash', () {
        final color = parseHexColor('#7C3AED');
        expect(color, isNotNull);
        expect(color!.toARGB32(), equals(const Color(0xFF7C3AED).toARGB32()));
      });

      test('parses valid 6-char hex color without hash', () {
        final color = parseHexColor('06B6D4');
        expect(color, isNotNull);
        expect(color!.toARGB32(), equals(const Color(0xFF06B6D4).toARGB32()));
      });

      test('returns null for null, empty or invalid hex color', () {
        expect(parseHexColor(null), isNull);
        expect(parseHexColor(''), isNull);
        expect(parseHexColor('xyz123'), isNull);
        expect(parseHexColor('#12'), isNull);
      });

      test('Classification.fromJson maps all fields correctly', () {
        final json = {
          'id': 'class-1',
          'ministry_id': 'min-alpha',
          'name': 'Adoração',
          'description': 'Músicas de intimidade',
          'color': '#06B6D4',
          'created_at': '2026-09-01T10:00:00Z',
          'updated_at': '2026-09-01T12:00:00Z',
        };

        final c = Classification.fromJson(json);
        expect(c.id, equals('class-1'));
        expect(c.ministryId, equals('min-alpha'));
        expect(c.name, equals('Adoração'));
        expect(c.description, equals('Músicas de intimidade'));
        expect(c.displayColor, isNotNull);
        expect(c.displayColor!.toARGB32(),
            equals(const Color(0xFF06B6D4).toARGB32()));
      });
    });

    group('SongSummary', () {
      test('fromJson maps object artist and classification ref', () {
        final json = {
          'id': 'song-101',
          'ministry_id': 'min-alpha',
          'title': 'Pra Onde Eu Iria?',
          'artist': {'id': 'art-1', 'name': 'Morada'},
          'classification': {
            'id': 'c-1',
            'name': 'Adoração',
            'color': '#7C3AED',
          },
          'original_key': 'G',
          'bpm': 128,
          'duration': '5:30',
          'youtube_url': 'https://youtube.com/watch?v=123',
          'audio_url': 'https://example.com/audio.mp3',
          'updated_at': '2026-09-20T10:00:00Z',
          'created_at': '2026-09-10T10:00:00Z',
        };

        final song = SongSummary.fromJson(json);
        expect(song.id, equals('song-101'));
        expect(song.ministryId, equals('min-alpha'));
        expect(song.title, equals('Pra Onde Eu Iria?'));
        expect(song.artistName, equals('Morada'));
        expect(song.displayArtist, equals('Morada'));
        expect(song.classification?.name, equals('Adoração'));
        expect(song.originalKey, equals('G'));
        expect(song.displayKey, equals('G'));
        expect(song.bpm, equals(128));
        expect(song.hasYoutube, isTrue);
      });

      test('fromJson maps string artist and handles missing fields gracefully',
          () {
        final json = {
          'id': 'song-102',
          'ministry_id': 'min-alpha',
          'title': 'Aclame ao Senhor',
          'artist': 'Diante do Trono',
          'original_key': null,
          'bpm': null,
          'youtube_url': null,
        };

        final song = SongSummary.fromJson(json);
        expect(song.artistName, equals('Diante do Trono'));
        expect(song.displayArtist, equals('Diante do Trono'));
        expect(song.displayKey, isNull);
        expect(song.hasYoutube, isFalse);
        expect(song.classification, isNull);
      });

      test('fallback to "Artista não informado" when artist is empty or null',
          () {
        final json = {
          'id': 'song-103',
          'ministry_id': 'min-alpha',
          'title': 'Hino Tradicional',
        };

        final song = SongSummary.fromJson(json);
        expect(song.displayArtist, equals('Artista não informado'));
      });
    });

    group('SongDetail', () {
      test('fromJson maps lyrics, notes, and external links map', () {
        final json = {
          'id': 'song-201',
          'ministry_id': 'min-alpha',
          'title': 'Ousado Amor',
          'artist': {'id': 'art-2', 'name': 'Isaías Saad'},
          'original_key': 'Bb',
          'bpm': 68,
          'duration': '4:45',
          'lyrics': 'Antes de eu falar\nTu cantavas sobre mim...',
          'notes': 'Tocar introdução com violão fingerstyle.',
          'chord_sheet_url':
              'https://cifraclub.com.br/isaias-saad/ousado-amor/',
          'youtube_url': 'https://youtube.com/watch?v=xyz',
          'audio_url': 'https://storage.googleapis.com/audio.mp3',
          'external_links': {
            'Spotify': 'https://open.spotify.com/track/123',
            'Apple Music': 'https://music.apple.com/track/123',
          },
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.id, equals('song-201'));
        expect(detail.hasLyrics, isTrue);
        expect(detail.lyrics, contains('Antes de eu falar'));
        expect(detail.hasNotes, isTrue);
        expect(detail.notes, contains('fingerstyle'));
        expect(detail.hasAnyLinks, isTrue);
        expect(detail.externalLinks.length, equals(2));
        expect(detail.externalLinks['Spotify'],
            equals('https://open.spotify.com/track/123'));
        expect(detail.chordSheetUrl, contains('cifraclub'));
      });

      test('handles song without lyrics, notes or links', () {
        final json = {
          'id': 'song-202',
          'ministry_id': 'min-alpha',
          'title': 'Instrumental',
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.hasLyrics, isFalse);
        expect(detail.hasNotes, isFalse);
        expect(detail.hasAnyLinks, isFalse);
      });
    });

    group('PaginatedSongs', () {
      test('fromJson parses envelope with pagination metadata', () {
        final json = {
          'data': [
            {
              'id': 's1',
              'ministry_id': 'min-1',
              'title': 'Song 1',
            },
            {
              'id': 's2',
              'ministry_id': 'min-1',
              'title': 'Song 2',
            },
          ],
          'total': 45,
          'nextCursor': 'cursor-token-abc',
          'hasMore': true,
          'limit': 20,
          'page': 1,
          'totalPages': 3,
        };

        final paginated = PaginatedSongs.fromJson(json);
        expect(paginated.songs.length, equals(2));
        expect(paginated.songs.first.title, equals('Song 1'));
        expect(paginated.total, equals(45));
        expect(paginated.nextCursor, equals('cursor-token-abc'));
        expect(paginated.hasMore, isTrue);
        expect(paginated.limit, equals(20));
        expect(paginated.page, equals(1));
        expect(paginated.totalPages, equals(3));
      });

      test('fromJson handles empty data gracefully', () {
        final json = {
          'data': [],
          'total': 0,
          'nextCursor': null,
          'hasMore': false,
        };

        final paginated = PaginatedSongs.fromJson(json);
        expect(paginated.songs, isEmpty);
        expect(paginated.total, equals(0));
        expect(paginated.nextCursor, isNull);
        expect(paginated.hasMore, isFalse);
      });
    });
  });
}
