// Cómo se dibuja una matrícula: como la placa de su país.
//
// Solo decide el DIBUJO. No valida ni corrige: lo que no encaja en nada se
// enseña tal cual está escrito, en un recuadro liso.
//
// El país se deduce de la forma SOLO cuando la forma no deja dudas: las
// españolas, las portuguesas, las rumanas y las polacas. En el resto no se
// adivina: Francia e Italia usan exactamente el mismo patrón (AA-123-AA), y
// una búlgara «B 1234 AB» es igual que una antigua de Barcelona. Esas salen
// como placa UE sin letra, salvo que la oficina haya indicado el país.
//
// La misma regla está en el panel (src/modules/matriculaEs.ts) y tiene que
// decir lo mismo, con las mismas pruebas.

enum TipoMatricula { actual, remolque, especial, antigua, ue, otra }

enum FondoMatricula { blanco, rojo, amarillo, liso }

class MatriculaDibujo {
  final TipoMatricula tipo;

  /// Los grupos, para pintarlos separados: «6084» «FRG».
  final List<String> partes;

  /// Cómo se juntan los grupos: espacio, guion…
  final String separador;

  /// La letra de la banda azul («E», «F»…). Vacía: banda sin letra.
  final String pais;

  /// Si lleva la banda azul de la UE.
  final bool banda;
  final FondoMatricula fondo;

  /// Letras rojas (vehículo especial español).
  final bool letrasRojas;

  const MatriculaDibujo(
    this.tipo,
    this.partes, {
    this.separador = ' ',
    this.pais = '',
    this.banda = false,
    this.fondo = FondoMatricula.blanco,
    this.letrasRojas = false,
  });
}

/// El valor de «País de la matrícula» para una que no es de la UE.
const fueraUe = 'X';

const _codigos = {
  'E', 'P', 'F', 'I', 'D', 'NL', 'B', 'L', 'PL', 'RO', 'BG', 'CZ', 'SK', 'H', 'A', 'SLO', 'HR', 'LT', 'LV',
  'EST', 'IRL', 'DK', 'S', 'FIN', 'GR', 'CY', 'M',
};

/// Un código de la lista, [fueraUe], o null (automático).
String? paisMatriculaValido(Object? v) {
  final t = (v ?? '').toString().trim().toUpperCase();
  return t == fueraUe || _codigos.contains(t) ? t : null;
}

// Las matrículas españolas actuales no llevan vocales ni Ñ ni Q.
const _letras = 'BCDFGHJKLMNPRSTVWXYZ';

final _actual = RegExp('^(\\d{4})([$_letras]{3})\$');
final _remolque = RegExp('^(R)(\\d{4})([$_letras]{3})\$');
final _especial = RegExp('^(E)(\\d{4})([$_letras]{3})\$');
final _antigua = RegExp(r'^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$');
// Portugal: tres parejas, con las letras en cualquiera de las tres posiciones.
final _portugal = RegExp(
    r'^(?:([A-Z]{2})(\d{2})([A-Z]{2})|(\d{2})([A-Z]{2})(\d{2})|(\d{2})(\d{2})([A-Z]{2})|([A-Z]{2})(\d{2})(\d{2}))$');
// Rumanía: B + 2-3 cifras + 3 letras, o provincia de dos letras + 2 cifras + 3 letras.
final _rumania = RegExp(r'^(?:(B)(\d{2,3})|([A-Z]{2})(\d{2}))([A-Z]{3})$');
// Polonia: 2-3 letras de comarca, cuatro cifras y un carácter más. (La forma
// «letras + 3 cifras + 2 letras» NO: es también la francesa, la italiana y la
// eslovaca.)
final _polonia = RegExp(r'^([A-Z]{2,3})(\d{4}[A-Z0-9])$');
// Francia e Italia (mismo patrón): solo con el país indicado.
final _aa123aa = RegExp(r'^([A-Z]{2})(\d{3})([A-Z]{2})$');
final _pintaDePlaca = RegExp(r'^[A-Z0-9]{5,9}$');

/// Siglas de provincia del sistema español anterior (hasta el año 2000). Sin
/// esta lista, cualquier extranjera con forma de «letras-4 cifras-letras»
/// saldría dibujada como española.
const _provincias = {
  'A', 'AB', 'AL', 'AV', 'B', 'BA', 'BI', 'BU', 'C', 'CA', 'CC', 'CE', 'CO', 'CR', 'CS', 'CU',
  'GC', 'GE', 'GI', 'GR', 'GU', 'H', 'HU', 'IB', 'J', 'L', 'LE', 'LO', 'LU', 'M', 'MA', 'ML',
  'MU', 'NA', 'O', 'OR', 'OU', 'P', 'PM', 'PO', 'S', 'SA', 'SE', 'SG', 'SO', 'SS', 'T', 'TE',
  'TF', 'TO', 'V', 'VA', 'VI', 'Z', 'ZA',
};

