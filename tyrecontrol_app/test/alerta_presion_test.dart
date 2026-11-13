/// Cómo se dice un aviso de presión en la tablet.
///
/// Las mismas reglas que en el panel (`alertasPresion.test.ts`), y por eso se
/// prueban otra vez aquí: son decisiones de qué se afirma y qué no, y si las
/// dos pantallas se separan, el cliente ve dos números distintos para el mismo
/// aviso.
///
/// Lo que se fija, sobre todo, es que no se afirme nada que el correo no diga.

import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/alerta_presion.dart';

AlertaPresion aviso({
  String tipo = 'presion_baja',
  double? presion = 4,
  double? recomendada = 8,
  double? desviacion = -49.65,
  int avisos = 1,
  DateTime? primero,
  DateTime? ultimo,
  String? posicion = 'E2_DER_INT',
  String? neumatico,
}) =>
    AlertaPresion(
      id: 'a1',
      vehiculoId: 'v1',
      posicionId: 'p1',
      tipo: tipo,
      severidad: 'alta',
      presionBar: presion,
      presionRecomendadaBar: recomendada,
      desviacionPct: desviacion,
      avisos: avisos,
      primerAvisoAt: primero,
      ultimoAvisoAt: ultimo,
      codigoPosicion: posicion,
      codigoNeumatico: neumatico,
    );

void main() {
  group('cómo se dice la presión', () {
    test('el caso normal: lo medido, lo recomendado y la desviación', () {
      // El aviso real de 1467HJS del 10/11.
      expect(textoDePresion(aviso()), '4 bar de 8 recomendados (-49.65 %)');
    });

    test('sin lectura NO se dice cero', () {
      // Es el aviso de «neumático desinflado», donde el correo pone `!!!`.
      // «0 bar» afirmaría que se midió cero, y lo que pasa es que el sensor no
      // da un número fiable.
      expect(
        textoDePresion(aviso(tipo: 'desinflado', presion: null, desviacion: null)),
        'Sin lectura del sensor de 8 recomendados',
      );
    });

    test('el porcentaje no se inventa cuando falta', () {
      expect(textoDePresion(aviso(desviacion: null)), '4 bar de 8 recomendados');
    });

    test('sin recomendada tampoco', () {
      expect(textoDePresion(aviso(recomendada: null, desviacion: null)), '4 bar');
    });

    test('se copia el porcentaje del correo aunque no cuadre con los bares', () {
      // 2,0 sobre 2,5 serían −20 % y el correo dice −18,76 %: los bares vienen
      // redondeados. Calcularlo daría un número distinto del de su portal.
      final t = textoDePresion(aviso(presion: 2, recomendada: 2.5, desviacion: -18.76));
      expect(t, contains('-18.76 %'));
      expect(t, isNot(contains('-20')));
    });

    test('los decimales se dicen como una persona: «8» y no «8.0»', () {
      expect(textoDePresion(aviso(presion: 4.4, recomendada: 8, desviacion: -45.19)),
          '4.4 bar de 8 recomendados (-45.19 %)');
    });
  });

  group('cuántas veces ha avisado', () {
    test('con un solo aviso no se dice nada', () {
      // Decir «1 aviso» en todas las líneas es ruido que tapa las que sí
      // llevan días avisando.
      expect(textoDeRepeticion(aviso()), isNull);
    });

    test('con varios se dice desde cuándo', () {
      // Es el dato que distingue una presión baja de una fuga.
      expect(
        textoDeRepeticion(aviso(avisos: 3, primero: DateTime(2026, 11, 8, 7, 58))),
        '3 avisos desde el 08/11',
      );
    });

    test('sin fecha de inicio, el número a secas', () {
      expect(textoDeRepeticion(aviso(avisos: 2)), '2 avisos');
    });
  });

  group('las fechas', () {
    test('día y mes, con el cero delante', () {
      expect(fechaCorta(DateTime(2026, 11, 8)), '08/11');
    });

    test('día, mes y hora', () {
      expect(fechaYHoraCorta(DateTime(2026, 11, 10, 22, 30)), '10/11 22:30');
    });

    test('sin fecha no se pinta nada raro', () {
      expect(fechaCorta(null), isNull);
      expect(fechaYHoraCorta(null), isNull);
    });
  });

  group('el nombre del tipo', () {
    test('los dos que manda Goodyear', () {
      expect(nombreDelTipo('presion_baja'), 'Presión baja');
      expect(nombreDelTipo('desinflado'), 'Neumático desinflado');
    });

    test('un tipo que no conocemos todavía no revienta', () {
      // De diez correos reales salieron dos tipos; habrá más. Mientras no se
      // añadan, se enseña el caso general en vez de dejar la línea en blanco.
      expect(nombreDelTipo('temperatura_alta'), 'Presión baja');
    });
  });

  group('lo que viene de la base', () {
    test('se lee una fila tal como la devuelve Supabase', () {
      final a = AlertaPresion.desdeJson({
        'id': 'a1',
        'vehiculo_id': 'v1',
        'posicion_id': 'p1',
        'tipo': 'presion_baja',
        'severidad': 'alta',
        'presion_bar': 4.0,
        'presion_recomendada_bar': 8.0,
        'desviacion_pct': -49.65,
        'avisos': 3,
        'primer_aviso_at': '2026-11-08T07:58:00+00:00',
        'ultimo_aviso_at': '2026-11-10T21:30:54+00:00',
        'posicion': {'codigo_posicion': 'E2_DER_INT'},
        'neumatico': {'codigo_interno': 'PLN-0421', 'numero_serie': 'X9'},
      });
      expect(a.codigoPosicion, 'E2_DER_INT');
      expect(a.codigoNeumatico, 'PLN-0421');
      expect(a.avisos, 3);
      expect(a.presionBar, 4.0);
    });

    test('los números pueden venir como texto', () {
      // PostgREST devuelve `numeric` como cadena según la configuración.
      final a = AlertaPresion.desdeJson({
        'id': 'a1', 'vehiculo_id': 'v1', 'posicion_id': 'p1',
        'tipo': 'desinflado', 'severidad': 'alta',
        'presion_bar': null, 'presion_recomendada_bar': '8.00', 'avisos': '2',
      });
      expect(a.presionBar, isNull);
      expect(a.presionRecomendadaBar, 8.0);
      expect(a.avisos, 2);
    });

    test('sin posición ni neumático enlazados no revienta', () {
      final a = AlertaPresion.desdeJson({
        'id': 'a1', 'vehiculo_id': 'v1', 'posicion_id': 'p1',
        'tipo': 'presion_baja', 'severidad': 'alta',
      });
      expect(a.codigoPosicion, isNull);
      expect(a.codigoNeumatico, isNull);
      expect(a.avisos, 1);
    });
  });
}
