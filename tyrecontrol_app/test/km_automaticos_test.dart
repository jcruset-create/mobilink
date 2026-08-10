import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/models.dart';

// De este flag depende que la APK pida los kilómetros o no. Si diera true por
// error, el vehículo sin plataforma se quedaría otra vez sin km y nadie se
// enteraría hasta ir a calcular el desgaste por mil kilómetros.
Vehiculo _veh({String? webfleet}) => Vehiculo(
      id: 'v1',
      empresaId: 'e1',
      matricula: '1234ABC',
      kmActual: 0,
      activo: true,
      webfleetVehicleId: webfleet,
    );

void main() {
  group('Vehiculo.kmAutomaticos', () {
    test('enlazado con la plataforma: los km llegan solos', () {
      expect(_veh(webfleet: 'wf-123').kmAutomaticos, isTrue);
    });

    test('sin enlazar: hay que pedirlos', () {
      expect(_veh().kmAutomaticos, isFalse);
    });

    test('enlace vacío es lo mismo que no tenerlo', () {
      // El panel puede dejar la columna a "" en vez de a null al desenlazar.
      expect(_veh(webfleet: '').kmAutomaticos, isFalse);
    });

    test('se lee del json tal como viene de la tabla', () {
      final conEnlace = Vehiculo.fromJson({
        'id': 'v1', 'empresa_id': 'e1', 'matricula': '1234ABC',
        'km_actual': 415000, 'activo': true, 'webfleet_vehicle_id': 'wf-9',
      });
      final sinEnlace = Vehiculo.fromJson({
        'id': 'v2', 'empresa_id': 'e1', 'matricula': '5678BCD',
        'km_actual': 0, 'activo': true,
      });
      expect(conEnlace.kmAutomaticos, isTrue);
      expect(sinEnlace.kmAutomaticos, isFalse);
    });
  });
}
