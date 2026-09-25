import 'package:flutter_test/flutter_test.dart';
import 'package:taller_app/services/outbox_politica.dart';

void main() {
  group('llevaJobId', () {
    test('una recepción no va asociada a ningún trabajo', () {
      expect(llevaJobId('recepcion'), isFalse);
    });

    test('los estados y las fotos sí', () {
      expect(llevaJobId('status'), isTrue);
      expect(llevaJobId('upload_file'), isTrue);
    });
  });

  group('accionPorRespuesta', () {
    test('lo enviado sale de la cola', () {
      expect(accionPorRespuesta(tipo: 'status', codigo: 200), AccionCola.quitar);
      expect(accionPorRespuesta(tipo: 'recepcion', codigo: 200), AccionCola.quitar);
    });

    test('una recepción con el servidor caído se conserva', () {
      expect(accionPorRespuesta(tipo: 'recepcion', codigo: 500), AccionCola.conservar);
      expect(accionPorRespuesta(tipo: 'recepcion', codigo: 503), AccionCola.conservar);
    });

    test('una recepción mal formada se descarta: reintentarla no la arregla', () {
      expect(accionPorRespuesta(tipo: 'recepcion', codigo: 400), AccionCola.quitar);
      expect(accionPorRespuesta(tipo: 'recepcion', codigo: 401), AccionCola.quitar);
    });

    test('los estados y las fotos siguen comportándose como antes', () {
      expect(accionPorRespuesta(tipo: 'status', codigo: 500), AccionCola.quitar);
      expect(accionPorRespuesta(tipo: 'upload_file', codigo: 400), AccionCola.quitar);
    });
  });

  group('accionPorExcepcion', () {
    test('sin red se para la pasada: el resto tampoco va a salir', () {
      expect(accionPorExcepcion(tipo: 'status', esDeRed: true), AccionCola.parar);
      expect(accionPorExcepcion(tipo: 'recepcion', esDeRed: true), AccionCola.parar);
    });

    test('un fallo que no es de red conserva la recepción y descarta el resto', () {
      expect(accionPorExcepcion(tipo: 'recepcion', esDeRed: false), AccionCola.conservar);
      expect(accionPorExcepcion(tipo: 'status', esDeRed: false), AccionCola.quitar);
    });
  });
}
