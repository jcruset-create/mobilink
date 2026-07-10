import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'tlgx_probe_service.dart';

/// Sesión de sonda TLGX3 a nivel de app (P0-A).
///
/// A diferencia de la pantalla de prueba, esto es un singleton que mantiene
/// UNA conexión viva mientras el técnico trabaja: se conecta al empezar la
/// revisión y permanece disponible entre ruedas y entre vehículos. La
/// pantalla de revisión escucha [onLectura] para asignar cada medida a la
/// posición activa, y [ChangeNotifier] para refrescar el estado de conexión.
///
/// La presión se entrega SIEMPRE en bar (la sonda mide en psi y aquí se
/// convierte), igual que hace el resto de la app.
class ProbeSession extends ChangeNotifier {
  ProbeSession._();
  static final ProbeSession instance = ProbeSession._();

  static const double _psiABar = 0.0689476;

  TlgxProbeService? _probe;

  bool conectando = false;
  bool conectada = false;
  String nombre = '';
  String? bateria;
  String error = '';

  // Última lectura en vivo (para mostrar mientras se apoya la sonda).
  double? profundidadMm;
  double? presionBar;
  String? rfidEpc;

  final StreamController<LecturaSonda> _lecturaCtrl = StreamController<LecturaSonda>.broadcast();

  /// Cada medida recibida de la sonda (presión ya convertida a bar).
  Stream<LecturaSonda> get onLectura => _lecturaCtrl.stream;

  TlgxProbeService _asegurarProbe() =>
      _probe ??= TlgxProbeService(onLine: _onLine, onState: _onState);

  Future<bool> pedirPermisos() => _asegurarProbe().pedirPermisos();

  /// Escanea y devuelve las sondas encontradas (por si hay que elegir).
  Future<List<ScanResult>> escanear() => _asegurarProbe().escanear();

  /// Conecta la sonda. Si [device] es null, escanea y usa la de señal más
  /// fuerte. Los errores quedan en [error] (no lanza) para que la UI decida.
  Future<void> conectar({BluetoothDevice? device}) async {
    if (conectada || conectando) return;
    conectando = true;
    error = '';
    notifyListeners();

    final probe = _asegurarProbe();
    try {
      if (!await probe.pedirPermisos()) {
        throw Exception('Faltan permisos de Bluetooth.');
      }

      var target = device;
      if (target == null) {
        final res = await probe.escanear();
        if (res.isEmpty) {
          throw Exception('No se ha encontrado la sonda. Enciéndela y acércala.');
        }
        res.sort((a, b) => b.rssi.compareTo(a.rssi)); // la más cercana primero
        target = res.first.device;
      }

      await probe.conectar(target);
      nombre = probe.nombre;

      // Configura unidades y pide la batería.
      await probe.enviar('UTM'); // profundidad en mm
      await probe.enviar('UPP'); // presión en psi (la convertimos a bar)
      await probe.enviar('BV');  // voltaje de batería
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      conectando = false;
      notifyListeners();
    }
  }

  void _onLine(String line) {
    final r = parsearLinea(line);
    LecturaSonda emitir = r;
    switch (r.tipo) {
      case LecturaTipo.profundidad:
        profundidadMm = r.valor;
        break;
      case LecturaTipo.presion:
        presionBar = r.valor != null ? r.valor! * _psiABar : null;
        emitir = LecturaSonda(LecturaTipo.presion, valor: presionBar, raw: r.raw);
        break;
      case LecturaTipo.rfid:
        rfidEpc = r.texto;
        break;
      case LecturaTipo.info:
        if (r.clave == 'bateria') bateria = r.texto;
        break;
      default:
        break;
    }
    _lecturaCtrl.add(emitir);
    notifyListeners();
  }

  void _onState(bool estado) {
    conectada = estado;
    if (!estado) nombre = '';
    notifyListeners();
  }

  Future<void> desconectar() async {
    await _probe?.desconectar();
    conectada = false;
    profundidadMm = null;
    presionBar = null;
    rfidEpc = null;
    notifyListeners();
  }
}
