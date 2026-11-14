import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/protocolo_profundidad.dart';

/// Los mismos casos que `protocoloProfundidad.test.ts` del panel: si una de
/// las dos reglas se mueve, estas pruebas y aquéllas dejan de decir lo mismo.

final _base = DateTime(2026, 11, 12);

/// Lecturas del arco, de la más reciente a la más antigua.
List<LecturaDeSerie> arco(List<double> mm) => [
      for (var i = 0; i < mm.length; i++) LecturaDeSerie(mm[i], fecha: _base.subtract(Duration(days: i))),
    ];
LecturaDeSerie aMano(double mm) => LecturaDeSerie(mm, manual: true, fecha: _base);

Veredicto juicio(ValorDeLaGoma? v, double? minimo) => veredicto(
      mm: v?.mm,
      confirmada: v?.confirmada ?? false,
      pendienteMm: v?.pendienteMm,
      minimo: minimo,
    );

void main() {
  group('valorDeLaSerie · tres lecturas: la mediana', () {
    test('el 4310JYJ: 8,7 · 8,5 · 1,8 → vale 8,5 y el 1,8 queda pendiente', () {
      final v = valorDeLaSerie(arco([1.8, 8.5, 8.7]))!;
      expect(v.mm, 8.5);
      expect(v.confirmada, isTrue);
      expect(v.pendienteMm, 1.8);
      expect(v.pendienteEn, _base);
    });

    test('el pico hacia arriba tampoco mueve el valor', () {
      final v = valorDeLaSerie(arco([10.7, 8.6, 8.6]))!;
      expect(v.mm, 8.6);
      expect(v.pendienteMm, 10.7);
    });

    test('un desgaste de verdad se confirma a la segunda lectura', () {
      final v = valorDeLaSerie(arco([3.0, 3.2, 9]))!;
      expect(v.mm, 3.2);
      expect(v.confirmada, isTrue);
      expect(v.pendienteMm, isNull);
    });

    test('el ruido normal no deja nada pendiente', () {
      final v = valorDeLaSerie(arco([8.5, 8.7, 9.2]))!;
      expect(v.mm, 8.7);
      expect(v.pendienteMm, isNull);
    });

    test('devuelve una lectura que existió, con su fecha, no un promedio', () {
      final v = valorDeLaSerie(arco([8.5, 9.2, 8.7]))!;
      expect(v.mm, 8.7);
      expect(v.fecha, _base.subtract(const Duration(days: 2)));
    });

    test('con dos iguales, la fecha es la de la más reciente de las dos, como en el panel', () {
      final v = valorDeLaSerie(arco([10.7, 8.6, 8.6]))!;
      expect(v.fecha, _base.subtract(const Duration(days: 2)));
      final w = valorDeLaSerie(arco([8.6, 8.6, 1.0]))!;
      expect(w.fecha, _base);
    });

    test('solo mira las tres últimas', () {
      expect(valorDeLaSerie(arco([8.5, 8.6, 8.7, 1.0, 1.0]))!.mm, 8.6);
    });

    test('justo en la tolerancia no es un disparate', () {
      expect(valorDeLaSerie(arco([8.5 - toleranciaMm, 8.5, 8.5]))!.pendienteMm, isNull);
    });
  });

  group('valorDeLaSerie · con menos de tres', () {
    test('dos que coinciden: vale la última, confirmada', () {
      final v = valorDeLaSerie(arco([3.1, 3.4]))!;
      expect((v.mm, v.confirmada, v.pendienteMm), (3.1, true, null));
    });

    test('dos que NO coinciden: se queda la anterior y la última queda pendiente', () {
      final v = valorDeLaSerie(arco([1.8, 8.5]))!;
      expect((v.mm, v.confirmada, v.pendienteMm), (8.5, false, 1.8));
    });

    test('una sola: es lo que hay, sin confirmar', () {
      final v = valorDeLaSerie(arco([3.0]))!;
      expect((v.mm, v.confirmada, v.pendienteMm), (3.0, false, null));
    });

    test('ninguna: no hay valor', () {
      expect(valorDeLaSerie([]), isNull);
    });
  });

  group('valorDeLaSerie · la medición a mano manda', () {
    test('la última a mano vale sola, sin esperar a nadie', () {
      final v = valorDeLaSerie([aMano(3.0), ...arco([8.5, 8.6])])!;
      expect((v.mm, v.confirmada, v.pendienteMm), (3.0, true, null));
    });

    test('lo anterior a la medición a mano deja de contar', () {
      final v = valorDeLaSerie([...arco([8.4]), aMano(8.5), ...arco([2.0])])!;
      expect(v.mm, 8.4);
      expect(v.confirmada, isTrue);
    });

    test('un disparate del arco justo después de una manual no la tumba', () {
      final v = valorDeLaSerie([...arco([1.8]), aMano(8.5)])!;
      expect((v.mm, v.confirmada, v.pendienteMm), (8.5, true, 1.8));
    });

    test('con la manual la más antigua de las tres, entra en la mediana como una más', () {
      expect(valorDeLaSerie([...arco([8.4, 8.2]), aMano(8.5)])!.mm, 8.4);
    });
  });

  group('veredicto', () {
    const min = 4.0;

    test('rojo solo si el valor bajo está confirmado', () {
      expect(juicio(valorDeLaSerie(arco([3.0, 3.2, 9])), min), Veredicto.cambiar);
      expect(juicio(valorDeLaSerie([aMano(3.0)]), min), Veredicto.cambiar);
    });

    test('una sola lectura baja: por confirmar, no rojo', () {
      expect(juicio(valorDeLaSerie(arco([3.0])), min), Veredicto.porConfirmar);
    });

    test('el 4310JYJ: valor 8,5 con un 1,8 pendiente → por confirmar', () {
      expect(juicio(valorDeLaSerie(arco([1.8, 8.5, 8.7])), min), Veredicto.porConfirmar);
    });

    test('una gastada de verdad con un pico hacia arriba encima sigue en rojo', () {
      expect(juicio(valorDeLaSerie(arco([10.7, 3.0, 3.1])), min), Veredicto.cambiar);
    });

    test('dos que no coinciden con la vieja baja: por confirmar', () {
      expect(juicio(valorDeLaSerie(arco([9.0, 3.0])), min), Veredicto.porConfirmar);
    });

    test('en el mínimo justo cuenta como en el informe: ≤', () {
      expect(juicio(valorDeLaSerie(arco([4.0, 4.0, 4.1])), min), Veredicto.cambiar);
      expect(juicio(valorDeLaSerie(arco([4.1, 4.1, 4.2])), min), Veredicto.ok);
    });

    test('un pendiente ALTO sobre un valor bueno no es nada', () {
      expect(juicio(valorDeLaSerie(arco([12.9, 8.6, 8.6])), min), Veredicto.ok);
    });

    test('sin valor o sin mínimo no se acusa a nadie', () {
      expect(juicio(null, min), Veredicto.ok);
      expect(juicio(valorDeLaSerie(arco([1.0, 1.0, 1.0])), null), Veredicto.ok);
    });
  });

  group('profundidadMinimaPorLlanta', () {
    test('22.5 → 4 · 19.5 y 17.5 → 3 · 16 o menos → 2', () {
      expect(profundidadMinimaPorLlanta('295/80R22.5'), 4);
      expect(profundidadMinimaPorLlanta('285/70 R19.5'), 3);
      expect(profundidadMinimaPorLlanta('215/75R17,5'), 3);
      expect(profundidadMinimaPorLlanta('225/65R16C'), 2);
    });

    test('el índice de carga pegado no se cuela en la llanta', () {
      expect(llantaDeMedida('295/80R22.5 154/149M'), 22.5);
    });

    test('sin llanta reconocible no hay mínimo: null no es cero', () {
      expect(profundidadMinimaPorLlanta(null), isNull);
      expect(profundidadMinimaPorLlanta('0'), isNull);
    });
  });
}
