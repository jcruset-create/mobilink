import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/umbrales.dart';

void main() {
  test('presión dentro de margen → no es anomalía', () {
    expect(Umbrales.presionFueraDeRango(8.4, 8.5, 0.5), isFalse);
    expect(Umbrales.presionFueraDeRango(8.9, 8.5, 0.5), isFalse); // justo en el borde
  });

  test('presión baja fuera de margen → anomalía', () {
    expect(Umbrales.presionFueraDeRango(6.8, 8.5, 0.5), isTrue);
  });

  test('presión alta fuera de margen → anomalía', () {
    expect(Umbrales.presionFueraDeRango(9.2, 8.5, 0.5), isTrue);
  });

  test('sin medida o sin objetivo → no evalúa', () {
    expect(Umbrales.presionFueraDeRango(null, 8.5, 0.5), isFalse);
    expect(Umbrales.presionFueraDeRango(6.0, null, 0.5), isFalse);
  });

  test('margen por defecto 0.5 si es null', () {
    expect(Umbrales.presionFueraDeRango(7.9, 8.5, null), isTrue); // dif 0.6 > 0.5
    expect(Umbrales.presionFueraDeRango(8.1, 8.5, null), isFalse); // dif 0.4
  });
}
