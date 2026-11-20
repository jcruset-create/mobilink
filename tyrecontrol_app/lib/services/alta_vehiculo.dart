/// Reglas del alta de vehículo en la tablet: uso, ejes y ruedas.
///
/// Funciones puras (sin red ni widgets) para poder probarlas: qué usos hay,
/// cuándo todos los ejes llevan la misma medida, cómo se busca «29580» y en
/// qué orden se ofrecen las referencias del catálogo.
library;

/// Para qué se usa el vehículo. Las claves son las de `tc_vehiculos.uso`.
class UsoVehiculo {
  final String clave;
  final String nombre;
  final String detalle;
  const UsoVehiculo(this.clave, this.nombre, this.detalle);
}

const usosVehiculo = <UsoVehiculo>[
  UsoVehiculo('larga_distancia', 'Larga distancia', 'Autopista, rutas largas'),
  UsoVehiculo('regional', 'Regional', 'Carretera y entorno regional'),
  UsoVehiculo('urbano', 'Urbano / transporte público', 'Ciudad, paradas frecuentes'),
  UsoVehiculo('distribucion', 'Distribución', 'Reparto, muchas maniobras'),
  UsoVehiculo('obra', 'Construcción / mixto', 'Obra, pistas y carretera'),
];

/// La configuración de un eje durante el alta.
class EjeAlta {
  final int eje;
  /// Cuántas ruedas tiene en el plano del tipo (4 = ruedas dobles). No se
  /// elige: lo dice el tipo de vehículo.
  final int ruedas;
  String? medidaId;
  String? llantaId;
  double? presionBar;
  bool directriz;
  bool motriz;
  bool elevable;

  EjeAlta({
    required this.eje,
    required this.ruedas,
    this.medidaId,
    this.llantaId,
    this.presionBar,
    this.directriz = false,
    this.motriz = false,
    this.elevable = false,
  });

  bool get dobles => ruedas >= 4;

  Map<String, dynamic> toJson() => {
        'eje': eje,
        'medida_id': medidaId,
        'tipo_llanta_id': llantaId,
        'presion_bar': presionBar,
        'directriz': directriz,
        'motriz': motriz,
        'elevable': elevable,
      };
}

/// Los ejes de un tipo a partir de sus posiciones (`eje` de cada una). El
/// primero sale direccional: es lo normal y así hay un toque menos.
List<EjeAlta> ejesDesdePosiciones(Iterable<int?> ejesDeCadaPosicion) {
  final cuenta = <int, int>{};
  for (final e in ejesDeCadaPosicion) {
    if (e == null) continue;
    cuenta[e] = (cuenta[e] ?? 0) + 1;
  }
  final numeros = cuenta.keys.toList()..sort();
  return [
    for (final n in numeros)
      EjeAlta(eje: n, ruedas: cuenta[n]!, directriz: n == numeros.first),
  ];
}

/// La medida común si TODOS los ejes llevan la misma (y la tienen puesta).
/// Con ella se enseña una vez arriba; si no, encima de cada eje.
String? medidaComun(List<EjeAlta> ejes) {
  if (ejes.isEmpty) return null;
  final m = ejes.first.medidaId;
  if (m == null) return null;
  return ejes.every((e) => e.medidaId == m) ? m : null;
}

/// Copia medida, llanta y presión de un eje a todos los demás. Los
/// interruptores (direccional, motriz, elevable) NO se copian: son de cada eje.
void aplicarATodos(List<EjeAlta> ejes, EjeAlta origen) {
  for (final e in ejes) {
    if (identical(e, origen)) continue;
    e.medidaId = origen.medidaId;
    e.llantaId = origen.llantaId;
    e.presionBar = origen.presionBar;
  }
}

/// Solo letras y números, en mayúsculas: «295/80 R22.5» → «29580R225».
String claveMedida(String? medida) =>
    (medida ?? '').toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');

/// ¿Encaja lo tecleado con esta medida? «29580» encuentra 295/80R22.5, y
/// «295/80» y «295 80» también.
bool coincideMedida(String? medida, String consulta) {
  final q = claveMedida(consulta);
  if (q.isEmpty) return true;
  return claveMedida(medida).contains(q);
}

