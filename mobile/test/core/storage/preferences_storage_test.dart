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
  });
}
