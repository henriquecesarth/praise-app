import 'package:flutter/material.dart';

/// Praise App — Design System Colors (Sage & Forest Green)
/// Dark mode default, with high-contrast Light Mode.
class AppColors {
  AppColors._();

  // ─── Brand Colors ──────────────────────────────────────────
  static const Color primaryBrand = Color(0xFF2B3B30);
  static const Color primaryHover = Color(0xFF415748);
  static const Color accent = Color(0xFF86A38F);

  // ─── Dark Mode (Default) ────────────────────────────────────
  static const Color background = Color(0xFF131614);
  static const Color surface = Color(0xFF1C221E);
  static const Color surfaceVariant = Color(0xFF242C27);
  static const Color surfaceElevated = Color(0xFF2B3630);

  static const Color primary = Color(0xFF2B3B30);
  static const Color primaryLight = Color(0xFF86A38F);
  static const Color primaryDark = Color(0xFF1B261F);
  static const Color primarySurface = Color(0xFF233B2B);

  static const Color secondary = Color(0xFF06B6D4);
  static const Color secondaryLight = Color(0xFF67E8F9);

  static const Color success = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF3B82F6);

  static const Color textPrimary = Color(0xFFECEFE2);
  static const Color textSecondary = Color(0xFF9DA79F);
  static const Color textTertiary = Color(0xFF6E7870);
  static const Color textOnPrimary = Color(0xFFFFFFFF);

  static const Color border = Color(0xFF2B3B30);
  static const Color divider = Color(0xFF242C27);

  static const Color glassWhite = Color(0x0DFFFFFF);
  static const Color glassBorder = Color(0x1AFFFFFF);

  // ─── Semantic Badges (Dark Mode) ───────────────────────────
  static const Color memberBadgeBg = Color(0x263B82F6);
  static const Color memberBadgeText = Color(0xFF93C5FD);
  static const Color importantBadgeBg = Color(0x26EF4444);
  static const Color importantBadgeText = Color(0xFFFCA5A5);
  static const Color dangerBtnBg = Color(0x1DEF4444);
  static const Color dangerBtnText = Color(0xFFFCA5A5);

  // ─── Classification Colors ────────────────────────────────
  static const Color classLouvor = Color(0xFF2B3B30);
  static const Color classAdoracao = Color(0xFF06B6D4);
  static const Color classContemplacao = Color(0xFF86A38F);
  static const Color classConsagracao = Color(0xFF10B981);
  static const Color classJubilo = Color(0xFFF59E0B);
  static const Color classEspeciais = Color(0xFFEF4444);
}

/// Light Mode Palette (High Contrast Rules)
class AppColorsLight {
  AppColorsLight._();

  static const Color background = Color(0xFFF4F6F4);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceVariant = Color(0xFFE8EDE9);
  static const Color surfaceElevated = Color(0xFFDEE5E0);

  static const Color primary = Color(0xFF2B3B30);
  static const Color primaryLight = Color(0xFF233B2B);
  static const Color primaryDark = Color(0xFF18231C);
  static const Color primarySurface = Color(0xFFE2EBE4);

  static const Color secondary = Color(0xFF0284C7);
  static const Color secondaryLight = Color(0xFF0369A1);

  static const Color success = Color(0xFF059669);
  static const Color warning = Color(0xFFD97706);
  static const Color error = Color(0xFFDC2626);
  static const Color info = Color(0xFF2563EB);

  // High contrast text colors for Light Mode
  static const Color textPrimary = Color(0xFF0F1411);
  static const Color textSecondary = Color(0xFF3A4A3E);
  static const Color textTertiary = Color(0xFF526356);
  static const Color textOnPrimary = Color(0xFFFFFFFF);

  static const Color border = Color(0xFFDCE2DD);
  static const Color divider = Color(0xFFE2E8E3);

  // High-contrast semantic badges for Light Mode
  static const Color memberBadgeBg = Color(0x1F2563EB);
  static const Color memberBadgeText = Color(0xFF1D4ED8);
  static const Color importantBadgeBg = Color(0x1FDC2626);
  static const Color importantBadgeText = Color(0xFFB91C1C);
  static const Color dangerBtnBg = Color(0x14DC2626);
  static const Color dangerBtnText = Color(0xFFDC2626);
}
