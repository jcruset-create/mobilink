/// Qué hacer con una lectura de odómetro que viene de la pantalla anterior.
///
/// ── Por qué no se vuelve a preguntar sin más ────────────────────────────────
///
/// Cada consulta gasta cupo del proveedor, y es el MISMO cupo que usa el
/// barrido de presencia en bases. Entre «Confirmar vehículo» y la revisión
/// pasan segundos: preguntar dos veces por el mismo autobús en ese rato es
/// gastar dos veces para recibir el mismo número.
///
/// ── Pero una lectura vieja tampoco vale ─────────────────────────────────────
///
/// El técnico puede dejar la pantalla de confirmación abierta y volver una
/// hora después, y en ese rato el autobús puede haber salido. La regla es la
/// misma que ya aplica la revisión antes de cerrar y la que decide
/// `tocaRefrescar` en el servidor: cuenta desde que el PROVEEDOR capturó el
/// dato, no desde que se consultó.
///
/// Ante la duda, `false`: volver a preguntar es lo que se hacía antes de
/// existir esto, así que equivocarse por ese lado no rompe nada.
library;

/// Minutos que una lectura se considera vigente si el servidor no dice otra
/// cosa. El servidor manda su propio `frescuraMin` y es el que gana.
const int kFrescuraOdometroMinPorDefecto = 120;

/// Margen para un reloj adelantado. Una captura 3 minutos «en el futuro» es un
/// desfase de relojes, no un dato del mañana; una de dos horas en el futuro sí
/// es una respuesta que no hay que creerse.
const int kMargenRelojMin = 10;

/// ¿Se puede reutilizar [lectura] en vez de volver a preguntar al proveedor?
bool lecturaSigueValiendo(
  Map<String, dynamic>? lectura, {
  DateTime? ahora,
  int frescuraPorDefectoMin = kFrescuraOdometroMinPorDefecto,
}) {
  if (lectura == null) return false;
  // Sin número no hay nada que reutilizar: que el vehículo no tenga telemática
  // se vuelve a comprobar, por si se ha enlazado entre pantalla y pantalla.
  if (lectura['km'] is! num) return false;

  final capturado = lectura['capturadoAt'];
  if (capturado is! String) return false;
  final leidoAt = DateTime.tryParse(capturado);
  if (leidoAt == null) return false;

  final frescura = (lectura['frescuraMin'] as num?)?.round() ?? frescuraPorDefectoMin;
  final minutos = (ahora ?? DateTime.now()).toUtc().difference(leidoAt.toUtc()).inMinutes;
  return minutos >= -kMargenRelojMin && minutos <= frescura;
}
