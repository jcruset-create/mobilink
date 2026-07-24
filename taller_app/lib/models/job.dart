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
  });

  factory Job.fromJson(Map<String, dynamic> j) {
    final names = (j['assignedNames'] as List<dynamic>? ?? [])
        .map((e) => e.toString())
        .toList();
    return Job(
      id: (j['id'] as num).toInt(),
      area: (j['area'] ?? '').toString(),
      plate: (j['plate'] ?? '').toString(),
      urgent: j['urgent'] == true,
      status: (j['status'] ?? 'espera').toString(),
      assignedNames: names,
      reason: (j['reason'] ?? '').toString(),
      customerName: (j['customerName'] ?? '').toString(),
      customerPhone: (j['customerPhone'] ?? '').toString(),
      createdAtMs: (j['createdAtMs'] as num?)?.toInt(),
      startedAtMs: (j['startedAtMs'] as num?)?.toInt(),
      closedAtMs: (j['closedAtMs'] as num?)?.toInt(),
      pausedAtMs: (j['pausedAtMs'] as num?)?.toInt(),
      actualMinutes: (j['actualMinutes'] as num?)?.toInt(),
    );
  }

  bool get isClosed => status == 'cerrado';
  bool get isActive => status == 'activo';
  bool get isPaused => status == 'parado';
}
