import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Almacenamiento local (Hive) para trabajar sin cobertura:
/// - Cachea la lista de trabajos (lectura offline).
/// - Cola (outbox) de cambios de estado y fotos pendientes de enviar.
class OfflineStore {
  static late Box _cache;
  static late Box _outbox;

  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  static final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  static Future<void> init() async {
    await Hive.initFlutter();
    _cache = await Hive.openBox('taller_cache');
    _outbox = await Hive.openBox('taller_outbox');
    pendingCount.value = _outbox.length;
  }

  // ── Caché de trabajos ──
  static Future<void> cacheJobs(List<Map<String, dynamic>> list) async {
    await _cache.put('jobs', jsonEncode(list));
  }

  static List<Map<String, dynamic>> cachedJobs() {
    final raw = _cache.get('jobs');
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw) as List<dynamic>;
        return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      } catch (_) {}
    }
    return [];
  }

  /// Actualiza el estado de un trabajo en la caché (optimista).
  static Future<Map<String, dynamic>?> applyLocalStatus(int jobId, String status) async {
    final list = cachedJobs();
    Map<String, dynamic>? updated;
    for (final j in list) {
      if (j['id'] == jobId) {
        j['status'] = status;
        updated = j;
      }
    }
    await cacheJobs(list);
    return updated;
  }

  // ── Cola de cambios de estado ──
  static Future<void> enqueueStatus({required int jobId, required String status}) async {
    await _outbox.add({
      'actionId': '${DateTime.now().millisecondsSinceEpoch}-$jobId-$status',
      'type': 'status',
      'jobId': jobId,
      'status': status,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
    await applyLocalStatus(jobId, status);
  }

  // ── Cola de subida de fotos ──
  static Future<void> enqueueUpload({required int jobId, required String localPath}) async {
    await _outbox.add({
      'actionId': '${DateTime.now().millisecondsSinceEpoch}-up-$jobId',
      'type': 'upload_file',
      'jobId': jobId,
      'localPath': localPath,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  static List<MapEntry<dynamic, Map<String, dynamic>>> pending() {
    return _outbox
        .toMap()
        .entries
        .map((e) => MapEntry(e.key, Map<String, dynamic>.from(e.value as Map)))
        .toList();
  }

  static Future<void> removePending(dynamic key) async {
    await _outbox.delete(key);
    pendingCount.value = _outbox.length;
  }
}
