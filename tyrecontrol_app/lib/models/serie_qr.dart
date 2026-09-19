/// Qué hacer con lo que devuelve el escáner de QR.
///
/// ── Por qué esto necesita cuidado ───────────────────────────────────────────
///
/// El QR de la etiqueta lleva SOLO el número de serie, en crudo. Es lo que se
/// pidió, y tiene una consecuencia que conviene no olvidar: un QR con un
/// número no se distingue de cualquier otro QR con un número. El de un palé,
/// el de una caja, el del móvil de un compañero.
///
/// Así que aquí no se «reconoce» una etiqueta de Mobilink —no hay forma—: se
/// comprueba que lo leído TIENE FORMA de número de serie y se descarta lo que
/// evidentemente no lo es. Lo demás lo hace la pantalla, enseñando lo leído en
/// el campo para que una persona lo vea antes de guardar.
class SerieQr {
  const SerieQr._(this.serie, this.aviso);

  /// El número, ya limpio. null cuando lo leído no sirve.
  final String? serie;

  /// Por qué no sirve, para poder decírselo al técnico. null si todo bien.
  final String? aviso;

  bool get valida => serie != null;

  /// Lo más largo que se admite. Un número de serie de neumático anda por los
  /// 10-13 caracteres; por encima de 40 es otra cosa.
  static const int maximo = 40;

  /// Y lo más corto. Con tres caracteres no se identifica una rueda.
  static const int minimo = 4;

  static SerieQr _malo(String aviso) => SerieQr._(null, aviso);

  /// Interpreta el contenido de un QR.
  static SerieQr leer(String? crudo) {
    final v = (crudo ?? '').trim();
    if (v.isEmpty) return _malo('El QR está vacío');

    // Un QR de herramienta o de máquina de Mobilink lleva una URL. Se dice
    // cuál es, que es más útil que «no reconocido»: quien lo escanea suele
    // tener el QR equivocado en la mano, no un QR roto.
    if (v.contains('/qr/herramienta/') || v.contains('/qr/maquina/')) {
      return _malo('Ese QR es de una herramienta o una máquina, no de un neumático');
    }
    if (v.contains('://')) {
      return _malo('Ese QR lleva una dirección de internet, no un número de serie');
    }
    if (v.contains('\n') || v.contains(' ')) {
      return _malo('Ese QR lleva un texto, no un número de serie');
    }
    if (v.length < minimo) return _malo('Lo leído es demasiado corto para ser un número de serie');
    if (v.length > maximo) return _malo('Lo leído es demasiado largo para ser un número de serie');

    // Letras, dígitos y los separadores que algún fabricante estampa. Nada más:
    // un QR con signos raros no es una etiqueta nuestra.
    final limpio = v.toUpperCase();
    if (!RegExp(r'^[A-Z0-9][A-Z0-9\-./]*$').hasMatch(limpio)) {
      return _malo('Lo leído no tiene forma de número de serie');
    }
    // Y tiene que llevar algún dígito: un número de serie sin números no lo es.
    if (!RegExp(r'[0-9]').hasMatch(limpio)) {
      return _malo('Lo leído no tiene ningún número');
    }

    return SerieQr._(limpio, null);
  }
}
