import 'package:flutter_test/flutter_test.dart';
import 'package:tyrecontrol_app/models/incidencias.dart';
import 'package:tyrecontrol_app/models/incidencias_grupos.dart';

Incidencia inc({
  String id = 'i1',
  String vehiculoId = 'v1',
  String? matricula = 'R1234ABC',
  String? revisionId = 'r1',
  String? revisionFecha = '2026-07-15',
  String? revisionEstado = 'completada_incidencia_pendiente',
  String estado = 'detectada',
  Gravedad gravedad = Gravedad.leve,
  String? posicionNombre = 'Eje 1 izquierda',
  String detectadaAt = '2026-07-15T10:00:00Z',
  List<String> tipos = const ['presion_baja'],
}) =>
    Incidencia(
      id: id,
      vehiculoId: vehiculoId,
      posicionId: posicionNombre == null ? null : 'p-$posicionNombre',
      matricula: matricula,
      cliente: 'SEA Tarragona',
      base: 'Tarragona',
      posicionNombre: posicionNombre,
      gravedad: gravedad,
      estado: estado,
      detectadaAt: detectadaAt,
      fotoUrl: null,
      motivoPendiente: null,
      tipos: tipos,
      revisionId: revisionId,
      revisionFecha: revisionFecha,
      revisionCreatedAt: revisionFecha == null ? null : '${revisionFecha}T15:30:00Z',
      revisionEstado: revisionEstado,
      tecnicoNombre: 'Juan Pérez',
    );

void main() {
  test('una revisión con una incidencia → un grupo con una fila', () {
    final g = agruparPorRevision([inc()]);
    expect(g.length, 1);
    expect(g.first.incidencias.length, 1);
    expect(g.first.matricula, 'R1234ABC');
  });

  test('varias incidencias de la misma revisión → un solo grupo', () {
    final g = agruparPorRevision([
      inc(id: 'a', posicionNombre: 'Eje 1 izquierda'),
      inc(id: 'b', posicionNombre: 'Eje 2 derecha'),
      inc(id: 'c', posicionNombre: 'Eje 3 derecha'),
    ]);
    expect(g.length, 1);
    expect(g.first.incidencias.length, 3);
  });

  test('misma matrícula, revisiones distintas → grupos distintos', () {
    final g = agruparPorRevision([
      inc(id: 'a', revisionId: 'r1', revisionFecha: '2026-07-15'),
      inc(id: 'b', revisionId: 'r2', revisionFecha: '2026-07-01'),
    ]);
    expect(g.length, 2);
    // La más reciente primero (misma gravedad)
    expect(g.first.revisionId, 'r1');
  });

  test('gravedad máxima del grupo y orden crítica → leve entre grupos', () {
    final g = agruparPorRevision([
      inc(id: 'a', revisionId: 'r1', gravedad: Gravedad.leve),
      inc(id: 'b', revisionId: 'r2', gravedad: Gravedad.critica),
      inc(id: 'c', revisionId: 'r2', gravedad: Gravedad.leve),
    ]);
    expect(g.first.revisionId, 'r2');
    expect(g.first.gravedadMax, Gravedad.critica);
    expect(g.last.gravedadMax, Gravedad.leve);
  });

  test('dentro del grupo: crítica primero, luego posición', () {
    final g = agruparPorRevision([
      inc(id: 'a', posicionNombre: 'Eje 3 derecha', gravedad: Gravedad.leve),
      inc(id: 'b', posicionNombre: 'Eje 2 derecha', gravedad: Gravedad.critica),
      inc(id: 'c', posicionNombre: 'Eje 1 izquierda', gravedad: Gravedad.leve),
    ]);
    final lista = g.first.incidencias;
    expect(lista[0].id, 'b'); // crítica primero
    expect(lista[1].posicionTexto, 'Eje 1 izquierda'); // leves por posición
    expect(lista[2].posicionTexto, 'Eje 3 derecha');
  });

  test('incidencia sin revisión → grupo "sin revisión" separado por vehículo', () {
    final g = agruparPorRevision([
      inc(id: 'a', revisionId: 'r1'),
      inc(id: 'b', revisionId: null, revisionFecha: null, revisionEstado: null),
    ]);
    expect(g.length, 2);
    final sin = g.firstWhere((x) => x.sinRevision);
    expect(sin.revisionId, isNull);
    expect(sin.fechaRevision, isNull); // → "Fecha no disponible" en UI
  });

  test('sin fecha se ordena al final', () {
    final g = agruparPorRevision([
      inc(id: 'a', revisionId: null, revisionFecha: null, revisionEstado: null),
      inc(id: 'b', revisionId: 'r1', revisionFecha: '2026-07-01'),
    ]);
    expect(g.last.sinRevision, isTrue);
  });

  test('revisión anulada no aparece', () {
    final g = agruparPorRevision([
      inc(id: 'a', revisionEstado: 'anulada'),
      inc(id: 'b', revisionId: 'r2'),
    ]);
    expect(g.length, 1);
    expect(g.first.revisionId, 'r2');
  });

  test('conteo de pestaña: revisiones e incidencias', () {
    final c = conteoTab([
      inc(id: 'a', revisionId: 'r1'),
      inc(id: 'b', revisionId: 'r1'),
      inc(id: 'c', revisionId: 'r2'),
      inc(id: 'd', revisionEstado: 'anulada', revisionId: 'r3'),
    ]);
    expect(c.revisiones, 2);
    expect(c.incidencias, 3);
  });

  test('incidencia sin posición → texto general, no "Eje null"', () {
    final i = inc(posicionNombre: null);
    expect(i.posicionTexto, 'Incidencia general del vehículo');
  });

  test('días pendientes: hoy y N días', () {
    final hoy = inc(detectadaAt: DateTime.now().toUtc().toIso8601String());
    expect(hoy.diasTexto, 'Hoy');
    final hace2 = inc(
        detectadaAt: DateTime.now().subtract(const Duration(days: 2)).toUtc().toIso8601String());
    expect(hace2.diasTexto, '2 días');
  });

  test('fecha corta dd/MM/yyyy y fecha no disponible', () {
    expect(fechaCortaIncidencia('2026-07-15'), '15/07/2026');
    expect(fechaCortaIncidencia(null), 'Fecha no disponible');
    expect(fechaCortaIncidencia('no-es-fecha'), 'Fecha no disponible');
  });
}
