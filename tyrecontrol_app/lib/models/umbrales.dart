import '../theme/app_theme.dart';
import 'models.dart';

/// Umbrales para decidir el "camino rápido vs excepción" (P0-C).
///
/// De momento son valores por defecto a nivel de app; en el futuro se
/// cargarán por empresa/eje desde Supabase (profundidad legal, presión
/// objetivo por posición…). El corte se hace sobre la PROFUNDIDAD, que es
/// la métrica de seguridad principal; la presión se registra pero, sin un
/// objetivo por vehículo, no dispara anomalía por sí sola.
class Umbrales {
  final double profCriticaMm; // <= → grave (rojo)
  final double profAvisoMm;   // <= → advertencia (ámbar)

  const Umbrales({this.profCriticaMm = 1.6, this.profAvisoMm = 3.0});

  static const Umbrales def = Umbrales();

  // Estados visuales que se consideran graves de entrada.
  static const graveVisual = {'pinchazo', 'corte', 'objeto_clavado'};

  /// Traduce una medición a color/estado de la rueda. Si se pasan
  /// [presionObjetivo] y [margenPresion], una presión fuera de rango marca
  /// advertencia (autodetección de presión baja/alta).
  TireStatus evaluar(RevisionDetalleDraft d, {num? presionObjetivo, num? margenPresion}) {
    if (d.noAccesible || d.neumaticoAusente) return TireStatus.noAccesible;

    if (d.estadoVisual != null && graveVisual.contains(d.estadoVisual)) {
      return TireStatus.grave;
    }

    final prof = d.profundidadMm;
    if (prof != null) {
      if (prof <= profCriticaMm) return TireStatus.grave;
      if (prof <= profAvisoMm) return TireStatus.advertencia;
    }

    if (d.estadoVisual != null && d.estadoVisual != 'correcto') {
      return TireStatus.advertencia;
    }

    if (presionFueraDeRango(d.presionBar, presionObjetivo, margenPresion)) {
      return TireStatus.advertencia;
    }
    return TireStatus.revisado;
  }

  /// ¿La presión medida se aleja del objetivo más que el margen?
  static bool presionFueraDeRango(double? medida, num? objetivo, num? margen) {
    if (medida == null || objetivo == null) return false;
    final m = (margen ?? 0.5).toDouble();
    return (medida - objetivo).abs() > m;
  }

  /// ¿Hay que abrir la ficha para que el técnico confirme? (camino de excepción)
  bool esAnomalia(RevisionDetalleDraft d) {
    final s = evaluar(d);
    return s == TireStatus.grave || s == TireStatus.advertencia;
  }
}
