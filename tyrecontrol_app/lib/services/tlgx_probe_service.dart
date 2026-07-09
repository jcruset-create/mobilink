import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

/// Comunicación con la sonda Translogik TLGX (TLGX2/3/4) por Bluetooth LE.
/// Protocolo G 13632: servicio UART transparente, comandos ASCII terminados
/// en Line Feed (0x0A). Las respuestas también terminan en LF/CR.
class TlgxProbeService {
  static final Guid serviceUuid = Guid('49535343-fe7d-4ae5-8fa9-9fafd205e455');
  static final Guid txUuid = Guid('49535343-1e4d-4bd9-ba61-23c647249616'); // sonda → app (notify)
  static final Guid rxUuid = Guid('49535343-8841-43f4-a8d4-ecbe34729bb3'); // app → sonda (write)

  BluetoothDevice? _device;
  BluetoothCharacteristic? _rx;
  StreamSubscription<List<int>>? _notifySub;
  StreamSubscription<BluetoothConnectionState>? _connSub;
  String _buffer = '';

  final void Function(String line) onLine;
  final void Function(bool conectada) onState;

  TlgxProbeService({required this.onLine, required this.onState});

  String get nombre => _device?.platformName ?? '';
  bool get conectada => _device != null && _rx != null;

  /// Pide permisos de Bluetooth/ubicación necesarios en Android.
  Future<bool> pedirPermisos() async {
    final res = await [
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.locationWhenInUse,
    ].request();
    return res.values.every((s) => s.isGranted || s.isLimited);
  }

  /// Escanea sondas TLGX/Translogik durante [timeout] y devuelve los
  /// resultados encontrados (para que el usuario elija).
  Future<List<ScanResult>> escanear({Duration timeout = const Duration(seconds: 8)}) async {
    if (!(await FlutterBluePlus.isSupported)) {
      throw Exception('Este dispositivo no tiene Bluetooth LE.');
    }
    if (FlutterBluePlus.adapterStateNow != BluetoothAdapterState.on) {
      throw Exception('Activa el Bluetooth para buscar la sonda.');
    }

    final Map<String, ScanResult> encontrados = {};
    final sub = FlutterBluePlus.scanResults.listen((results) {
      for (final r in results) {
        final n = r.device.platformName;
        if (n.startsWith('TL') || n.startsWith('Trans')) {
          encontrados[r.device.remoteId.str] = r;
        }
      }
    });

    await FlutterBluePlus.startScan(timeout: timeout);
    await FlutterBluePlus.isScanning.where((s) => s == false).first;
    await sub.cancel();
    return encontrados.values.toList();
  }

  /// Conecta con una sonda concreta y prepara la comunicación.
  Future<void> conectar(BluetoothDevice device) async {
    _device = device;

    _connSub?.cancel();
    _connSub = device.connectionState.listen((state) {
      if (state == BluetoothConnectionState.disconnected) {
        _rx = null;
        onState(false);
      }
    });

    await device.connect(timeout: const Duration(seconds: 15));

    final services = await device.discoverServices();
    final service = services.firstWhere(
      (s) => s.uuid == serviceUuid,
      orElse: () => throw Exception('La sonda no expone el servicio esperado.'),
    );

    BluetoothCharacteristic? tx;
    for (final c in service.characteristics) {
      if (c.uuid == txUuid) tx = c;
      if (c.uuid == rxUuid) _rx = c;
    }
    if (tx == null || _rx == null) {
      throw Exception('Características Bluetooth de la sonda no encontradas.');
    }

    await tx.setNotifyValue(true);
    _notifySub?.cancel();
    _notifySub = tx.onValueReceived.listen(_recibir);

    onState(true);
  }

  void _recibir(List<int> data) {
    _buffer += String.fromCharCodes(data);
    // Separar por LF (10) o CR (13)
    final re = RegExp(r'[\r\n]');
    int idx;
    while ((idx = _buffer.indexOf(re)) >= 0) {
      final line = _buffer.substring(0, idx).trim();
      _buffer = _buffer.substring(idx + 1);
      if (line.isNotEmpty) onLine(line);
    }
  }

  /// Envía un comando ASCII a la sonda (se añade el terminador LF).
  Future<void> enviar(String cmd) async {
    final rx = _rx;
    if (rx == null) throw Exception('Sonda no conectada');
    final bytes = '$cmd\n'.codeUnits;
    // El RX admite Write Without Response
    await rx.write(bytes, withoutResponse: rx.properties.writeWithoutResponse);
  }

  Future<void> desconectar() async {
    await _notifySub?.cancel();
    await _connSub?.cancel();
    try { await _device?.disconnect(); } catch (_) {}
    _rx = null;
    _device = null;
    onState(false);
  }
}

// ── Parseo de respuestas ─────────────────────────────────────
enum LecturaTipo { profundidad, presion, rfid, info, timeout, otro }

class LecturaSonda {
  final LecturaTipo tipo;
  final double? valor;   // mm (profundidad) o presión
  final String? texto;   // EPC del RFID o valor de info
  final String? clave;   // clave de info: modelo/version/bateria
  final String raw;
  LecturaSonda(this.tipo, {this.valor, this.texto, this.clave, required this.raw});
}

LecturaSonda parsearLinea(String line) {
  final l = line.trim();

  if (RegExp(r'^GST', caseSensitive: false).hasMatch(l)) {
    return LecturaSonda(LecturaTipo.timeout, raw: l);
  }

  final rfid = RegExp(r'^G[CR]([0-9A-Fa-f]{4,})$').firstMatch(l);
  if (rfid != null) {
    return LecturaSonda(LecturaTipo.rfid, texto: rfid.group(1)!.toUpperCase(), raw: l);
  }

  final t = RegExp(r'^T(\d+(?:\.\d+)?)$', caseSensitive: false).firstMatch(l);
  if (t != null) {
    return LecturaSonda(LecturaTipo.profundidad, valor: double.tryParse(t.group(1)!), raw: l);
  }

  final p = RegExp(r'^P(\d+(?:\.\d+)?)$', caseSensitive: false).firstMatch(l);
  if (p != null) {
    return LecturaSonda(LecturaTipo.presion, valor: double.tryParse(p.group(1)!), raw: l);
  }

  final bv = RegExp(r'^BV(\d+(?:\.\d+)?)', caseSensitive: false).firstMatch(l);
  if (bv != null) {
    return LecturaSonda(LecturaTipo.info, clave: 'bateria', texto: bv.group(1), raw: l);
  }
  if (RegExp(r'^MODSTR', caseSensitive: false).hasMatch(l)) {
    return LecturaSonda(LecturaTipo.info, clave: 'modelo', texto: l.replaceFirst(RegExp(r'^MODSTR', caseSensitive: false), ''), raw: l);
  }
  if (RegExp(r'^V\d', caseSensitive: false).hasMatch(l)) {
    return LecturaSonda(LecturaTipo.info, clave: 'version', texto: l.replaceFirst(RegExp(r'^V', caseSensitive: false), ''), raw: l);
  }

  return LecturaSonda(LecturaTipo.otro, raw: l);
}
