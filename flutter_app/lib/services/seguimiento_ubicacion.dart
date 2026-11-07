import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api_service.dart';

/// La posición de la tablet llega al servidor también con la pantalla
/// apagada o con el operario en otra app, mientras tenga la sesión abierta.
///
/// Dos modos:
///   - **Asistencia** (en camino al punto o de vuelta al taller): una posición
///     cada 30 s a la ruta de la asistencia. Es el respaldo del GPS de la
///     furgoneta para el seguimiento del cliente y la llegada al taller, y
///     además coloca la tablet en el Mapa flota.
///   - **General** (sesión abierta sin asistencia en camino): una posición por
///     minuto, solo para el Mapa flota.
///
/// Es un servicio en primer plano de Android (con su notificación fija, que es
/// lo que el sistema exige para dejarlo vivo, y que además deja claro al
/// operario que se está enviando) y, en iOS, actualizaciones en segundo plano.
/// Se para al cerrar sesión.
class SeguimientoUbicacion {
  SeguimientoUbicacion._();
  static final SeguimientoUbicacion instancia = SeguimientoUbicacion._();

  /// Los estados en que se manda a la asistencia: ida al punto y vuelta al taller.
  static const estadosConSeguimiento = {'en_camino', 'en_camino_base'};

  static const intervaloAsistencia = Duration(seconds: 30);
  static const intervaloGeneral = Duration(minutes: 1);

  StreamSubscription<Position>? _sub;
  ApiService? _api;
  int? _asistenciaId;
  bool _activo = false;
  DateTime? _ultimoEnvio;

  /// La asistencia a la que se manda, o null en modo general / parado.
  int? get asistenciaActiva => _asistenciaId;

  /// Si está enviando, en cualquiera de los dos modos.
  bool get activo => _activo;

  Duration get _intervalo => _asistenciaId != null ? intervaloAsistencia : intervaloGeneral;

  /// Ajusta el modo a la lista de asistencias del operario: la primera que
  /// esté en camino, o el modo general si no hay ninguna. Así, al abrir la app
  /// —o tras reiniciar la tablet— el envío se retoma solo.
  Future<void> sincronizar(ApiService api, List<Map<String, dynamic>> asistencias) async {
    for (final a in asistencias) {
      final id = a['id'];
      if (id is int && estadosConSeguimiento.contains(a['status'])) {
        await _arrancar(api, id);
        return;
      }
    }
    await _arrancar(api, null);
  }

  /// Ajusta el modo al nuevo estado de una asistencia.
  Future<void> alCambiarEstado(ApiService api, int id, String? estado) async {
    if (estadosConSeguimiento.contains(estado)) {
      await _arrancar(api, id);
    } else if (_asistenciaId == id || !_activo) {
      await _arrancar(api, null);
    }
  }

  /// Empieza a mandar a una asistencia.
  Future<void> iniciar(ApiService api, int id) => _arrancar(api, id);

  /// Para del todo: solo al cerrar sesión.
  Future<void> detener() async {
    await _sub?.cancel();
    _sub = null;
    _asistenciaId = null;
    _activo = false;
    _ultimoEnvio = null;
  }

  Future<void> _arrancar(ApiService api, int? asistenciaId) async {
    _api = api;
    if (_activo && _sub != null && _asistenciaId == asistenciaId) return;
    await detener();

    if (!await _permiso()) return;

    _asistenciaId = asistenciaId;
    _activo = true;
    _sub = Geolocator.getPositionStream(locationSettings: _ajustes(asistenciaId)).listen(
      _alRecibir,
      onError: (Object e) => debugPrint('Seguimiento de ubicación: $e'),
      cancelOnError: false,
    );
  }

  Future<void> _alRecibir(Position pos) async {
    final api = _api;
    if (!_activo || api == null) return;
    final ahora = DateTime.now();
    final ultimo = _ultimoEnvio;
    // El sistema puede entregar varias posiciones de golpe al despertar: con
    // la última basta.
    if (ultimo != null && ahora.difference(ultimo) < _intervalo - const Duration(seconds: 5)) {
      return;
    }
    _ultimoEnvio = ahora;
    // Geolocator da la velocidad en m/s; el resto del sistema habla en km/h
    final speedKmh = pos.speed >= 0 ? pos.speed * 3.6 : null;
    final id = _asistenciaId;
    if (id != null) {
      // `sendLocation` ya guarda la posición para enviarla luego si no hay
      // red, y el servidor la pone también en el Mapa flota.
      await api.sendLocation(id, pos.latitude, pos.longitude,
          accuracyM: pos.accuracy, speedKmh: speedKmh);
    } else {
      final enCamino = await api.sendTabletLocation(pos.latitude, pos.longitude,
          accuracyM: pos.accuracy, speedKmh: speedKmh);
      // La oficina ha puesto en camino una asistencia: a partir de ahora, a ella.
      if (enCamino != null && _activo && _asistenciaId == null) {
        await _arrancar(api, enCamino);
      }
    }
  }

  Future<bool> _permiso() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return false;
      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      // «Mientras se usa la app» basta: el servicio se arranca con la app
      // delante, y desde ahí el sistema lo deja seguir en segundo plano.
      return permiso == LocationPermission.whileInUse ||
          permiso == LocationPermission.always;
    } catch (_) {
      return false;
    }
  }

  LocationSettings _ajustes(int? asistenciaId) {
    final intervalo = asistenciaId != null ? intervaloAsistencia : intervaloGeneral;
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        intervalDuration: intervalo,
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationTitle: 'Mobilink Assist',
          notificationText: asistenciaId != null
              ? 'Enviando tu ubicación de la asistencia nº $asistenciaId'
              : 'Ubicación activa mientras tengas la sesión abierta',
          notificationChannelName: 'Ubicación de la tablet',
          // Sin el wakelock, con la pantalla apagada el sistema duerme y las
          // posiciones llegan todas juntas al despertar, ya tarde.
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    if (Platform.isIOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        activityType: ActivityType.automotiveNavigation,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.high);
  }
}
