// Lo que decide «Vehículos en bases» en la tablet.
//
// Réplica de `presenciaVista.test.ts` del panel en lo que la tablet usa. La
// prueba que más importa es la última: los tres grupos de pendientes —en
// base, fuera, sin ubicación— son exactamente todos los pendientes, sin
// repetir ni perder ninguno. Sin ella, un pendiente puede caerse por una
// grieta entre dos filtros y no revisarse nunca.

import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/presencia_vista.dart';

VehiculoPresencia veh(
  String id, {
  String estado = enBase,
  String? base,
  String? entrada,
  int? distancia,
  int? antiguedad,
  double? velocidad,
  String matricula = '0000AAA',
}) =>
    VehiculoPresencia(
      vehiculoId: id,
      estado: estado,
      delegacionId: base,
      entradaBaseAt: entrada,
      distanciaM: distancia,
      antiguedadMin: antiguedad,
      velocidadKmh: velocidad,
      matricula: matricula,
    );

RevisionEstado rev(String id, String estado, {int? dias, int? intervalo, String? origen, String? por}) =>
    RevisionEstado(
      vehiculoId: id,
      estado: estado,
      diasVencido: dias,
      intervaloDias: intervalo,
      ultimaRevisionOrigen: origen,
      ultimaRevisionPor: por,
    );

Map<String, RevisionEstado> mapa(List<RevisionEstado> rs) => {for (final r in rs) r.vehiculoId: r};

