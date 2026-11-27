import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/filtro_rebote.dart';

void main() {
  final t0 = DateTime(2026, 11, 27, 10);
  DateTime ms(int n) => t0.add(Duration(milliseconds: n));

  test('el eco de la misma lectura al instante se descarta', () {
    final f = FiltroRebote();
    expect(f.acepta(12.3, ms(0)), isTrue);
    expect(f.acepta(12.3, ms(40)), isFalse);
  });

  test('cualquier lectura a menos de 0,7 s es un rebote', () {
    final f = FiltroRebote();
    expect(f.acepta(12.3, ms(0)), isTrue);
    expect(f.acepta(11.8, ms(500)), isFalse);
  });

  test('la otra banda, apoyada con tiempo, entra aunque mida igual', () {
    final f = FiltroRebote();
    expect(f.acepta(12.3, ms(0)), isTrue);
    expect(f.acepta(11.9, ms(900)), isTrue); // valor distinto pasado 0,7 s
    expect(f.acepta(11.9, ms(1200)), isFalse); // mismo valor a 0,3 s: eco
    expect(f.acepta(11.9, ms(2600)), isTrue); // mismo valor, pasado 1,5 s
  });

  test('un descarte no cuenta como «anterior»', () {
    final f = FiltroRebote();
    expect(f.acepta(10, ms(0)), isTrue);
    expect(f.acepta(10, ms(600)), isFalse);
    // 0,8 s desde la aceptada (no desde la descartada) y distinto valor: entra.
    expect(f.acepta(9.5, ms(800)), isTrue);
  });

  test('reiniciar olvida la anterior', () {
    final f = FiltroRebote();
    expect(f.acepta(10, ms(0)), isTrue);
    f.reiniciar();
    expect(f.acepta(10, ms(10)), isTrue);
  });
}
