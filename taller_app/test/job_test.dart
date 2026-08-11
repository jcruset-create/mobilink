import 'package:flutter_test/flutter_test.dart';
import 'package:taller_app/models/job.dart';

/// El backend devuelve los trabajos tal cual salen de la tabla `jobs`, con
/// campos que a veces faltan y números que llegan como int o como double según
/// el driver. `Job.fromJson` es el único punto donde eso se normaliza, así que
/// es lo que más duele si se rompe: un fallo aquí deja la lista de tareas del
/// técnico en blanco sin ningún error visible.
void main() {
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
