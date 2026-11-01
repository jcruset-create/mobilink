import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sea_tarragona_operario/services/api_service.dart';
import 'package:sea_tarragona_operario/services/seguimiento_ubicacion.dart';

/// El GPS fingido: cuenta cuántas veces se abre el flujo de posiciones y deja
/// meter posiciones a mano.
class _GpsFingido extends GeolocatorPlatform {
  int flujosAbiertos = 0;
  StreamController<Position>? controlador;
  LocationPermission permiso = LocationPermission.whileInUse;

  @override
  Future<bool> isLocationServiceEnabled() async => true;
  @override
  Future<LocationPermission> checkPermission() async => permiso;
  @override
  Future<LocationPermission> requestPermission() async => permiso;
  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) {
    flujosAbiertos++;
    controlador = StreamController<Position>();
    return controlador!.stream;
  }
}

class _ApiFingida extends ApiService {
  _ApiFingida() : super(techName: 'Iván', code: '0000');
  final enviados = <int>[];
  @override
  Future<void> sendLocation(int id, double lat, double lng,
      {double? accuracyM, double? speedKmh}) async {
    enviados.add(id);
  }
}

Position _pos() => Position(
      latitude: 41.1,
      longitude: 1.2,
      timestamp: DateTime.now(),
      accuracy: 5,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 10,
      speedAccuracy: 0,
    );

void main() {
  late _GpsFingido gps;
  late _ApiFingida api;
  final seguimiento = SeguimientoUbicacion.instancia;

  setUp(() async {
    gps = _GpsFingido();
    GeolocatorPlatform.instance = gps;
    api = _ApiFingida();
    await seguimiento.detener();
  });

  test('con una asistencia en camino, la sigue aunque no se abra su pantalla', () async {
    await seguimiento.sincronizar(api, [
      {'id': 7, 'status': 'asignada'},
      {'id': 8, 'status': 'en_camino'},
    ]);
    expect(seguimiento.asistenciaActiva, 8);

    gps.controlador!.add(_pos());
    await Future<void>.delayed(Duration.zero);
    expect(api.enviados, [8]);
  });

  test('no manda dos posiciones en menos del intervalo', () async {
    await seguimiento.iniciar(api, 8);
    gps.controlador!..add(_pos())..add(_pos())..add(_pos());
    await Future<void>.delayed(Duration.zero);
    expect(api.enviados, [8]);
  });

  test('refrescar la lista no reabre el GPS de la misma asistencia', () async {
    final lista = [{'id': 8, 'status': 'en_camino_base'}];
    await seguimiento.sincronizar(api, lista);
    await seguimiento.sincronizar(api, lista);
    expect(gps.flujosAbiertos, 1);
  });

  test('al pasar a un estado sin seguimiento, se para', () async {
    await seguimiento.iniciar(api, 8);
    await seguimiento.alCambiarEstado(api, 8, 'llegada_taller');
    expect(seguimiento.asistenciaActiva, isNull);
    expect(gps.controlador!.hasListener, isFalse);
  });

  test('sin asistencias en camino, se para', () async {
    await seguimiento.iniciar(api, 8);
    await seguimiento.sincronizar(api, [{'id': 8, 'status': 'en_punto'}]);
    expect(seguimiento.asistenciaActiva, isNull);
  });

  test('sin permiso de ubicación, no arranca', () async {
    gps.permiso = LocationPermission.deniedForever;
    await seguimiento.iniciar(api, 8);
    expect(seguimiento.asistenciaActiva, isNull);
    expect(gps.flujosAbiertos, 0);
  });
}
