import 'package:shared_preferences/shared_preferences.dart';

/// Ajustes locales del dispositivo que NO son sesión ni datos de trabajo:
/// qué ha aceptado ya el operario y qué quiere que la app recuerde.
///
/// Todo vive en `shared_preferences`, que es donde ya guardaba `Session` sus
/// datos no sensibles. Aquí no entra nada secreto: el token va al llavero del
/// sistema (`SecureStore`) y el PIN no se guarda en ninguna parte.
class Preferencias {
  Preferencias._();

  /// Condiciones aceptadas. Lleva versión en la clave: el día que cambie el
  /// texto de privacidad se sube a `_v2` y la pantalla se vuelve a enseñar una
  /// vez, sin tocar el resto de ajustes.
  static const _kOnboarding = 'lite_onboarding_v1';

  /// Código de taller recordado. Es un dato de organización, no una
  /// credencial: no da acceso a nada por sí solo (hacen falta usuario y PIN).
  static const _kTaller = 'lite_taller_recordado';

  /// Acceso biométrico activado por el operario en ESTE dispositivo.
  static const _kBiometria = 'lite_biometria';

  /// Ya se le ofreció activar la biometría. Preguntar en cada acceso sería
  /// justo lo contrario de quitar pulsaciones: quien dijo que no lo activa
  /// cuando quiera desde Perfil.
  static const _kBiometriaOfrecida = 'lite_biometria_ofrecida';

  static Future<SharedPreferences> get _p => SharedPreferences.getInstance();

  // ── Condiciones ────────────────────────────────────────────────────────
  static Future<bool> onboardingHecho() async =>
      (await _p).getBool(_kOnboarding) ?? false;

  static Future<void> marcarOnboarding() async =>
      (await _p).setBool(_kOnboarding, true);

  // ── Taller recordado ───────────────────────────────────────────────────
  static Future<String?> tallerRecordado() async {
    final v = (await _p).getString(_kTaller);
    return (v == null || v.isEmpty) ? null : v;
  }

  static Future<void> recordarTaller(String codigo) async {
    final c = codigo.trim();
    if (c.isEmpty) return olvidarTaller();
    await (await _p).setString(_kTaller, c);
  }

  static Future<void> olvidarTaller() async => (await _p).remove(_kTaller);

  // ── Biometría ──────────────────────────────────────────────────────────
  static Future<bool> biometriaActivada() async =>
      (await _p).getBool(_kBiometria) ?? false;

  static Future<void> activarBiometria(bool valor) async =>
      (await _p).setBool(_kBiometria, valor);

  static Future<bool> biometriaOfrecida() async =>
      (await _p).getBool(_kBiometriaOfrecida) ?? false;

  static Future<void> marcarBiometriaOfrecida() async =>
      (await _p).setBool(_kBiometriaOfrecida, true);

  /// Al cerrar sesión se olvida todo lo biométrico: la cara del móvil abría
  /// UNA sesión concreta y esa ya no existe. Si el siguiente en entrar es otro
  /// operario del taller, se le vuelve a ofrecer a él. El taller recordado NO
  /// se toca: eso es del móvil, no de la persona.
  static Future<void> olvidarBiometria() async {
    final p = await _p;
    await p.remove(_kBiometria);
    await p.remove(_kBiometriaOfrecida);
  }
}
