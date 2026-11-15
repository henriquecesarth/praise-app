import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SharedPreferencesStorage storage;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    storage = SharedPreferencesStorage(prefs);
  });

  group('SharedPreferencesStorage', () {
    test('gets and sets selected ministry ID', () async {
      expect(storage.getSelectedMinistryId(), isNull);

      await storage.setSelectedMinistryId('min_abc123');
      expect(storage.getSelectedMinistryId(), 'min_abc123');

      await storage.setSelectedMinistryId(null);
      expect(storage.getSelectedMinistryId(), isNull);
    });

    test('gets and sets theme mode', () async {
      expect(storage.getThemeMode(), isNull);

      await storage.setThemeMode('dark');
      expect(storage.getThemeMode(), 'dark');

      await storage.setThemeMode(null);
      expect(storage.getThemeMode(), isNull);
    });

    test('clear wipes non-authoritative preferences', () async {
      await storage.setSelectedMinistryId('min_xyz');
      await storage.setThemeMode('light');

      await storage.clear();

      expect(storage.getSelectedMinistryId(), isNull);
      expect(storage.getThemeMode(), isNull);
    });

    test(
        'gets and sets chord font family scoped by user ID with account isolation',
        () async {
      expect(storage.getUserChordFontFamily('usr_a'), isNull);
      expect(storage.getUserChordFontFamily('usr_b'), isNull);

      await storage.setUserChordFontFamily('usr_a', 'Georgia');
      expect(storage.getUserChordFontFamily('usr_a'), 'Georgia');
      expect(storage.getUserChordFontFamily('usr_b'), isNull);

      await storage.setUserChordFontFamily('usr_b', 'Arial');
      expect(storage.getUserChordFontFamily('usr_a'), 'Georgia');
      expect(storage.getUserChordFontFamily('usr_b'), 'Arial');

      await storage.setUserChordFontFamily('usr_a', null);
      expect(storage.getUserChordFontFamily('usr_a'), isNull);
      expect(storage.getUserChordFontFamily('usr_b'), 'Arial');
    });

    test('selected ministry is scoped by account', () async {
      await storage.setSelectedMinistryIdForUser('usr_a', 'min_shared');
      expect(storage.getSelectedMinistryIdForUser('usr_a'), 'min_shared');
      expect(storage.getSelectedMinistryIdForUser('usr_b'), isNull);

      await storage.setSelectedMinistryIdForUser('usr_b', 'min_shared');
      expect(storage.getSelectedMinistryIdForUser('usr_a'), 'min_shared');
      expect(storage.getSelectedMinistryIdForUser('usr_b'), 'min_shared');

      await storage.setSelectedMinistryIdForUser('usr_a', null);
      expect(storage.getSelectedMinistryIdForUser('usr_a'), isNull);
      expect(storage.getSelectedMinistryIdForUser('usr_b'), 'min_shared');
    });

    test(
        'clear does not wipe cached user chord font preferences across session clear',
        () async {
      await storage.setSelectedMinistryId('min_xyz');
      await storage.setUserChordFontFamily('usr_a', 'Georgia');

      await storage.clear();

      expect(storage.getSelectedMinistryId(), isNull);
      expect(storage.getUserChordFontFamily('usr_a'), 'Georgia');
    });

    test('gets, clamps, and persists vocal player volume per user with fallback', () async {
      expect(storage.getVocalPlayerVolume(userId: 'usr_a'), isNull);

      await storage.setVocalPlayerVolume(0.45, userId: 'usr_a');
      expect(storage.getVocalPlayerVolume(userId: 'usr_a'), closeTo(0.45, 0.0001));

      // Out-of-range values clamp safely
      await storage.setVocalPlayerVolume(2.5, userId: 'usr_a');
      expect(storage.getVocalPlayerVolume(userId: 'usr_a'), 1.0);

      await storage.setVocalPlayerVolume(-0.3, userId: 'usr_a');
      expect(storage.getVocalPlayerVolume(userId: 'usr_a'), 0.0);

      // Distinct user inherits fallback only if saved as null userId
      await storage.setVocalPlayerVolume(0.7, userId: null);
      expect(storage.getVocalPlayerVolume(userId: 'usr_b'), closeTo(0.7, 0.0001));
      expect(storage.getVocalPlayerVolume(userId: 'usr_a'), 0.0);
    });
  });
}
