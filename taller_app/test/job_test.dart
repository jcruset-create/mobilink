import 'package:flutter_test/flutter_test.dart';
import 'package:taller_app/models/job.dart';

/// El backend devuelve los trabajos tal cual salen de la tabla `jobs`, con
/// campos que a veces faltan y números que llegan como int o como double según
/// el driver. `Job.fromJson` es el único punto donde eso se normaliza, así que
/// es lo que más duele si se rompe: un fallo aquí deja la lista de tareas del
/// técnico en blanco sin ningún error visible.
void main() {
  _pruebasDelParte();
  group('Job.fromJson', () {
    test('lee un trabajo completo del backend', () {
      final job = Job.fromJson({
        'id': 812,
        'area': 'movil',
        'plate': '1234ABC',
        'urgent': true,
        'status': 'activo',
        'assignedNames': ['David', 'Jesús'],
        'reason': 'Cambiar 2 neumáticos',
        'customerName': 'Encatrans',
        'customerPhone': '600111222',
        'createdAtMs': 1750000000000,
        'startedAtMs': 1750000600000,
        'workshopId': 'sea-tarragona',
      });

      expect(job.id, 812);
      expect(job.plate, '1234ABC');
      expect(job.urgent, isTrue);
      expect(job.assignedNames, ['David', 'Jesús']);
      expect(job.customerName, 'Encatrans');
      expect(job.workshopId, 'sea-tarragona');
      expect(job.isActive, isTrue);
      expect(job.isClosed, isFalse);
    });

    test('aguanta los campos que el backend puede omitir', () {
      final job = Job.fromJson({'id': 5});

      expect(job.area, '');
      expect(job.plate, '');
      expect(job.urgent, isFalse);
      // Sin estado explícito, el trabajo está en espera: no se puede asumir
      // que esté activo, o la app lo pintaría como en curso.
      expect(job.status, 'espera');
      expect(job.assignedNames, isEmpty);
      expect(job.startedAtMs, isNull);
      expect(job.workshopId, isNull);
    });

    // Este es el caso que tumbaba la app al abrirla en la tablet: las columnas
    // de tiempo de `jobs` son BIGINT y el driver de Postgres las serializa como
    // cadena para no perder precisión.
    test('acepta números serializados como cadena (BIGINT de Postgres)', () {
      final job = Job.fromJson({
        'id': '812',
        'status': 'activo',
        'createdAtMs': '1750000000000',
        'startedAtMs': '1750000600000',
        'actualMinutes': '90',
        'closedAtMs': '',
      });

      expect(job.id, 812);
      expect(job.createdAtMs, 1750000000000);
      expect(job.startedAtMs, 1750000600000);
      expect(job.actualMinutes, 90);
      // Cadena vacía no es un cero: es "no hay dato".
      expect(job.closedAtMs, isNull);
    });

    test('un número ilegible no revienta la lista entera', () {
      final job = Job.fromJson({'id': 7, 'createdAtMs': 'ayer'});

      expect(job.id, 7);
      expect(job.createdAtMs, isNull);
    });

    test('acepta ids y tiempos que llegan como double', () {
      final job = Job.fromJson({
        'id': 42.0,
        'status': 'parado',
        'createdAtMs': 1750000000000.0,
        'actualMinutes': 90.0,
      });

      expect(job.id, 42);
      expect(job.createdAtMs, 1750000000000);
      expect(job.actualMinutes, 90);
      expect(job.isPaused, isTrue);
    });

    test('los estados derivados no se pisan entre sí', () {
      final cerrado = Job.fromJson({'id': 1, 'status': 'cerrado'});

      expect(cerrado.isClosed, isTrue);
      expect(cerrado.isActive, isFalse);
      expect(cerrado.isPaused, isFalse);
    });
  });
}

void _pruebasDelParte() {
  group('lo que trae el parte de trabajo', () {
    test('lee las tareas incluidas y los materiales del JSONB', () {
      final job = Job.fromJson({
        'id': 1,
        'area': 'Montaje camión',
        'plate': '8072MNC',
        'status': 'activo',
        'quantity': 4,
        'unitMinutes': 25,
        'ptNumero': 'D2_26/62',
        'includedTasks': [
          {'label': 'Montaje fijación', 'quantity': 4, 'standardMinutes': 40},
        ],
        'materiales': [
          {'descripcion': '315/70X22.5 SAILUN', 'unidades': 4, 'precioTotal': 2400},
        ],
      });

      expect(job.ptNumero, 'D2_26/62');
      expect(job.tareasIncluidas.length, 1);
      expect(job.materiales.single.descripcion, '315/70X22.5 SAILUN');
      expect(job.materiales.single.unidades, 4);
    });

    test('la mano de obra junta la principal y las incluidas, y suma minutos', () {
      final job = Job.fromJson({
        'id': 1,
        'area': 'camion',
        'plate': '8072MNC',
        'status': 'activo',
        'quantity': 4,
        'unitMinutes': 25,
        'includedTasks': [
          {'label': 'Montaje fijación', 'quantity': 4, 'standardMinutes': 40},
        ],
      });

      final lineas = job.manoDeObra('Montaje camión mayor 19.5"');

      expect(lineas.length, 2);
      expect(lineas.first.principal, isTrue);
      expect(lineas.first.minutos, 100);
      expect(job.minutosManoDeObra('Montaje camión mayor 19.5"'), 140);
    });

    test('aguanta null, listas vacías y basura en las dos columnas', () {
      final job = Job.fromJson({
        'id': 1,
        'area': 'camion',
        'plate': '8072MNC',
        'status': 'activo',
        'includedTasks': null,
        'materiales': 'no es una lista',
      });

      expect(job.tareasIncluidas, isEmpty);
      expect(job.materiales, isEmpty);
      expect(job.manoDeObra('Pinchazo').length, 1);
    });

    test('descarta material sin descripción o sin unidades', () {
      final job = Job.fromJson({
        'id': 1,
        'area': 'camion',
        'plate': '8072MNC',
        'status': 'activo',
        'materiales': [
          {'descripcion': '', 'unidades': 4},
          {'descripcion': 'Sin unidades', 'unidades': 0},
          {'descripcion': 'Válida', 'unidades': 1},
        ],
      });

      expect(job.materiales.length, 1);
      expect(job.materiales.single.descripcion, 'Válida');
    });

    test('las cantidades llegan como cadena desde Postgres y se leen igual', () {
      final job = Job.fromJson({
        'id': 1,
        'area': 'camion',
        'plate': '8072MNC',
        'status': 'activo',
        'quantity': '4',
        'unitMinutes': '25',
        'materiales': [
          {'descripcion': 'Neumático', 'unidades': '4'},
        ],
      });

      expect(job.quantity, 4);
      expect(job.materiales.single.unidades, 4);
      expect(job.minutosManoDeObra('Montaje'), 100);
    });
  });
}
