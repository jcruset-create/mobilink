import 'dart:async';
import 'dart:io' show Platform;

import 'package:geolocator/geolocator.dart';
import 'api.dart';
import 'queue.dart';

/// Estados en los que se comparte ubicación. Debe coincidir con
/// server/connect/liteRules.ts (shouldTrack): fuera de estos estados NO se
/// hace seguimiento, es un compromiso de privacidad con el operario.
const _trackingStatuses = {
  'en_route',
  'arrived',
  'in_progress',
  'returning_to_workshop',
};

class TrackerState {
  final bool active;
  final int assistanceId;
  final String status;
  final Position? last;
  final String? suggestion; // estado sugerido por geovalla
  final int? distanceM;
  final bool offline;

  const TrackerState({
    required this.active,
    this.assistanceId = 0,
    this.status = '',
    this.last,
    this.suggestion,
    this.distanceM,
    this.offline = false,
  });
}

/// Seguimiento GPS del operario durante una asistencia activa.
///
/// - Solo funciona con una asistencia activa y en los estados de arriba.
/// - La cadencia se adapta a la velocidad (parado espacia, en marcha afina).
/// - Sin cobertura, las posiciones se acumulan en la cola local y se envían
///   agrupadas al recuperar la conexión.
class Tracker {
  Tracker(this._api);

  final Api _api;
  StreamSubscription<Position>? _sub;
  Timer? _ticker;
  int _assistanceId = 0;
  String _status = '';
  bool _trackWhileWorking = true;
  Position? _last;
  int _lastSentMs = 0;
  int _intervalSec = 30;
  int _ultimaPosicionMs = 0;

  final _controller = StreamController<TrackerState>.broadcast();
  Stream<TrackerState> get stream => _controller.stream;
  bool get isActive => _sub != null;
  int get assistanceId => _assistanceId;

  static bool shouldTrack(String status, {bool trackWhileWorking = true}) {
    if (status == 'in_progress' && !trackWhileWorking) return false;
    return _trackingStatuses.contains(status);
  }

