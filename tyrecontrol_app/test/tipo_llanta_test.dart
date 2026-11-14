import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/tipo_llanta.dart';

/// Lo que se fija aquí es que la llanta se lea IGUAL donde se elige y donde se
/// consulta. Si el alta la llamara de una forma y la ficha de otra, el técnico
/// no podría comprobar que eligió bien.
void main() {
  group('nombreTipoLlanta', () {
    test('lo básico: material con mayúscula y medida', () {
      expect(nombreTipoLlanta({'material': 'acero', 'medida': '22.5x11.75'}),
          'Acero · 22.5x11.75 · s/tapacubo');
    });

    test('con todo el detalle que tenga el catálogo', () {
      expect(
        nombreTipoLlanta({
          'material': 'aluminio', 'medida': '22.5x9.00',
          'agujeros': 10, 'centrado': 'centrada', 'tapacubo': true,
        }),
        'Aluminio · 22.5x9.00 · 10 aguj. · centrada · c/tapacubo',
      );
    });

    test('lo que no tiene dato no se escribe', () {
      // Una llanta a medio rellenar no debe leerse «null aguj.».
      final texto = nombreTipoLlanta({'material': 'acero', 'medida': '19.5x6.75', 'agujeros': null});
      expect(texto, 'Acero · 19.5x6.75 · s/tapacubo');
      expect(texto.contains('null'), isFalse);
    });

    test('el tapacubo se dice siempre: distingue dos llantas iguales', () {
      final con = nombreTipoLlanta({'material': 'acero', 'medida': '22.5x11.75', 'tapacubo': true});
      final sin = nombreTipoLlanta({'material': 'acero', 'medida': '22.5x11.75', 'tapacubo': false});
      expect(con, isNot(sin));
    });

    test('un catálogo vacío no deja la pantalla en blanco', () {
      expect(nombreTipoLlanta({}), '—');
    });
  });
}
