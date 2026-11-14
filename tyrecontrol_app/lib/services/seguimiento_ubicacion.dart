import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'supabase_service.dart';

/// La posición de la tablet llega al servidor mientras el operario tenga la
/// sesión abierta, también con la pantalla apagada o con la app de fondo.
///
/// Puerto del mismo servicio de Mobilink Assist
/// (`flutter_app/lib/services/seguimiento_ubicacion.dart`), recortado a lo que
/// aquí hace falta: allí hay dos modos porque la posición se manda a una
/// asistencia concreta cuando el operario va de camino; aquí solo existe el
/// modo general, una posición por minuto.
///
/// ── El servicio en primer plano no es un detalle técnico ────────────────────
///
/// Android exige la notificación fija para dejar que una app siga leyendo el
/// GPS con la pantalla apagada. Y hace de aviso: mientras se está enviando, el
/// operario lo ve en su barra de notificaciones. Las dos cosas a la vez, y las
/// dos convienen.
///
/// ── Lo que NO hace ──────────────────────────────────────────────────────────
///
/// No guarda recorrido. El servidor se queda solo con la última posición de
/// cada uno —la pregunta es «dónde está ahora», no «por dónde ha ido»— y la
/// borra al cerrar sesión. Si algún día hiciera falta el rastro, sería otra
/// cosa, con otras implicaciones, y habría que decidirlo aparte.
class SeguimientoUbicacion {
  SeguimientoUbicacion._();
  static final SeguimientoUbicacion instancia = SeguimientoUbicacion._();

  static const intervalo = Duration(minutes: 1);

  StreamSubscription<Position>? _sub;
  bool _activo = false;
  DateTime? _ultimoEnvio;

  /// La última posición que se leyó, para poder sellar una revisión sin
  /// esperar a que el GPS vuelva a fijar. Null si todavía no hay ninguna o si
  /// el seguimiento está parado.
  Position? _ultima;

  bool get activo => _activo;

  /// Arranca. Se llama al entrar y al reanudar la app: si ya está en marcha no
  /// hace nada, así que llamarlo de más no cuesta.
  Future<void> iniciar() async {
    if (_activo && _sub != null) return;
    await detener();
    if (!await _permiso()) return;
    _activo = true;
    _sub = Geolocator.getPositionStream(locationSettings: _ajustes()).listen(
      _alRecibir,
      onError: (Object e) => debugPrint('Seguimiento de ubicación: $e'),
      cancelOnError: false,
    );
  }

  /// Para del todo. El borrado de la posición en el servidor lo hace
  /// `TyreControlApi.signOut`, que es quien sabe que todavía hay token.
  Future<void> detener() async {
    await _sub?.cancel();
    _sub = null;
    _activo = false;
    _ultimoEnvio = null;
    _ultima = null;
  }

  /*
   * Dónde está la tablet AHORA, para sellar el principio o el final de una
   * revisión.
   *
   * Primero lo que ya tiene el seguimiento: si hay una posición de hace menos
   * de dos minutos, esa vale y no se gasta batería ni se hace esperar al
   * técnico delante del camión. Si no la hay —seguimiento parado, permiso
   * denegado, acaba de arrancar— se pide una con un tope corto.
   *
   * Nunca lanza y nunca bloquea: una revisión no se puede quedar sin guardar
   * porque el GPS no fije. Devuelve null y la revisión va sin coordenadas, que
   * es exactamente lo que pasaba antes de que esto existiera.
   */
  Future<Position?> posicionParaRevision() async {
    final ultima = _ultima;
    if (ultima != null) {
      final edad = DateTime.now().difference(ultima.timestamp);
      if (!edad.isNegative && edad < const Duration(minutes: 2)) return ultima;
    }
    try {
      if (!await _permiso()) return null;
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          // Ocho segundos: lo que se tarda en fijar en un patio a cielo
          // abierto. Más que eso, el técnico está esperando mirando la tablet.
          timeLimit: Duration(seconds: 8),
        ),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _alRecibir(Position pos) async {
    if (!_activo) return;
    _ultima = pos;
    final ahora = DateTime.now();
    final ultimo = _ultimoEnvio;
    // Al despertar, el sistema puede soltar varias posiciones de golpe: con la
    // última basta.
    if (ultimo != null && ahora.difference(ultimo) < intervalo - const Duration(seconds: 5)) {
      return;
    }
    _ultimoEnvio = ahora;
    try {
      await TyreControlApi.enviarMiUbicacion(
        lat: pos.latitude,
        lng: pos.longitude,
        precisionM: pos.accuracy,
        // Geolocator da la velocidad en m/s; aquí se habla en km/h.
        velocidadKmh: pos.speed >= 0 ? pos.speed * 3.6 : null,
        vistoAt: pos.timestamp,
      );
    } catch (_) {
      // Silencioso a propósito: esto no puede interrumpir al técnico. La
      // siguiente posición llega en un minuto.
    }
  }

  Future<bool> _permiso() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return false;
      var permiso = await Geolocator.checkPermission();
      if (permiso == LocationPermission.denied) {
        permiso = await Geolocator.requestPermission();
      }
      // «Mientras se usa la app» basta: el servicio arranca con la app
      // delante, y desde ahí el sistema lo deja seguir en segundo plano.
      return permiso == LocationPermission.whileInUse ||
          permiso == LocationPermission.always;
    } catch (_) {
      return false;
    }
  }

  LocationSettings _ajustes() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        intervalDuration: intervalo,
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Mobilink TyreControl',
          notificationText: 'Ubicación activa mientras tengas la sesión abierta',
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