/// Busca en el catálogo por marca, modelo o medida. Cada palabra tiene que
/// aparecer; las palabras con números se comparan como medida.
bool coincideReferencia(Map<String, dynamic> r, String consulta) {
  final palabras = consulta.trim().toLowerCase().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
  final texto = '${r['marca'] ?? ''} ${r['modelo'] ?? ''}'.toLowerCase();
  for (final p in palabras) {
    final esMedida = RegExp(r'[0-9]').hasMatch(p);
    if (esMedida ? !coincideMedida(r['medida'] as String?, p) : !texto.contains(p)) return false;
  }
  return true;
}

/// La clave con la que se cruza una referencia del catálogo con los
/// favoritos de la flota (que vienen de las gomas montadas, en texto).
String claveFavorito(String? marca, String? modelo, String? medida) =>
    '${(marca ?? '').trim().toLowerCase()}|${(modelo ?? '').trim().toLowerCase()}|${claveMedida(medida)}';

/// Las referencias del catálogo en el orden en que se ofrecen: primero las
/// más montadas en la flota (de más a menos), después el resto por marca y
/// modelo. Si hay [medida], solo las de esa medida.
List<Map<String, dynamic>> ordenarReferencias(
  List<Map<String, dynamic>> catalogo, {
  List<Map<String, dynamic>> favoritos = const [],
  String? medida,
}) {
  final veces = <String, int>{
    for (final f in favoritos)
      claveFavorito(f['marca'] as String?, f['modelo'] as String?, f['medida'] as String?):
          (f['veces'] as num?)?.toInt() ?? 0,
  };
  final clave = claveMedida(medida);
  final lista = catalogo
      .where((r) => clave.isEmpty || claveMedida(r['medida'] as String?) == clave)
      .toList();
  int vecesDe(Map<String, dynamic> r) =>
      veces[claveFavorito(r['marca'] as String?, r['modelo'] as String?, r['medida'] as String?)] ?? 0;
  lista.sort((a, b) {
    final v = vecesDe(b).compareTo(vecesDe(a));
    if (v != 0) return v;
    final m = '${a['marca']}'.toLowerCase().compareTo('${b['marca']}'.toLowerCase());
    if (m != 0) return m;
    return '${a['modelo']}'.toLowerCase().compareTo('${b['modelo']}'.toLowerCase());
  });
  return lista;
}

/// Cuántas veces está montada esta referencia en la flota (0 si ninguna).
int vecesEnFlota(Map<String, dynamic> r, List<Map<String, dynamic>> favoritos) {
  final k = claveFavorito(r['marca'] as String?, r['modelo'] as String?, r['medida'] as String?);
  for (final f in favoritos) {
    if (claveFavorito(f['marca'] as String?, f['modelo'] as String?, f['medida'] as String?) == k) {
      return (f['veces'] as num?)?.toInt() ?? 0;
    }
  }
  return 0;
}

/// Las marcas de una lista de referencias, en el orden en que aparecen (así
/// la más montada sale primero).
List<String> marcasDe(List<Map<String, dynamic>> refs) {
  final vistas = <String>[];
  for (final r in refs) {
    final m = (r['marca'] as String?)?.trim() ?? '';
    if (m.isNotEmpty && !vistas.contains(m)) vistas.add(m);
  }
  return vistas;
}

/// Los tipos de vehículo con los más usados en la flota primero (los que
/// llevan más vehículos de esa empresa) y, a igualdad, por nombre.
List<Map<String, dynamic>> ordenarTiposPorUso(
  List<Map<String, dynamic>> tipos,
  Map<String, int> vehiculosPorTipo,
) {
  String nombre(Map<String, dynamic> t) =>
      ((t['descripcion'] ?? t['nombre']) as String? ?? '').toLowerCase();
  final lista = [...tipos];
  lista.sort((a, b) {
    final v = (vehiculosPorTipo[b['id']] ?? 0).compareTo(vehiculosPorTipo[a['id']] ?? 0);
    return v != 0 ? v : nombre(a).compareTo(nombre(b));
  });
  return lista;
}

/// Pone la medida de la ficha del vehículo en los ejes que aún no tienen
/// ninguna. Devuelve cuántos ha rellenado. Los que ya tienen medida no se
/// tocan: lo que eligió el técnico manda sobre la ficha.
int precargarMedida(List<EjeAlta> ejes, String? medidaFicha) {
  if (medidaFicha == null || medidaFicha.isEmpty) return 0;
  var n = 0;
  for (final e in ejes) {
    if (e.medidaId == null) {
      e.medidaId = medidaFicha;
      n++;
    }
  }
  return n;
}