void main() {
  group('qué cuenta como pendiente', () {
    test('sin revisión, vencida y próxima sí; al día y desconocido no', () {
      expect(tieneRevisionPendiente(rev('a', 'sin_revision')), isTrue);
      expect(tieneRevisionPendiente(rev('a', 'vencida')), isTrue);
      expect(tieneRevisionPendiente(rev('a', 'proxima')), isTrue);
      expect(tieneRevisionPendiente(rev('a', 'al_dia')), isFalse);
      expect(tieneRevisionPendiente(null), isFalse);
    });

    test('el orden de prioridad: nunca revisado primero', () {
      expect(prioridadRevision('sin_revision'), 0);
      expect(prioridadRevision('vencida'), 1);
      expect(prioridadRevision('proxima'), 2);
      expect(prioridadRevision('al_dia'), 3);
      expect(prioridadRevision(null), 3);
    });
  });

  group('agruparPorBase', () {
    test('solo entra quien está dentro AHORA, no el de posición antigua', () {
      final vs = [
        veh('a', base: 'b1'),
        veh('b', estado: posicionAntigua, base: 'b1'),
        veh('c', estado: fueraDeBases, base: 'b1'),
        veh('d', base: 'b2'),
      ];
      final g = agruparPorBase(vs, {});
      expect(g['b1']!.map((v) => v.vehiculoId), ['a']);
      expect(g['b2']!.map((v) => v.vehiculoId), ['d']);
    });

    test('sin base asignada no se agrupa en ninguna', () {
      expect(agruparPorBase([veh('a')], {}), isEmpty);
    });

    test('primero el que más falta hace y, a igualdad, el que lleva más tiempo', () {
      final vs = [
        veh('aldia', base: 'b1', entrada: '2026-11-09T06:00:00Z'),
        veh('proxima', base: 'b1', entrada: '2026-11-09T06:00:00Z'),
        veh('nunca', base: 'b1', entrada: '2026-11-09T09:00:00Z'),
        veh('vencida-tarde', base: 'b1', entrada: '2026-11-09T09:00:00Z'),
        veh('vencida-pronto', base: 'b1', entrada: '2026-11-09T05:00:00Z'),
      ];
      final r = mapa([
        rev('aldia', 'al_dia'),
        rev('proxima', 'proxima'),
        rev('nunca', 'sin_revision'),
        rev('vencida-tarde', 'vencida'),
        rev('vencida-pronto', 'vencida'),
      ]);
      expect(agruparPorBase(vs, r)['b1']!.map((v) => v.vehiculoId), [
        'nunca',
        'vencida-pronto',
        'vencida-tarde',
        'proxima',
        'aldia',
      ]);
    });
  });

  group('los recuentos de cada tarjeta de base', () {
    test('revisablesPorBase cuenta solo los pendientes dentro ahora', () {
      final vs = [
        veh('a', base: 'b1'),
        veh('b', base: 'b1'),
        veh('c', base: 'b1'),
        veh('d', estado: posicionAntigua, base: 'b1'),
        veh('e', base: 'b2'),
      ];
      final r = mapa([
        rev('a', 'vencida'),
        rev('b', 'al_dia'),
        rev('c', 'proxima'),
        rev('d', 'vencida'),
        rev('e', 'sin_revision'),
      ]);
      expect(revisablesPorBase(vs, r), {'b1': 2, 'b2': 1});
    });

    test('dormidosPorBase cuenta los de posición antigua, y solo esos', () {
      final vs = [
        veh('a', estado: posicionAntigua, base: 'b1'),
        veh('b', estado: posicionAntigua, base: 'b1'),
        veh('c', base: 'b1'),
        veh('d', estado: sinPosicion, base: 'b1'),
      ];
      expect(dormidosPorBase(vs), {'b1': 2});
    });
  });

  group('las tres listas de pendientes', () {
    test('en base: solo IN_BASE y pendientes, el más vencido primero', () {
      final vs = [veh('a'), veh('b'), veh('c', estado: fueraDeBases)];
      final r = mapa([
        rev('a', 'vencida', dias: 3),
        rev('b', 'vencida', dias: 40),
        rev('c', 'vencida', dias: 90),
      ]);
      expect(revisablesEnBase(vs, r).map((v) => v.vehiculoId), ['b', 'a']);
    });

    test('fuera de base: solo OUTSIDE_BASES, nunca el de posición antigua', () {
      final vs = [
        veh('circulando', estado: fueraDeBases),
        veh('dormido-fuera', estado: posicionAntigua),
        veh('dentro'),
      ];
      final r = mapa([
        rev('circulando', 'vencida'),
        rev('dormido-fuera', 'vencida'),
        rev('dentro', 'vencida'),
      ]);
      expect(revisablesFueraDeBase(vs, r).map((v) => v.vehiculoId), ['circulando']);
    });

    test('sin ubicación: los tres estados que no afirman nada', () {
      final vs = [
        veh('vieja', estado: posicionAntigua),
        veh('sin', estado: sinPosicion),
        veh('mala', estado: posicionNoValida),
        veh('dentro'),
        veh('fuera', estado: fueraDeBases),
      ];
      final r = mapa([
        for (final id in ['vieja', 'sin', 'mala', 'dentro', 'fuera']) rev(id, 'vencida'),
      ]);
      expect(
        revisablesSinUbicacion(vs, r).map((v) => v.vehiculoId).toSet(),
        {'vieja', 'sin', 'mala'},
      );
    });

    test('la posición antigua dentro de una base cuenta como sin ubicación, no como en base', () {
      // No es una contradicción con que la tarjeta de la base lo liste aparte:
      // allí se dice cuántos duermen dentro, y aquí a quién se puede ir a
      // buscar. «Probablemente siga ahí» no vale para mandar a nadie al patio.
      final vs = [veh('dormido', estado: posicionAntigua, base: 'b1')];
      final r = mapa([rev('dormido', 'vencida')]);
      expect(revisablesEnBase(vs, r), isEmpty);
      expect(revisablesSinUbicacion(vs, r).map((v) => v.vehiculoId), ['dormido']);
    });

    test('LA SUMA CUADRA: los tres grupos son todos los pendientes, sin repetir', () {
      final vs = [
        veh('a', base: 'b1'),
        veh('b', base: 'b1'),
        veh('c', estado: fueraDeBases),
        veh('d', estado: posicionAntigua, base: 'b2'),
        veh('e', estado: sinPosicion),
        veh('f', estado: posicionNoValida),
        veh('g', base: 'b2'), // al día: no es pendiente
        veh('h', estado: fueraDeBases), // al día tampoco
      ];
      final r = mapa([
        rev('a', 'vencida', dias: 10),
        rev('b', 'sin_revision'),
        rev('c', 'proxima'),
        rev('d', 'vencida', dias: 2),
        rev('e', 'sin_revision'),
        rev('f', 'vencida', dias: 1),
        rev('g', 'al_dia', intervalo: 90),
        rev('h', 'al_dia', intervalo: 90),
      ]);

      final todos = vs.where((v) => tieneRevisionPendiente(r[v.vehiculoId])).map((v) => v.vehiculoId).toSet();
      final tres = [
        ...revisablesEnBase(vs, r),
        ...revisablesFueraDeBase(vs, r),
        ...revisablesSinUbicacion(vs, r),
      ].map((v) => v.vehiculoId).toList();

      expect(tres.toSet(), todos, reason: 'los tres grupos tienen que ser todos los pendientes');
      expect(tres.length, tres.toSet().length, reason: 'ninguno puede salir en dos grupos');
      expect(todos.length, 6);
    });
  });

  group('el «al día» que no dice nada', () {
    test('al día sin periodicidad es sospechoso; con periodicidad no', () {
      expect(sinPeriodicidad(rev('a', 'al_dia')), isTrue);
      expect(sinPeriodicidad(rev('a', 'al_dia', intervalo: 90)), isFalse);
      expect(sinPeriodicidad(rev('a', 'vencida')), isFalse);
      expect(sinPeriodicidad(null), isFalse);
    });

    test('solo se listan los que están en base ahora', () {
      final vs = [
        veh('dentro'),
        veh('fuera', estado: fueraDeBases),
        veh('dentro-ok'),
      ];
      final r = mapa([
        rev('dentro', 'al_dia'),
        rev('fuera', 'al_dia'),
        rev('dentro-ok', 'al_dia', intervalo: 90),
      ]);
      expect(sinPeriodicidadEnBase(vs, r).map((v) => v.vehiculoId), ['dentro']);
    });
  });

  group('cómo se dicen los números', () {
    final ahora = DateTime.utc(2026, 11, 9, 12, 0);

    test('desde: minutos, horas y días', () {
      expect(desde(null), '—');
      expect(desde('no-es-una-fecha'), '—');
      expect(desde('2026-11-09T11:45:00Z', ahora: ahora), '15 min');
      expect(desde('2026-11-09T09:30:00Z', ahora: ahora), '2 h 30 min');
      expect(desde('2026-11-07T06:00:00Z', ahora: ahora), '2 d 6 h');
    });

    test('desde: una fecha futura es «—», no un negativo', () {
      expect(desde('2026-11-09T13:00:00Z', ahora: ahora), '—');
    });

    test('minutosEnPalabras redondea a la unidad que se lee', () {
      expect(minutosEnPalabras(null), '—');
      expect(minutosEnPalabras(3), '3 min');
      expect(minutosEnPalabras(59), '59 min');
      expect(minutosEnPalabras(60), '1 h');
      expect(minutosEnPalabras(1439), '23 h');
      expect(minutosEnPalabras(1440), '1 d');
    });

    test('distanciaCorta: metros hasta el kilómetro, luego km', () {
      expect(distanciaCorta(null), '—');
      expect(distanciaCorta(71), '71 m');
      expect(distanciaCorta(999), '999 m');
      expect(distanciaCorta(1000), '1,0 km');
      expect(distanciaCorta(18400), '18,4 km');
      expect(distanciaCorta(127300), '127 km');
    });

    test('velocidadCorta: por debajo de 3 km/h, «Parado»', () {
      expect(velocidadCorta(null), '—');
      expect(velocidadCorta(0), 'Parado');
      expect(velocidadCorta(2.4), 'Parado');
      expect(velocidadCorta(3), '3 km/h');
      expect(velocidadCorta(82.6), '83 km/h');
    });

    test('fechaCorta en formato de aquí', () {
      expect(fechaCorta(null), '—');
      expect(fechaCorta(''), '—');
      expect(fechaCorta('vaya'), '—');
      expect(fechaCorta('2026-03-07'), '07/03/2026');
      expect(fechaCorta('2026-11-09T10:00:00Z'), '09/11/2026');
    });

    test('quienReviso distingue a una persona del arco', () {
      expect(quienReviso(null), '—');
      expect(quienReviso(rev('a', 'al_dia', origen: 'checkpoint')), 'CheckPoint');
      expect(quienReviso(rev('a', 'al_dia', origen: 'tecnico', por: 'David')), 'David');
      expect(quienReviso(rev('a', 'al_dia', origen: 'tecnico')), 'Técnico');
      expect(quienReviso(rev('a', 'al_dia', origen: 'tecnico', por: '')), 'Técnico');
      expect(quienReviso(rev('a', 'al_dia')), '—');
    });
  });

  group('lectura del JSON que manda el servidor', () {
    test('una fila de presencia con vehículo y delegación anidados', () {
      final v = VehiculoPresencia.desdeJson({
        'vehiculo_id': 'v1',
        'estado': 'IN_BASE',
        'delegacion_id': 'd1',
        'es_su_base': true,
        'distancia_m': 71,
        'antiguedad_min': 3,
        'velocidad_kmh': 0,
        'entrada_base_at': '2026-11-08T06:00:00Z',
        'motivo': null,
        'vehiculo': {'id': 'v1', 'matricula': '6137GDT', 'numero_unidad': '12'},
        'delegacion': {'id': 'd1', 'nombre': 'Tarragona'},
      });
      expect(v.matricula, '6137GDT');
      expect(v.numeroUnidad, '12');
      expect(v.delegacionNombre, 'Tarragona');
      expect(v.distanciaM, 71);
      expect(v.velocidadKmh, 0);
    });

    test('una fila sin vehículo anidado no revienta', () {
      final v = VehiculoPresencia.desdeJson({'vehiculo_id': 'v1', 'estado': 'NO_POSITION'});
      expect(v.matricula, '—');
      expect(v.delegacionNombre, isNull);
      expect(v.distanciaM, isNull);
    });

    test('la respuesta entera, incluido porEstado', () {
      final p = PresenciaBases.desdeJson({
        'ok': true,
        'vehiculos': [
          {'vehiculo_id': 'v1', 'estado': 'IN_BASE'},
        ],
        'bases': [
          {'id': 'd1', 'nombre': 'Reus'},
        ],
        'cuentas': [
          {'proveedor': 'webfleet', 'cuenta': 'c1', 'nombre': 'Plana', 'activa': true},
        ],
        'porEstado': {'IN_BASE': 142, 'OUTSIDE_BASES': 110},
        'calculadoAt': '2026-11-09T11:00:00Z',
      });
      expect(p.vehiculos.length, 1);
      expect(p.bases.single.nombre, 'Reus');
      expect(p.cuentas.single.activa, isTrue);
      expect(p.porEstado['IN_BASE'], 142);
      expect(p.calculadoAt, '2026-11-09T11:00:00Z');
    });

    test('sinSeguimiento se lee, y sin él es cero y no nulo', () {
      // Un servidor viejo no manda el campo. Cero es la respuesta correcta:
      // significa «no hay ninguno fuera», que es lo que pasaba antes.
      expect(PresenciaBases.desdeJson({'sinSeguimiento': 3}).sinSeguimiento, 3);
      expect(PresenciaBases.desdeJson({}).sinSeguimiento, 0);
    });

    test('una respuesta vacía da listas vacías, no nulos', () {
      final p = PresenciaBases.desdeJson({});
      expect(p.vehiculos, isEmpty);
      expect(p.bases, isEmpty);
      expect(p.cuentas, isEmpty);
      expect(p.porEstado, isEmpty);
      expect(p.calculadoAt, isNull);
    });

    test('una fila de tc_revision_estado', () {
      final r = RevisionEstado.desdeJson({
        'vehiculo_id': 'v1',
        'estado': 'vencida',
        'ultima_revision': '2026-03-07',
        'intervalo_dias': 90,
        'dias_vencido': 157,
        'ultima_revision_por': 'David',
        'ultima_revision_origen': 'tecnico',
      });
      expect(r.estado, 'vencida');
      expect(r.diasVencido, 157);
      expect(quienReviso(r), 'David');
      expect(fechaCorta(r.ultimaRevision), '07/03/2026');
    });
  });
}
