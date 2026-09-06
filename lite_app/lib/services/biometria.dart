import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

/// Face ID / Touch ID / huella, para no pedir usuario y PIN en cada acceso.
///
/// Lo que la biometría hace aquí es **abrir la sesión que ya está guardada**,
/// no sustituir al login: el token vive en el llavero del sistema
/// (`SecureStore`) y esto es la llave para usarlo. Por eso no se guarda ni el
/// PIN ni ninguna contraseña: si el operario cierra sesión, no hay nada que
/// una huella pueda recuperar.
///
/// Ninguna función lanza: un móvil sin sensor, con el sensor estropeado o con
/// la huella recién borrada tiene que dejar entrar por el camino de siempre,
/// no quedarse encallado.
class Biometria {
  Biometria._();

  static final _auth = LocalAuthentication();

  /// ¿Hay sensor y hay algo dado de alta (cara, huella)?
  ///
  /// `isDeviceSupported` sola no basta: dice que el hardware existe, aunque el
  /// operario no haya configurado nada. Sin `canCheckBiometrics` la petición
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
  /// `persistAcrossBackgrounding` mantiene la petición viva si el operario se
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
