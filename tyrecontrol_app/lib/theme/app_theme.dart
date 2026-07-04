import 'package:flutter/material.dart';

// ── Paleta de colores ────────────────────────────────────────────
// Misma filosofia que la app de asistencias (flutter_app): fondo casi
// negro (no negro puro, reduce fatiga visual con reflejos de taller),
// alto contraste, un unico acento para la accion principal.
class AppColors {
  static const background     = Color(0xFF0B0F14);
  static const surface        = Color(0xFF151B23);
  static const surfaceVariant = Color(0xFF1E2630);
  static const cardBorder     = Color(0xFF2A3441);

  static const primary     = Color(0xFF0EA5E9); // azul cian — accion principal
  static const onPrimary   = Color(0xFF0B0F14);
  static const secondary   = Color(0xFF1E2630);
  static const onSecondary = Color(0xFF93A5B8);

  static const success = Color(0xFF22C55E);
  static const warning = Color(0xFFF59E0B);
  static const danger  = Color(0xFFEF4444);
  static const info    = Color(0xFF38BDF8);

  static const textPrimary   = Color(0xFFF1F5F9);
  static const textSecondary = Color(0xFF93A5B8);
  static const textHint      = Color(0xFF54606E);
  static const textDisabled  = Color(0xFF5A6672);

  static const disabledBtn = Color(0xFF2A3441);

  // Estados de posicion de neumatico (color + significado, nunca solo color)
  static const tirePendiente    = Color(0xFF4B5563); // gris
  static const tireSeleccionado = Color(0xFF3B82F6); // azul
  static const tireRevisado     = Color(0xFF22C55E); // verde
  static const tireAdvertencia  = Color(0xFFF59E0B); // ambar
  static const tireGrave        = Color(0xFFEF4444); // rojo
  static const tireNoAccesible  = Color(0xFF374151); // negro/gris oscuro
}

// ── Tamanos: modo normal vs "exterior" (sol directo / guantes) ──
class AppSizes {
  final bool exterior;
  AppSizes({this.exterior = false});

  double get fontTitle    => exterior ? 26 : 22;
  double get fontHero     => exterior ? 40 : 32; // matricula, valor de medicion
  double get fontSubtitle => exterior ? 20 : 17;
  double get fontButton   => exterior ? 19 : 17;
  double get fontBody     => exterior ? 17 : 16;
  double get fontSmall    => exterior ? 15 : 13;

  double get btnHeight   => exterior ? 64 : 56;
  double get iconSize    => exterior ? 26 : 24;
  double get tileMinSize => exterior ? 64 : 56; // zona de toque minima
}

class AppTheme {
  static ThemeData build({bool exterior = false}) {
    final sz = AppSizes(exterior: exterior);

    final colorScheme = ColorScheme.dark(
      background: AppColors.background,
      surface: AppColors.surface,
      surfaceVariant: AppColors.surfaceVariant,
      primary: AppColors.primary,
      onPrimary: AppColors.onPrimary,
      secondary: AppColors.secondary,
      onSecondary: AppColors.onSecondary,
      tertiary: AppColors.success,
      error: AppColors.danger,
      onBackground: AppColors.textPrimary,
      onSurface: AppColors.textPrimary,
      outline: AppColors.cardBorder,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,

      textTheme: TextTheme(
        displayLarge: TextStyle(fontSize: sz.fontHero, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
        titleLarge:   TextStyle(fontSize: sz.fontTitle, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
        titleMedium:  TextStyle(fontSize: sz.fontSubtitle, fontWeight: FontWeight.w500, color: AppColors.textPrimary),
        labelLarge:   TextStyle(fontSize: sz.fontButton, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
        bodyLarge:    TextStyle(fontSize: sz.fontBody, color: AppColors.textPrimary),
        bodyMedium:   TextStyle(fontSize: sz.fontSmall, color: AppColors.textSecondary),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.disabledBtn,
          disabledForegroundColor: AppColors.textDisabled,
          minimumSize: Size(double.infinity, sz.btnHeight),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: TextStyle(fontSize: sz.fontButton, fontWeight: FontWeight.w600),
          elevation: 0,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          minimumSize: Size(double.infinity, sz.btnHeight),
          side: const BorderSide(color: AppColors.cardBorder),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: TextStyle(fontSize: sz.fontButton, fontWeight: FontWeight.w600),
        ),
      ),

      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.cardBorder, width: 1),
        ),
        margin: const EdgeInsets.symmetric(vertical: 6),
      ),

      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: AppColors.textSecondary, size: sz.iconSize),
        titleTextStyle: TextStyle(fontSize: sz.fontSubtitle, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.primary.withValues(alpha: 0.18),
        height: exterior ? 76 : 64,
        labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
              fontSize: sz.fontSmall,
              fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w400,
              color: states.contains(WidgetState.selected) ? AppColors.primary : AppColors.textSecondary,
            )),
        iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
              size: sz.iconSize,
              color: states.contains(WidgetState.selected) ? AppColors.primary : AppColors.textSecondary,
            )),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceVariant,
        labelStyle: TextStyle(color: AppColors.textSecondary, fontSize: sz.fontBody),
        hintStyle: TextStyle(color: AppColors.textHint, fontSize: sz.fontBody),
        border: OutlineInputBorder(borderSide: const BorderSide(color: AppColors.cardBorder), borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(borderSide: const BorderSide(color: AppColors.cardBorder), borderRadius: BorderRadius.circular(12)),
        focusedBorder: OutlineInputBorder(borderSide: const BorderSide(color: AppColors.primary, width: 2), borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),

      dividerColor: AppColors.cardBorder,
      iconTheme: IconThemeData(color: AppColors.textSecondary, size: sz.iconSize),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AppColors.surfaceVariant,
        contentTextStyle: TextStyle(color: AppColors.textPrimary),
      ),
    );
  }
}

// ── Estado visual de una posicion durante la revision ───────────
enum TireStatus { pendiente, seleccionado, revisado, advertencia, grave, noAccesible }

Color tireStatusColor(TireStatus s) {
  switch (s) {
    case TireStatus.pendiente:    return AppColors.tirePendiente;
    case TireStatus.seleccionado: return AppColors.tireSeleccionado;
    case TireStatus.revisado:     return AppColors.tireRevisado;
    case TireStatus.advertencia:  return AppColors.tireAdvertencia;
    case TireStatus.grave:        return AppColors.tireGrave;
    case TireStatus.noAccesible:  return AppColors.tireNoAccesible;
  }
}

IconData tireStatusIcon(TireStatus s) {
  switch (s) {
    case TireStatus.pendiente:    return Icons.schedule;
    case TireStatus.seleccionado: return Icons.radio_button_checked;
    case TireStatus.revisado:     return Icons.check_circle;
    case TireStatus.advertencia:  return Icons.warning_rounded;
    case TireStatus.grave:        return Icons.error;
    case TireStatus.noAccesible:  return Icons.lock;
  }
}
