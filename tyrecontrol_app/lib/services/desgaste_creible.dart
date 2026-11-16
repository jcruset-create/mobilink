/// ¿Es creíble esta bajada de profundidad con los kilómetros que se han hecho?
///
/// La misma regla que el panel (`services/desgasteCreible.ts`), con los mismos
/// números y las mismas pruebas: si cambia una, cambia la otra.
///
/// El caso que la hizo falta, el 2651JRM: una delantera nueva de 12,2 mm leída
/// a 1,6 y a 2,2 dos días seguidos, 195 km después. El protocolo contra los
/// falsos desgastes da por buena una lectura cuando otra la respalda, y dos
/// malas lecturas del arco se confirman entre ellas. Lo que el protocolo no
/// mira, y esto sí, es si la bajada CABE en los kilómetros recorridos.
///
/// La regla, con las lecturas de la goma desde su montaje, de la más reciente
/// a la más antigua:
///
///  · En duda están las tres últimas; su mediana es el valor que se iba a dar
///    por bueno.
///  · La BASE es la mediana de las tres anteriores.
///  · El RITMO es el de la propia goma: de sus primeras lecturas a la base,
///    en mm cada 1.000 km. Sin recorrido bastante, el medio de las demás
///    ruedas del vehículo.
///  · Lo que PODÍA bajar: el doble de su ritmo en los km hechos desde la base,
///    más 1 mm por lo que baila el arco.
///
/// Si baja más, no se da por buena: la goma se queda en su base y la lectura
/// pasa a «por confirmar», para medirla con la sonda.
///
/// Sin datos no se juzga: menos de seis lecturas, una medición de técnico
/// entre las tres últimas, kilómetros desconocidos o sin ritmo dejan el aviso
/// como estaba.
library;

/// Los mm que baila el arco de un día a otro y que no son desgaste.
const double margenArcoMm = 1;

/// Cuántas veces su ritmo se le tolera a una goma.
const double vecesElRitmo = 2;

/// Con menos recorrido que esto, el ritmo de una goma es ruido.
const double kmMinimosParaRitmo = 3000;

class LecturaConKm {
  final double mm;

  /// Día de la revisión.
  final DateTime? fecha;

  /// Kilómetros del vehículo ese día, si se saben.
  final double? km;

  /// La midió un técnico, no el arco.
  final bool manual;

  const LecturaConKm(this.mm, {this.fecha, this.km, this.manual = false});
}

/// Un punto del cuentakilómetros del vehículo.
class PuntoKm {
  final DateTime fecha;
  final double km;
  const PuntoKm(this.fecha, this.km);
}

int _dia(DateTime f) => DateTime.utc(f.year, f.month, f.day).millisecondsSinceEpoch ~/ 86400000;

/// Los kilómetros del vehículo un día, a partir de los que sí se saben.
///
/// Entre dos puntos, en línea recta. Después del último, con el ritmo de los
/// últimos 30 días; antes del primero, con el del primer tramo. Con menos de
/// dos puntos no hay ritmo y devuelve null (salvo que el día sea justo ése).
double? kmEnFecha(List<PuntoKm> puntos, DateTime? fecha) {
  if (fecha == null) return null;
  final orden = [...puntos.where((p) => p.km.isFinite && p.km > 0)]
    ..sort((a, b) => _dia(a.fecha).compareTo(_dia(b.fecha)));
  if (orden.isEmpty) return null;
  final d = _dia(fecha);
  final exactos = orden.where((p) => _dia(p.fecha) == d);
  if (exactos.isNotEmpty) return exactos.last.km;
  if (orden.length < 2) return null;

  double ritmo(PuntoKm a, PuntoKm b) {
    final dias = _dia(b.fecha) - _dia(a.fecha);
    if (dias <= 0) return 0;
    final r = (b.km - a.km) / dias;
    return r < 0 ? 0 : r;
  }

  final primero = orden.first;
  final ultimo = orden.last;
  if (d > _dia(ultimo.fecha)) {
    final desde = orden.firstWhere((p) => _dia(ultimo.fecha) - _dia(p.fecha) <= 30, orElse: () => primero);
    final r = ritmo(identical(desde, ultimo) ? orden[orden.length - 2] : desde, ultimo);
    return (ultimo.km + r * (d - _dia(ultimo.fecha))).roundToDouble();
  }
  if (d < _dia(primero.fecha)) {
    return (primero.km - ritmo(primero, orden[1]) * (_dia(primero.fecha) - d)).roundToDouble();
  }
  for (var i = 1; i < orden.length; i += 1) {
    final a = orden[i - 1];
    final b = orden[i];
    if (d <= _dia(b.fecha)) return (a.km + ritmo(a, b) * (d - _dia(a.fecha))).roundToDouble();
  }
  return null;
}

