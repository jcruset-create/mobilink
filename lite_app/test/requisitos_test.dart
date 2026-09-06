import 'package:flutter_test/flutter_test.dart';
import 'package:lite_app/services/requisitos.dart';

/// Los casos que tienen que impedir avanzar, uno por uno.
///
/// Se prueba el criterio, que es lo que decide si el operario puede seguir o
/// no: `Requisitos.alLlegar` y `Requisitos.alFinalizar` sobre un estado de
/// evidencias dado. La recogida de ese estado (`Evidencias.cargar`) habla con
/// la API y con Hive, así que sus dos casos —sin cobertura y app reabierta—
/// se prueban en el móvil; están en el README.
Evidencias con({
  Set<String> categorias = const {},
  bool firma = false,
  String nombre = '',
  String documento = '',
  int montajes = 0,
}) =>
    Evidencias(
      categorias: categorias,
      firma: firma,
      firmanteNombre: nombre,
      firmanteDocumento: documento,
      montajesConfirmados: montajes,
      sinConexion: false,
    );

/// Todo lo del cierre menos lo que se quiera quitar en cada caso.
Evidencias completa({
  Set<String>? categorias,
  bool firma = true,
  String nombre = 'Ana Pérez',
  String documento = '12345678Z',
  int montajes = 0,
}) =>
    con(
      categorias: categorias ??
          {
            Requisitos.catMatricula,
            Requisitos.catAveria,
            Requisitos.catReparacion,
          },
      firma: firma,
      nombre: nombre,
      documento: documento,
      montajes: montajes,
    );

void main() {
  group('Al llegar al punto', () {
    test('CASO 1 · sin foto de matrícula no se puede continuar', () {
      final faltan = Requisitos.alLlegar(con(categorias: {Requisitos.catAveria}));
      expect(faltan, isNotEmpty);
      expect(faltan, contains(Requisitos.etiquetas[Requisitos.catMatricula]));
    });

    test('CASO 2 · con matrícula pero sin avería tampoco', () {
      final faltan =
          Requisitos.alLlegar(con(categorias: {Requisitos.catMatricula}));
      expect(faltan, [Requisitos.etiquetas[Requisitos.catAveria]]);
    });

    test('CASO 3 · con las dos, adelante', () {
      final faltan = Requisitos.alLlegar(
          con(categorias: {Requisitos.catMatricula, Requisitos.catAveria}));
      expect(faltan, isEmpty);
    });

    test('sin ninguna, se nombran las dos: nada de "faltan datos"', () {
      expect(Requisitos.alLlegar(con()).length, 2);
    });
  });

  group('Al finalizar', () {
    test('CASO 4 · sin foto de la reparación no se cierra', () {
      final faltan = Requisitos.alFinalizar(completa(
        categorias: {Requisitos.catMatricula, Requisitos.catAveria},
      ));
      expect(faltan, [Requisitos.etiquetas[Requisitos.catReparacion]]);
    });

    test('CASO 5 · sin nombre del cliente no se cierra', () {
      expect(Requisitos.alFinalizar(completa(nombre: '  ')),
          ['Nombre y apellidos del cliente']);
    });

    test('CASO 6 · sin DNI no se cierra', () {
      expect(Requisitos.alFinalizar(completa(documento: '')),
          ['DNI / NIE del cliente']);
    });

    test('CASO 7 · sin firma no se cierra', () {
      final faltan = Requisitos.alFinalizar(completa(firma: false));
      expect(faltan, ['Firma del cliente']);
    });

    test('CASO 8 · neumático nuevo sin foto del montaje no se cierra', () {
      final faltan = Requisitos.alFinalizar(completa(montajes: 1));
      expect(faltan, [Requisitos.etiquetas[Requisitos.catMontaje]]);
    });

    test('CASO 9 · neumático nuevo CON su foto y el resto completo, se cierra', () {
      final faltan = Requisitos.alFinalizar(completa(
        categorias: {
          Requisitos.catMatricula,
          Requisitos.catAveria,
          Requisitos.catReparacion,
          Requisitos.catMontaje,
        },
        montajes: 2,
      ));
      expect(faltan, isEmpty);
    });

    test('sin neumático nuevo, la foto de montaje NO se pide', () {
      expect(Requisitos.alFinalizar(completa(montajes: 0)), isEmpty);
    });

    test('el cierre arrastra lo de la llegada: se pide todo lo que falte', () {
      final faltan = Requisitos.alFinalizar(con());
      expect(faltan, containsAll([
        Requisitos.etiquetas[Requisitos.catMatricula],
        Requisitos.etiquetas[Requisitos.catAveria],
        Requisitos.etiquetas[Requisitos.catReparacion],
        'Firma del cliente',
      ]));
    });

    test('cada fallo se nombra por separado, sin mensajes genéricos', () {
      for (final f in Requisitos.alFinalizar(con())) {
        expect(f.length, greaterThan(8));
        expect(f.toLowerCase(), isNot(contains('faltan datos')));
      }
    });

    test('el nombre y el DNI solo se exigen si hay firma que identificar', () {
      final faltan = Requisitos.alFinalizar(completa(firma: false, nombre: '', documento: ''));
      expect(faltan, ['Firma del cliente']);
    });
  });
}
