/// Convierte a entero lo que llega del backend, venga como sea.
///
/// Las columnas de tiempo de `jobs` son BIGINT y el driver de Postgres las
/// serializa como CADENA para no perder precisión, así que `createdAtMs` llega
/// como "1750000000000" y no como número. Un `as num?` directo lanza
/// "type 'String' is not a subtype of type 'num?'" y deja la app en la pantalla
/// de error, que es exactamente lo que pasaba al abrirla.
int? _entero(dynamic valor) {
  if (valor == null) return null;
  if (valor is num) return valor.toInt();
  if (valor is String) {
    final limpio = valor.trim();
    if (limpio.isEmpty) return null;
    return int.tryParse(limpio) ?? double.tryParse(limpio)?.toInt();
  }
  return null;
}

/// Una línea de mano de obra del parte: qué hay que hacer y cuánto se tarda.
class LineaManoObra {
  final String label;
  final int cantidad;
  final int minutos;
  final bool principal;

  const LineaManoObra({
    required this.label,
    required this.cantidad,
    required this.minutos,
    required this.principal,
  });
}

/// Una línea de material del parte: qué hay que montar.
///
/// Sin importes a propósito. El técnico necesita saber qué montar; lo que se
/// factura se ve en el panel de oficina.
class LineaMaterial {
  final String descripcion;
  final int unidades;

  const LineaMaterial({required this.descripcion, required this.unidades});
}

/// Cantidad válida de una línea: lo que no sea un entero positivo, no cuenta.
int _cantidad(dynamic valor) {
  final n = _entero(valor);
  return (n == null || n <= 0) ? 0 : n;
}

/// Trabajo del taller (tabla `jobs` del backend).
class Job {
  final int id;
  final String area;
  final String plate;
  final bool urgent;
  final String status;
  final List<String> assignedNames;
  final String reason;
  final String customerName;
  final String customerPhone;
  final int? createdAtMs;
  final int? startedAtMs;
  final int? closedAtMs;
  final int? pausedAtMs;
  final int? actualMinutes;
  final String? workshopId;

  /// Lo que trae el parte de trabajo.
  final String? ptNumero;
  final int? quantity;
  final int? unitMinutes;
  final List<LineaManoObra> tareasIncluidas;
  final List<LineaMaterial> materiales;

  Job({
    required this.id,
    required this.area,
    required this.plate,
    required this.urgent,
    required this.status,
    required this.assignedNames,
    required this.reason,
    required this.customerName,
    required this.customerPhone,
    this.createdAtMs,
    this.startedAtMs,
    this.closedAtMs,
    this.pausedAtMs,
    this.actualMinutes,
    this.workshopId,
    this.ptNumero,
    this.quantity,
    this.unitMinutes,
    this.tareasIncluidas = const [],
    this.materiales = const [],
  });

  factory Job.fromJson(Map<String, dynamic> j) {
    final names = (j['assignedNames'] as List<dynamic>? ?? [])
        .map((e) => e.toString())
        .toList();
    return Job(
      id: _entero(j['id']) ?? 0,
      area: (j['area'] ?? '').toString(),
      plate: (j['plate'] ?? '').toString(),
      urgent: j['urgent'] == true,
      status: (j['status'] ?? 'espera').toString(),
      assignedNames: names,
      reason: (j['reason'] ?? '').toString(),
      customerName: (j['customerName'] ?? '').toString(),
      customerPhone: (j['customerPhone'] ?? '').toString(),
      createdAtMs: _entero(j['createdAtMs']),
      startedAtMs: _entero(j['startedAtMs']),
      closedAtMs: _entero(j['closedAtMs']),
      pausedAtMs: _entero(j['pausedAtMs']),
      actualMinutes: _entero(j['actualMinutes']),
      workshopId: (j['workshopId'])?.toString(),
      ptNumero: (j['ptNumero'])?.toString(),
      quantity: _entero(j['quantity']),
      unitMinutes: _entero(j['unitMinutes']),
      tareasIncluidas: _tareas(j['includedTasks']),
      materiales: _materiales(j['materiales']),
    );
  }

  /// Mano de obra completa: la operación principal y las tareas incluidas.
  ///
  /// La principal no está en `includedTasks` —es la del propio trabajo—, y
  /// dejarla fuera de la lista hacía parecer que no contaba.
  List<LineaManoObra> manoDeObra(String etiquetaPrincipal) {
    final lineas = <LineaManoObra>[];

    final etiqueta = etiquetaPrincipal.trim();

    if (etiqueta.isNotEmpty) {
      final porUnidad = unitMinutes ?? 0;
      final cantidad = (quantity ?? 0) > 0 ? quantity! : 1;

      lineas.add(LineaManoObra(
        label: etiqueta,
        cantidad: cantidad,
        minutos: porUnidad > 0 ? porUnidad * cantidad : 0,
        principal: true,
      ));
    }

    lineas.addAll(tareasIncluidas);

    return lineas;
  }

  int minutosManoDeObra(String etiquetaPrincipal) =>
      manoDeObra(etiquetaPrincipal).fold(0, (suma, l) => suma + l.minutos);

  bool get isClosed => status == 'cerrado';
  bool get isActive => status == 'activo';
  bool get isPaused => status == 'parado';
}

/// Tareas incluidas que llegan de la columna JSONB.
///
/// Las alimenta una lectura con IA, así que pueden venir a null, vacías o con
/// basura. Nada de eso puede tumbar la pantalla del técnico.
List<LineaManoObra> _tareas(dynamic valor) {
  if (valor is! List) return const [];

  final lineas = <LineaManoObra>[];

  for (final item in valor) {
    if (item is! Map) continue;

    final label = (item['label'] ?? '').toString().trim();
    if (label.isEmpty) continue;

    final cantidad = _cantidad(item['quantity']);
    final minutos = _cantidad(item['standardMinutes']);

    lineas.add(LineaManoObra(
      label: label,
      cantidad: cantidad == 0 ? 1 : cantidad,
      minutos: minutos,
      principal: false,
    ));
  }

  return lineas;
}

List<LineaMaterial> _materiales(dynamic valor) {
  if (valor is! List) return const [];

  final lineas = <LineaMaterial>[];

  for (final item in valor) {
    if (item is! Map) continue;

    final descripcion = (item['descripcion'] ?? '').toString().trim();
    final unidades = _cantidad(item['unidades']);

    // Una línea sin descripción o sin unidades no le dice nada al técnico.
    if (descripcion.isEmpty || unidades == 0) continue;

    lineas.add(LineaMaterial(descripcion: descripcion, unidades: unidades));
  }

  return lineas;
}
