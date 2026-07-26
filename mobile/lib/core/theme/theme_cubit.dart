import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Cubit managing app ThemeMode (dark mode default with SharedPreferences persistence)
class ThemeCubit extends Cubit<ThemeMode> {
  static const String _key = 'praise_theme';

  ThemeCubit() : super(ThemeMode.dark) {
    _loadTheme();
  }

  Future<void> _loadTheme() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (saved == 'light') {
        emit(ThemeMode.light);
      } else {
        emit(ThemeMode.dark);
      }
    } catch (_) {
      emit(ThemeMode.dark);
    }
  }

  Future<void> toggleTheme() async {
    final nextMode = state == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    emit(nextMode);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, nextMode == ThemeMode.light ? 'light' : 'dark');
    } catch (_) {}
  }
}
