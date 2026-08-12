import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/models.dart';

// La pantalla de Cambios lee el vehículo con obtenerVehiculoCompleto(), cuyo
// select trae la empresa embebida solo por el nombre. Al empezar a construir
// un Vehiculo con ese mapa —para saber si los km llegan solos de la
// plataforma— la empresa sin id tiraba la pantalla entera al entrar en
// Operaciones, con cualquier vehículo:
//
//   type 'Null' is not a subtype of type 'String'
//
// Reventaba en el modelo, así que no lo salvaba ningún try/catch de pantalla.
void main() {
  group('Vehiculo.fromJson con relaciones embebidas a medias', () {
    test('la empresa embebida sin id no tira la pantalla', () {
      final v = Vehiculo.fromJson({
        'id': 'v1', 'empresa_id': 'e1', 'matricula': '1234ABC',
        'km_actual': 0, 'activo': true,
        'empresa': {'nombre': 'Empresa Plana S.L.'}, // sin id: solo el nombre
      });
      expect(v.empresa?.nombre, 'Empresa Plana S.L.');
      // El id que vale es el de la columna, no el de la embebida.
      expect(v.empresaId, 'e1');
    });

    test('la empresa completa conserva su id', () {
      final v = Vehiculo.fromJson({
        'id': 'v1', 'empresa_id': 'e1', 'matricula': '1234ABC',
        'km_actual': 0, 'activo': true,
        'empresa': {'id': 'e1', 'nombre': 'Empresa Plana S.L.'},
      });
      expect(v.empresa?.id, 'e1');
    });

    test('un vehículo recién importado, con todo lo opcional en blanco', () {
      // Así salen los 119 de Plana: sin base, sin marca, sin modelo, sin
      // bastidor y sin enlace con la plataforma.
      final v = Vehiculo.fromJson({
        'id': 'v1', 'empresa_id': 'e1', 'matricula': '0072JFY',
        'km_actual': 0, 'activo': true,
        'delegacion_id': null, 'numero_unidad': null,
        'marca': null, 'modelo': null, 'webfleet_vehicle_id': null,
        'tipo_vehiculo_id': 't1',
        'empresa': {'nombre': 'Empresa Plana S.L.'},
        'tipo': {'id': 't1', 'nombre': 'autobus', 'configuracion_ejes': '2x4'},
      });
      expect(v.matricula, '0072JFY');
      expect(v.kmAutomaticos, isFalse);
      expect(v.tipo?.configuracionEjes, '2x4');
    });
  });
}
