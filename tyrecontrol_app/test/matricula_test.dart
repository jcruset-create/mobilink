import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/matricula.dart';

void main() {
  test('normaliza quitando espacios, guiones y minúsculas', () {
    expect(normalizarMatricula(' 4721-lmn '), '4721LMN');
    expect(normalizarMatricula(null), '');
  });

  test('reconoce los formatos', () {
    expect(formatoMatricula('4721LMN'), FormatoMatricula.actual);
    expect(formatoMatricula('R1234BCD'), FormatoMatricula.remolque);
    expect(formatoMatricula('M1234AB'), FormatoMatricula.provincial);
    expect(formatoMatricula('GI1234X'), FormatoMatricula.provincial);
    // Vocales en la parte de letras: no es una matrícula actual.
    expect(formatoMatricula('4721LAN'), FormatoMatricula.desconocido);
    expect(formatoMatricula('47'), FormatoMatricula.desconocido);
  });

  test('marca como dudosos los caracteres que no cuadran con el formato', () {
    expect(dudososPorFormato('4721LMN'), isEmpty);
    // Una I donde va un número (472I) y un 0 donde va una letra (LM0).
    expect(dudososPorFormato('472ILM0'), [3, 6]);
    // Remolque: la R no cuenta, la O sí.
    expect(dudososPorFormato('R12O4BCD'), [3]);
    // Fuera de los formatos de 7 y 8 no se juzga por posición.
    expect(dudososPorFormato('M1234AB0'), isEmpty);
  });

  test('el juicio junta las dudas de la IA y las del formato', () {
    final j = JuicioMatricula.de('4721-lmn', dudososIa: [5, 99]);
    expect(j.matricula, '4721LMN');
    expect(j.dudosos, [5]);
    expect(j.valeParaAlta, isFalse);

    final bien = JuicioMatricula.de('4721LMN');
    expect(bien.valeParaAlta, isTrue);

    final sinFormato = JuicioMatricula.de('ABCDEFG');
    expect(sinFormato.formatoValido, isFalse);
    expect(sinFormato.valeParaAlta, isFalse);
  });

  test('se escribe como en la placa', () {
    expect(matriculaLegible('4721LMN'), '4721 LMN');
    expect(matriculaLegible('r1234bcd'), 'R 1234 BCD');
    expect(matriculaLegible('M1234AB'), 'M1234AB');
  });
}
