import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Avisos push de Central Pro (Firebase Cloud Messaging).
///
/// El backend ya enviaba desde `server/core/push.ts` y guardaba el token en
/// `connect_lite_devices.fcmToken`; esto es el lado que faltaba, el que recibe.
///
/// Reglas que se respetan aquí:
///
/// * La notificación **solo trae identificadores** (`type`, `assistanceId`).
///   El detalle se descarga de la API con la sesión ya validada, así que un
///   aviso interceptado no filtra datos del cliente ni del vehículo.
/// * Si Firebase no está configurado (falta `google-services.json`), la app
///   **sigue funcionando**: se queda con el sondeo de la bandeja. Un fallo de
///   avisos nunca puede impedir trabajar en carretera.
class Push {
  Push._();

  /// Avisos recibidos, ya sea en primer plano o al tocar la notificación.
  /// La bandeja escucha aquí para refrescarse y, si procede, abrir la ficha.
  static final _controller = StreamController<PushEvent>.broadcast();
  static Stream<PushEvent> get events => _controller.stream;

  static bool _iniciado = false;
  static bool _disponible = false;
  static String? _token;

  /// ¿Hay push de verdad? La bandeja lo usa para decidir cada cuánto sondea.
  static bool get disponible => _disponible;
  static String? get token => _token;

  /// Permiso de notificaciones, tal y como se guarda en el dispositivo:
  /// granted | denied | provisional | unknown.
  static String _permiso = 'unknown';
  static String get permiso => _permiso;

  /// Arranca Firebase y deja la app escuchando. Nunca lanza: si algo falla se
  /// deja constancia y se sigue sin push.
  static Future<void> init() async {
    if (_iniciado) return;
    _iniciado = true;
    try {
      await Firebase.initializeApp();
      final messaging = FirebaseMessaging.instance;

      // Android 13+ exige permiso explícito; en versiones anteriores se
      // concede solo. Se pide aquí y no en el arranque en frío para que el
      // operario ya sepa qué es la app cuando el sistema le pregunte.
      final ajustes = await messaging.requestPermission();
      _permiso = switch (ajustes.authorizationStatus) {
        AuthorizationStatus.authorized => 'granted',
        AuthorizationStatus.provisional => 'provisional',
        AuthorizationStatus.denied => 'denied',
        _ => 'unknown',
      };

      _token = await messaging.getToken();
      _disponible = _token != null;

      // Token nuevo (reinstalación, restauración, limpieza de datos): hay que
      // decírselo al backend o los avisos se van a un dispositivo que ya no
      // existe.
      messaging.onTokenRefresh.listen((t) {
        _token = t;
        _disponible = true;
        _controller.add(PushEvent.tokenRenovado(t));
      });

      // Aviso con la app abierta: no se pinta notificación del sistema, se
      // refresca la bandeja, que es menos intrusivo y más útil.
      FirebaseMessaging.onMessage.listen(
        (m) => _controller.add(PushEvent.deMensaje(m, abrir: false)),
      );

      // El operario ha tocado la notificación con la app en segundo plano.
      FirebaseMessaging.onMessageOpenedApp.listen(
        (m) => _controller.add(PushEvent.deMensaje(m, abrir: true)),
      );

      // La app estaba cerrada del todo y se ha abierto desde la notificación.
      final inicial = await messaging.getInitialMessage();
      if (inicial != null) {
        // Con retardo para que la bandeja esté ya escuchando cuando llegue.
        Future<void>.delayed(const Duration(milliseconds: 400), () {
          _controller.add(PushEvent.deMensaje(inicial, abrir: true));
        });
      }
    } catch (e) {
      _disponible = false;
      debugPrint('[push] no disponible: $e');
    }
  }
}

/// Aviso ya interpretado: qué ha pasado, sobre qué asistencia, y si hay que
/// abrirla porque el operario ha tocado la notificación.
class PushEvent {
  const PushEvent({
    required this.type,
    this.assistanceId,
    this.abrir = false,
    this.token,
  });

  /// assistance_assigned | assistance_updated | assistance_cancelled |
  /// assistance_message | token_refresh
  final String type;
  final int? assistanceId;
  final bool abrir;
  final String? token;

  factory PushEvent.deMensaje(RemoteMessage m, {required bool abrir}) {
    final data = m.data;
    final id = int.tryParse('${data['assistanceId'] ?? ''}');
    return PushEvent(
      type: '${data['type'] ?? 'unknown'}',
      assistanceId: id,
      abrir: abrir,
    );
  }

  factory PushEvent.tokenRenovado(String token) =>
      PushEvent(type: 'token_refresh', token: token);
}
