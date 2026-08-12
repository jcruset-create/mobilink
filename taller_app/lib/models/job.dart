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
    );
  }

  bool get isClosed => status == 'cerrado';
  bool get isActive => status == 'activo';
  bool get isPaused => status == 'parado';
}
