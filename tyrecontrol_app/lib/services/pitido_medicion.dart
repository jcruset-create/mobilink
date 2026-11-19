import 'dart:async';

/// El pitido con el que la sonda confirma que una medición de profundidad ha
/// quedado REGISTRADA en TyreControl.
///
/// El TLGX4 pita por su cuenta al medir, pero eso solo dice que la sonda ha
/// leído; no que la tablet haya recibido el dato y lo haya guardado. Este
/// pitido lo manda la app (`BEEP1`, protocolo TLGX Tools rev. Q, sección 12)
/// cuando ya lo tiene registrado: el técnico, agachado junto a la rueda, sabe
/// sin mirar la pantalla que puede pasar a la siguiente.
///
/// Las reglas, que son las que se prueban:
///
///   · Un pitido por medición registrada, y solo uno: cada lectura de
///     profundidad lleva su número de orden ([siguiente]) y no se pita dos
///     veces por el mismo número, se procese las veces que se procese.
///   · Solo profundidad. Quien llama es el código que registra una
///     profundidad; presión, RFID, errores y configuración no pasan por aquí.
///   · No estorba: el envío no se espera, así que la recepción de nuevas
///     lecturas sigue su curso.
///   · Si el envío falla —sonda apagada, fuera de alcance— no pasa nada: la
///     medición ya está registrada y el trabajo sigue.
///
/// No abre conexión ninguna: escribe por la que ya hay, con la función que se
/// le pasa ([ProbeSession] le da la de su `TlgxProbeService`).
class PitidoDeMedicion {
  /// Un pitido. El terminador `\n` lo añade quien envía.
  static const String comando = 'BEEP1';

  final Future<void> Function(String comando) _enviar;
  int _ultima = 0;
  int _pitada = 0;

  PitidoDeMedicion(this._enviar);

  /// El número de orden de una lectura de profundidad recién recibida.
  int siguiente() => ++_ultima;

  /// La lectura [n] ha quedado registrada: pita, si no se había pitado ya por
  /// ella. Devuelve si ha mandado el pitido.
  bool registrada(int? n) {
    if (n == null || n <= _pitada) return false;
    _pitada = n;
    // Sin `await` a propósito, y con el error tragado: ver arriba.
    unawaited(() async {
      try {
        await _enviar(comando);
      } catch (_) {/* la medición ya está guardada */}
    }());
    return true;
  }
}
