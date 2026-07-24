import 'package:flutter/material.dart';

/// Paleta Mobilink (oscuro slate + acento ámbar, como el módulo web Presencia).
class AppColors {
  static const bg = Color(0xFF0F172A); // slate-900
  static const surface = Color(0xFF1E293B); // slate-800
  static const surfaceDeep = Color(0xFF0B1120); // slate-950
  static const border = Color(0xFF334155); // slate-700
  static const primary = Color(0xFFF59E0B); // amber-500
  static const onPrimary = Color(0xFF451A03); // amber-950
  static const textMuted = Color(0xFF94A3B8); // slate-400
  static const green = Color(0xFF10B981); // emerald-500
  static const red = Color(0xFFEF4444); // red-500
}

class AppTheme {
  static ThemeData build() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bg,
      colorScheme: base.colorScheme.copyWith(
        primary: AppColors.primary,
        surface: AppColors.surface,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.surfaceDeep,
        elevation: 0,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceDeep,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppColors.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
        ),
      ),
    );
  }
}
