import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/configuracion_ejes.dart';

/// Lo que se fija aquí es que la APK lea la configuración EXACTAMENTE igual que
/// el servidor que generó las posiciones. Si divergieran, el técnico vería en
/// la tablet un camión con más o menos ruedas de las que tiene el plano.
void main() {
  group('ConfiguracionEjes', () {
    test('se lee de delante hacia atrás', () {
      final c = ConfiguracionEjes.desdeTexto('2x2x4');
      expect(c.ruedasPorEje, [2, 2, 4]);
      expect(c.numeroEjes, 3);
      expect(c.totalPosiciones, 8);
    });

    test('el caso del autobús: 2x4x2 son 2, 4 y 2', () {
      // Este es el error real que se arregló en el panel: un 2x4x2 con cuatro
      // ruedas en el TERCER eje. El segundo es el gemelo, no el tercero.
      final c = ConfiguracionEjes.desdeTexto('2x4x2');
      expect(c.ruedasPorEje, [2, 4, 2]);
      expect(c.ejeGemelo(2), isTrue);
      expect(c.ejeGemelo(3), isFalse);
      expect(c.totalPosiciones, 8);
    });

    test('el semirremolque de tres ejes sencillos', () {
      final c = ConfiguracionEjes.desdeTexto('2x2x2');
      expect(c.totalPosiciones, 6);
      expect(c.ejeGemelo(1), isFalse);
    });

    test('una etiqueta con un número que no es 2 ni 4 no se dibuja', () {
      // Mejor no enseñar plano que enseñar uno inventado.
      for (final mala in ['2x3x2', '1x2', '2x6', '2x0']) {
        expect(ConfiguracionEjes.desdeTexto(mala).esValida, isFalse, reason: mala);
      }
    });

    test('vacío, nulo o con letras tampoco', () {
      for (final mala in [null, '', '   ', 'axb', '2xx2']) {
        expect(ConfiguracionEjes.desdeTexto(mala).esValida, isFalse, reason: '$mala');
      }
    });

    test('el resumen es el que lee el técnico antes de confirmar', () {
      expect(ConfiguracionEjes.desdeTexto('2x2x4').resumen, '3 ejes · 2+2+4 · 8 neumáticos');
    });
  });
}
