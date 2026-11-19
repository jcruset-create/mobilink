import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/desgaste_creible.dart';
import 'package:tyrecontrol_app/services/ultima_medicion.dart';

/// Las series son las del 2651JRM en producción el 16/11/2026, las mismas que
/// prueba el panel en `desgasteCreible.test.ts`: fecha · km · delantera
/// izquierda · trasera izquierda exterior. De la más reciente a la más antigua.
const _revisiones = <(String, double?, double, double)>[
  ('2026-11-16', null, 2.2, 3.8),
  ('2026-11-14', 776502, 1.6, 4.9),
  ('2026-11-10', 775838, 11.9, 3.9),
  ('2026-11-09', 775587, 12.2, 4.2),
  ('2026-11-04', 774688, 12.4, 4.1),
  ('2026-10-30', 773827, 12.4, 4.6),
  ('2026-10-29', 773661, 12.2, 4.7),
  ('2026-10-01', null, 12.6, 5.2),
  ('2026-09-30', null, 12.9, 5.4),
  ('2026-09-26', 767958, 12.8, 5.8),
  ('2026-09-25', 767578, 12.6, 5.3),
  ('2026-09-07', 767431, 12.9, 5.6),
  ('2026-09-04', 767299, 13.1, 5.7),
  ('2026-09-03', 767057, 13.0, 5.7),
  ('2026-09-02', 766817, 13.1, 5.9),
  ('2026-09-01', 766573, 13.3, 5.9),
  ('2026-08-31', 766329, 13.9, 6.0),
  ('2026-08-30', 766083, 13.4, 6.6),
  ('2026-08-29', 765933, 12.9, 6.5),
  ('2026-08-28', 765645, 13.8, 6.6),
  ('2026-08-27', 765404, 13.9, 6.8),
  ('2026-08-26', 765144, 13.9, 7.1),
  ('2026-08-23', 764681, 14.0, 7.1),
  ('2026-08-21', 764567, 14.0, 7.2),
  ('2026-08-20', 764160, 13.6, 7.1),
  ('2026-08-13', 764143, 14.2, 7.5),
  ('2026-08-12', 763662, 14.1, 7.8),
];

final _puntos = [
  for (final r in _revisiones)
    if (r.$2 != null) PuntoKm(DateTime.parse(r.$1), r.$2!),
];

List<LecturaConKm> _serie({required bool delantera, int desde = 0, int? hasta}) => [
      for (final r in _revisiones.sublist(desde, hasta))
        LecturaConKm(
          delantera ? r.$3 : r.$4,
          fecha: DateTime.parse(r.$1),
          km: r.$2 ?? kmEnFecha(_puntos, DateTime.parse(r.$1)),
        ),
    ];

