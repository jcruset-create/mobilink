import 'package:flutter/services.dart';
import 'package:local_auth/error_codes.dart' as errores;
import 'package:local_auth/local_auth.dart';

/// Cómo acabó un intento de autenticación biométrica.
///
/// Se distingue el «no ha podido» del «no ha querido» porque la pantalla los
/// trata distinto: cancelar no es un error y no debe pintar nada en rojo.
enum ResultadoBiometria {
  ok,

  /// El usuario canceló. No es un fallo: no se le enseña error.
  cancelado,

  /// La cara/huella no coincide, o se han agotado los intentos.
  fallido,

  /// El dispositivo no tiene biometría, no está enrolada, o el sistema la ha
  /// bloqueado. Aquí hay que apagar el flujo biométrico y pedir el PIN.
  noDisponible,
}

/// Envoltorio sobre `local_auth`.
///
/// Todo lo que llama al sistema puede lanzar `PlatformException`, y en un
/// móvil de flota eso pasa de verdad: biometría desactivada en Ajustes, cara
/// no enrolada, demasiados intentos fallidos. Aquí se traduce a un enum en vez
/// de dejar que la excepción suba hasta la pantalla.
class Biometria {
  static final LocalAuthentication _auth = LocalAuthentication();

  /// ¿Se puede pedir biometría AHORA mismo?
  ///
  /// Las tres condiciones son necesarias y distintas: el aparato puede
  /// soportarla (`isDeviceSupported`), tener el hardware operativo
  /// (`canCheckBiometrics`) y aun así no haber ninguna cara ni huella dada de
  /// alta (`getAvailableBiometrics` vacío). Ese último caso es el que deja el
  /// botón «Entrar con Face ID» inservible si no se comprueba.
  static Future<bool> disponible() async {
    try {
      if (!await _auth.isDeviceSupported()) return false;
      if (!await _auth.canCheckBiometrics) return false;
      final tipos = await _auth.getAvailableBiometrics();
      return tipos.isNotEmpty;
    } on PlatformException {
      return false;
    }
  }

  /// ¿Este aparato usa Face ID? Sólo sirve para elegir el icono y el texto:
  /// llamar «Face ID» a un lector de huella confunde al operario.
  static Future<bool> esFaceId() async {
    try {
      final tipos = await _auth.getAvailableBiometrics();
      return tipos.contains(BiometricType.face);
    } on PlatformException {
      return false;
    }
  }

  static Future<ResultadoBiometria> autenticar(String motivo) async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: motivo,
        options: const AuthenticationOptions(
          // Sólo biometría: si aceptáramos el código del teléfono, cualquiera
          // que conozca ese código entraría con la sesión del operario, que es
          // justo lo que esto viene a impedir.
          biometricOnly: true,
          stickyAuth: true,
          useErrorDialogs: true,
        ),
      );
      return ok ? ResultadoBiometria.ok : ResultadoBiometria.fallido;
    } on PlatformException catch (e) {
      switch (e.code) {
        case errores.notAvailable:
        case errores.notEnrolled:
        case errores.passcodeNotSet:
        case errores.lockedOut:
        case errores.permanentlyLockedOut:
          return ResultadoBiometria.noDisponible;
        default:
          // El usuario da al botón de cancelar del diálogo del sistema.
          return ResultadoBiometria.cancelado;
      }
    }
  }
}
