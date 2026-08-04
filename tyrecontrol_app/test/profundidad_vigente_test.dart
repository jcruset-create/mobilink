import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/models.dart';

/// El fallo que arreglan estas pruebas: se reesculturaba una rueda, se
/// tecleaban los 8 mm, y la tarjeta seguía enseñando los 4.7 mm de la última
/// revisión. El neumático conserva su id al reesculturar, así que la medición
/// vieja tapaba el dato nuevo para siempre.
void main() {
  final ayer = DateTime(2026, 8, 3, 9, 0);
  final hoy = DateTime(2026, 8, 4, 9, 0);

  RevisionDetalleDraft medicion(double mm, DateTime? cuando) =>
      RevisionDetalleDraft(posicionId: 'p', profundidadMm: mm, medidoEn: cuando);

  Neumatico neumatico(num? mm, DateTime? cuando) => Neumatico(
        id: 'n',
        estado: 'montado',
        profundidadActualMm: mm,
        profundidadActualizadaEn: cuando,
      );

  test('reescultura DESPUÉS de la revisión: mandan los mm nuevos', () {
    expect(profundidadVigente(medicion(4.7, ayer), neumatico(8.0, hoy)), 8.0);
  });

  test('revisión DESPUÉS del montaje: manda la medición', () {
    // Se monta un usado con 8 mm a mano y luego se mide con sonda: 7.2.
    expect(profundidadVigente(medicion(7.2, hoy), neumatico(8.0, ayer)), 7.2);
  });

  test('sin medición: manda la del neumático', () {
    expect(profundidadVigente(null, neumatico(16.5, hoy)), 16.5);
    expect(profundidadVigente(medicion(4.7, ayer).conProfundidad(null), neumatico(16.5, hoy)), 16.5);
  });

  test('sin profundidad propia: manda la medición', () {
    expect(profundidadVigente(medicion(4.7, ayer), neumatico(null, null)), 4.7);
  });

  test('sin ninguna de las dos: no hay dato', () {
    expect(profundidadVigente(null, neumatico(null, null)), isNull);
    expect(profundidadVigente(null, null), isNull);
  });

  test('si falta alguna fecha manda la MEDICIÓN, que es el dato de sonda', () {
    // Es el comportamiento de antes de la corrección: sin fechas no se puede
    // decidir, y se prefiere no empeorar lo que ya funcionaba.
    expect(profundidadVigente(medicion(4.7, null), neumatico(8.0, hoy)), 4.7);
    expect(profundidadVigente(medicion(4.7, ayer), neumatico(8.0, null)), 4.7);
  });

  test('empate exacto: manda la medición', () {
    expect(profundidadVigente(medicion(4.7, hoy), neumatico(8.0, hoy)), 4.7);
  });

  test('conProfundidad conserva el resto de la medición', () {
    final m = RevisionDetalleDraft(
      posicionId: 'p', neumaticoId: 'n', profundidadMm: 4.7, presionBar: 8.5,
      estadoVisual: 'corte', noAccesible: true, medidoEn: ayer,
    );
    final c = m.conProfundidad(8.0);
    expect(c.profundidadMm, 8.0);
    expect(c.presionBar, 8.5); // la presión medida NO se pierde
    expect(c.estadoVisual, 'corte');
    expect(c.noAccesible, isTrue);
    expect(c.neumaticoId, 'n');
    expect(c.medidoEn, ayer);
    expect(m.profundidadMm, 4.7); // el original no se toca
  });
}
