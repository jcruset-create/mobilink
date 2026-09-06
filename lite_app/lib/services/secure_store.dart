import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Almacén cifrado del sistema para lo único secreto que guarda la app: el
/// token de sesión.
///
/// Antes vivía en `shared_preferences`, que en iOS es un plist en el sandbox
/// de la app y en Android un XML: cifrado por el sistema mientras el
/// dispositivo está bloqueado, pero legible desde una copia de seguridad o un
/// móvil con root. Ahora va al **llavero** (Keychain) y a Keystore, que es
/// donde tiene que estar un credencial, y más cuando la biometría abre la
/// sesión sin volver a pedir el PIN.
///
/// `first_unlock_this_device`: disponible desde el primer desbloqueo tras
/// encender —el seguimiento GPS tiene que poder seguir con la pantalla
/// bloqueada— y **sin** copia a iCloud, porque el token identifica a ESTE
/// dispositivo y la central lo revoca por dispositivo.
class SecureStore {
  SecureStore._();

  static const _almacen = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
    aOptions: AndroidOptions(),
  );

  /// Nunca lanza: un llavero que falla no puede impedir arrancar la app. Si no
  /// se puede leer, la sesión se da por no guardada y se pide login, que es lo
  /// peor que puede pasar y no deja a nadie tirado en carretera.
  static Future<String?> leer(String clave) async {
    try {
      return await _almacen.read(key: clave);
    } catch (e) {
      debugPrint('[secure] no se pudo leer $clave: $e');
      return null;
    }
  }

  static Future<void> escribir(String clave, String valor) async {
    try {
      await _almacen.write(key: clave, value: valor);
    } catch (e) {
      debugPrint('[secure] no se pudo guardar $clave: $e');
    }
  }

  static Future<void> borrar(String clave) async {
    try {
      await _almacen.delete(key: clave);
    } catch (e) {
      debugPrint('[secure] no se pudo borrar $clave: $e');
    }
  }
}
