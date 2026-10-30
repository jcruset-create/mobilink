import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/services/lectura_km.dart';

// De esto depende que se gaste o no una consulta al proveedor por cada
// revisión. Si diera true con una lectura caducada, el parte se cerraría con
// los kilómetros de hace tres horas sin que nadie lo notara.

final DateTime ahora = DateTime.utc(2026, 10, 29, 18, 0);

Map<String, dynamic> lectura({
  Object? km = 415000,
  Object? capturadoAt = '2026-10-29T17:55:00.000Z',
  Object? frescuraMin,
}) =>
    {
      'estado': 'actualizado',
      'km': km,
      'capturadoAt': capturadoAt,
      if (frescuraMin != null) 'frescuraMin': frescuraMin,
    };

void main() {
  group('lecturaSigueValiendo', () {
    test('recién capturada: se reutiliza', () {
      expect(lecturaSigueValiendo(lectura(), ahora: ahora), isTrue);
    });

    test('dentro de la frescura por defecto (120 min)', () {
      expect(
        lecturaSigueValiendo(
            lectura(capturadoAt: '2026-10-29T16:05:00.000Z'), ahora: ahora),
        isTrue,
      );
    });

    test('pasada la frescura: se vuelve a preguntar', () {
      expect(
        lecturaSigueValiendo(
            lectura(capturadoAt: '2026-10-29T15:30:00.000Z'), ahora: ahora),
        isFalse,
      );
    });

    test('manda la frescura que diga el servidor, no la de por defecto', () {
      // La misma lectura, de hace 60 minutos: con la frescura del servidor
      // (30 min) ya no vale; con la de por defecto (120 min) sí.
      const haceUnaHora = '2026-10-29T17:00:00.000Z';
      expect(
        lecturaSigueValiendo(lectura(capturadoAt: haceUnaHora, frescuraMin: 30), ahora: ahora),
        isFalse,
      );
      expect(
        lecturaSigueValiendo(lectura(capturadoAt: haceUnaHora), ahora: ahora),
        isTrue,
      );
    });

    test('sin lectura, sin km o sin fecha: se pregunta', () {
      expect(lecturaSigueValiendo(null, ahora: ahora), isFalse);
      expect(lecturaSigueValiendo(lectura(km: null), ahora: ahora), isFalse);
      expect(lecturaSigueValiendo(lectura(capturadoAt: null), ahora: ahora), isFalse);
      expect(lecturaSigueValiendo(lectura(capturadoAt: 'no es una fecha'), ahora: ahora), isFalse);
    });

    test('un vehículo sin telemática se vuelve a comprobar', () {
      // Puede haberse enlazado entre una pantalla y la siguiente.
      final sinTelematica = {
        'estado': 'sin_telematica', 'km': null, 'capturadoAt': null,
      };
      expect(lecturaSigueValiendo(sinTelematica, ahora: ahora), isFalse);
    });

    test('un reloj unos minutos adelantado no invalida la lectura', () {
      expect(
        lecturaSigueValiendo(
            lectura(capturadoAt: '2026-10-29T18:03:00.000Z'), ahora: ahora),
        isTrue,
      );
    });

    test('pero una captura muy en el futuro no se cree', () {
      expect(
        lecturaSigueValiendo(
            lectura(capturadoAt: '2026-10-29T20:00:00.000Z'), ahora: ahora),
        isFalse,
      );
    });
  });
}
