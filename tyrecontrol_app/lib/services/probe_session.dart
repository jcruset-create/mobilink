import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'offline_store.dart';
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
  bool autoReconectando = false; // esperando a que la sonda guardada aparezca

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
      // Recordamos esta sonda como predeterminada para autoconectar luego.
      await guardarPredeterminada(target, nombre);
      // Las unidades se configuran en _onState al confirmarse la conexión.
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      conectando = false;
      notifyListeners();
    }
  }

  // ── Sonda predeterminada (persistencia + autoconexión) ───────
  static const _kSonda = 'sonda_predeterminada';

  /// {remoteId, nombre, serie} de la sonda recordada, o null.
  Map<String, dynamic>? sondaPredeterminada() {
    final raw = OfflineStore.cachedJson(_kSonda);
    return raw is Map ? Map<String, dynamic>.from(raw) : null;
  }

  Future<void> guardarPredeterminada(BluetoothDevice device, String nombre, {String? serie}) async {
    await OfflineStore.cacheJson(_kSonda, {
      'remoteId': device.remoteId.str,
      'nombre': nombre,
      if (serie != null && serie.trim().isNotEmpty) 'serie': serie.trim(),
    });
    notifyListeners();
  }

  /// Guarda solo la serie/nombre esperado (para cuando aún no se ha conectado).
  Future<void> guardarSerieEsperada(String serie) async {
    final actual = sondaPredeterminada() ?? {};
    actual['serie'] = serie.trim();
    await OfflineStore.cacheJson(_kSonda, actual);
    notifyListeners();
  }

  Future<void> olvidarPredeterminada() async {
    await OfflineStore.cacheJson(_kSonda, null);
    notifyListeners();
  }

  /// Intenta reconectar la sonda guardada SIN intervención del técnico. Con
  /// `autoConnect`, el sistema la enlaza en cuanto se enciende. No bloquea ni
  /// muestra errores: es best-effort al abrir la app.
  Future<void> autoReconectar() async {
    if (conectada || conectando || autoReconectando) return;
    final saved = sondaPredeterminada();
    final remoteId = saved?['remoteId'] as String?;
    if (remoteId == null || remoteId.isEmpty) return;

    autoReconectando = true;
    notifyListeners();
    try {
      final probe = _asegurarProbe();
      if (!await probe.pedirPermisos()) return;
      nombre = (saved?['nombre'] as String?) ?? '';
      await probe.conectarAuto(BluetoothDevice.fromId(remoteId));
    } catch (_) {
      // Sin permisos / BT apagado: se reintenta la próxima vez que se abra.
    } finally {
      autoReconectando = false;
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
    if (estado) {
      autoReconectando = false;
      if (_probe != null && _probe!.nombre.isNotEmpty) nombre = _probe!.nombre;
      // Configura unidades y pide batería en cuanto la sonda está lista
      // (también tras una reconexión automática al encenderla).
      _configurarUnidades();
    } else {
      nombre = '';
    }
    notifyListeners();
  }

  Future<void> _configurarUnidades() async {
    final probe = _probe;
    if (probe == null) return;
    try {
      await probe.enviar('UTM'); // profundidad en mm
      await probe.enviar('UPP'); // presión en psi (se convierte a bar)
      await probe.enviar('BV');  // voltaje de batería
    } catch (_) {/* la conexión aún no está lista; se reintenta al reconectar */}
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
