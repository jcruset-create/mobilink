// El orden de los trabajos de una OTF en la base, el mismo que el servidor
// (`server/otf/mejoras.ts`): primero lo que está a medias, luego lo
// pendiente por número de plaza (los que no la dicen, al final y en el orden
// en que se crearon), y lo hecho abajo. Para recorrer la base sin dar vueltas.

/// La plaza, sacada de las observaciones («remolque en plaza 27», «Pl. 3»).
int? plazaDe(Object? observaciones) {
  final m = RegExp(r'\bpl(?:aza|\.)?\s*(?:n[º°o.]?\s*)?(\d{1,4})\b', caseSensitive: false)
      .firstMatch(observaciones?.toString() ?? '');
  return m == null ? null : int.parse(m.group(1)!);
}

const _ordenEstado = {'en_proceso': 0, 'pendiente': 1, 'finalizado': 2, 'no_realizado': 3};

List<Map<String, dynamic>> ordenarTrabajosEnBase(List<Map<String, dynamic>> trabajos) {
  final copia = [...trabajos];
  copia.sort((a, b) {
    final ea = _ordenEstado[a['status']] ?? 1;
    final eb = _ordenEstado[b['status']] ?? 1;
    if (ea != eb) return ea - eb;
    final pa = plazaDe(a['observaciones']) ?? 1 << 30;
    final pb = plazaDe(b['observaciones']) ?? 1 << 30;
    if (pa != pb) return pa - pb;
    return ((a['id'] as int?) ?? 0) - ((b['id'] as int?) ?? 0);
  });
  return copia;
}