  /// Comprueba y solicita permisos. Devuelve el estado para poder mostrarlo
  /// en el perfil y enviarlo al backend.
  static Future<String> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) return 'service_disabled';
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
    switch (p) {
      case LocationPermission.always:
        return 'always';
      case LocationPermission.whileInUse:
        return 'while_in_use';
      case LocationPermission.deniedForever:
        return 'denied_forever';
      default:
        return 'denied';
    }
  }

  static Future<Position?> currentPosition() async {
    try {
      final perm = await ensurePermission();
      if (perm == 'denied' || perm == 'denied_forever' || perm == 'service_disabled') {
        return null;
      }
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 12));
    } catch (_) {
      return null;
    }
  }

  static Map<String, dynamic> pointOf(Position p) => {
        'lat': p.latitude,
        'lng': p.longitude,
        'ts': p.timestamp.millisecondsSinceEpoch,
        'accuracyM': p.accuracy,
        'speedKmh': p.speed * 3.6,
        'headingDeg': p.heading,
      };

  /// Arranca o detiene el seguimiento según el estado de la asistencia.
  Future<void> sync(int assistanceId, String status, {bool trackWhileWorking = true}) async {
    _trackWhileWorking = trackWhileWorking;
    if (!shouldTrack(status, trackWhileWorking: trackWhileWorking)) {
      await stop();
      return;
    }
    _assistanceId = assistanceId;
    _status = status;
    if (_sub != null) return; // ya en marcha
    await start();
  }

  Future<void> start() async {
    final perm = await ensurePermission();
    if (perm == 'denied' || perm == 'denied_forever' || perm == 'service_disabled') {
      _controller.add(const TrackerState(active: false));
      return;
    }
    _sub = Geolocator.getPositionStream(
      locationSettings: _ajustes(),
    ).listen(
      _onPosition,
      // El flujo se puede cortar solo: si Android mata la actividad y la
      // recrea, o si el usuario desactiva y reactiva la ubicación. Antes se
      // tragaba el error y el seguimiento se quedaba muerto sin que nadie lo
      // supiera; ahora el latido lo levanta.
      onError: (_) => _sub = null,
      onDone: () => _sub = null,
      cancelOnError: true,
    );
    _ultimaPosicionMs = DateTime.now().millisecondsSinceEpoch;
    // Latido: garantiza envíos periódicos aunque el operario esté parado, y
    // vigila que el flujo siga vivo.
    _ticker = Timer.periodic(const Duration(seconds: 20), (_) {
      _vigilar();
      if (_last != null) _maybeSend(_last!);
    });
    _controller.add(TrackerState(active: true, assistanceId: _assistanceId, status: _status));
  }

  /// Ajustes del flujo de posiciones.
  ///
  /// En Android se arranca como **servicio en primer plano** con notificación
  /// persistente. Sin él, el sistema deja de entregar posiciones a los pocos
  /// minutos de bloquear la pantalla, que es exactamente lo que hace un
  /// operario mientras conduce: el rastro llegaba a Central con agujeros.
  ///
  /// El servicio lo arranca el propio `geolocator` (`GeolocatorLocationService`,
  /// ya declarado con `foregroundServiceType="location"` en su manifiesto), así
  /// que no hace falta ninguna dependencia de pago. Como se arranca con la app
  /// en primer plano —el operario acaba de pulsar "En camino"—, basta con el
  /// permiso de ubicación "mientras se usa la app" y no hace falta el de
  /// segundo plano.
  ///
  /// La notificación no se puede ocultar (`setOngoing`), y eso es intencionado:
  /// es el aviso permanente de que se está compartiendo ubicación.
  LocationSettings _ajustes() {
    if (!Platform.isAndroid) {
      return const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 15,
      );
    }
    return AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 15,
      // El sistema entrega como mucho una posición cada 10 s; el filtrado fino
      // por velocidad lo hace `_intervalFor` antes de enviar a Central.
      intervalDuration: const Duration(seconds: 10),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'Mobilink Assist Lite',
        notificationText: 'Compartiendo ubicación durante la asistencia',
        notificationChannelName: 'Seguimiento de asistencias',
        // Sin wakelock el sistema duerme entre posiciones y las entrega todas
        // de golpe al despertar: el rastro llega, pero tarde y a saltos.
        enableWakeLock: true,
        setOngoing: true,
      ),
    );
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    _ticker?.cancel();
    _ticker = null;
    _assistanceId = 0;
    _controller.add(const TrackerState(active: false));
  }

  void _onPosition(Position p) {
    _last = p;
    _ultimaPosicionMs = DateTime.now().millisecondsSinceEpoch;
    _maybeSend(p);
  }

  /// Vuelve a abrir el flujo si se ha caído.
  ///
  /// El servicio en primer plano evita que Android corte el GPS con la pantalla
  /// bloqueada, pero no impide que el sistema mate la actividad si va justo de
  /// memoria. En ese caso el flujo muere en silencio y el rastro se queda a
  /// medias, que es justo lo que se quería arreglar.
  ///
  /// El silencio solo cuenta como avería en los estados de movimiento: parado
  /// en el punto de la avería es normal que no llegue ninguna posición nueva
  /// con el filtro de 15 m, y reabrir el flujo cada tres minutos solo serviría
  /// para parpadear la notificación y gastar batería.
  void _vigilar() {
    if (_assistanceId == 0) return;
    if (!shouldTrack(_status, trackWhileWorking: _trackWhileWorking)) return;

    final enMovimiento = _status == 'en_route' || _status == 'returning_to_workshop';
    final mudoMs = DateTime.now().millisecondsSinceEpoch - _ultimaPosicionMs;
    final caido = _sub == null || (enMovimiento && mudoMs > 180_000);
    if (!caido) return;

    _sub?.cancel();
    _sub = null;
    _ticker?.cancel();
    _ticker = null;
    start();
  }

  int _intervalFor(double speedKmh) {
    if (_status == 'arrived' || _status == 'in_progress') return 120;
    if (speedKmh < 3) return 60;
    if (speedKmh < 30) return 30;
    return 15;
  }

  Future<void> _maybeSend(Position p) async {
    // Doble comprobación: si el estado ya no admite seguimiento (o el taller
    // no rastrea mientras se trabaja), no se envía nada.
    if (!shouldTrack(_status, trackWhileWorking: _trackWhileWorking)) {
      await stop();
      return;
    }
    final now = DateTime.now().millisecondsSinceEpoch;
    _intervalSec = _intervalFor(p.speed * 3.6);
    if (now - _lastSentMs < _intervalSec * 1000) return;
    _lastSentMs = now;

    final point = pointOf(p);
    try {
      final res = await _api.sendLocation(_assistanceId, point);
      final hint = res['hint'] as Map?;
      _controller.add(TrackerState(
        active: true,
        assistanceId: _assistanceId,
        status: _status,
        last: p,
        suggestion: hint?['suggest'] as String?,
        distanceM: (hint?['distanceM'] as num?)?.toInt(),
      ));
    } on OfflineError {
      await OfflineQueue.addLocation(_assistanceId, point);
      _controller.add(TrackerState(
        active: true, assistanceId: _assistanceId, status: _status, last: p, offline: true,
      ));
    } on ApiError catch (e) {
      // 404/403: la asistencia ya no es nuestra → dejar de rastrear
      if (e.statusCode == 404 || e.isAuth) await stop();
    } catch (_) {
      await OfflineQueue.addLocation(_assistanceId, point);
    }
  }

  void dispose() {
    _sub?.cancel();
    _ticker?.cancel();
    _controller.close();
  }
}
