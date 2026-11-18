import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/widgets/tarjetas_plano.dart';

void main() {
  test('gemelas en fila: ninguna pisa a la de al lado', () {
    // Eje 2 de un 2x4: cuatro ruedas a 120 px entre centros, en 520 px.
    const cajas = [CajaTarjeta(70, 400), CajaTarjeta(190, 400), CajaTarjeta(330, 400), CajaTarjeta(450, 400)];
    final t = repartirTarjetas(cajas, areaAncho: 520, areaAlto: 560);
    for (int i = 0; i < cajas.length - 1; i++) {
      final derecha = cajas[i].centroX + t[i].ancho / 2;
      final izquierda = cajas[i + 1].centroX - t[i + 1].ancho / 2;
      expect(derecha <= izquierda, isTrue, reason: 'la $i pisa a la ${i + 1}');
    }
  });

  test('un eje delantero solo, con sitio, crece hasta el máximo', () {
    final t = repartirTarjetas(const [CajaTarjeta(100, 40), CajaTarjeta(420, 40)], areaAncho: 520, areaAlto: 560);
    expect(t[0].ancho, 200);
    expect(t[1].ancho, 200);
  });

  test('dos ejes traseros juntos: la de arriba no baja sobre la de abajo', () {
    final t = repartirTarjetas(const [CajaTarjeta(100, 300), CajaTarjeta(100, 390)], areaAncho: 520, areaAlto: 560);
    expect(t[0].altoMax, 82); // 390 - 300 - 8
    expect(t[1].altoMax, 170);
  });

  test('pegada al borde no se sale', () {
    final t = repartirTarjetas(const [CajaTarjeta(50, 40)], areaAncho: 520, areaAlto: 560);
    expect(t[0].ancho, 100);
  });

  test('con etiqueta de medida encima del eje de abajo, la de arriba se queda antes de la etiqueta', () {
    final t = repartirTarjetas(const [CajaTarjeta(100, 100), CajaTarjeta(100, 300)],
        areaAncho: 520, areaAlto: 560, reservaArriba: const [26, 26]);
    expect(t[0].altoMax, 166); // 300 - 26 - 100 - 8
  });
}
