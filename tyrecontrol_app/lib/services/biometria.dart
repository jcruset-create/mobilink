import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Face ID / Touch ID / huella, para no pedir nombre y PIN en cada acceso.
///
/// Es la misma pieza que lleva Mobilink Assist Lite (`lite_app`), copiada tal
/// cual para que las dos apps se comporten igual.
///
/// Lo que la biometría hace aquí es **abrir la sesión que ya está guardada**,
/// no sustituir al login: la sesión de Supabase ya queda en el dispositivo al
/// entrar, y esto es la llave para usarla. Por eso no se guarda ni el PIN ni
/// ninguna contraseña: si el técnico cierra sesión, no hay nada que una cara o
/// una huella puedan recuperar.
///
/// Ninguna función lanza: un móvil sin sensor, con el sensor estropeado o con
/// la huella recién borrada tiene que dejar entrar por el camino de siempre,
/// no quedarse encallado.
class Biometria {
  Biometria._();

  static final _auth = LocalAuthentication();

  // ── Ajuste del dispositivo ──────────────────────────────────────────────

  /// Acceso biométrico activado por el técnico en ESTE dispositivo.
  static const _kActivada = 'tc_biometria';

  /// Ya se le ofreció activarlo. Preguntar en cada acceso sería justo lo
  /// contrario de quitar pulsaciones: quien dijo que no lo activa cuando
  /// quiera desde Perfil.
  static const _kOfrecida = 'tc_biometria_ofrecida';

  static Future<SharedPreferences> get _p => SharedPreferences.getInstance();

  static Future<bool> activada() async =>
      (await _p).getBool(_kActivada) ?? false;

  static Future<void> activar(bool valor) async =>
      (await _p).setBool(_kActivada, valor);

  static Future<bool> ofrecida() async =>
      (await _p).getBool(_kOfrecida) ?? false;

  static Future<void> marcarOfrecida() async =>
      (await _p).setBool(_kOfrecida, true);

  /// Al cerrar sesión: la siguiente persona que entre en esta tablet decide
  /// por sí misma, y no se encuentra el candado de la anterior.
  static Future<void> olvidar() async {
    final p = await _p;
    await p.remove(_kActivada);
    await p.remove(_kOfrecida);
  }

  // ── Sensor ──────────────────────────────────────────────────────────────

  /// ¿Hay sensor y hay algo dado de alta (cara, huella)?
  ///
  /// `isDeviceSupported` sola no basta: dice que el hardware existe, aunque el
  /// técnico no haya configurado nada. Sin `canCheckBiometrics` la petición
  /// saldría y fallaría siempre.
  static Future<bool> disponible() async {
    try {
      if (!await _auth.isDeviceSupported()) return false;
      if (!await _auth.canCheckBiometrics) return false;
      return (await _auth.getAvailableBiometrics()).isNotEmpty;
    } on PlatformException catch (e) {
      debugPrint('[biometria] no disponible: ${e.code}');
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Nombre para los botones y los avisos: en iPhone es Face ID o Touch ID
  /// según el modelo, y decir "biometría" no lo entiende nadie.
  static Future<String> nombre() async {
    try {
      final tipos = await _auth.getAvailableBiometrics();
      if (Platform.isIOS) {
        if (tipos.contains(BiometricType.face)) return 'Face ID';
        if (tipos.contains(BiometricType.fingerprint) ||
            tipos.contains(BiometricType.strong)) {
          return 'Touch ID';
        }
        return 'Face ID';
      }
      if (tipos.contains(BiometricType.face)) return 'reconocimiento facial';
      return 'huella';
    } catch (_) {
      return Platform.isIOS ? 'Face ID' : 'huella';
    }
  }

  /// Pide la identificación. Devuelve true solo si el sistema la da por buena.
  ///
  /// `persistAcrossBackgrounding` mantiene la petición viva si el técnico se
  /// va a otra app y vuelve —en carretera pasa— en vez de darla por cancelada.
  /// `biometricOnly` en false a propósito: si la cara falla tres veces, iOS
  /// ofrece el código del dispositivo, que es una salida más y no un bucle.
  static Future<bool> autenticar(String motivo) async {
    try {
      return await _auth.authenticate(
        localizedReason: motivo,
        biometricOnly: false,
        persistAcrossBackgrounding: true,
      );
    } on PlatformException catch (e) {
      // Cancelar, no tener huellas dadas de alta o quedarse bloqueado por
      // intentos fallidos NO son errores de la app: son un "no" del sistema.
      debugPrint('[biometria] ${e.code}');
      return false;
    } catch (_) {
      return false;
    }
  }
}
