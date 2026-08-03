import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/theme/app_theme.dart';

/// Los colores del recuadro del neumático tienen que ser EXACTAMENTE los del
/// informe de flota: el técnico y el cliente miran lo mismo. Si alguien cambia
/// una banda aquí o allí sin tocar la otra, esto salta.
void main() {
  // Paleta del informe ejecutivo (BANDA_INFO en InformeEjecutivo.tsx).
  const rojo = 0xFFE5322E;
  const naranja = 0xFFEFA508;
  const amarillo = 0xFFF6D96D;
  const verdeClaro = 0xFFCDE0B2;
  const verdeMedio = 0xFF8FBF6B;
  const verdeOscuro = 0xFF4A7D2A;

  test('los límites caen en la banda de abajo, igual que en el informe', () {
    // El SQL del informe: when profundidad_mm <= 4 then '<=4' … else '>12'.
    expect(bandaProfundidad(4.0).fondo.toARGB32(), rojo);
    expect(bandaProfundidad(4.1).fondo.toARGB32(), naranja);
    expect(bandaProfundidad(6.0).fondo.toARGB32(), naranja);
    expect(bandaProfundidad(6.1).fondo.toARGB32(), amarillo);
    expect(bandaProfundidad(8.0).fondo.toARGB32(), amarillo);
    expect(bandaProfundidad(8.1).fondo.toARGB32(), verdeClaro);
    expect(bandaProfundidad(10.0).fondo.toARGB32(), verdeClaro);
    expect(bandaProfundidad(10.1).fondo.toARGB32(), verdeMedio);
    expect(bandaProfundidad(12.0).fondo.toARGB32(), verdeMedio);
    expect(bandaProfundidad(12.1).fondo.toARGB32(), verdeOscuro);
  });

  test('los extremos y un dato sucio no revientan', () {
    expect(bandaProfundidad(0).fondo.toARGB32(), rojo);
    expect(bandaProfundidad(-1).fondo.toARGB32(), rojo);
    expect(bandaProfundidad(99).fondo.toARGB32(), verdeOscuro);
  });

  test('la tinta se lee encima de su fondo', () {
    double canal(double c) =>
        c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
    double luminancia(int argb) {
      final r = ((argb >> 16) & 0xFF) / 255;
      final g = ((argb >> 8) & 0xFF) / 255;
      final b = (argb & 0xFF) / 255;
      return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
    }

    for (final mm in [2.0, 5.0, 7.0, 9.0, 11.0, 15.0]) {
      final banda = bandaProfundidad(mm);
      final lf = luminancia(banda.fondo.toARGB32());
      final lt = luminancia(banda.tinta.toARGB32());
      final contraste =
          lf > lt ? (lf + 0.05) / (lt + 0.05) : (lt + 0.05) / (lf + 0.05);
      // El rojo con blanco se queda en 4.35: es el peor caso y se acepta
      // porque el texto va en negrita y el blanco sobre rojo es la convención
      // de peligro del resto de la app.
      expect(contraste, greaterThanOrEqualTo(4.3),
          reason: '$mm mm → ${banda.etiqueta} da ${contraste.toStringAsFixed(2)}:1');
    }
  });
}
