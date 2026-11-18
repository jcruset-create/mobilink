/// Reglas de la matrícula para el alta desde la tablet.
///
/// Antes de crear un camión nuevo hay que estar seguros de la matrícula: un
/// carácter mal leído es un vehículo duplicado que nadie encuentra después.
/// Aquí van las comprobaciones que se pueden hacer sin red; la búsqueda de
/// iguales y parecidas la hace la base (`tc_comprobar_matricula`).
library;

/// Mayúsculas y solo letras y números. La misma regla que el servidor
/// (`server/tyrecontrol/matricula.ts`) y la base (`tc_matricula_normalizada`).
String normalizarMatricula(String? valor) =>
    (valor ?? '').toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

enum FormatoMatricula {
  /// 0000BBB: cuatro números y tres consonantes (desde el 2000).
  actual,
  /// R0000BBB: remolques y semirremolques.
  remolque,
  /// M1234AB, B123456, GI1234X…: las provinciales de antes del 2000.
  provincial,
  desconocido,
}

/// Las consonantes que usa la matrícula actual: sin vocales, sin Ñ y sin Q.
const _consonantes = 'BCDFGHJKLMNPRSTVWXYZ';

final _actual = RegExp('^[0-9]{4}[$_consonantes]{3}\$');
final _remolque = RegExp('^R[0-9]{4}[$_consonantes]{3}\$');
final _provincial = RegExp(r'^[A-Z]{1,2}[0-9]{4}[A-Z]{1,2}$|^[A-Z]{1,2}[0-9]{6}$');

FormatoMatricula formatoMatricula(String matricula) {
  final m = normalizarMatricula(matricula);
  if (_actual.hasMatch(m)) return FormatoMatricula.actual;
  if (_remolque.hasMatch(m)) return FormatoMatricula.remolque;
  if (_provincial.hasMatch(m)) return FormatoMatricula.provincial;
  return FormatoMatricula.desconocido;
}

String nombreFormato(FormatoMatricula f) => switch (f) {
      FormatoMatricula.actual => 'Formato de matrícula española (4 números y 3 consonantes)',
      FormatoMatricula.remolque => 'Formato de matrícula de remolque (R, 4 números y 3 consonantes)',
      FormatoMatricula.provincial => 'Formato de matrícula provincial antigua',
      FormatoMatricula.desconocido => 'No tiene formato de matrícula española',
    };

/// Pares que la cámara confunde. Si uno aparece donde el formato pide el otro,
/// la lectura casi seguro está mal.
const _confusiones = {
  'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6', 'T': '7',
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T',
};

/// Posiciones dudosas por el propio formato, sin preguntar a nadie.
///
/// Con 7 caracteres se espera la actual (cuatro números y tres consonantes) y
/// con 8 que empiecen por R, el remolque. Una letra donde van los números, o
/// un número o una vocal donde van las letras, se marca: casi siempre es una
/// confusión de la cámara (0/O, 8/B, 1/I…).
List<int> dudososPorFormato(String matricula) {
  final m = normalizarMatricula(matricula);
  final int inicio;
  if (m.length == 7) {
    inicio = 0;
  } else if (m.length == 8 && m.startsWith('R')) {
    inicio = 1;
  } else {
    return const [];
  }
  final res = <int>[];
  for (var i = inicio; i < m.length; i++) {
    final c = m[i];
    final esNumero = RegExp(r'[0-9]').hasMatch(c);
    final enZonaNumeros = i < inicio + 4;
    if (enZonaNumeros && !esNumero && _confusiones.containsKey(c)) res.add(i);
    if (!enZonaNumeros && (esNumero || !_consonantes.contains(c))) res.add(i);
  }
  return res;
}

/// La lectura de una foto, ya juzgada: si es válida para dar de alta.
class JuicioMatricula {
  final String matricula;
  final FormatoMatricula formato;
  /// Posiciones dudosas: las que marca la IA más las que no cuadran con el
  /// formato, sin repetir y en orden.
  final List<int> dudosos;

  JuicioMatricula._(this.matricula, this.formato, this.dudosos);

  factory JuicioMatricula.de(String leida, {List<int> dudososIa = const []}) {
    final m = normalizarMatricula(leida);
    final d = <int>{
      ...dudososIa.where((i) => i >= 0 && i < m.length),
      ...dudososPorFormato(m),
    }.toList()
      ..sort();
    return JuicioMatricula._(m, formatoMatricula(m), d);
  }

  bool get formatoValido => formato != FormatoMatricula.desconocido;
  bool get sinDudas => dudosos.isEmpty;
  /// Solo se ofrece «Sí, es esta» cuando las dos cosas están bien. Si no, se
  /// repite la foto.
  bool get valeParaAlta => formatoValido && sinDudas;
}

/// Cuántas fotos fallidas hacen falta para dejar escribirla a mano.
const fotosFallidasParaTeclear = 2;

/// La matrícula como se ve en la placa: «4721 LMN», «R 1234 BCD».
String matriculaLegible(String matricula) {
  final m = normalizarMatricula(matricula);
  switch (formatoMatricula(m)) {
    case FormatoMatricula.actual:
      return '${m.substring(0, 4)} ${m.substring(4)}';
    case FormatoMatricula.remolque:
      return 'R ${m.substring(1, 5)} ${m.substring(5)}';
    default:
      return m;
  }
}
