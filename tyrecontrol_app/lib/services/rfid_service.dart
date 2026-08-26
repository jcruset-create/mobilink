import 'dart:async';

import 'tlgx_probe_service.dart';

/// Lectura de etiquetas RFID (ISO18000-6C / EPCglobal gen-2) con la sonda
/// Translogik TLGX. Protocolo G 13632 Q, sección 7.
///
/// No abre ni gestiona la conexión: se apoya en la que ya existe
/// ([TlgxProbeService] directamente, o [ProbeSession] cuando la sesión está
/// viva). Solo aporta la capa de comandos RFID: enviar, esperar respuesta,
/// controlar el tiempo de espera, cancelar y extraer el EPC.
///
/// Como el canal es único y compartido, quien recibe las líneas de la sonda
/// debe pasárselas a [manejarLinea]. Ese método solo consume respuestas RFID
/// y devuelve `false` para el resto, de modo que la profundidad y la presión
/// siguen llegando con normalidad a quien las esté esperando.
class RfidService {
  RfidService({required Future<void> Function(String cmd) enviar}) : _enviar = enviar;

  final Future<void> Function(String cmd) _enviar;

  /// Tiempo de espera por defecto de una lectura puntual. El propio lector
  /// aborta con GST según su ajuste GA; este es el tope por parte de la app.
  static const Duration timeoutPorDefecto = Duration(seconds: 12);

  /// Margen tras el GO inicial para que el lector quede libre antes del GR.
  static const Duration _pausaTrasCancelar = Duration(milliseconds: 100);

  Completer<RfidMessage>? _espera;
  bool _continuo = false;

  /// Hay una lectura en curso (puntual o continua).
  bool get leyendo => _espera != null || _continuo;

  final StreamController<RfidMessage> _ctrl = StreamController<RfidMessage>.broadcast();

  /// Todas las respuestas RFID reconocidas (útil para la lectura continua).
  Stream<RfidMessage> get onRfid => _ctrl.stream;

  /// Procesa una línea recibida de la sonda. Devuelve `true` si era una
  /// respuesta RFID (y por tanto la ha consumido esta capa).
  bool manejarLinea(String line) {
    final msg = parsearRfid(line);
    if (msg == null) return false;

    _ctrl.add(msg);

    final espera = _espera;
    if (espera != null && !espera.isCompleted) {
      // Un GO suelto es solo la confirmación del apagado previo: no cierra
      // la lectura que acabamos de pedir.
      if (msg.status == RfidStatus.cancelado) return true;
      _espera = null;
      espera.complete(msg);
    }
    return true;
  }

  /// Lee el EPC de una etiqueta (comando GR).
  ///
  /// Secuencia del protocolo: se cancela cualquier lectura anterior (GO), se
  /// deja un instante al lector, se pide la lectura (GR) y, pase lo que pase,
  /// se vuelve a enviar GO para apagar la radio y no gastar batería.
  ///
  /// Devuelve el [RfidMessage] resultante: `epc` con la etiqueta, `timeout`
  /// si no apareció ninguna, o `error` si el módulo respondió GSU.
  Future<RfidMessage> leerEpc({Duration timeout = timeoutPorDefecto}) =>
      _leerCon('GR', timeout);

  /// Lee el área TID de la etiqueta (comando GI).
  Future<RfidMessage> leerTid({Duration timeout = timeoutPorDefecto}) =>
      _leerCon('GI', timeout);

  Future<RfidMessage> _leerCon(String comando, Duration timeout) async {
    if (_espera != null) {
      throw StateError('Ya hay una lectura RFID en curso');
    }

    await _enviar('GO'); // por si quedó una lectura anterior abierta
    await Future<void>.delayed(_pausaTrasCancelar);

    final completer = Completer<RfidMessage>();
    _espera = completer;

    try {
      await _enviar(comando);
      return await completer.future.timeout(
        timeout,
        // Sin respuesta de la sonda: se trata igual que un GST del lector.
        onTimeout: () => const RfidMessage(status: RfidStatus.timeout, raw: ''),
      );
    } finally {
      _espera = null;
      // Apagar la radio RFID pase lo que pase (protocolo: conservar batería).
      try { await _enviar('GO'); } catch (_) {}
    }
  }

  /// Arranca la lectura continua (GC). Las etiquetas van llegando por
  /// [onRfid] hasta llamar a [cancelar].
  Future<void> leerContinuo() async {
    if (_continuo) return;
    await _enviar('GO');
    await Future<void>.delayed(_pausaTrasCancelar);
    await _enviar('GC');
    _continuo = true;
  }

  /// Cancela la lectura en curso y apaga el lector (GO).
  Future<void> cancelar() async {
    _continuo = false;
    final espera = _espera;
    _espera = null;
    if (espera != null && !espera.isCompleted) {
      espera.complete(const RfidMessage(status: RfidStatus.cancelado, raw: 'GO'));
    }
    await _enviar('GO');
  }

  /// Tiempo de espera del lector en segundos (GA). 0 = nunca expira.
  Future<void> fijarTimeoutLector(int segundos) => _enviar('GA$segundos');

  /// Potencia máxima admitida por el protocolo: 27 dBm.
  static const int potenciaMaxima = 2700;

  /// Potencia de emisión en centésimas de dBm (RFIDPWR2700 = 27 dBm).
  /// Es temporal: vuelve al valor por defecto al reiniciar la sonda.
  Future<void> fijarPotencia(int centesimasDbm) =>
      _enviar('RFIDPWR${_potenciaValida(centesimasDbm)}');

  /// Igual que [fijarPotencia] pero PERSISTENTE: la sonda mantiene el valor
  /// aunque se apague y se vuelva a encender.
  Future<void> fijarPotenciaPersistente(int centesimasDbm) =>
      _enviar('PERRFIDPWR${_potenciaValida(centesimasDbm)}');

  /// Pide la potencia configurada. La respuesta llega como línea normal
  /// ("RFIDPWR n") y la reconoce [parsearLinea] con clave 'rfid_pwr'.
  Future<void> leerPotencia() => _enviar('RFIDPWR');

  int _potenciaValida(int v) => v.clamp(0, potenciaMaxima);

  void dispose() {
    _ctrl.close();
  }
}
