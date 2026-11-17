import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/models.dart';

/// Medición doble: banda interior y exterior de cada rueda. La regla que no
/// se puede romper: la profundidad oficial —la que leen informes, alertas e
/// incidencias— es la MENOR de las bandas medidas.
void main() {
  RevisionDetalleDraft nuevo() => RevisionDetalleDraft(posicionId: 'p1');

  group('menorDeBandas', () {
    test('la menor de las dos', () {
      expect(menorDeBandas(7.8, 4.1), 4.1);
      expect(menorDeBandas(4.1, 7.8), 4.1);
    });
    test('con una sola banda, esa', () {
      expect(menorDeBandas(6.2, null), 6.2);
      expect(menorDeBandas(null, 6.2), 6.2);
    });
    test('sin bandas, nada', () => expect(menorDeBandas(null, null), isNull));
  });

  group('ponerBandas', () {
    test('guarda las dos y la oficial es la menor', () {
      final d = nuevo()..ponerBandas(7.8, 4.1);
      expect(d.profundidadIntMm, 7.8);
      expect(d.profundidadExtMm, 4.1);
      expect(d.profundidadMm, 4.1);
    });

    test('remedir recalcula la mínima', () {
      final d = nuevo()..ponerBandas(7.8, 4.1);
      d.ponerBandas(7.9, 7.5);
      expect(d.profundidadMm, 7.5);
    });

    test('"saltar banda": una sola banda vale como mínima', () {
      final d = nuevo()..ponerBandas(6.9, null);
      expect(d.profundidadMm, 6.9);
      expect(d.profundidadExtMm, isNull);
    });

    test('sin bandas no pisa una profundidad simple', () {
      final d = RevisionDetalleDraft(posicionId: 'p1', profundidadMm: 5.0)..ponerBandas(null, null);
      expect(d.profundidadMm, 5.0);
    });
  });

  group('desgaste irregular', () {
    test('Δ solo con las dos bandas', () {
      expect((nuevo()..ponerBandas(7.8, 4.1)).deltaBandas, closeTo(3.7, 1e-9));
      expect((nuevo()..ponerBandas(7.8, null)).deltaBandas, isNull);
    });

    test('avisa a partir del umbral de la empresa, incluido el propio umbral', () {
      expect((nuevo()..ponerBandas(7.8, 4.1)).desgasteIrregular(2.0), isTrue);
      expect((nuevo()..ponerBandas(6.0, 4.0)).desgasteIrregular(2.0), isTrue); // justo 2,0
      expect((nuevo()..ponerBandas(6.0, 4.5)).desgasteIrregular(2.0), isFalse);
    });

    test('sin umbral (null = aviso apagado) nunca avisa', () {
      expect((nuevo()..ponerBandas(9.0, 1.0)).desgasteIrregular(null), isFalse);
    });
  });

  group('toJson', () {
    Map<String, dynamic> json(RevisionDetalleDraft d) =>
        d.toJson(revisionId: 'r', empresaId: 'e', vehiculoId: 'v');

    test('con bandas viajan las dos y la mínima', () {
      final j = json(nuevo()..ponerBandas(7.8, 4.1));
      expect(j['profundidad_int_mm'], 7.8);
      expect(j['profundidad_ext_mm'], 4.1);
      expect(j['profundidad_mm'], 4.1);
    });

    test('una medición simple NO manda columnas de bandas', () {
      // Así una base sin migrar no ve columnas que no conoce, y una fila
      // simple se queda exactamente como hasta ahora.
      final j = json(RevisionDetalleDraft(posicionId: 'p1', profundidadMm: 5.0));
      expect(j.containsKey('profundidad_int_mm'), isFalse);
      expect(j.containsKey('profundidad_ext_mm'), isFalse);
      expect(j['profundidad_mm'], 5.0);
    });

    test('conProfundidad conserva las bandas', () {
      final d = (nuevo()..ponerBandas(7.8, 4.1)).conProfundidad(4.1);
      expect(d.profundidadIntMm, 7.8);
      expect(d.profundidadExtMm, 4.1);
    });
  });
}