/// La lectura de en medio de tres (o la única, o la más baja de dos).
LecturaConKm _mediana(List<LecturaConKm> l) {
  final enOrden = [...l]..sort((a, b) => a.mm.compareTo(b.mm));
  return enOrden[(enOrden.length - 1) ~/ 2];
}

/// El ritmo de desgaste de una goma, en mm cada 1.000 km: de sus primeras
/// lecturas a su base. Null si no tiene recorrido bastante. La ventana en duda
/// (las tres últimas) se deja fuera: un ritmo calculado con la lectura que se
/// está juzgando le daría la razón siempre.
double? ritmoDeLaGoma(List<LecturaConKm> lecturas) {
  if (lecturas.length < 9) return null;
  final base = _mediana(lecturas.sublist(3, 6));
  final primeras = _mediana(lecturas.sublist(lecturas.length - 3));
  if (base.km == null || primeras.km == null) return null;
  final km = base.km! - primeras.km!;
  if (km < kmMinimosParaRitmo) return null;
  final r = (primeras.mm - base.mm) / km * 1000;
  return r < 0 ? 0 : r;
}

class JuicioDesgaste {
  /// true: cabe. false: no cabe. null: no hay con qué juzgar.
  final bool? creible;

  /// Por qué no se ha juzgado, o la cuenta hecha.
  final String explicacion;

  /// Cómo estaba la goma antes de las lecturas en duda.
  final LecturaConKm? base;
  final double? bajadaMm;
  final double? km;
  final double? ritmo;
  final double? permitidoMm;

  const JuicioDesgaste({
    required this.creible,
    required this.explicacion,
    this.base,
    this.bajadaMm,
    this.km,
    this.ritmo,
    this.permitidoMm,
  });
}

String _num(double n, [int d = 1]) => n.toStringAsFixed(d).replaceAll('.', ',');

String _miles(double n) {
  final s = n.round().toString();
  final b = StringBuffer();
  for (var i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return b.toString();
}

/// El juicio de la bajada. [lecturas]: las de la goma desde su montaje, de la
/// más reciente a la más antigua, ya con sus km. [ritmoDeReserva]: el medio de
/// las demás ruedas del vehículo, para la que no tiene recorrido propio.
JuicioDesgaste juzgarDesgaste(List<LecturaConKm> lecturas, [double? ritmoDeReserva]) {
  JuicioDesgaste sin(String e) => JuicioDesgaste(creible: null, explicacion: e);

  if (lecturas.length < 6) return sin('Pocas lecturas para comparar.');
  final ventana = lecturas.sublist(0, 3);
  if (ventana.any((l) => l.manual)) return sin('La midió un técnico.');

  final valor = _mediana(ventana);
  final base = _mediana(lecturas.sublist(3, 6));
  final ultima = lecturas.first;
  if (ultima.km == null || base.km == null) return sin('No se saben los kilómetros de ese tramo.');
  final recorrido = ultima.km! - base.km!;
  final km = recorrido < 0 ? 0.0 : recorrido;

  final ritmo = ritmoDeLaGoma(lecturas) ?? ritmoDeReserva;
  if (ritmo == null) return sin('No hay recorrido bastante para saber su ritmo de desgaste.');

  final bajadaMm = base.mm - valor.mm;
  final permitidoMm = vecesElRitmo * ritmo * km / 1000 + margenArcoMm;
  final creible = bajadaMm <= permitidoMm;
  final cuenta = 'Ha bajado ${_num(bajadaMm)} mm en ${_miles(km)} km; a su ritmo, '
      '${_num(ritmo, 2)} mm cada 1.000 km, le tocaban ${_num(ritmo * km / 1000)} mm';
  return JuicioDesgaste(
    creible: creible,
    explicacion: creible ? '$cuenta.' : '$cuenta. No es desgaste: medir con sonda.',
    base: base,
    bajadaMm: bajadaMm,
    km: km,
    ritmo: ritmo,
    permitidoMm: permitidoMm,
  );
}

/// El ritmo medio de las gomas que sí tienen el suyo. Null si ninguna.
double? ritmoMedio(Iterable<double?> ritmos) {
  final validos = ritmos.whereType<double>().toList();
  if (validos.isEmpty) return null;
  return validos.reduce((a, b) => a + b) / validos.length;
}
