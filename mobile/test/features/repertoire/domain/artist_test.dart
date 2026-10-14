import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';

void main() {
  group('Artist Domain Model', () {
    test('fromJson parses complete artist json', () {
      final json = {
        'id': 'artist_123',
        'ministry_id': 'min_abc',
        'name': 'Fernandinho',
      };

      final artist = Artist.fromJson(json);

      expect(artist.id, equals('artist_123'));
      expect(artist.ministryId, equals('min_abc'));
      expect(artist.name, equals('Fernandinho'));
    });

    test('fromJson handles missing or null fields gracefully', () {
      final artist = Artist.fromJson(const {});

      expect(artist.id, isEmpty);
      expect(artist.ministryId, isEmpty);
      expect(artist.name, isEmpty);
    });

    test('toJson serializes artist correctly', () {
      const artist = Artist(
        id: 'artist_123',
        ministryId: 'min_abc',
        name: 'Gabriela Rocha',
      );

      final json = artist.toJson();

      expect(json['id'], equals('artist_123'));
      expect(json['ministry_id'], equals('min_abc'));
      expect(json['name'], equals('Gabriela Rocha'));
    });

    test('value equality based on id and ministryId', () {
      const a1 = Artist(id: 'a1', ministryId: 'm1', name: 'Name 1');
      const a2 = Artist(id: 'a1', ministryId: 'm1', name: 'Name 1 Changed');
      const a3 = Artist(id: 'a2', ministryId: 'm1', name: 'Name 1');

      expect(a1, equals(a2));
      expect(a1.hashCode, equals(a2.hashCode));
      expect(a1, isNot(equals(a3)));
    });
  });
}
