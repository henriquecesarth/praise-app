import 'package:shared_preferences/shared_preferences.dart';

/// Storage abstraction for non-authoritative local preferences.
///
/// Authentication tokens, credentials, and authorization roles must NEVER
/// be stored here.
abstract class PreferencesStorage {
  Future<void> setSelectedMinistryId(String? ministryId);
  String? getSelectedMinistryId();

  Future<void> setThemeMode(String? themeMode);
  String? getThemeMode();

  Future<void> clear();
}

/// SharedPreferences implementation of [PreferencesStorage].
class SharedPreferencesStorage implements PreferencesStorage {
  final SharedPreferences _prefs;

  static const _keySelectedMinistryId = 'louvaio_selected_ministry_id';
  static const _keyThemeMode = 'louvaio_theme_mode';

  SharedPreferencesStorage(this._prefs);

  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {
    if (ministryId == null) {
      await _prefs.remove(_keySelectedMinistryId);
    } else {
      await _prefs.setString(_keySelectedMinistryId, ministryId);
    }
  }

  @override
  String? getSelectedMinistryId() {
    return _prefs.getString(_keySelectedMinistryId);
  }

  @override
  Future<void> setThemeMode(String? themeMode) async {
    if (themeMode == null) {
      await _prefs.remove(_keyThemeMode);
    } else {
      await _prefs.setString(_keyThemeMode, themeMode);
    }
  }

  @override
  String? getThemeMode() {
    return _prefs.getString(_keyThemeMode);
  }

  @override
  Future<void> clear() async {
    await _prefs.remove(_keySelectedMinistryId);
    await _prefs.remove(_keyThemeMode);
  }
}
