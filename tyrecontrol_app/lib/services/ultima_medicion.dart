/// La última medición de cada rueda, a partir de las filas de detalle de las
/// revisiones.
///
/// ── La profundidad solo cuenta si la revisión midió todas sus ruedas ───────
///
/// El caso que lo destapó, el 4300GZD en su rueda E2_IZQ_INT:
///
///     30/10/2026   12,7 mm   revisión con las seis ruedas medidas
///     05/11/2026    1,9 mm   revisión con UNA sola rueda medida
///
/// En seis días no se gastan 11 mm. La lectura del 05/11 es del arco y ese día
/// llovía: el láser no lee la goma mojada. Medido en producción desde
/// septiembre, las lecturas de una revisión completa se mueven −0,01 mm de
/// media respecto a la anterior de la misma goma y un 0,9 % cae más de 2 mm;
/// las de una revisión parcial, −0,50 mm de media y un 9,3 %.
///
/// Así que una revisión vale para la profundidad cuando TODAS sus filas traen
/// profundidad. Si le falta una, no se usa ninguna de las suyas y la rueda se
/// queda con la de su última revisión completa.
///
/// La PRESIÓN no se toca: el arco la mide bien con lluvia, así que sale de la
/// última fila que la traiga, sea de una revisión completa o no.
///
/// Es la misma regla que `services/ultimaMedicion.ts` en el panel y que
/// `tc_informes_alertas_vehiculos` en la base. Las tres tienen que decir lo
/// mismo: si cambia una, cambian las tres.
library;

/// Una fila de `revisiones_neumaticos_detalle`, con lo justo para repartir.
class FilaMedicion {
  final String? revisionId;

  /// Por qué se agrupa: el neumático o la posición, según quién pregunte.
  final String? clave;
  final double? profundidadMm;
  final double? presionBar;

  /// Cuándo se tomó, para sellar la medición que salga de esta fila.
  final DateTime? momento;

  const FilaMedicion({
    required this.revisionId,
    required this.clave,
    this.profundidadMm,
    this.presionBar,
    this.momento,
  });
}

/// Lo que se sabe de una rueda.
class MedicionVigente {
  double? profundidadMm;
  double? presionBar;

  /// De cuándo es la PROFUNDIDAD, que es el dato que luego se compara con la
  /// del propio neumático.
  DateTime? medidoEn;

  /// De cuándo es la presión, por si no hay profundidad que fechar.
  DateTime? presionEn;
}

/// Las revisiones cuyas filas traen TODAS profundidad.
///
/// [cortada] es una revisión de la que NO se tienen todas las filas —la más
/// antigua de una consulta con `limit`, que puede haberse quedado a medias—:
/// no se puede saber si está completa, así que no cuenta. Darla por buena con
/// media revisión delante sería justo el error que esto quiere evitar.
Set<String> revisionesConTodasLasRuedas(Iterable<FilaMedicion> filas, {String? cortada}) {
  final total = <String, int>{};
  final conProfundidad = <String, int>{};
  for (final f in filas) {
    final id = f.revisionId;
    if (id == null) continue;
    total[id] = (total[id] ?? 0) + 1;
    if (f.profundidadMm != null) conProfundidad[id] = (conProfundidad[id] ?? 0) + 1;
  }
  return {
    for (final id in total.keys)
      if (id != cortada && total[id] == (conProfundidad[id] ?? 0)) id,
  };
}

/// El reparto: para cada clave, la profundidad de su última revisión completa
/// y la presión de su última fila con presión.
///
/// [filas] tiene que venir de la MÁS RECIENTE a la más antigua. Si la consulta
/// llevaba `limit` y lo ha agotado, se pasa [limite] para no fiarse de la
/// revisión del final, que puede venir cortada.
Map<String, MedicionVigente> repartirUltimasMediciones(List<FilaMedicion> filas, {int? limite}) {
  final cortada = (limite != null && filas.length >= limite && filas.isNotEmpty) ? filas.last.revisionId : null;
  final completas = revisionesConTodasLasRuedas(filas, cortada: cortada);

  final out = <String, MedicionVigente>{};
  for (final f in filas) {
    final clave = f.clave;
    if (clave == null) continue;
    final deCompleta = f.revisionId != null && completas.contains(f.revisionId);
    final aportaProfundidad = f.profundidadMm != null && deCompleta;
    final aportaPresion = f.presionBar != null;
    if (!aportaProfundidad && !aportaPresion) continue;

    final m = out.putIfAbsent(clave, MedicionVigente.new);
    if (m.profundidadMm == null && aportaProfundidad) {
      m.profundidadMm = f.profundidadMm;
      m.medidoEn = f.momento;
    }
    if (m.presionBar == null && aportaPresion) {
      m.presionBar = f.presionBar;
      m.presionEn = f.momento;
    }
  }
  return out;
}
