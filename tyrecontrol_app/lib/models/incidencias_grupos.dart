import 'incidencias.dart';

/// Agrupación de incidencias por revisión de origen: una tarjeta por
/// revisión, con todas sus incidencias dentro. Lógica pura (sin Flutter)
/// para poder testearla y no recalcular en cada widget.

class GrupoRevision {
  /// Clave del grupo: revision_id, o `sin-<vehiculoId>` para las incidencias
  /// históricas sin revisión asociada (no se mezclan con otras revisiones).
  final String clave;
  final String? revisionId;
  final String vehiculoId;
  final String? matricula;
  final String? cliente;
  final String? base;
  final String? tecnicoNombre;
  final String? fechaRevision; // yyyy-MM-dd (null → "Fecha no disponible")
  final String? horaRevision; // HH:mm
  final List<Incidencia> incidencias; // solo las de la pestaña actual

  GrupoRevision({
    required this.clave,
    required this.revisionId,
    required this.vehiculoId,
    required this.matricula,
    required this.cliente,
    required this.base,
    required this.tecnicoNombre,
    required this.fechaRevision,
    required this.horaRevision,
    required this.incidencias,
  });

  /// Gravedad más alta de las incidencias VISIBLES en esta pestaña (caso 27:
  /// no cuenta una crítica ya solucionada que se muestra en otra pestaña).
  Gravedad get gravedadMax => incidencias.fold(
      Gravedad.leve,
      (max, i) => i.gravedad.index > max.index ? i.gravedad : max);

  bool get sinRevision => revisionId == null;
}

/// Orden de gravedad para comparar (crítica primero).
int _pesoGravedad(Gravedad g) => switch (g) {
      Gravedad.critica => 0,
      Gravedad.importante => 1,
      Gravedad.leve => 2,
    };

String? _horaDe(String? iso) {
  if (iso == null) return null;
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return null;
  return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

/// Agrupa las incidencias (ya filtradas por los estados de la pestaña) en
/// una tarjeta por revisión. Excluye revisiones anuladas (caso 8).
List<GrupoRevision> agruparPorRevision(List<Incidencia> deTab) {
  final grupos = <String, List<Incidencia>>{};
  for (final i in deTab) {
    if (i.revisionEstado == 'anulada') continue; // revisión anulada: fuera de pestañas operativas
    final clave = i.revisionId ?? 'sin-${i.vehiculoId}';
    grupos.putIfAbsent(clave, () => []).add(i);
  }

  final out = grupos.entries.map((e) {
    final lista = e.value;
    // Dentro del cuadro: crítica → importante → leve, luego posición.
    lista.sort((a, b) {
      final g = _pesoGravedad(a.gravedad).compareTo(_pesoGravedad(b.gravedad));
      if (g != 0) return g;
      return a.posicionTexto.compareTo(b.posicionTexto);
    });
    final primera = lista.first;
    return GrupoRevision(
      clave: e.key,
      revisionId: primera.revisionId,
      vehiculoId: primera.vehiculoId,
      matricula: primera.matricula,
      cliente: primera.cliente,
      base: primera.base,
      tecnicoNombre: primera.tecnicoNombre,
      fechaRevision: primera.revisionFecha,
      horaRevision: _horaDe(primera.revisionCreatedAt),
      incidencias: lista,
    );
  }).toList();

  // Orden de cuadros: gravedad máxima, luego revisión más reciente (las sin
  // fecha al final), luego incidencia más antigua.
  out.sort((a, b) {
    final g = _pesoGravedad(a.gravedadMax).compareTo(_pesoGravedad(b.gravedadMax));
    if (g != 0) return g;
    final fa = a.fechaRevision, fb = b.fechaRevision;
    if (fa == null && fb == null) {
      return a.incidencias.first.detectadaAt.compareTo(b.incidencias.first.detectadaAt);
    }
    if (fa == null) return 1; // sin fecha → al final
    if (fb == null) return -1;
    final f = fb.compareTo(fa); // más reciente primero
    if (f != 0) return f;
    return a.incidencias.first.detectadaAt.compareTo(b.incidencias.first.detectadaAt);
  });
  return out;
}

/// Conteos para la etiqueta de una pestaña: "(N revisiones · M incidencias)".
({int revisiones, int incidencias}) conteoTab(List<Incidencia> deTab) {
  final claves = <String>{};
  var n = 0;
  for (final i in deTab) {
    if (i.revisionEstado == 'anulada') continue;
    claves.add(i.revisionId ?? 'sin-${i.vehiculoId}');
    n++;
  }
  return (revisiones: claves.length, incidencias: n);
}

/// Fecha corta dd/MM/yyyy (zona local, sin cambiar el día).
String fechaCortaIncidencia(String? iso) {
  if (iso == null || iso.isEmpty) return 'Fecha no disponible';
  final d = DateTime.tryParse(iso);
  if (d == null) return 'Fecha no disponible';
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}
