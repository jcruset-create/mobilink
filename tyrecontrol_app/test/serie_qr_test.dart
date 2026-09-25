import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/serie_qr.dart';

void main() {
  group('SerieQr', () {
    test('el QR de una etiqueta nuestra: solo el número', () {
      final r = SerieQr.leer('6162121986');
      expect(r.valida, isTrue);
      expect(r.serie, '6162121986');
      expect(r.aviso, isNull);
    });

    test('se limpia igual que al teclearlo: sin espacios de sobra y en mayúsculas', () {
      expect(SerieQr.leer('  ab12cd34  ').serie, 'AB12CD34');
    });

    test('se admiten los separadores que estampan algunos fabricantes', () {
      expect(SerieQr.leer('1234-5678/90').serie, '1234-5678/90');
    });

    test('el QR de una herramienta se reconoce y se dice cuál es', () {
      // Es el error típico: tener el QR equivocado en la mano.
      final r = SerieQr.leer('https://panel.mobilink.es/qr/herramienta/'
          '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
      expect(r.valida, isFalse);
      expect(r.aviso, contains('herramienta'));
    });

    test('cualquier otra dirección de internet tampoco vale', () {
      expect(SerieQr.leer('https://example.com/loquesea').valida, isFalse);
    });

    test('un QR con un texto dentro no es un número de serie', () {
      expect(SerieQr.leer('Taller Mobilink Tarragona').valida, isFalse);
      expect(SerieQr.leer('linea1\nlinea2').valida, isFalse);
    });

    test('demasiado corto o demasiado largo se rechaza', () {
      expect(SerieQr.leer('12').valida, isFalse);
      expect(SerieQr.leer('1' * (SerieQr.maximo + 1)).valida, isFalse);
    });

    test('sin ningún dígito no es un número de serie', () {
      expect(SerieQr.leer('ABCDEFGH').valida, isFalse);
    });

    test('vacío o nulo no revienta', () {
      expect(SerieQr.leer(null).valida, isFalse);
      expect(SerieQr.leer('   ').aviso, contains('vacío'));
    });

    test('siempre se dice POR QUÉ no vale: un rechazo mudo no ayuda a nadie', () {
      for (final malo in ['', '12', 'https://x.es/a', 'hola que tal', 'ABC']) {
        final r = SerieQr.leer(malo);
        expect(r.valida, isFalse);
        expect(r.aviso, isNotNull);
        expect(r.aviso!.isNotEmpty, isTrue);
      }
    });
  });
}
