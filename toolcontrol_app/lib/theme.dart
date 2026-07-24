import 'package:flutter/material.dart';

/// Paleta Mobilink (oscuro slate + acento ámbar).
class AppColors {
  static const bg = Color(0xFF0F172A); // slate-900
  static const surface = Color(0xFF1E293B); // slate-800
  static const surfaceDeep = Color(0xFF0B1120); // slate-950
  static const border = Color(0xFF334155); // slate-700
  static const primary = Color(0xFFF59E0B); // amber-500
  static const textMuted = Color(0xFF94A3B8); // slate-400
}

/// Color por estado de herramienta (CHECK de tc_tools).
Color toolStatusColor(String estado) {
  switch (estado) {
    case 'disponible':
      return const Color(0xFF10B981); // emerald
    case 'en_uso':
      return const Color(0xFF3B82F6); // blue
    case 'compartida':
      return const Color(0xFF06B6D4); // cyan
    case 'pendiente_devolucion':
      return const Color(0xFFF59E0B); // amber
    case 'danada':
    case 'perdida':
      return const Color(0xFFEF4444); // red
    case 'mantenimiento':
    case 'pendiente_revision':
    case 'desactualizada':
      return const Color(0xFF8B5CF6); // violet
    case 'fuera_servicio':
    default:
      return const Color(0xFF64748B); // slate
  }
}

String toolStatusLabel(String estado) {
  switch (estado) {
    case 'disponible':
      return 'Disponible';
    case 'en_uso':
      return 'En uso';
    case 'compartida':
      return 'Compartida';
    case 'pendiente_devolucion':
      return 'Pendiente devolución';
    case 'danada':
      return 'Dañada';
    case 'mantenimiento':
      return 'Mantenimiento';
    case 'perdida':
      return 'Perdida';
    case 'fuera_servicio':
      return 'Fuera de servicio';
    case 'pendiente_revision':
      return 'Pendiente revisión';
    case 'desactualizada':
      return 'Desactualizada';
    default:
      return estado;
  }
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
          foregroundColor: Colors.black,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
        ),
      ),
    );
  }
}
