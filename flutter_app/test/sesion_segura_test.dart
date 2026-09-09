import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:sea_tarragona_operario/services/sesion_segura.dart';

/// Llavero de mentira: mismo contrato que el plugin, un Map por dentro.
///
/// flutter_secure_storage habla por MethodChannel con el Llavero de iOS y el
/// Keystore de Android, que en un runner de CI no existen. Se intercepta el
/// canal para poder comprobar de verdad QUÉ acaba guardado y dónde, que es lo
/// único que importa aquí.
class LlaveroFalso {
  final Map<String, String> datos = {};

  void instalar() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (call) async {
        final args = (call.arguments as Map?) ?? const {};
        final key = args['key'] as String?;
        switch (call.method) {
          case 'write':
            datos[key!] = args['value'] as String;
            return null;
          case 'read':
            return datos[key];
          case 'delete':
            datos.remove(key);
            return null;
          case 'readAll':
            return Map<String, String>.from(datos);
          case 'deleteAll':
            datos.clear();
            return null;
          case 'containsKey':
            return datos.containsKey(key);
        }
        return null;
      },
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late LlaveroFalso llavero;

  setUp(() {
    llavero = LlaveroFalso()..instalar();
  });

  group('migración desde SharedPreferences', () {
    test('saca el PIN de prefs, lo mete en el llavero y lo borra de prefs',
        () async {
      SharedPreferences.setMockInitialValues({
        'techName': 'Iván',
        'code': '4821',
        'empresaNombre': 'SEA Tarragona',
      });

      await SesionSegura.migrarDesdePrefs();

      // Está en el almacén seguro…
      final cred = await SesionSegura.leer();
      expect(cred, isNotNull);
      expect(cred!.techName, 'Iván');
      expect(cred.code, '4821');

      // …y ya NO está en texto plano. Esto es lo que veníamos a arreglar.
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('code'), isNull);

      // El nombre se queda: no es un secreto y las pantallas lo leen de ahí.
      expect(prefs.getString('techName'), 'Iván');
      expect(prefs.getString('empresaNombre'), 'SEA Tarragona');
    });

    test('es idempotente: al segundo arranque no hay nada que migrar y no '
        'pisa lo ya guardado', () async {
      SharedPreferences.setMockInitialValues({'techName': 'Iván', 'code': '4821'});
      await SesionSegura.migrarDesdePrefs();
      await SesionSegura.migrarDesdePrefs();

      final cred = await SesionSegura.leer();
      expect(cred!.code, '4821');
      expect(llavero.datos.length, 2);
    });

    test('sin PIN en prefs no toca nada', () async {
      SharedPreferences.setMockInitialValues({'techName': 'Iván'});
      await SesionSegura.migrarDesdePrefs();
      expect(await SesionSegura.leer(), isNull);
      expect(llavero.datos, isEmpty);
    });

    test('un PIN huérfano, sin nombre, se borra igual', () async {
      // No se puede reconstruir la sesión con medio dato, pero dejar el PIN
      // en claro sería quedarnos con lo peor de los dos mundos.
      SharedPreferences.setMockInitialValues({'code': '4821'});
      await SesionSegura.migrarDesdePrefs();

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('code'), isNull);
      expect(await SesionSegura.leer(), isNull);
    });
  });

  group('credenciales', () {
    test('guardar y leer', () async {
      SharedPreferences.setMockInitialValues({});
      await SesionSegura.guardar('Jesús', '1234');
      final cred = await SesionSegura.leer();
      expect(cred!.techName, 'Jesús');
      expect(cred.code, '1234');
    });

    test('media credencial no vale como credencial', () async {
      SharedPreferences.setMockInitialValues({});
      llavero.datos['sesion_tech_name'] = 'Jesús'; // sin código
      expect(await SesionSegura.leer(), isNull);

      llavero.datos.clear();
      llavero.datos['sesion_code'] = '1234'; // sin nombre
      expect(await SesionSegura.leer(), isNull);
    });

    test('borrar deja el llavero vacío', () async {
      SharedPreferences.setMockInitialValues({});
      await SesionSegura.guardar('Jesús', '1234');
      await SesionSegura.borrar();
      expect(await SesionSegura.leer(), isNull);
      expect(llavero.datos, isEmpty);
    });
  });

  group('interruptor de biometría', () {
    test('por defecto está apagado', () async {
      SharedPreferences.setMockInitialValues({});
      expect(await SesionSegura.biometriaActivada(), isFalse);
    });

    test('activar y desactivar', () async {
      SharedPreferences.setMockInitialValues({});
      await SesionSegura.activarBiometria();
      expect(await SesionSegura.biometriaActivada(), isTrue);
      await SesionSegura.desactivarBiometria();
      expect(await SesionSegura.biometriaActivada(), isFalse);
    });

    test('el interruptor NO es un secreto: no ocupa sitio en el llavero',
        () async {
      SharedPreferences.setMockInitialValues({});
      await SesionSegura.activarBiometria();
      expect(llavero.datos, isEmpty);
    });
  });

  group('cerrar sesión', () {
    test('se lleva la credencial y apaga la biometría', () async {
      SharedPreferences.setMockInitialValues({});
      await SesionSegura.guardar('Iván', '4821');
      await SesionSegura.activarBiometria();

      await SesionSegura.cerrarSesion();

      expect(await SesionSegura.leer(), isNull);
      expect(llavero.datos, isEmpty);
      // Si el interruptor sobreviviera, la pantalla de acceso ofrecería un
      // «Entrar con Face ID» que abriría la sesión recién cerrada.
      expect(await SesionSegura.biometriaActivada(), isFalse);
    });
  });
}
