import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Quien hace sonar un aviso de la central.
///
/// Está separado de `MensajesCentral` a propósito: así la lógica de cuándo
/// suena y cuándo repite se prueba sin el sistema de notificaciones, que en un
/// test no existe. Es el mismo reparto que en Assist Pro
/// (`flutter_app/lib/services/avisador_mensajes.dart`).
abstract class Avisador {
  Future<void> preparar();
  Future<void> sonar(Map<String, dynamic> mensaje);
  Future<void> quitar(int id);
  Future<void> quitarTodos();
}

/// Notificación del sistema con sonido propio: suena con la app delante,
/// detrás o con la pantalla apagada, y al tocarla abre la app, que enseña el
/// aviso a pantalla completa.
///
/// **El texto del mensaje no va en la notificación.** Solo el expediente. Es
/// la misma regla que el push de Central (`services/push.dart`): el contenido
/// se lee dentro de la app, ya autenticado, y no en la pantalla de bloqueo de
/// un móvil que se presta o se pierde.
class AvisadorNotificaciones implements Avisador {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _preparado = false;

  /// Los avisos puestos, para quitar solo esos: un `cancelAll` se llevaría por
  /// delante la notificación del servicio de ubicación.
  final Set<int> _puestos = {};

  /// El id de la notificación no es el del mensaje tal cual: el servicio de
  /// ubicación usa un id fijo propio y un mensaje con ese mismo número le
  /// pisaría la notificación.
  static int _idNotificacion(int idMensaje) => 100000000 + (idMensaje % 100000000);

  /// Canal propio, con el sonido de aviso y la máxima importancia, para que
  /// salga por encima de lo que esté haciendo el operario.
  ///
  /// Dos cosas que no son un descuido:
  ///
  /// * **Sin `fullScreenIntent`.** Desde Android 14 eso exige el permiso
  ///   `USE_FULL_SCREEN_INTENT`, reservado a despertadores y llamadas, y Play
  ///   lo revisa. La pantalla completa la pone la propia app
  ///   (`widgets/aviso_mensaje.dart`) cuando está abierta, que es el caso
  ///   normal: el operario está trabajando en ella.
  /// * **`visibility: secret`.** En la pantalla de bloqueo no sale ni el
  ///   expediente. Suena, vibra, y para verlo hay que desbloquear.
  ///
  /// El sonido de un canal no se puede cambiar una vez creado: si cambia, el
  /// canal tiene que cambiar de id (de ahí el `_v1`).
  static const _canal = AndroidNotificationDetails(
    'mensajes_central_v1',
    'Mensajes de la central',
    channelDescription: 'Avisos de la central durante una asistencia',
    importance: Importance.max,
    priority: Priority.max,
    playSound: true,
    sound: RawResourceAndroidNotificationSound('aviso_mensaje'),
    enableVibration: true,
    category: AndroidNotificationCategory.message,
    visibility: NotificationVisibility.secret,
    ticker: 'Mensaje de la central',
  );

  static const _canalIos = DarwinNotificationDetails(
    presentAlert: true,
    presentSound: true,
    presentBanner: true,
  );

  @override
  Future<void> preparar() async {
    if (_preparado) return;
    try {
      await _plugin.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
      );
      if (Platform.isAndroid) {
        await _plugin
            .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
            ?.requestNotificationsPermission();
      }
      _preparado = true;
    } catch (e) {
      // Sin notificaciones la app sigue trabajando: el aviso a pantalla
      // completa no depende de esto, solo el sonido con la app en segundo
      // plano. Un fallo aquí no puede dejar al operario sin app.
      debugPrint('[avisador] no disponible: $e');
    }
  }

  @override
  Future<void> sonar(Map<String, dynamic> mensaje) async {
    if (!_preparado) return;
    final id = mensaje['id'];
    if (id is! int) return;
    final urgente = mensaje['urgent'] == true || mensaje['escalado'] == true;
    final expediente = mensaje['expedientNumber']?.toString();
    try {
      await _plugin.show(
        _idNotificacion(id),
        urgente ? '⚠ URGENTE · Mensaje de la central' : 'Mensaje de la central',
        expediente != null && expediente.isNotEmpty
            ? '$expediente · Abre la app para leerlo'
            : 'Abre la app para leerlo',
        const NotificationDetails(android: _canal, iOS: _canalIos),
      );
      _puestos.add(id);
    } catch (e) {
      debugPrint('[avisador] aviso $id: $e');
    }
  }

  @override
  Future<void> quitar(int id) async {
    if (!_preparado) return;
    _puestos.remove(id);
    try {
      await _plugin.cancel(_idNotificacion(id));
    } catch (_) {}
  }

  @override
  Future<void> quitarTodos() async {
    if (!_preparado) return;
    final ids = _puestos.toList();
    _puestos.clear();
    for (final id in ids) {
      try {
        await _plugin.cancel(_idNotificacion(id));
      } catch (_) {}
    }
  }
}
