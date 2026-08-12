import 'package:flutter/material.dart';

/// Paleta Mobilink (oscuro slate + acento rojo).
class AppColors {
  static const bg = Color(0xFF0F172A); // slate-900
  static const surface = Color(0xFF1E293B); // slate-800
  static const surfaceDeep = Color(0xFF0B1120); // slate-950
  static const border = Color(0xFF334155); // slate-700
  static const primary = Color(0xFFDC2626); // red-600
  static const textMuted = Color(0xFF94A3B8); // slate-400
}

/// Color por estado de trabajo (JobStatus).
Color statusColor(String status) {
  switch (status) {
    case 'activo':
      return const Color(0xFF10B981); // emerald
    case 'parado':
      return const Color(0xFFF59E0B); // amber
    case 'validacion':
      return const Color(0xFF3B82F6); // blue
    case 'bloqueado':
      return const Color(0xFFEF4444); // red
    case 'cerrado':
      return const Color(0xFF64748B); // slate
    case 'espera':
    default:
      return const Color(0xFF8B5CF6); // violet
  }
}

String statusLabel(String status) {
  switch (status) {
    case 'espera':
      return 'En espera';
    case 'validacion':
      return 'Validación';
    case 'activo':
      return 'En curso';
    case 'parado':
      return 'Pausado';
    case 'cerrado':
      return 'Finalizado';
    case 'bloqueado':
      return 'Bloqueado';
    default:
      return status;
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
      // Botones de taller: se pulsan con guantes y de pie, así que alto
      // mínimo generoso (56 px, muy por encima de los 48 recomendados) y
      // texto grande. Es la diferencia entre acertar a la primera y tener que
      // quitarse el guante.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 56),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
        ),
      ),
      // Los iconos de la barra también son objetivo táctil: refrescar y salir
      // se pulsan con el dedo, no con un ratón.
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(52, 52)),
      ),
      // Cuerpo de texto un punto por encima del estándar: la tablet se mira a
      // un brazo de distancia, no a 30 cm como el móvil.
      textTheme: base.textTheme.apply(fontSizeDelta: 1),
    );
  }
}
