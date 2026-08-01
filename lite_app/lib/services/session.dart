import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Sesión del dispositivo: token opaco emitido por el backend + datos del
/// usuario y del taller. El token es lo único sensible que se guarda y vive
/// en el almacenamiento privado de la app (no se registra en logs).
class Session {
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
    await prefs.setString(_kToken, token);
    await prefs.setString(_kUser, jsonEncode(user));
    await prefs.setString(_kWorkshop, jsonEncode(workshop));
    await prefs.setString(_kConfig, jsonEncode(config));
  }

  static Future<Session?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_kToken);
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
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    await prefs.remove(_kWorkshop);
    await prefs.remove(_kConfig);
  }
}
