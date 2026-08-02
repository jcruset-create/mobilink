import 'package:flutter/material.dart';

/// Paleta Mobilink (oscuro slate) con acento violeta del producto Lite.
/// Contraste alto y tipografía grande: la app se usa en carretera, con luz
/// exterior y guantes.
class AppColors {
  static const bg = Color(0xFF0F172A); // slate-900
  static const surface = Color(0xFF1E293B); // slate-800
  static const surfaceDeep = Color(0xFF0B1120); // slate-950
  static const border = Color(0xFF334155); // slate-700
  static const primary = Color(0xFF8B5CF6); // violet-500
  static const onPrimary = Color(0xFFFFFFFF);
  static const textMuted = Color(0xFF94A3B8); // slate-400
  static const ok = Color(0xFF10B981); // emerald
  static const warn = Color(0xFFF97316); // orange
  static const danger = Color(0xFFEF4444); // red
  static const info = Color(0xFF06B6D4); // cyan
}

/// Color e icono por estado. Nunca se comunica un estado solo con color:
/// siempre acompaña el icono y el texto.
class StatusStyle {
  final Color color;
  final IconData icon;
  final String label;
  const StatusStyle(this.color, this.icon, this.label);
}

const Map<String, StatusStyle> kStatusStyles = {
  'awaiting_acceptance':
      StatusStyle(Color(0xFFE879F9), Icons.mark_email_unread, 'Pendiente de aceptar'),
  'assigned': StatusStyle(Color(0xFF3B82F6), Icons.assignment, 'Recibida'),
  'technician_assigned':
      StatusStyle(Color(0xFF6366F1), Icons.person_pin_circle, 'Asignada'),
  'en_route': StatusStyle(Color(0xFF8B5CF6), Icons.navigation, 'En camino'),
  'arrived': StatusStyle(Color(0xFF06B6D4), Icons.place, 'En punto'),
  'in_progress': StatusStyle(Color(0xFF14B8A6), Icons.build, 'Trabajando'),
  'finished': StatusStyle(Color(0xFF10B981), Icons.check_circle, 'Finalizada'),
  'returning_to_workshop':
      StatusStyle(Color(0xFF84CC16), Icons.keyboard_return, 'Vuelta al taller'),
  'at_workshop': StatusStyle(Color(0xFF22C55E), Icons.home_work, 'En taller'),
  'cancelled': StatusStyle(Color(0xFFEF4444), Icons.cancel, 'Cancelada'),
};

StatusStyle statusStyle(String status) =>
    kStatusStyles[status] ??
    const StatusStyle(AppColors.textMuted, Icons.help_outline, 'Desconocido');

class AppTheme {
  static ThemeData build() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bg,
      colorScheme: base.colorScheme.copyWith(
        primary: AppColors.primary,
        onPrimary: AppColors.onPrimary,
        surface: AppColors.surface,
      ),
      textTheme: base.textTheme.apply(fontSizeFactor: 1.05),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.surfaceDeep,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
          minimumSize: const Size(0, 56),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: AppColors.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
          minimumSize: const Size(0, 48),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