/// Las provincias rumanas: sin la lista, una británica «AB12 CDE» (misma
/// forma, y no es de la UE) saldría como rumana.
const _judete = {
  'AB', 'AR', 'AG', 'BC', 'BH', 'BN', 'BT', 'BV', 'BR', 'BZ', 'CS', 'CL', 'CJ', 'CT', 'CV', 'DB', 'DJ', 'GL',
  'GR', 'GJ', 'HR', 'HD', 'IL', 'IS', 'IF', 'MM', 'MH', 'MS', 'NT', 'OT', 'PH', 'SM', 'SJ', 'SB', 'SV', 'TR',
  'TM', 'TL', 'VS', 'VL', 'VN',
};

List<String> _grupos(RegExpMatch r) =>
    [for (var i = 1; i <= r.groupCount; i++) if (r[i] != null) r[i]!];

MatriculaDibujo? _espanola(String m) {
  var r = _remolque.firstMatch(m);
  if (r != null) {
    return MatriculaDibujo(TipoMatricula.remolque, _grupos(r), pais: 'E', banda: true, fondo: FondoMatricula.rojo);
  }
  r = _especial.firstMatch(m);
  if (r != null) {
    return MatriculaDibujo(TipoMatricula.especial, _grupos(r), pais: 'E', banda: true, letrasRojas: true);
  }
  r = _actual.firstMatch(m);
  if (r != null) return MatriculaDibujo(TipoMatricula.actual, _grupos(r), pais: 'E', banda: true);
  r = _antigua.firstMatch(m);
  if (r != null && _provincias.contains(r[1])) return MatriculaDibujo(TipoMatricula.antigua, _grupos(r));
  return null;
}

/// Con el país indicado: su letra, su color y su forma de separar.
MatriculaDibujo _conPais(String m, String escrita, String pais) {
  MatriculaDibujo ue(List<String> partes, {String separador = ' ', FondoMatricula fondo = FondoMatricula.blanco}) =>
      MatriculaDibujo(TipoMatricula.ue, partes, pais: pais, banda: true, separador: separador, fondo: fondo);
  if (pais == 'E') return _espanola(m) ?? ue([escrita]);
  if (pais == 'P') {
    final r = _portugal.firstMatch(m);
    if (r != null) return ue(_grupos(r), separador: '·');
  }
  if (pais == 'F' || pais == 'I') {
    final r = _aa123aa.firstMatch(m);
    if (r != null) return ue(_grupos(r), separador: pais == 'F' ? '-' : ' ');
  }
  if (pais == 'RO') {
    final r = _rumania.firstMatch(m);
    if (r != null) return ue(_grupos(r));
  }
  if (pais == 'PL') {
    final r = _polonia.firstMatch(m);
    if (r != null) return ue(_grupos(r));
  }
  // Países Bajos y Luxemburgo llevan la placa amarilla.
  return ue([escrita], fondo: pais == 'NL' || pais == 'L' ? FondoMatricula.amarillo : FondoMatricula.blanco);
}

MatriculaDibujo dibujoMatricula(String? matricula, [Object? paisIndicado]) {
  // Lo escrito, en mayúsculas y con los separadores reducidos a un espacio.
  final escrita = (matricula ?? '').trim().toUpperCase().replaceAll(RegExp(r'[\s\-.·]+'), ' ');
  final m = escrita.replaceAll(' ', '');
  final pais = paisMatriculaValido(paisIndicado);

  if (pais == fueraUe) return MatriculaDibujo(TipoMatricula.otra, [escrita], fondo: FondoMatricula.liso);
  if (pais != null) return _conPais(m, escrita, pais);

  // Automático: solo lo que no deja dudas.
  final es = _espanola(m);
  if (es != null) return es;
  var r = _portugal.firstMatch(m);
  if (r != null) return MatriculaDibujo(TipoMatricula.ue, _grupos(r), pais: 'P', banda: true, separador: '·');
  r = _rumania.firstMatch(m);
  if (r != null && (r[1] != null || _judete.contains(r[3]))) {
    return MatriculaDibujo(TipoMatricula.ue, _grupos(r), pais: 'RO', banda: true);
  }
  r = _polonia.firstMatch(m);
  if (r != null) return MatriculaDibujo(TipoMatricula.ue, _grupos(r), pais: 'PL', banda: true);

  // Con pinta de placa europea (letras y cifras, de 5 a 9 caracteres): banda
  // de la UE sin letra, porque el país no se puede saber por la forma.
  if (_pintaDePlaca.hasMatch(m) && m.contains(RegExp(r'[A-Z]')) && m.contains(RegExp(r'\d'))) {
    return MatriculaDibujo(TipoMatricula.ue, [escrita], banda: true);
  }
  return MatriculaDibujo(TipoMatricula.otra, [escrita], fondo: FondoMatricula.liso);
}
