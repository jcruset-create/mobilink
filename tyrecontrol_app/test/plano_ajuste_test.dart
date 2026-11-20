import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/widgets/plano_margen.dart';

void main() {
  // La imagen del semirremolque 2x2x2 de producción: 944 × 1666.
  const aspecto = 944 / 1666;

  group('ajustePlano', () {
    test('si cabe a lo ancho se dibuja como siempre', () {
      final a = ajustePlano(760, 1200, aspecto);
      expect(a.w, 760);
      expect(a.h, closeTo(760 / aspectoPlano(aspecto), 0.01));
      expect(a.mx, kMargenVistaX);
      expect(a.my, kMargenVistaY);
    });

    test('si manda el alto, el plano llena el ancho en vez de encogerse', () {
      // Una tablet de 8" en vertical: el hueco entre la sonda y los botones.
      final a = ajustePlano(588, 560, aspecto);
      final antes = 560 * aspectoPlano(aspecto); // lo ancho que quedaba antes
      expect(a.w, 588);
      expect(a.w, greaterThan(antes * 1.15));
      expect(a.h, lessThanOrEqualTo(560));
    });

    test('y la imagen gana alto: el margen vertical baja al de las coordenadas', () {
      final a = ajustePlano(588, 560, aspecto);
      final ri = rectImagenEnPlano(a.w, a.h, mx: a.mx, my: a.my);
      expect(a.my, kMargenCoordY);
      expect(ri.h, greaterThan(560 * (1 - 2 * kMargenVistaY)));
      // La imagen no se deforma.
      expect(ri.w / ri.h, closeTo(aspecto, 0.001));
    });

    test('nunca se sale del hueco ni estrecha el margen lateral de siempre', () {
      for (final t in [[588.0, 560.0], [521.0, 470.0], [400.0, 900.0], [1100.0, 520.0], [300.0, 300.0]]) {
        final a = ajustePlano(t[0], t[1], aspecto);
        expect(a.w, lessThanOrEqualTo(t[0] + 0.001));
        expect(a.h, lessThanOrEqualTo(t[1] + 0.001));
        expect(a.mx, greaterThanOrEqualTo(kMargenVistaX - 0.0001));
        expect(a.mx, lessThanOrEqualTo(kMargenVistaXMax + 0.0001));
      }
    });

    test('en apaisado el margen lateral tiene tope: las tarjetas no se desmandan', () {
      final a = ajustePlano(1100, 520, aspecto);
      expect(a.mx, closeTo(kMargenVistaXMax, 0.0001));
      expect(a.w, lessThan(1100));
    });
  });

  group('cajaAVista', () {
    const caja = (x: 3.86, y: 20.49, w: 10.64, h: 12.88);

    test('sin márgenes dados, los de siempre', () {
      final c = cajaAVista(caja);
      final d = cajaAVista(caja, mx: kMargenVistaX, my: kMargenVistaY);
      expect(c.x, d.x);
      expect(c.y, d.y);
    });

    test('la tarjeta sigue pegada a la imagen aunque cambie el margen', () {
      // Su centro, medido desde el borde de la imagen y en anchos de imagen,
      // no depende del margen con que se dibuje.
      double relativa(double mx) {
        final c = cajaAVista(caja, mx: mx, my: kMargenCoordY);
        return (c.x + c.w / 2 - mx * 100) / (100 - 2 * mx * 100);
      }
      expect(relativa(0.22), closeTo(relativa(0.30), 1e-9));
    });
  });
}
