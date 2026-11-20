// El pitido con el que la sonda confirma una profundidad registrada.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/pitido_medicion.dart';
import 'package:tyrecontrol_app/services/tlgx_probe_service.dart';

void main() {
  group('PitidoDeMedicion', () {
    late List<String> enviados;
    late PitidoDeMedicion pitido;

    setUp(() {
      enviados = [];
      pitido = PitidoDeMedicion((cmd) async => enviados.add(cmd));
    });

    test('una medición registrada, un BEEP1', () async {
      final n = pitido.siguiente();
      expect(pitido.registrada(n), isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(enviados, ['BEEP1']);
    });

    test('procesar dos veces la misma medición no pita dos veces', () async {
      final n = pitido.siguiente();
      pitido.registrada(n);
      expect(pitido.registrada(n), isFalse);
      await Future<void>.delayed(Duration.zero);
      expect(enviados, ['BEEP1']);
    });

    test('dos mediciones registradas, dos pitidos', () async {
      pitido.registrada(pitido.siguiente());
      pitido.registrada(pitido.siguiente());
      await Future<void>.delayed(Duration.zero);
      expect(enviados, ['BEEP1', 'BEEP1']);
    });

    test('una lectura que llega mientras se guarda la anterior tiene su propio pitido', () async {
      final primera = pitido.siguiente();
      final segunda = pitido.siguiente(); // llega antes de que la primera se guarde
      expect(pitido.registrada(primera), isTrue);
      expect(pitido.registrada(segunda), isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(enviados.length, 2);
    });

    test('recibir una lectura no pita: solo registrarla', () async {
      pitido.siguiente();
      await Future<void>.delayed(Duration.zero);
      expect(enviados, isEmpty);
    });

    test('sin número de orden (presión, RFID, info) no pita', () async {
      expect(pitido.registrada(null), isFalse);
      await Future<void>.delayed(Duration.zero);
      expect(enviados, isEmpty);
    });

    test('no hace esperar: vuelve antes de que el envío termine', () async {
      final fin = Completer<void>();
      final lento = PitidoDeMedicion((_) => fin.future);
      // Si esperase al envío, esta línea no volvería nunca.
      expect(lento.registrada(lento.siguiente()), isTrue);
      fin.complete();
    });

    test('si el envío falla no se propaga nada', () async {
      final roto = PitidoDeMedicion((_) async => throw Exception('Sonda no conectada'));
      expect(() => roto.registrada(roto.siguiente()), returnsNormally);
      // El error del envío se queda dentro: si saliera, la prueba fallaría
      // por excepción no capturada.
      await Future<void>.delayed(Duration.zero);
    });

    test('y tras un fallo la siguiente medición vuelve a pitar', () async {
      var falla = true;
      final p = PitidoDeMedicion((cmd) async {
        if (falla) throw Exception('fuera de alcance');
        enviados.add(cmd);
      });
      p.registrada(p.siguiente());
      await Future<void>.delayed(Duration.zero);
      falla = false;
      p.registrada(p.siguiente());
      await Future<void>.delayed(Duration.zero);
      expect(enviados, ['BEEP1']);
    });

    test('el comando es BEEP1, sin terminador: el salto de línea lo pone el envío', () {
      expect(PitidoDeMedicion.comando, 'BEEP1');
    });
  });

  // Las lecturas se siguen entendiendo igual que antes.
  group('parsearLinea no ha cambiado', () {
    test('profundidad', () {
      final l = parsearLinea('T8.50');
      expect(l.tipo, LecturaTipo.profundidad);
      expect(l.valor, 8.5);
      // El parser no numera: el número lo pone la sesión al recibirla.
      expect(l.n, isNull);
    });

    test('presión', () {
      final l = parsearLinea('P123.4');
      expect(l.tipo, LecturaTipo.presion);
      expect(l.valor, 123.4);
      expect(l.n, isNull);
    });

    test('RFID, batería y timeout no son profundidades', () {
      expect(parsearLinea('GRE2801160600002').tipo, LecturaTipo.rfid);
      expect(parsearLinea('BV3.91').tipo, LecturaTipo.info);
      expect(parsearLinea('GST').tipo, LecturaTipo.timeout);
    });

    test('la respuesta de la sonda al BEEP no se toma por una medición', () {
      for (final eco in ['BEEP1', 'OK', 'BEEP']) {
        final l = parsearLinea(eco);
        expect(l.tipo, isNot(LecturaTipo.profundidad));
        expect(l.tipo, isNot(LecturaTipo.presion));
      }
    });
  });
}
