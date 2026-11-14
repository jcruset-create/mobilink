/// Cómo se lee un tipo de llanta del catálogo (`tc_tipos_llanta`).
///
/// Vive aquí, y no dentro de una pantalla, porque lo usan dos: la ficha del
/// vehículo —que lo enseña— y el alta operativa —que lo ofrece para elegir—.
/// Dos formateadores para el mismo dato acaban divergiendo, y entonces la
/// llanta que el técnico elige no se llama igual que la que luego lee en la
/// ficha del mismo camión.
///
/// Se juntan solo los campos que tienen dato: una llanta a la que oficina no
/// le ha puesto agujeros ni centrado se lee «Acero · 22.5x11.75» y no
/// «Acero · 22.5x11.75 · null aguj.».
String nombreTipoLlanta(Map<String, dynamic> l) {
  final material = (l['material'] as String?) ?? '';
  final medida = (l['medida'] as String?) ?? '';
  final centrado = (l['centrado'] as String?) ?? '';
  final partes = <String>[
    if (material.isNotEmpty) material[0].toUpperCase() + material.substring(1),
    if (medida.isNotEmpty) medida,
    if (l['agujeros'] != null) '${l['agujeros']} aguj.',
    if (centrado.isNotEmpty) centrado,
  ];
  // Sin un solo dato no hay llanta que nombrar: un «s/tapacubo» suelto no
  // dice nada y encima parece un dato.
  if (partes.isEmpty) return '—';
  // El tapacubo se dice siempre, en un sentido o en el otro: es lo que
  // distingue dos llantas que por lo demás se llaman igual.
  partes.add((l['tapacubo'] as bool?) == true ? 'c/tapacubo' : 's/tapacubo');
  return partes.join(' · ');
}
