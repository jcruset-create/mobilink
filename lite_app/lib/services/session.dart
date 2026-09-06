import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

import 'secure_store.dart';

/// Sesión del dispositivo: token opaco emitido por el backend + datos del
/// usuario y del taller.
///
/// El token es lo único sensible y vive en el **llavero del sistema**
/// (`SecureStore`), no en `shared_preferences`. El resto —nombre del usuario,
/// taller, configuración— se queda en las preferencias: son datos de trabajo,
/// no credenciales, y ahí se leen sin coste al arrancar.
class Session {
  /// Clave del token en el llavero. La misma cadena que usaba
  /// `shared_preferences` a propósito: así la migración es leer de un sitio y
  /// escribir en el otro, sin inventar nombres nuevos.
  static const _kToken = 'lite_token';
  static const _kUser = 'lite_user';
  static const _kWorkshop = 'lite_workshop';
  static const _kConfig = 'lite_config';
  static const _kDeviceId = 'lite_device_id';

  String token;
  Map<String, dynamic> user;
  Map<String, dynamic> workshop;
  Map<String, dynamic> config;

  Session({
    required this.token,
    required this.user,
    required this.workshop,
    required this.config,
  });

  String get userName => (user['name'] ?? '').toString();
  String get role => (user['role'] ?? 'operator').toString();
  bool get isAdmin => role == 'workshop_admin';
  String get workshopName => (workshop['name'] ?? '').toString();
  int get userId => (user['id'] as num?)?.toInt() ?? 0;

  double? get workshopLat => (workshop['latitude'] as num?)?.toDouble();
  double? get workshopLng => (workshop['longitude'] as num?)?.toDouble();

  Map<String, dynamic> get features =>
      (config['features'] as Map?)?.cast<String, dynamic>() ?? const {};

  bool feature(String name) => features[name] == true;

  Map<String, dynamic> get finishRules =>
      (config['finishRules'] as Map?)?.cast<String, dynamic>() ?? const {};

  bool get trackWhileWorking => config['trackWhileWorking'] != false;

  static Future<String> deviceId() async {
    final prefs = await SharedPreferences.getInstance();
    var id = prefs.getString(_kDeviceId);
    if (id == null || id.isEmpty) {
      id = 'dev-${DateTime.now().millisecondsSinceEpoch}-'
          '${DateTime.now().microsecond}';
      await prefs.setString(_kDeviceId, id);
    }
    return id;
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await SecureStore.escribir(_kToken, token);
    await prefs.setString(_kUser, jsonEncode(user));
    await prefs.setString(_kWorkshop, jsonEncode(workshop));
    await prefs.setString(_kConfig, jsonEncode(config));
  }

  static Future<Session?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    var token = await SecureStore.leer(_kToken);

    // Migración de quien ya tenía sesión antes de que el token se mudara al
    // llavero: se pasa y se borra del sitio viejo. Sin esto, actualizar la app
    // echaría fuera a todos los operarios con una sesión abierta.
    if (token == null || token.isEmpty) {
      final antiguo = prefs.getString(_kToken);
      if (antiguo != null && antiguo.isNotEmpty) {
        await SecureStore.escribir(_kToken, antiguo);
        await prefs.remove(_kToken);
        token = antiguo;
      }
    }
    if (token == null || token.isEmpty) return null;
    Map<String, dynamic> decode(String? raw) {
      if (raw == null || raw.isEmpty) return {};
      try {
        return (jsonDecode(raw) as Map).cast<String, dynamic>();
      } catch (_) {
        return {};
      }
    }

    return Session(
      token: token,
      user: decode(prefs.getString(_kUser)),
      workshop: decode(prefs.getString(_kWorkshop)),
      config: decode(prefs.getString(_kConfig)),
    );
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    // El identificador del dispositivo se conserva: identifica al equipo,
    // no al usuario, y evita duplicar registros en cada login.
    await SecureStore.borrar(_kToken);
    // Y del sitio viejo, por si quedó algo de antes de la migración.
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    await prefs.remove(_kWorkshop);
    await prefs.remove(_kConfig);
  }
}
