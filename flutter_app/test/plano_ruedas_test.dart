import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/widgets/plano_ruedas.dart';

void main() {
  // Las mismas cuentas que shared/planoMargen.ts del panel: si divergen, las
  // ruedas se pintan fuera de su sitio en la tablet.
  test('el centro del plano no se mueve y las esquinas calibradas caen en el margen de la vista', () {
    expect(centroEnVista(50, 50).dx, closeTo(50, 1e-9));
    expect(centroEnVista(50, 50).dy, closeTo(50, 1e-9));
    expect(centroEnVista(12, 4).dx, closeTo(22, 1e-9));
    expect(centroEnVista(12, 4).dy, closeTo(8, 1e-9));
    expect(centroEnVista(88, 96).dx, closeTo(78, 1e-9));
    expect(aspectoPlano(1), closeTo(0.84 / 0.56, 1e-9));
  });

  test('etiquetas de las posiciones', () {
    expect(etiquetaPosicion({'codigo': 'E1_IZQ', 'eje': 1, 'lado': 'izq'}), 'E1 IZQ');
    expect(etiquetaPosicion({'codigo': 'E2_DER_INT', 'eje': 2, 'lado': 'der', 'interiorExterior': 'int'}), 'E2 DER INT');
    expect(etiquetaPosicion({'codigo': 'REPUESTO'}), 'REPUESTO');
  });
}
