import 'package:flutter/material.dart';

/// Centralized brand color tokens matching LouvAIO official identity.
///
/// Precedence: Verde escuro `#0F2A1F`, Terracota `#B85A3C`, Creme `#F5EFE6`, Preto `#121212`.
class AppColors {
  static const green = Color(0xFF0F2A1F);
  static const terracotta = Color(0xFFB85A3C);
  static const cream = Color(0xFFF5EFE6);
  static const black = Color(0xFF121212);

  // Neutral / surface extensions for Material 3
  static const lightBackground = Color(0xFFFAF7F2);
  static const lightCard = Colors.white;
  static const darkBackground = Color(0xFF121212);
  static const darkSurface = Color(0xFF1A1A1A);
  static const darkCard = Color(0xFF242424);

  // Status colors
  static const error = Color(0xFFBA1A1A);
  static const success = Color(0xFF2E7D32);
  static const warning = Color(0xFFED6C02);
}

/// Material 3 Themes for LouvAIO.
class AppTheme {
  static ThemeData get lightTheme {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.green,
      brightness: Brightness.light,
      primary: AppColors.green,
      onPrimary: AppColors.cream,
      secondary: AppColors.terracotta,
      onSecondary: Colors.white,
      surface: AppColors.lightBackground,
      onSurface: AppColors.black,
      error: AppColors.error,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.lightBackground,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.green,
        foregroundColor: AppColors.cream,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardTheme(
        color: AppColors.lightCard,
        elevation: 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.green,
          foregroundColor: AppColors.cream,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }

  static ThemeData get darkTheme {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: AppColors.green,
      brightness: Brightness.dark,
      primary: const Color(0xFF4E9A7B),
      onPrimary: AppColors.black,
      secondary: AppColors.terracotta,
      onSecondary: Colors.white,
      surface: AppColors.darkSurface,
      onSurface: AppColors.cream,
      error: const Color(0xFFFFB4AB),
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.darkBackground,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.darkSurface,
        foregroundColor: AppColors.cream,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardTheme(
        color: AppColors.darkCard,
        elevation: 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.terracotta,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
    );
  }
}
