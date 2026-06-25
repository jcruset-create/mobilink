import 'package:flutter/material.dart';

// ── Paleta de colores ──────────────────────────────────────────────────────────
class AppColors {
  // Fondos
  static const background     = Color(0xFF0D1B2A);
  static const surface        = Color(0xFF162232);
  static const surfaceVariant = Color(0xFF1B2B40);
  static const cardBorder     = Color(0xFF2D4A6A);

  // Acciones
  static const primary   = Color(0xFFF0C040); // amarillo — btn principal
  static const onPrimary = Color(0xFF0D1B2A);
  static const secondary = Color(0xFF1E3A5F); // azul oscuro — btn secundario
  static const onSecondary = Color(0xFF8BAFD4);

  // Estados semánticos
  static const success = Color(0xFF3DCEA8); // en taller / éxito
  static const warning = Color(0xFFF0843A); // en camino / aviso
  static const danger  = Color(0xFFE2504A); // error / cancelada
  static const info    = Color(0xFF4DC3FF); // información

  // Texto
  static const textPrimary   = Color(0xFFF0F4FF);
  static const textSecondary = Color(0xFF8BAFD4);
  static const textHint      = Color(0xFF4A6080);
  static const textDisabled  = Color(0xFF606880);

  // Botón deshabilitado
  static const disabledBtn   = Color(0xFF3A4560);

  // Colores de estado de asistencia
  static const statusAsignada        = Color(0xFF378ADD);
  static const statusEnCamino        = Color(0xFF4DC3FF);
  static const statusEnPunto         = Color(0xFF9F7AEA);
  static const statusInicioReparacion = Color(0xFFF0843A);
  static const statusFinalizada      = Color(0xFF3DCEA8);
  static const statusEnCaminoBase    = Color(0xFF3DCEA8);
  static const statusLlegadaTaller   = Color(0xFF4A5568);
  static const statusCancelada       = Color(0xFFE2504A);
  static const statusPendiente       = Color(0xFFF0C040);
}

// ── Tamaños según modo ─────────────────────────────────────────────────────────
class AppSizes {
  final bool exterior;
  AppSizes({this.exterior = false});

  double get fontTitle    => exterior ? 28 : 24;
  double get fontSubtitle => exterior ? 22 : 18;
  double get fontButton   => exterior ? 20 : 18;
  double get fontBody     => exterior ? 18 : 16;
  double get fontSmall    => exterior ? 16 : 14;
  double get fontMeta     => exterior ? 14 : 13;

  double get btnHeight    => exterior ? 80 : 72;
  double get iconSize     => exterior ? 28 : 24;
  double get iconNavSize  => exterior ? 30 : 26;
  double get cardPaddingV => exterior ? 16 : 12;
  double get cardPaddingH => exterior ? 18 : 14;
}

// ── ThemeData ──────────────────────────────────────────────────────────────────
class AppTheme {
  static ThemeData build({bool exterior = false}) {
    final sz = AppSizes(exterior: exterior);

    final colorScheme = ColorScheme.dark(
      background:     AppColors.background,
      surface:        AppColors.surface,
      surfaceVariant: AppColors.surfaceVariant,
      primary:        AppColors.primary,
      onPrimary:      AppColors.onPrimary,
      secondary:      AppColors.secondary,
      onSecondary:    AppColors.onSecondary,
      tertiary:       AppColors.success,
      error:          AppColors.danger,
      onBackground:   AppColors.textPrimary,
      onSurface:      AppColors.textPrimary,
      outline:        AppColors.cardBorder,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.background,
      fontFamily: 'Roboto',

      textTheme: TextTheme(
        titleLarge:  TextStyle(fontSize: sz.fontTitle,    fontWeight: FontWeight.w500, color: AppColors.textPrimary),
        titleMedium: TextStyle(fontSize: sz.fontSubtitle, fontWeight: FontWeight.w500, color: AppColors.textPrimary),
        labelLarge:  TextStyle(fontSize: sz.fontButton,   fontWeight: FontWeight.w500, color: AppColors.textPrimary),
        bodyLarge:   TextStyle(fontSize: sz.fontBody,     fontWeight: FontWeight.normal, color: AppColors.textPrimary),
        bodyMedium:  TextStyle(fontSize: sz.fontSmall,    fontWeight: FontWeight.normal, color: AppColors.textSecondary),
        labelSmall:  TextStyle(fontSize: sz.fontMeta,     fontWeight: FontWeight.w500, color: AppColors.textSecondary, letterSpacing: 0.04),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.onPrimary,
          disabledBackgroundColor: AppColors.disabledBtn,
          disabledForegroundColor: AppColors.textDisabled,
          minimumSize: Size(double.infinity, sz.btnHeight),
          padding: EdgeInsets.symmetric(horizontal: 20, vertical: exterior ? 20 : 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: TextStyle(fontSize: sz.fontButton, fontWeight: FontWeight.w500),
          elevation: 0,
        ),
      ),

      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: AppColors.cardBorder, width: 1),
        ),
        margin: const EdgeInsets.symmetric(vertical: 4),
      ),

      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        iconTheme: IconThemeData(color: AppColors.textSecondary, size: sz.iconSize),
        titleTextStyle: TextStyle(
          fontSize: sz.fontSubtitle,
          fontWeight: FontWeight.w500,
          color: AppColors.primary,
        ),
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.textSecondary,
        indicatorColor: AppColors.primary,
        labelStyle: TextStyle(fontSize: sz.fontSmall, fontWeight: FontWeight.w500),
        unselectedLabelStyle: TextStyle(fontSize: sz.fontSmall),
        indicator: const UnderlineTabIndicator(
          borderSide: BorderSide(color: AppColors.primary, width: 2.5),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceVariant,
        labelStyle: TextStyle(color: AppColors.textSecondary, fontSize: sz.fontBody),
        hintStyle: TextStyle(color: AppColors.textHint, fontSize: sz.fontBody),
        border: OutlineInputBorder(
          borderSide: const BorderSide(color: AppColors.cardBorder),
          borderRadius: BorderRadius.circular(8),
        ),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: AppColors.cardBorder),
          borderRadius: BorderRadius.circular(8),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
          borderRadius: BorderRadius.circular(8),
        ),
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: sz.cardPaddingV),
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

// ── Helper para colores de estado ─────────────────────────────────────────────
Color statusColor(String status) {
  switch (status) {
    case 'asignada':          return AppColors.statusAsignada;
    case 'en_camino':         return AppColors.statusEnCamino;
    case 'en_punto':          return AppColors.statusEnPunto;
    case 'inicio_reparacion': return AppColors.statusInicioReparacion;
    case 'finalizada':        return AppColors.statusFinalizada;
    case 'en_camino_base':    return AppColors.statusEnCaminoBase;
    case 'llegada_taller':    return AppColors.statusLlegadaTaller;
    case 'redirigida':        return AppColors.warning;
    case 'cancelada':         return AppColors.statusCancelada;
    default:                  return AppColors.statusPendiente;
  }
}

String statusLabel(String status) {
  switch (status) {
    case 'pendiente':         return 'Pendiente';
    case 'asignada':          return 'Asignada';
    case 'en_camino':         return 'En camino';
    case 'en_punto':          return 'En punto';
    case 'inicio_reparacion': return 'Reparando';
    case 'finalizada':        return 'Finalizada';
    case 'en_camino_base':    return 'Vuelta al taller';
    case 'llegada_taller':    return 'En taller ✓';
    case 'redirigida':        return 'Redirigida';
    case 'cancelada':         return 'Cancelada';
    default:                  return status;
  }
}
