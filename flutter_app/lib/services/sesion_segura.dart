import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Credenciales del operario: lo que el backend pide para abrir sesión.
class Credenciales {
  final String techName;
  final String code;
  const Credenciales(this.techName, this.code);
}

/// Dónde vive la credencial del operario.
///
/// Antes vivía en SharedPreferences —`prefs.setString('code', pin)`—, que en
/// iOS es un plist dentro del sandbox y en Android un XML: texto plano en los
/// dos casos. Cualquiera con acceso al backup del dispositivo leía el PIN.
///
/// Ahora vive en el Llavero de iOS y en el Keystore de Android, que es para lo
/// que están. Esto vale para TODOS los operarios, activen o no el Face ID: es
/// una corrección de seguridad que no depende de la biometría.
class SesionSegura {
  static const _almacen = FlutterSecureStorage(
    // Sin `first_unlock` a secas: `_this_device` impide que la credencial
    // viaje al Llavero de iCloud y acabe en otro teléfono del mismo Apple ID.
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _kNombre = 'sesion_tech_name';
  static const _kCodigo = 'sesion_code';

  /// El interruptor NO es un secreto: es una preferencia. Va en prefs, que es
  /// donde van las preferencias, y así leerlo en el arranque no despierta al
  /// Llavero ni puede fallar por él.
  static const _kBiometria = 'biometriaActivada';

  // ── Credenciales ────────────────────────────────────────────────────

  static Future<void> guardar(String techName, String code) async {
    await _almacen.write(key: _kNombre, value: techName);
    await _almacen.write(key: _kCodigo, value: code);
  }

  static Future<Credenciales?> leer() async {
    final nombre = await _almacen.read(key: _kNombre);
    final codigo = await _almacen.read(key: _kCodigo);
    if (nombre == null || nombre.isEmpty) return null;
    if (codigo == null || codigo.isEmpty) return null;
    return Credenciales(nombre, codigo);
  }

  static Future<void> borrar() async {
    await _almacen.delete(key: _kNombre);
    await _almacen.delete(key: _kCodigo);
  }

  // ── Interruptor de biometría ────────────────────────────────────────

  static Future<bool> biometriaActivada() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kBiometria) ?? false;
  }

  static Future<void> activarBiometria() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kBiometria, true);
  }

  static Future<void> desactivarBiometria() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kBiometria);
  }

  // ── Migración desde el almacenamiento en claro ──────────────────────

  /// Mueve el PIN que estaba en SharedPreferences al almacén seguro y lo
  /// BORRA de allí. Se ejecuta en el arranque, una sola vez por instalación:
  /// al segundo arranque ya no queda nada que migrar.
  ///
  /// `techName` se deja donde está a propósito: no es un secreto, y las
  /// pantallas lo leen de prefs para pintar la cabecera.
  static Future<void> migrarDesdePrefs() async {
    final prefs = await SharedPreferences.getInstance();
    final codigo = prefs.getString('code');
    if (codigo == null || codigo.isEmpty) return;

    final nombre = prefs.getString('techName') ?? '';
    if (nombre.isNotEmpty) {
      await guardar(nombre, codigo);
    }
    // Se borra aunque no hubiera nombre: un PIN suelto en claro no aporta
    // nada y es exactamente lo que veníamos a quitar.
    await prefs.remove('code');
  }

  /// Cerrar sesión: fuera la credencial y fuera el interruptor.
  ///
  /// El interruptor cae también porque queda huérfano —sin credencial no hay
  /// nada que desbloquear— y dejarlo puesto haría que la pantalla de acceso
  /// ofreciera un «Entrar con Face ID» que no puede funcionar.
  static Future<void> cerrarSesion() async {
    await borrar();
    await desactivarBiometria();
  }
}
