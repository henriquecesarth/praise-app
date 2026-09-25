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
  });
}
