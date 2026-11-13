import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/ultima_medicion.dart';

/// Las filas llegan de la consulta de la más reciente a la más antigua.
FilaMedicion fila(String rev, String clave, double? prof, {double? pres, String? dia}) => FilaMedicion(
      revisionId: rev,
      clave: clave,
      profundidadMm: prof,
      presionBar: pres,
      momento: dia == null ? null : DateTime.parse(dia),
    );

void main() {
  group('revisionesConTodasLasRuedas', () {
    test('la que mide todas sus ruedas cuenta', () {
      expect(revisionesConTodasLasRuedas([fila('r1', 'a', 9), fila('r1', 'b', 8)]), {'r1'});
    });

    test('a la que le falta una, no', () {
      expect(revisionesConTodasLasRuedas([fila('r1', 'a', 9), fila('r1', 'b', null)]), isEmpty);
    });

    test('la que no trae ninguna profundidad, tampoco', () {
      expect(revisionesConTodasLasRuedas([fila('r1', 'a', null, pres: 8), fila('r1', 'b', null, pres: 8)]), isEmpty);
    });

    test('cada revisión se juzga sola', () {
      final completas = revisionesConTodasLasRuedas([
        fila('r1', 'a', 9), fila('r1', 'b', 8),
        fila('r2', 'a', 7), fila('r2', 'b', null),
      ]);
      expect(completas, {'r1'});
    });

    test('la revisión cortada por el límite no se da por buena', () {
      final filas = [fila('r2', 'a', 9), fila('r2', 'b', 8), fila('r1', 'a', 7)];
      expect(revisionesConTodasLasRuedas(filas, cortada: 'r1'), {'r2'});
    });
  });

  group('repartirUltimasMediciones · el caso del 4300GZD', () {
    // La E2_IZQ_INT medía 12,7 mm el 30/10 con las seis ruedas medidas, y el
    // 05/11 el arco —con lluvia— devolvió 1,9 mm midiendo solo ésa.
    final filas = [
      fila('r3', 'int', 1.9, pres: 7.9, dia: '2026-11-05'),
      fila('r3', 'ext', null, pres: 7.7, dia: '2026-11-05'),
      fila('r2', 'int', 12.7, pres: 8.0, dia: '2026-10-30'),
      fila('r2', 'ext', 12.1, pres: 8.1, dia: '2026-10-30'),
    ];
    final mapa = repartirUltimasMediciones(filas);

    test('la profundidad vuelve a la de la última revisión completa', () {
      expect(mapa['int']!.profundidadMm, 12.7);
      expect(mapa['ext']!.profundidadMm, 12.1);
    });

    test('con su fecha, la del 30/10 y no la del 05/11', () {
      expect(mapa['int']!.medidoEn, DateTime.parse('2026-10-30'));
    });

    test('la presión sí sale de la parcial: con lluvia el arco la mide bien', () {
      expect(mapa['int']!.presionBar, 7.9);
      expect(mapa['ext']!.presionBar, 7.7);
      expect(mapa['int']!.presionEn, DateTime.parse('2026-11-05'));
    });
  });

  group('repartirUltimasMediciones', () {
    test('sin ninguna revisión completa, la rueda se queda sin profundidad pero con presión', () {
      final mapa = repartirUltimasMediciones([fila('r3', 'a', 1.9, pres: 7.9), fila('r3', 'b', null, pres: 7.7)]);
      expect(mapa['a']!.profundidadMm, isNull);
      expect(mapa['a']!.medidoEn, isNull);
      expect(mapa['a']!.presionBar, 7.9);
    });

    test('una revisión solo de presión ya no tapa la profundidad anterior', () {
      // Antes ganaba la fila más reciente entera: con presión y sin
      // profundidad dejaba la ficha en «— mm» aunque hubiera medición buena.
      final mapa = repartirUltimasMediciones([
        fila('r2', 'a', null, pres: 8.2),
        fila('r1', 'a', 9.5, pres: 8.0),
      ]);
      expect(mapa['a']!.profundidadMm, 9.5);
      expect(mapa['a']!.presionBar, 8.2);
    });

    test('una fila sin clave no se reparte, pero sí cuenta para saber si la revisión está completa', () {
      final mapa = repartirUltimasMediciones([
        fila('r1', 'a', 9),
        const FilaMedicion(revisionId: 'r1', clave: null, profundidadMm: null),
      ]);
      expect(mapa.containsKey('a'), isFalse);
    });

    test('si la consulta agotó su límite, la revisión del final no cuenta', () {
      // Tres filas con límite 3: la r1 puede venir cortada.
      final filas = [fila('r2', 'a', 9), fila('r2', 'b', 8), fila('r1', 'c', 7)];
      final mapa = repartirUltimasMediciones(filas, limite: 3);
      expect(mapa['a']!.profundidadMm, 9);
      expect(mapa.containsKey('c'), isFalse);
    });

    test('si no lo agotó, la del final vale', () {
      final filas = [fila('r2', 'a', 9), fila('r1', 'c', 7)];
      expect(repartirUltimasMediciones(filas, limite: 3)['c']!.profundidadMm, 7);
    });

    test('el cero es una medición: una goma lisa se dice', () {
      expect(repartirUltimasMediciones([fila('r1', 'a', 0)])['a']!.profundidadMm, 0);
    });

    test('sin filas, mapa vacío', () {
      expect(repartirUltimasMediciones([]), isEmpty);
    });
  });
}
