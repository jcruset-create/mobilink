import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/alta_vehiculo.dart';

void main() {
  test('los ejes salen de las posiciones del tipo, con el primero direccional', () {
    final ejes = ejesDesdePosiciones([1, 1, 2, 2, 2, 2, null]);
    expect(ejes.map((e) => e.eje), [1, 2]);
    expect(ejes.map((e) => e.ruedas), [2, 4]);
    expect(ejes[0].directriz, isTrue);
    expect(ejes[1].directriz, isFalse);
    expect(ejes[1].dobles, isTrue);
  });

  test('medida común solo si todos los ejes llevan la misma', () {
    final ejes = ejesDesdePosiciones([1, 1, 2, 2]);
    expect(medidaComun(ejes), isNull);
    ejes[0].medidaId = 'm1';
    expect(medidaComun(ejes), isNull);
    ejes[1].medidaId = 'm1';
    expect(medidaComun(ejes), 'm1');
    ejes[1].medidaId = 'm2';
    expect(medidaComun(ejes), isNull);
  });

  test('aplicar a todos copia medida, llanta y presión, no los interruptores', () {
    final ejes = ejesDesdePosiciones([1, 1, 2, 2, 3, 3]);
    ejes[0]
      ..medidaId = 'm'
      ..llantaId = 'l'
      ..presionBar = 8.5;
    aplicarATodos(ejes, ejes[0]);
    expect(ejes.every((e) => e.medidaId == 'm' && e.llantaId == 'l' && e.presionBar == 8.5), isTrue);
    expect(ejes.where((e) => e.directriz).length, 1);
  });

  test('«29580» encuentra 295/80R22.5', () {
    expect(coincideMedida('295/80R22.5', '29580'), isTrue);
    expect(coincideMedida('295/80R22.5', '295/80'), isTrue);
    expect(coincideMedida('295/80R22.5', '31580'), isFalse);
    expect(claveMedida('295/80 R22.5'), '29580R225');
  });

  final catalogo = [
    {'id': 'a', 'marca': 'Michelin', 'modelo': 'X Multi D', 'medida': '315/80R22.5'},
    {'id': 'b', 'marca': 'Hankook', 'modelo': 'DH51', 'medida': '315/80R22.5'},
    {'id': 'c', 'marca': 'Bridgestone', 'modelo': 'R-Steer', 'medida': '315/80R22.5'},
    {'id': 'd', 'marca': 'Hankook', 'modelo': 'AH31', 'medida': '295/80R22.5'},
  ];

  test('la búsqueda mezcla marca y medida', () {
    expect(catalogo.where((r) => coincideReferencia(r, 'hankook 29580')).map((r) => r['id']), ['d']);
    expect(catalogo.where((r) => coincideReferencia(r, 'hankook')).length, 2);
  });

  test('los favoritos de la flota van primero y se filtra por la medida del eje', () {
    final favoritos = [
      {'marca': 'Hankook', 'modelo': 'DH51', 'medida': '315/80 R22.5', 'veces': 40},
      {'marca': 'Michelin', 'modelo': 'X Multi D', 'medida': '315/80R22.5', 'veces': 12},
    ];
    final orden = ordenarReferencias(catalogo, favoritos: favoritos, medida: '315/80R22.5');
    expect(orden.map((r) => r['id']), ['b', 'a', 'c']);
    expect(vecesEnFlota(orden.first, favoritos), 40);
    expect(marcasDe(orden), ['Hankook', 'Michelin', 'Bridgestone']);
    // Sin medida salen todas.
    expect(ordenarReferencias(catalogo).length, 4);
  });
}
