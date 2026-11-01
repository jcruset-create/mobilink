import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api_service.dart';

/// La posición de la tablet llega al servidor también con la pantalla
/// apagada o con el operario en otra app.
///
/// Antes la mandaba un `Timer` de la pantalla de la asistencia: en cuanto el
/// operario salía de esa pantalla, abría el navegador o bloqueaba la tablet,
/// dejaba de enviarse. Y la posición de la tablet es el respaldo cuando el GPS
/// de la furgoneta (Webfleet) falla: un respaldo que solo funciona con la
/// pantalla abierta no sirve de mucho.
///
/// Ahora es un servicio en primer plano de Android (con su notificación fija,
/// que es lo que el sistema exige para dejarlo vivo) y, en iOS, actualizaciones
/// en segundo plano. Vive mientras la asistencia esté en camino al punto o de
/// vuelta al taller, y se para solo al cambiar de estado.
class SeguimientoUbicacion {
  SeguimientoUbicacion._();
  static final SeguimientoUbicacion instancia = SeguimientoUbicacion._();

  /// Los estados en que se manda la posición: ida al punto y vuelta al taller.
  static const estadosConSeguimiento = {'en_camino', 'en_camino_base'};

  /// Una posición cada tanto como mucho: lo mismo que mandaba el `Timer`.
  static const intervalo = Duration(seconds: 30);

  StreamSubscription<Position>? _sub;
  ApiService? _api;
  int? _asistenciaId;
  DateTime? _ultimoEnvio;

  int? get asistenciaActiva => _asistenciaId;

  /// Arranca o para según la lista de asistencias del operario: se sigue la
  /// primera que esté en camino. Así, al abrir la app con una asistencia ya en
  /// marcha, el seguimiento vuelve aunque no se entre en su pantalla.
  Future<void> sincronizar(ApiService api, List<Map<String, dynamic>> asistencias) async {
    for (final a in asistencias) {
      final id = a['id'];
      if (id is int && estadosConSeguimiento.contains(a['status'])) {
        await iniciar(api, id);
        return;
      }
    }
    await detener();
  }

  /// Ajusta el seguimiento al nuevo estado de una asistencia.
  Future<void> alCambiarEstado(ApiService api, int id, String? estado) async {
    if (estadosConSeguimiento.contains(estado)) {
      await iniciar(api, id);
    } else if (_asistenciaId == id) {
      await detener();
    }
  }

  Future<void> iniciar(ApiService api, int id) async {
    _api = api;
    if (_asistenciaId == id && _sub != null) return;
    await detener();

    if (!await _permiso()) return;

    _asistenciaId = id;
    _ultimoEnvio = null;
    _sub = Geolocator.getPositionStream(locationSettings: _ajustes(id)).listen(
      _alRecibir,
      onError: (Object e) => debugPrint('Seguimiento de ubicación: $e'),
      cancelOnError: false,
    );
  }

  Future<void> detener() async {
    await _sub?.cancel();
    _sub = null;
    _asistenciaId = null;
    _ultimoEnvio = null;
  }

  Future<void> _alRecibir(Position pos) async {
    final id = _asistenciaId;
    final api = _api;
    if (id == null || api == null) return;
    final ahora = DateTime.now();
    final ultimo = _ultimoEnvio;
    // El sistema puede entregar varias posiciones de golpe al despertar: con
    // la última basta.
    if (ultimo != null && ahora.difference(ultimo) < intervalo - const Duration(seconds: 5)) {
      return;
    }
    _ultimoEnvio = ahora;
    // `sendLocation` ya guarda la posición para enviarla luego si no hay red.
    await api.sendLocation(
      id,
      pos.latitude,
      pos.longitude,
      accuracyM: pos.accuracy,
      // Geolocator la da en m/s; el resto del sistema habla en km/h
      speedKmh: pos.speed >= 0 ? pos.speed * 3.6 : null,
    );
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

  LocationSettings _ajustes(int id) {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        intervalDuration: intervalo,
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationTitle: 'Mobilink Assist',
          notificationText: 'Enviando tu ubicación de la asistencia nº $id',
          notificationChannelName: 'Ubicación de la asistencia',
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