void main() {
  group('kmEnFecha', () {
    test('el día que se sabe, el que es', () {
      expect(kmEnFecha(_puntos, DateTime.parse('2026-11-14')), 776502);
    });

    test('entre dos lecturas, en línea recta', () {
      expect(kmEnFecha(_puntos, DateTime.parse('2026-09-30')), (767958 + (773661 - 767958) / 33 * 4).roundToDouble());
    });

    test('después de la última, con el ritmo del último mes', () {
      final km = kmEnFecha(_puntos, DateTime.parse('2026-11-16'))!;
      expect(km, greaterThan(776502));
      expect(km, lessThan(776502 + 1000));
    });

    test('con un solo punto no hay ritmo: solo vale ese día', () {
      final uno = [PuntoKm(DateTime.parse('2026-11-14'), 776502)];
      expect(kmEnFecha(uno, DateTime.parse('2026-11-16')), isNull);
      expect(kmEnFecha(uno, DateTime.parse('2026-11-14')), 776502);
      expect(kmEnFecha(const [], DateTime.parse('2026-11-14')), isNull);
    });
  });

  group('ritmoDeLaGoma', () {
    test('la delantera nueva: unos 0,16 mm cada 1.000 km', () {
      expect(ritmoDeLaGoma(_serie(delantera: true))!, closeTo(0.16, 0.05));
    });

    test('la trasera exterior se gasta el doble de deprisa', () {
      expect(ritmoDeLaGoma(_serie(delantera: false))!, inInclusiveRange(0.25, 0.4));
    });

    test('sin recorrido bastante no hay ritmo', () {
      expect(ritmoDeLaGoma(_serie(delantera: true, hasta: 8)), isNull);
      expect(ritmoDeLaGoma(_serie(delantera: true, desde: 12, hasta: 21)), isNull);
    });
  });

  group('juzgarDesgaste · el 2651JRM', () {
    test('la delantera izquierda: 10 mm en unos 2.000 km no es desgaste', () {
      final j = juzgarDesgaste(_serie(delantera: true));
      expect(j.creible, isFalse);
      expect(j.base!.mm, 12.4);
      expect(j.base!.fecha, DateTime.parse('2026-11-04'));
      expect(j.bajadaMm!, closeTo(10.2, 0.05));
      expect(j.permitidoMm!, lessThan(2));
      expect(j.explicacion, contains('medir con sonda'));
    });

    test('la trasera exterior: su bajada sí cabe, el aviso es de verdad', () {
      final j = juzgarDesgaste(_serie(delantera: false));
      expect(j.creible, isTrue);
      expect(j.bajadaMm!, lessThan(1));
    });

    test('el día antes del disparate no había nada que objetar', () {
      expect(juzgarDesgaste(_serie(delantera: true, desde: 2)).creible, isTrue);
    });
  });

  group('juzgarDesgaste · cuándo no se juzga', () {
    test('con menos de seis lecturas no hay base', () {
      expect(juzgarDesgaste(_serie(delantera: true, hasta: 5)).creible, isNull);
    });

    test('si una de las tres últimas es de un técnico, manda la sonda', () {
      final s = _serie(delantera: true);
      s[1] = LecturaConKm(s[1].mm, fecha: s[1].fecha, km: s[1].km, manual: true);
      expect(juzgarDesgaste(s).creible, isNull);
    });

    test('sin kilómetros de ese tramo no se acusa a la lectura', () {
      final s = [for (final l in _serie(delantera: true)) LecturaConKm(l.mm, fecha: l.fecha)];
      expect(juzgarDesgaste(s).creible, isNull);
    });

    test('sin ritmo propio ni de reserva, tampoco; con el de reserva, sí', () {
      expect(juzgarDesgaste(_serie(delantera: true, hasta: 7)).creible, isNull);
      final j = juzgarDesgaste(_serie(delantera: true, hasta: 7), 0.2);
      expect(j.creible, isFalse);
      expect(j.ritmo, 0.2);
    });
  });

  group('juzgarDesgaste · el margen', () {
    List<LecturaConKm> plana(List<double> mm) => [
          for (var i = 0; i < mm.length; i += 1) LecturaConKm(mm[i], km: 100000 - i * 250),
        ];

    test('el baile del arco (1 mm) no hace saltar nada', () {
      expect(juzgarDesgaste(plana([7.1, 7.0, 7.2, 8.0, 8.0, 8.0]), 0).creible, isTrue);
    });

    test('un poco más que eso, sí', () {
      expect(juzgarDesgaste(plana([6.8, 6.9, 6.8, 8.0, 8.0, 8.0]), 0).creible, isFalse);
    });

    test('una goma que sube nunca es un desgaste imposible', () {
      expect(juzgarDesgaste(plana([9.5, 9.6, 9.4, 8.0, 8.0, 8.0]), 0.2).creible, isTrue);
    });
  });

  group('En el reparto de la tablet', () {
    // Lo que lee la ficha: una fila por rueda y revisión, con su día y sus km.
    final filas = <FilaMedicion>[
      for (var i = 0; i < _revisiones.length; i += 1) ...[
        FilaMedicion(
          revisionId: 'r$i', clave: 'del', profundidadMm: _revisiones[i].$3,
          momento: DateTime.parse(_revisiones[i].$1), dia: DateTime.parse(_revisiones[i].$1), kmVehiculo: _revisiones[i].$2,
        ),
        FilaMedicion(
          revisionId: 'r$i', clave: 'tras', profundidadMm: _revisiones[i].$4,
          momento: DateTime.parse(_revisiones[i].$1), dia: DateTime.parse(_revisiones[i].$1), kmVehiculo: _revisiones[i].$2,
        ),
      ],
    ];
    final mapa = repartirUltimasMediciones(filas, protocolo: true, minimos: const {'del': 4, 'tras': 4});

    test('la delantera enseña sus 12,4 mm y deja el 2,2 por confirmar', () {
      expect(mapa['del']!.profundidadMm, 12.4);
      expect(mapa['del']!.pendienteMm, 2.2);
      expect(mapa['del']!.confirmada, isTrue);
      expect(mapa['del']!.noCreible, contains('medir con sonda'));
    });

    test('la trasera, gastada de verdad, se queda en su mínimo', () {
      expect(mapa['tras']!.profundidadMm, 3.9);
      expect(mapa['tras']!.pendienteMm, isNull);
      expect(mapa['tras']!.noCreible, isNull);
    });

    test('sin día ni km en las filas, todo sigue como estaba', () {
      final sinKm = [
        for (final f in filas)
          FilaMedicion(revisionId: f.revisionId, clave: f.clave, profundidadMm: f.profundidadMm, momento: f.momento),
      ];
      final m = repartirUltimasMediciones(sinKm, protocolo: true, minimos: const {'del': 4, 'tras': 4});
      expect(m['del']!.profundidadMm, 2.2);
      expect(m['del']!.noCreible, isNull);
    });
  });
}
