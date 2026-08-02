import 'dart:convert';
import 'dart:math';
import 'package:hive_flutter/hive_flutter.dart';
import 'api.dart';

/// Cola local transaccional de operaciones pendientes de enviar.
///
/// Cada operación lleva su `clientActionId`, así que reenviar el lote entero
/// es seguro: el backend descarta las repetidas. Si el servidor rechaza un
/// cambio de estado porque el estado oficial ya no lo admite, la operación se
/// marca como conflicto y se informa al usuario en lugar de ocultarlo.
class PendingOp {
  final String id;
  final String kind; // status | note | locations
  final int assistanceId;
  final Map<String, dynamic> payload;
  final int createdAtMs;
  int attempts;
  String state; // pending | conflict | failed

  PendingOp({
    required this.id,
    required this.kind,
    required this.assistanceId,
    required this.payload,
    required this.createdAtMs,
    this.attempts = 0,
    this.state = 'pending',
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind,
        'assistanceId': assistanceId,
        'payload': payload,
        'createdAtMs': createdAtMs,
        'attempts': attempts,
        'state': state,
      };

  static PendingOp fromJson(Map<String, dynamic> j) => PendingOp(
        id: j['id'] as String,
        kind: j['kind'] as String,
        assistanceId: (j['assistanceId'] as num).toInt(),
        payload: (j['payload'] as Map).cast<String, dynamic>(),
        createdAtMs: (j['createdAtMs'] as num).toInt(),
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
        state: (j['state'] as String?) ?? 'pending',
      );

  /// Forma que espera POST /sync.
  Map<String, dynamic> toOperation() => {
        'clientActionId': id,
        'kind': kind,
        'assistanceId': assistanceId,
        'tsMs': createdAtMs,
        ...payload,
      };
}

class OfflineQueue {
  static const _boxName = 'lite_queue';
  static Box? _box;

  static Future<void> init() async {
    await Hive.initFlutter();
    _box = await Hive.openBox(_boxName);
  }

  static String newActionId() {
    final rnd = Random();
    final n = List.generate(8, (_) => rnd.nextInt(16).toRadixString(16)).join();
    return '${DateTime.now().millisecondsSinceEpoch}-$n';
  }

  static List<PendingOp> all() {
    final box = _box;
    if (box == null) return [];
    return box.values
        .map((v) => PendingOp.fromJson((jsonDecode(v as String) as Map).cast<String, dynamic>()))
        .toList()
      ..sort((a, b) => a.createdAtMs.compareTo(b.createdAtMs));
  }

  static int get pendingCount => all().where((o) => o.state == 'pending').length;

  static List<PendingOp> conflicts() => all().where((o) => o.state == 'conflict').toList();

  static Future<PendingOp> add({
    required String kind,
    required int assistanceId,
    required Map<String, dynamic> payload,
    String? actionId,
  }) async {
    final op = PendingOp(
      id: actionId ?? newActionId(),
      kind: kind,
      assistanceId: assistanceId,
      payload: payload,
      createdAtMs: DateTime.now().millisecondsSinceEpoch,
    );
    await _box?.put(op.id, jsonEncode(op.toJson()));
    return op;
  }

  static Future<void> remove(String id) async => _box?.delete(id);

  static Future<void> clearConflicts() async {
    for (final op in conflicts()) {
      await remove(op.id);
    }
  }

  static Future<void> _update(PendingOp op) async =>
      _box?.put(op.id, jsonEncode(op.toJson()));

  /// Agrupa las posiciones sueltas en una sola operación por asistencia para
  /// no saturar la red al recuperar cobertura.
  static Future<void> addLocation(int assistanceId, Map<String, dynamic> point) async {
    final existing = all().firstWhere(
      (o) => o.kind == 'locations' && o.assistanceId == assistanceId && o.state == 'pending',
      orElse: () => PendingOp(
        id: '', kind: '', assistanceId: 0, payload: {}, createdAtMs: 0,
      ),
    );
    if (existing.id.isEmpty) {
      await add(kind: 'locations', assistanceId: assistanceId, payload: {
        'points': [point]
      });
      return;
    }
    final points = List<Map<String, dynamic>>.from(
      (existing.payload['points'] as List).map((e) => (e as Map).cast<String, dynamic>()),
    )..add(point);
    // Techo defensivo: si el desplazamiento es muy largo sin cobertura se
    // conservan las últimas 500 posiciones (unas 4 h a 30 s de cadencia).
    existing.payload['points'] = points.length > 500 ? points.sublist(points.length - 500) : points;
    await _update(existing);
  }

  /// Envía todo lo pendiente. Devuelve el resultado por operación para que la
  /// UI avise de los conflictos.
  static Future<List<Map<String, dynamic>>> flush(Api api) async {
    final pending = all().where((o) => o.state == 'pending').toList();
    if (pending.isEmpty) return [];

    final res = await api.sync(pending.map((o) => o.toOperation()).toList());
    final results = (res['results'] as List? ?? [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();

    for (final r in results) {
      final id = r['clientActionId']?.toString() ?? '';
      final op = pending.where((o) => o.id == id).firstOrNull;
      if (op == null) continue;
      final status = r['status']?.toString();
      if (status == 'applied' || status == 'duplicate') {
        await remove(op.id);
      } else if (status == 'conflict') {
        op.state = 'conflict';
        op.payload['officialStatus'] = r['officialStatus'];
        await _update(op);
      } else {
        op.attempts++;
        // Tras 8 intentos se marca como fallida y deja de reintentarse sola
        if (op.attempts >= 8) op.state = 'failed';
        await _update(op);
      }
    }
    return results;
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}
