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

/// Capability interface for local storage supporting user-scoped chord font preference caching.
abstract class UserChordFontPreferencesStorage {
  Future<void> setUserChordFontFamily(String userId, String? fontFamily);
  String? getUserChordFontFamily(String userId);
}

/// Safe extension providing default non-throwing access to chord font preferences
/// on any [PreferencesStorage] instance.
extension UserChordFontPreferencesStorageExtension on PreferencesStorage {
  Future<void> setUserChordFontFamily(String userId, String? fontFamily) async {
    final self = this;
    if (self is UserChordFontPreferencesStorage) {
      final storage = self as UserChordFontPreferencesStorage;
      await storage.setUserChordFontFamily(userId, fontFamily);
    }
  }

  String? getUserChordFontFamily(String userId) {
    final self = this;
    if (self is UserChordFontPreferencesStorage) {
      final storage = self as UserChordFontPreferencesStorage;
      return storage.getUserChordFontFamily(userId);
    }
    return null;
  }
}

/// SharedPreferences implementation of [PreferencesStorage].
class SharedPreferencesStorage
    implements PreferencesStorage, UserChordFontPreferencesStorage {
  final SharedPreferences _prefs;

  static const _keySelectedMinistryId = 'louvaio_selected_ministry_id';
  static const _keyThemeMode = 'louvaio_theme_mode';
  static String _keyUserChordFont(String userId) =>
      'louvaio_chord_font_user_$userId';

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
  Future<void> setUserChordFontFamily(String userId, String? fontFamily) async {
    final key = _keyUserChordFont(userId);
    if (fontFamily == null) {
      await _prefs.remove(key);
    } else {
      await _prefs.setString(key, fontFamily);
    }
  }

  @override
  String? getUserChordFontFamily(String userId) {
    return _prefs.getString(_keyUserChordFont(userId));
  }

  @override
  Future<void> clear() async {
    await _prefs.remove(_keySelectedMinistryId);
    await _prefs.remove(_keyThemeMode);
  }
}
