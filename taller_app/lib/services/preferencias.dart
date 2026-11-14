import 'package:shared_preferences/shared_preferences.dart';

import 'secure_store.dart';

/// Ajustes del dispositivo y la sesión guardada.
///
/// El nombre del operario va en `shared_preferences`, como siempre; el PIN ya
/// no: va al llavero del sistema (`SecureStore`), que es donde tiene que estar
/// un credencial, y más desde que el Face ID / la huella abre la sesión sin
/// volver a pedirlo. El PIN que hubiera en preferencias de versiones
/// anteriores se mueve al llavero la primera vez y se borra de ahí.
class Preferencias {
  Preferencias._();

  static const _kTech = 'techName';
  static const _kCodeAntiguo = 'code';
  static const _kCodeSeguro = 'taller_pin';

  /// Acceso biométrico activado por el operario en ESTE dispositivo.
  static const _kBiometria = 'taller_biometria';

  /// Ya se le ofreció activar la biometría: no se pregunta en cada acceso.
  static const _kBiometriaOfrecida = 'taller_biometria_ofrecida';

  static Future<SharedPreferences> get _p => SharedPreferences.getInstance();

  // ── Sesión ─────────────────────────────────────────────────────────────
  static Future<void> guardarSesion(String techName, String code) async {
    final p = await _p;
    await p.setString(_kTech, techName);
    await p.remove(_kCodeAntiguo);
    await SecureStore.escribir(_kCodeSeguro, code);
  }

  /// (nombre, PIN) o null si no hay sesión guardada.
  static Future<({String techName, String code})?> sesionGuardada() async {
    final p = await _p;
    final tech = p.getString(_kTech) ?? '';
    if (tech.isEmpty) return null;
    var code = await SecureStore.leer(_kCodeSeguro) ?? '';
    if (code.isEmpty) {
      // Migración desde versiones que lo guardaban en preferencias.
      code = p.getString(_kCodeAntiguo) ?? '';
      if (code.isNotEmpty) {
        await SecureStore.escribir(_kCodeSeguro, code);
        await p.remove(_kCodeAntiguo);
      }
    }
    if (code.isEmpty) return null;
    return (techName: tech, code: code);
  }

  static Future<void> borrarSesion() async {
    final p = await _p;
    await p.remove(_kTech);
    await p.remove(_kCodeAntiguo);
    await SecureStore.borrar(_kCodeSeguro);
  }

  // ── Biometría ──────────────────────────────────────────────────────────
  static Future<bool> biometriaActivada() async =>
      (await _p).getBool(_kBiometria) ?? false;

  static Future<void> activarBiometria(bool valor) async =>
      (await _p).setBool(_kBiometria, valor);

  static Future<bool> biometriaOfrecida() async =>
      (await _p).getBool(_kBiometriaOfrecida) ?? false;

  static Future<void> marcarBiometriaOfrecida() async =>
      (await _p).setBool(_kBiometriaOfrecida, true);

  /// Al salir se olvida lo biométrico: la cara abría UNA sesión concreta y esa
  /// ya no existe. Si entra otro operario, se le vuelve a ofrecer a él.
  static Future<void> olvidarBiometria() async {
    final p = await _p;
    await p.remove(_kBiometria);
    await p.remove(_kBiometriaOfrecida);
  }
}
