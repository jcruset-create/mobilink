import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Quien hace sonar un mensaje de la oficina. Aparte de `MensajesOficina`
/// para que la lógica se pueda probar sin el sistema de notificaciones.
abstract class Avisador {
  Future<void> preparar();
  Future<void> sonar(Map<String, dynamic> mensaje);
  Future<void> quitar(int id);
  Future<void> quitarTodos();
}

/// Notificación del sistema con sonido: suena con la app delante, detrás o con
/// la pantalla apagada, y al tocarla abre la app, que enseña el mensaje a
/// pantalla completa.
class AvisadorNotificaciones implements Avisador {
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _preparado = false;
  // Los avisos puestos, para quitar solo esos: un cancelAll se llevaría por
  // delante la notificación del servicio de ubicación.
  final Set<int> _puestos = {};

  // El id de la notificación no es el del mensaje tal cual: el servicio de
  // ubicación usa un id fijo propio, y un mensaje con ese mismo número le
  // pisaría la notificación.
  static int _idNotificacion(int idMensaje) => 100000000 + (idMensaje % 100000000);

  // Un canal propio, con el sonido de aviso y máxima importancia (sale encima
  // de lo que esté haciendo el operario). El sonido de un canal no se puede
  // cambiar una vez creado: si cambia, el canal tiene que cambiar de id.
  static const _canal = AndroidNotificationDetails(
    'mensajes_oficina_v1',
    'Mensajes de la oficina',
    channelDescription: 'Avisos de la oficina durante una asistencia',
    importance: Importance.max,
    priority: Priority.max,
    playSound: true,
    sound: RawResourceAndroidNotificationSound('aviso_mensaje'),
    enableVibration: true,
    category: AndroidNotificationCategory.message,
    fullScreenIntent: true,
    visibility: NotificationVisibility.public,
    ticker: 'Mensaje de la oficina',
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
      debugPrint('Notificaciones de mensajes: $e');
    }
  }

  @override
  Future<void> sonar(Map<String, dynamic> mensaje) async {
    if (!_preparado) return;
    final id = mensaje['id'];
    if (id is! int) return;
    final urgente = mensaje['urgente'] == true || mensaje['escalado'] == true;
    try {
      await _plugin.show(
        _idNotificacion(id),
        urgente ? 'URGENTE · Mensaje de la oficina' : 'Has recibido un mensaje nuevo',
        '${mensaje['texto'] ?? ''}',
        const NotificationDetails(
          android: _canal,
          iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true, presentBanner: true),
        ),
      );
      _puestos.add(id);
    } catch (e) {
      debugPrint('Aviso de mensaje: $e');
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
    for (final id in _puestos.toList()) {
      await quitar(id);
    }
  }
}
