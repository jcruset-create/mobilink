// Qué clase de matrícula es, para dibujarla como la placa real.
//
// Solo decide el DIBUJO. No valida ni corrige: una matrícula que no encaja en
// ningún formato español se enseña tal cual está escrita, en un recuadro liso.
//
// La misma regla está en el panel (src/modules/matriculaEs.ts) y tiene que
// decir lo mismo: si aquí un remolque sale rojo y allí blanco, el operario y
// la oficina no están viendo el mismo vehículo.

enum TipoMatricula { actual, remolque, antigua, otra }

class MatriculaDibujo {
  final TipoMatricula tipo;

  /// Los grupos, para pintarlos separados: «6084» «FRG».
  final List<String> partes;
  const MatriculaDibujo(this.tipo, this.partes);
}

// Las matrículas actuales no llevan vocales ni Ñ ni Q.
const _letras = 'BCDFGHJKLMNPRSTVWXYZ';

final _actual = RegExp('^(\\d{4})([$_letras]{3})\$');
final _remolque = RegExp('^(R)(\\d{4})([$_letras]{3})\$');
final _antigua = RegExp(r'^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$');

/// Siglas de provincia del sistema anterior (hasta el año 2000). Sin esta
/// lista, cualquier matrícula extranjera con forma de «letras-4 cifras-letras»
/// saldría dibujada como española.
const _provincias = {
  'A', 'AB', 'AL', 'AV', 'B', 'BA', 'BI', 'BU', 'C', 'CA', 'CC', 'CE', 'CO', 'CR', 'CS', 'CU',
  'GC', 'GE', 'GI', 'GR', 'GU', 'H', 'HU', 'IB', 'J', 'L', 'LE', 'LO', 'LU', 'M', 'MA', 'ML',
  'MU', 'NA', 'O', 'OR', 'OU', 'P', 'PM', 'PO', 'S', 'SA', 'SE', 'SG', 'SO', 'SS', 'T', 'TE',
  'TF', 'TO', 'V', 'VA', 'VI', 'Z', 'ZA',
};

MatriculaDibujo dibujoMatricula(String? matricula) {
  final m = (matricula ?? '').toUpperCase().replaceAll(RegExp(r'[\s\-.]'), '');
  var r = _remolque.firstMatch(m);
  if (r != null) return MatriculaDibujo(TipoMatricula.remolque, [r[1]!, r[2]!, r[3]!]);
  r = _actual.firstMatch(m);
  if (r != null) return MatriculaDibujo(TipoMatricula.actual, [r[1]!, r[2]!]);
  r = _antigua.firstMatch(m);
  if (r != null && _provincias.contains(r[1])) {
    return MatriculaDibujo(TipoMatricula.antigua, [r[1]!, r[2]!, r[3]!]);
  }
  return MatriculaDibujo(TipoMatricula.otra, [(matricula ?? '').trim().toUpperCase()]);
}
