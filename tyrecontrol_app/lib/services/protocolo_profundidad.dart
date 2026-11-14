/// El protocolo contra los falsos desgastes: qué profundidad se da por buena.
///
/// Es un puerto, función por función, de
/// `src/modules/tyrecontrol/services/protocoloProfundidad.ts` del panel, y la
/// misma regla que `tc_informes_alertas_vehiculos` en la base. Las pruebas de
/// aquí usan los mismos casos que las de allí: si cambia una, cambian las tres.
///
/// ── El problema ────────────────────────────────────────────────────────────
///
/// El arco mide bien casi siempre y de vez en cuando suelta un disparate. La
/// serie de una goma del 4310JYJ, día a día:
///
///     8,6 · 8,6 · 8,6 · 10,7 · 8,0 · 8,1 · 9,2 · 8,7 · 8,5 · 1,8
///
/// Quedándose con la última, esa goma de 8,5 mm salía a 1,8.
///
/// ── La regla ───────────────────────────────────────────────────────────────
///
/// El valor de una goma es la MEDIANA DE SUS TRES ÚLTIMAS LECTURAS. Con menos:
///
///   · dos que coinciden (≤ 2 mm) → vale la última, confirmada;
///   · dos que no coinciden → se queda la anterior y la última queda PENDIENTE;
///   · una sola → es lo que hay, sin confirmar.
///
/// Lo que mide un técnico a mano no espera confirmación y corta la ventana: lo
/// anterior a esa medición deja de contar.
///
/// Una lectura baja sin confirmar no pinta la rueda de rojo, pero sale como
/// «por confirmar»: hay que medirla con la sonda.
library;

/// Cuánto pueden diferir dos lecturas para darse la razón, en mm.
const double toleranciaMm = 2;

class LecturaDeSerie {
  final double mm;

  /// La midió un técnico (sonda o a mano), no el arco.
  final bool manual;
  final DateTime? fecha;
  const LecturaDeSerie(this.mm, {this.manual = false, this.fecha});
}

class ValorDeLaGoma {
  /// La profundidad que se da por buena.
  final double mm;
  final DateTime? fecha;

  /// Si hay otra lectura (o un técnico) que la respalde.
  final bool confirmada;

  /// La última lectura, cuando NO es la que se ha dado por buena.
  final double? pendienteMm;
  final DateTime? pendienteEn;

  const ValorDeLaGoma({
    required this.mm,
    required this.fecha,
    required this.confirmada,
    this.pendienteMm,
    this.pendienteEn,
  });
}

/// El valor de una goma a partir de sus lecturas, de la MÁS RECIENTE a la más
/// antigua. Solo se miran las tres primeras.
ValorDeLaGoma? valorDeLaSerie(List<LecturaDeSerie> lecturas) {
  var ventana = lecturas.take(3).toList();
  if (ventana.isEmpty) return null;

  // La manual manda: lo anterior a la medición a mano más reciente no cuenta.
  final manual = ventana.indexWhere((l) => l.manual);
  if (manual >= 0) ventana = ventana.sublist(0, manual + 1);

  final ultima = ventana.first;
  if (ultima.manual) {
    return ValorDeLaGoma(mm: ultima.mm, fecha: ultima.fecha, confirmada: true);
  }
  if (ventana.length == 1) {
    return ValorDeLaGoma(mm: ultima.mm, fecha: ultima.fecha, confirmada: false);
  }
  if (ventana.length == 2) {
    final anterior = ventana[1];
    if ((ultima.mm - anterior.mm).abs() <= toleranciaMm) {
      return ValorDeLaGoma(mm: ultima.mm, fecha: ultima.fecha, confirmada: true);
    }
    return ValorDeLaGoma(
      mm: anterior.mm,
      fecha: anterior.fecha,
      confirmada: anterior.manual,
      pendienteMm: ultima.mm,
      pendienteEn: ultima.fecha,
    );
  }

  // Tres: la de en medio. La LECTURA mediana —con su fecha—, no un promedio.
  // El orden es estable a propósito, como el `sort` del panel: con dos
  // lecturas iguales la fecha que sale tiene que ser la misma en los dos.
  final indices = [0, 1, 2]
    ..sort((a, b) {
      final c = ventana[a].mm.compareTo(ventana[b].mm);
      return c != 0 ? c : a.compareTo(b);
    });
  final mediana = ventana[indices[1]];
  final discrepa = (ultima.mm - mediana.mm).abs() > toleranciaMm;
  return ValorDeLaGoma(
    mm: mediana.mm,
    fecha: mediana.fecha,
    confirmada: true,
    pendienteMm: discrepa ? ultima.mm : null,
    pendienteEn: discrepa ? ultima.fecha : null,
  );
}

/// Lo que hay que decir de una goma frente a su mínimo.
enum Veredicto { cambiar, porConfirmar, ok }

/// · `cambiar`: el valor dado por bueno está en el mínimo o por debajo, y está
///   confirmado.
/// · `porConfirmar`: hay una lectura en el mínimo o por debajo que nadie ha
///   respaldado todavía —el propio valor o la última pendiente—.
/// · `ok`: lo demás. Sin mínimo no se acusa a nadie.
Veredicto veredicto({
  required double? mm,
  required bool confirmada,
  double? pendienteMm,
  required double? minimo,
}) {
  if (mm == null || minimo == null) return Veredicto.ok;
  if (mm <= minimo) return confirmada ? Veredicto.cambiar : Veredicto.porConfirmar;
  if (pendienteMm != null && pendienteMm <= minimo) return Veredicto.porConfirmar;
  return Veredicto.ok;
}

/// El diámetro de llanta que diga la medida. «295/80R22.5» → 22.5.
///
/// Acotado a dos cifras y un decimal: «295/80R22.5 154/149M» lleva el índice
/// de carga pegado y sin acotar saldría 22.5154.
double? llantaDeMedida(String? medida) {
  final m = RegExp(r'R\s?(\d{2}(?:[.,]\d)?)', caseSensitive: false).firstMatch(medida ?? '');
  if (m == null) return null;
  return double.tryParse(m.group(1)!.replaceAll(',', '.'));
}

/// El mínimo del informe de alertas: 22.5 → 4 mm · 19.5 y 17.5 → 3 · 16 o
/// menos → 2. `null` si la medida no dice la llanta: null no es cero.
///
/// Puerto de `profundidadMinimaPorLlanta` (umbralProfundidad.ts) y de
/// `tc_profundidad_minima_por_llanta` en la base.
double? profundidadMinimaPorLlanta(String? medida) {
  final d = llantaDeMedida(medida);
  if (d == null) return null;
  if (d >= 20) return 4;
  if (d >= 17) return 3;
  return 2;
}
