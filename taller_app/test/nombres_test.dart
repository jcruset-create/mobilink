import 'package:flutter_test/flutter_test.dart';
import 'package:taller_app/nombres.dart';

/// El técnico ve "no tienes tareas" cuando su nombre no casa exactamente con el
/// de `assignedNames`. Pasó en producción, así que la comparación tolerante va
/// con red.
void main() {
  group('mismoNombre', () {
    test('ignora acentos, mayúsculas y espacios', () {
      expect(mismoNombre('Jesús', 'jesus'), isTrue);
      expect(mismoNombre('  José ', 'JOSE'), isTrue);
      expect(mismoNombre('Iván', 'Ivan'), isTrue);
    });

    test('no confunde a dos técnicos distintos', () {
      expect(mismoNombre('José', 'Josep'), isFalse);
      expect(mismoNombre('David', 'Davido'), isFalse);
    });

    test('un nombre vacío no casa con nada', () {
      expect(mismoNombre('', ''), isFalse);
      expect(mismoNombre('   ', 'David'), isFalse);
    });
  });

  group('estaAsignado', () {
    test('encuentra al técnico aunque el trabajo lo guarde con acento', () {
      expect(estaAsignado(['Jesús', 'Albert'], 'jesus'), isTrue);
      expect(estaAsignado(['Anthoni'], 'David'), isFalse);
      expect(estaAsignado([], 'David'), isFalse);
    });
  });
}
