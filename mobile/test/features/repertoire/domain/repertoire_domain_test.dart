import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
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

      test('parses Web-created multi-version song preserving stable IDs, null keys, classifications, notes and links', () {
        final json = {
          'id': 'song-web-1',
          'ministry_id': 'min-alpha',
          'title': 'Santo Espírito',
          'artist': {'id': 'art-1', 'name': 'Laura Souguellis'},
          'notes': 'Observação geral da música',
          'versions': [
            {
              'id': 'v_web_orig',
              'name': 'Original (Estúdio)',
              'classificationIds': ['c-1', 'c-2'],
              'notes': 'Intro no piano 4 compassos',
              'key': 'E',
              'bpm': 72,
              'duration': '05:10',
              'links': [
                {'label': 'Cifra', 'url': 'https://cifraclub.com.br/santo-espirito'},
                {'label': 'Vídeo', 'url': 'https://youtube.com/watch?v=orig'},
                {'id': 'cust-1', 'label': 'Multitracks', 'url': 'https://multitracks.com/1', 'isCustom': true},
              ],
            },
            {
              'id': 'v_web_acustico',
              'name': 'Acústico',
              'classification_ids': ['c-3'],
              'notes': 'Apenas violão e voz',
              'key': null,
              'bpm': 68,
              'duration': '04:20',
              'links': [
                {'label': 'Áudio', 'url': 'https://spotify.com/acustico'},
              ],
            },
          ],
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.versions, hasLength(2));
        expect(detail.versions[0].id, equals('v_web_orig'));
        expect(detail.versions[0].name, equals('Original (Estúdio)'));
        expect(detail.versions[0].classificationIds, equals(['c-1', 'c-2']));
        expect(detail.versions[0].notes, equals('Intro no piano 4 compassos'));
        expect(detail.versions[0].key, equals('E'));
        expect(detail.versions[0].bpm, equals(72));
        expect(detail.versions[0].duration, equals('05:10'));
        expect(detail.versions[0].links, hasLength(3));
        expect(detail.versions[0].links[2].isCustom, isTrue);

        expect(detail.versions[1].id, equals('v_web_acustico'));
        expect(detail.versions[1].name, equals('Acústico'));
        expect(detail.versions[1].classificationIds, equals(['c-3']));
        expect(detail.versions[1].key, isNull);
        expect(detail.versions[1].bpm, equals(68));
        expect(detail.versions[1].duration, equals('04:20'));
        expect(detail.versions[1].links, hasLength(1));

        // Top-level compatibility fallbacks from primary version
        expect(detail.originalKey, equals('E'));
        expect(detail.bpm, equals(72));
        expect(detail.duration, equals('05:10'));
        expect(detail.classificationId, equals('c-1'));
      });

      test('synthesizes default Original version for legacy song without versions array and preserves null key', () {
        final json = {
          'id': 'song-legacy-1',
          'ministry_id': 'min-alpha',
          'title': 'Hino Antigo',
          'classification_id': 'c-hino',
          'original_key': null,
          'bpm': 90,
          'duration': '03:30',
          'youtube_url': 'https://youtube.com/watch?v=legacy',
          'external_links': {'Partitura': 'https://drive.google.com/pdf'},
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.versions, hasLength(1));
        expect(detail.versions.first.id, equals('song-legacy-1_v1'));
        expect(detail.versions.first.name, equals('Original'));
        expect(detail.versions.first.key, isNull);
        expect(detail.versions.first.bpm, equals(90));
        expect(detail.versions.first.classificationIds, equals(['c-hino']));
        expect(detail.versions.first.links.map((l) => l.label), containsAll(['Vídeo', 'Partitura']));
      });

      test('SongFormData and SongVersion serialize versions cleanly without injecting defaults into omitted fields', () {
        const partialForm = SongFormData(
          title: 'Apenas Titulo',
        );
        final partialJson = partialForm.toJson();
        expect(partialJson, equals({'title': 'Apenas Titulo'}));
        expect(partialJson.containsKey('original_key'), isFalse);
        expect(partialJson.containsKey('versions'), isFalse);

        const multiVersionForm = SongFormData(
          title: 'Música Multi-Versão',
          artistId: 'art-1',
          notes: 'Nota geral',
          versions: [
            SongVersion(
              id: 'v_1',
              name: 'Original',
              key: null,
              bpm: 120,
              duration: '04:00',
              classificationIds: ['c-1'],
              notes: 'Nota v1',
              links: [
                SongLink(label: 'Vídeo', url: 'https://youtube.com/watch?v=1'),
              ],
            ),
            SongVersion(
              id: 'v_2',
              name: 'Acústica',
              key: 'G',
            ),
          ],
        );

        final fullJson = multiVersionForm.toJson();
        expect(fullJson['title'], equals('Música Multi-Versão'));
        expect(fullJson['artist_id'], equals('art-1'));
        expect(fullJson['notes'], equals('Nota geral'));
        expect(fullJson['versions'], isA<List>());
        final versionsJson = fullJson['versions'] as List;
        expect(versionsJson, hasLength(2));
        expect(versionsJson[0]['id'], equals('v_1'));
        expect(versionsJson[0]['name'], equals('Original'));
        expect(versionsJson[0]['key'], isNull);
        expect(versionsJson[0].containsKey('key'), isTrue);
        expect(versionsJson[0]['classificationIds'], equals(['c-1']));
        expect(versionsJson[1]['id'], equals('v_2'));
        expect(versionsJson[1]['name'], equals('Acústica'));
        expect(versionsJson[1]['key'], equals('G'));
        expect(versionsJson[1].containsKey('bpm'), isFalse);
      });

      test('F01: Web-created free-text artist {id: "", name: "Free Artist"} parses with null artistId and preserves artistName', () {
        final json = {
          'id': 'song-free-art',
          'ministry_id': 'min-alpha',
          'title': 'Canção Livre',
          'artist_id': null,
          'artist': {'id': '', 'name': 'Free Artist'},
          'artist_name': 'Free Artist',
          'versions': [
            {'id': 'v_1', 'name': 'Original', 'key': 'G', 'bpm': 72},
          ],
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.artistId, isNull);
        expect(detail.artistName, equals('Free Artist'));
        expect(detail.displayArtist, equals('Free Artist'));
      });

      test('F03: fractional BPM is preserved without truncation across SongDetail, SongVersion, and SongSummary', () {
        final json = {
          'id': 'song-frac-bpm',
          'ministry_id': 'min-alpha',
          'title': 'Tempo Preciso',
          'bpm': 72.5,
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'D',
              'bpm': 72.5,
            },
            {
              'id': 'v_2',
              'name': 'Acústica',
              'key': 'C',
              'bpm': 68.75,
            },
          ],
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.bpm, equals(72.5));
        expect(detail.versions[0].bpm, equals(72.5));
        expect(detail.versions[1].bpm, equals(68.75));
        expect(detail.versions[0].toJson()['bpm'], equals(72.5));
        expect(detail.versions[1].toJson()['bpm'], equals(68.75));

        final summary = SongSummary.fromJson(json);
        expect(summary.bpm, equals(72.5));
        expect(summary.versions[0].bpm, equals(72.5));
      });

      test('F04: textual BPM "Rubato" is preserved without converting to null across SongDetail, SongVersion, and SongSummary', () {
        final json = {
          'id': 'song-text-bpm',
          'ministry_id': 'min-alpha',
          'title': 'Tempo Livre',
          'bpm': 'Rubato',
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'D',
              'bpm': 'Rubato',
            },
            {
              'id': 'v_2',
              'name': 'Ao Vivo',
              'key': 'C',
              'bpm': 'Lento',
            },
          ],
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.bpm, equals('Rubato'));
        expect(detail.versions[0].bpm, equals('Rubato'));
        expect(detail.versions[1].bpm, equals('Lento'));
        expect(detail.versions[0].toJson()['bpm'], equals('Rubato'));
        expect(detail.versions[1].toJson()['bpm'], equals('Lento'));

        final summary = SongSummary.fromJson(json);
        expect(summary.bpm, equals('Rubato'));
        expect(summary.versions[0].bpm, equals('Rubato'));
      });

      test(
          'F03 (R3): untouched textual BPM with surrounding spaces " Rubato " is preserved byte-for-byte across SongDetail, SongVersion, and SongSummary',
          () {
        final json = {
          'id': 's_f03_spaced',
          'ministry_id': 'min_1',
          'title': 'Espontâneo',
          'bpm': ' Rubato ',
          'versions': [
            {
              'id': 'v_1',
              'name': 'Original',
              'key': 'E',
              'bpm': ' Rubato ',
            },
          ],
        };

        final detail = SongDetail.fromJson(json);
        expect(detail.bpm, equals(' Rubato '));
        expect(detail.versions[0].bpm, equals(' Rubato '));
        expect(detail.versions[0].toJson()['bpm'], equals(' Rubato '));

        final summary = SongSummary.fromJson(json);
        expect(summary.bpm, equals(' Rubato '));
        expect(summary.versions[0].bpm, equals(' Rubato '));
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
