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

/// Capability interface for local storage supporting user-scoped chord line spacing preference caching.
abstract class UserChordLineSpacingPreferencesStorage {
  Future<void> setUserChordLineSpacingPx(String userId, int? spacingPx);
  int? getUserChordLineSpacingPx(String userId);
}

/// Capability interface for local storage supporting user-scoped PDF custom marker preferences.
abstract class UserPdfMarkerPreferencesStorage {
  Future<void> setUserPdfMarkerText(String userId, String? markerText);
  String? getUserPdfMarkerText(String userId);
  Future<void> setUserPdfMarkerEnabled(String userId, bool enabled);
  bool getUserPdfMarkerEnabled(String userId);
}

/// Capability interface for local storage supporting user-scoped vocal range preference caching.
abstract class UserVocalRangePreferencesStorage {
  Future<void> setUserVocalRange(String userId, int? minMidi, int? maxMidi);
  (int, int)? getUserVocalRange(String userId);
}

/// Optional capability for keeping ministry context preferences per account.
abstract class UserMinistrySelectionStorage {
  Future<void> setSelectedMinistryIdForUser(String userId, String? ministryId);
  String? getSelectedMinistryIdForUser(String userId);
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

  Future<void> setUserChordLineSpacingPx(String userId, int? spacingPx) async {
    final self = this;
    if (self is UserChordLineSpacingPreferencesStorage) {
      final storage = self as UserChordLineSpacingPreferencesStorage;
      await storage.setUserChordLineSpacingPx(userId, spacingPx);
    }
  }

  int? getUserChordLineSpacingPx(String userId) {
    final self = this;
    if (self is UserChordLineSpacingPreferencesStorage) {
      final storage = self as UserChordLineSpacingPreferencesStorage;
      return storage.getUserChordLineSpacingPx(userId);
    }
    return null;
  }

  Future<void> setUserPdfMarkerText(String userId, String? markerText) async {
    final self = this;
    if (self is UserPdfMarkerPreferencesStorage) {
      final storage = self as UserPdfMarkerPreferencesStorage;
      await storage.setUserPdfMarkerText(userId, markerText);
    }
  }

  String? getUserPdfMarkerText(String userId) {
    final self = this;
    if (self is UserPdfMarkerPreferencesStorage) {
      final storage = self as UserPdfMarkerPreferencesStorage;
      return storage.getUserPdfMarkerText(userId);
    }
    return null;
  }

  Future<void> setUserPdfMarkerEnabled(String userId, bool enabled) async {
    final self = this;
    if (self is UserPdfMarkerPreferencesStorage) {
      final storage = self as UserPdfMarkerPreferencesStorage;
      await storage.setUserPdfMarkerEnabled(userId, enabled);
    }
  }

  bool getUserPdfMarkerEnabled(String userId) {
    final self = this;
    if (self is UserPdfMarkerPreferencesStorage) {
      final storage = self as UserPdfMarkerPreferencesStorage;
      return storage.getUserPdfMarkerEnabled(userId);
    }
    return false;
  }

  Future<void> setUserVocalRange(
    String userId,
    int? minMidi,
    int? maxMidi,
  ) async {
    final self = this;
    if (self is UserVocalRangePreferencesStorage) {
      final storage = self as UserVocalRangePreferencesStorage;
      await storage.setUserVocalRange(userId, minMidi, maxMidi);
    }
  }

  (int, int)? getUserVocalRange(String userId) {
    final self = this;
    if (self is UserVocalRangePreferencesStorage) {
      final storage = self as UserVocalRangePreferencesStorage;
      return storage.getUserVocalRange(userId);
    }
    return null;
  }
}

/// SharedPreferences implementation of [PreferencesStorage].
class SharedPreferencesStorage
    implements
        PreferencesStorage,
        UserChordFontPreferencesStorage,
        UserChordLineSpacingPreferencesStorage,
        UserPdfMarkerPreferencesStorage,
        UserVocalRangePreferencesStorage,
        UserMinistrySelectionStorage {
  final SharedPreferences _prefs;

  static const _keySelectedMinistryId = 'louvaio_selected_ministry_id';
  static const _keyThemeMode = 'louvaio_theme_mode';
  static String _keyUserChordFont(String userId) =>
      'louvaio_chord_font_user_$userId';
  static String _keyUserChordLineSpacing(String userId) =>
      'louvaio_chord_line_spacing_user_$userId';
  static String _keyUserPdfMarkerText(String userId) =>
      'louvaio_pdf_marker_user_$userId';
  static String _keyUserPdfMarkerEnabled(String userId) =>
      'louvaio_pdf_marker_enabled_user_$userId';
  static String _keyUserVocalMinMidi(String userId) =>
      'louvaio_vocal_min_midi_user_$userId';
  static String _keyUserVocalMaxMidi(String userId) =>
      'louvaio_vocal_max_midi_user_$userId';
  static String _keyUserSelectedMinistry(String userId) =>
      'louvaio_selected_ministry_user_$userId';

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
  Future<void> setSelectedMinistryIdForUser(
      String userId, String? ministryId) async {
    final key = _keyUserSelectedMinistry(userId);
    if (ministryId == null) {
      await _prefs.remove(key);
    } else {
      await _prefs.setString(key, ministryId);
    }
  }

  @override
  String? getSelectedMinistryIdForUser(String userId) =>
      _prefs.getString(_keyUserSelectedMinistry(userId));

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
  Future<void> setUserChordLineSpacingPx(String userId, int? spacingPx) async {
    final key = _keyUserChordLineSpacing(userId);
    if (spacingPx == null) {
      await _prefs.remove(key);
    } else {
      await _prefs.setInt(key, spacingPx);
    }
  }

  @override
  int? getUserChordLineSpacingPx(String userId) {
    return _prefs.getInt(_keyUserChordLineSpacing(userId));
  }

  @override
  Future<void> setUserPdfMarkerText(String userId, String? markerText) async {
    final key = _keyUserPdfMarkerText(userId);
    if (markerText == null || markerText.isEmpty) {
      await _prefs.remove(key);
    } else {
      await _prefs.setString(key, markerText);
    }
  }

  @override
  String? getUserPdfMarkerText(String userId) {
    return _prefs.getString(_keyUserPdfMarkerText(userId));
  }

  @override
  Future<void> setUserPdfMarkerEnabled(String userId, bool enabled) async {
    await _prefs.setBool(_keyUserPdfMarkerEnabled(userId), enabled);
  }

  @override
  bool getUserPdfMarkerEnabled(String userId) {
    return _prefs.getBool(_keyUserPdfMarkerEnabled(userId)) ?? false;
  }

  @override
  Future<void> setUserVocalRange(
    String userId,
    int? minMidi,
    int? maxMidi,
  ) async {
    final minKey = _keyUserVocalMinMidi(userId);
    final maxKey = _keyUserVocalMaxMidi(userId);
    if (minMidi == null || maxMidi == null) {
      await _prefs.remove(minKey);
      await _prefs.remove(maxKey);
    } else {
      await _prefs.setInt(minKey, minMidi);
      await _prefs.setInt(maxKey, maxMidi);
    }
  }

  @override
  (int, int)? getUserVocalRange(String userId) {
    final minVal = _prefs.getInt(_keyUserVocalMinMidi(userId));
    final maxVal = _prefs.getInt(_keyUserVocalMaxMidi(userId));
    if (minVal == null || maxVal == null) return null;
    return (minVal, maxVal);
  }

  @override
  Future<void> clear() async {
    await _prefs.remove(_keySelectedMinistryId);
    await _prefs.remove(_keyThemeMode);
  }
}
