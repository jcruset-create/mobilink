import 'package:flutter_test/flutter_test.dart';
import 'package:sea_tarragona_operario/services/orden_trabajos.dart';

void main() {
  test('lee la plaza de las observaciones', () {
    expect(plazaDe('remolque en plaza 27'), 27);
    expect(plazaDe('Pl. 3, junto a la garita'), 3);
    expect(plazaDe('Plaza nº 12'), 12);
    expect(plazaDe('al fondo'), isNull);
    expect(plazaDe(null), isNull);
  });

  test('a medias primero, pendientes por plaza, sin plaza al final, y lo hecho abajo', () {
    final t = [
      {'id': 1, 'status': 'pendiente', 'observaciones': 'plaza 30'},
      {'id': 2, 'status': 'finalizado', 'observaciones': 'plaza 1'},
      {'id': 3, 'status': 'pendiente', 'observaciones': null},
      {'id': 4, 'status': 'en_proceso', 'observaciones': 'plaza 50'},
      {'id': 5, 'status': 'pendiente', 'observaciones': 'plaza 4'},
      {'id': 6, 'status': 'no_realizado', 'observaciones': null},
    ];
    expect(ordenarTrabajosEnBase(t).map((x) => x['id']), [4, 5, 1, 3, 2, 6]);
  });
}
