import 'dart:async';
import 'dart:io' show Platform;
import 'package:device_info_plus/device_info_plus.dart';
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
  BluetoothDevice? get device => _device;

  /// Pide los permisos necesarios para escanear/conectar la sonda.
  ///
  /// En Android 12+ (API 31) el escaneo BLE NO necesita ubicación gracias al
  /// flag `neverForLocation` del manifest: basta con BLUETOOTH_SCAN/CONNECT.
  /// Solo en Android 11 o inferior el sistema operativo exige ubicación para
  /// poder escanear, así que ahí sí se pide (y únicamente ahí).
  Future<bool> pedirPermisos() async {
    if (!Platform.isAndroid) {
      final s = await Permission.bluetooth.request();
      return s.isGranted || s.isLimited;
    }

    final sdk = (await DeviceInfoPlugin().androidInfo).version.sdkInt;

    if (sdk >= 31) {
      // Android 12+: sin ubicación.
      final res = await [
        Permission.bluetoothScan,
        Permission.bluetoothConnect,
      ].request();
      return res.values.every((s) => s.isGranted);
    }

    // Android 11 o inferior: el escaneo BLE exige ubicación (limitación del SO).
    final loc = await Permission.locationWhenInUse.request();
    return loc.isGranted;
  }

  /// Nombre anunciado por el dispositivo. Durante el escaneo Android NO
  /// rellena `platformName` (llega vacío hasta que conectas/emparejas); el
  /// nombre real viaja en la publicidad BLE (`advName`). Por eso miramos
  /// primero la publicidad y solo caemos a `platformName` como respaldo.
  String _nombreDe(ScanResult r) {
    final adv = r.advertisementData.advName;
    return adv.isNotEmpty ? adv : r.device.platformName;
  }

  /// ¿Parece una sonda Translogik/Transense TLGX? La reconocemos por el
  /// UUID de servicio UART que anuncia (lo más fiable) o por el nombre.
  bool _pareceSonda(ScanResult r) {
    if (r.advertisementData.serviceUuids.contains(serviceUuid)) return true;
    final n = _nombreDe(r).toUpperCase();
    return n.startsWith('TL') || n.contains('TRANS') || n.contains('GX');
  }

  /// Escanea sondas TLGX/Translogik durante [timeout] y devuelve los
  /// resultados encontrados (para que el usuario elija). Si el filtro no
  /// acierta con ninguna, devuelve todos los dispositivos con nombre para
  /// que el técnico pueda elegir la sonda a mano.
  Future<List<ScanResult>> escanear({Duration timeout = const Duration(seconds: 12)}) async {
    if (!(await FlutterBluePlus.isSupported)) {
      throw Exception('Este dispositivo no tiene Bluetooth LE.');
    }
    if (FlutterBluePlus.adapterStateNow != BluetoothAdapterState.on) {
      throw Exception('Activa el Bluetooth para buscar la sonda.');
    }

    final Map<String, ScanResult> sondas = {};     // coinciden con el filtro
    final Map<String, ScanResult> conNombre = {};  // respaldo: cualquiera con nombre
    final sub = FlutterBluePlus.scanResults.listen((results) {
      for (final r in results) {
        if (_pareceSonda(r)) {
          sondas[r.device.remoteId.str] = r;
        } else if (_nombreDe(r).isNotEmpty) {
          conNombre[r.device.remoteId.str] = r;
        }
      }
    });

    // androidUsesFineLocation: false → no forzamos ubicación en Android 12+.
    await FlutterBluePlus.startScan(timeout: timeout, androidUsesFineLocation: false);
    await FlutterBluePlus.isScanning.where((s) => s == false).first;
    await sub.cancel();

    if (sondas.isNotEmpty) return sondas.values.toList();
    return conNombre.values.toList();
  }

  /// Conecta con una sonda concreta y prepara la comunicación (conexión
  /// manual: espera a que conecte y descubre servicios de inmediato).
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
    await _prepararComunicacion(device);
  }

  /// Conexión AUTOMÁTICA: con `autoConnect` el sistema operativo reconecta
  /// solo cuando la sonda se enciende o vuelve al alcance, sin escanear ni
  /// tocar nada. El descubrimiento de servicios se hace cuando el estado
  /// pasa a "conectado" (puede tardar: ocurre al encender la sonda).
  Future<void> conectarAuto(BluetoothDevice device) async {
    _device = device;

    _connSub?.cancel();
    _connSub = device.connectionState.listen((state) async {
      if (state == BluetoothConnectionState.connected) {
        try {
          await _prepararComunicacion(device);
        } catch (_) {
          // Si falla el descubrimiento, esperamos al próximo ciclo de conexión.
        }
      } else if (state == BluetoothConnectionState.disconnected) {
        _rx = null;
        onState(false);
      }
    });

    // mtu debe ser null con autoConnect (requisito de flutter_blue_plus).
    await device.connect(autoConnect: true, mtu: null);
  }

  /// Descubre servicios/características y activa las notificaciones. Común a
  /// la conexión manual y a la automática (tras conectar).
  Future<void> _prepararComunicacion(BluetoothDevice device) async {
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
