import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Almacenamiento local (Hive) para trabajar sin cobertura.
/// - Cachea la lista de asistencias asignadas (lectura offline).
/// - Mantiene una cola (outbox) de cambios de estado pendientes de enviar.
class OfflineStore {
  static late Box _cache;
  static late Box _outbox;

  /// Notifican a la UI: nº de cambios pendientes y si estamos offline.
  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  static final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  static Future<void> init() async {
    await Hive.initFlutter();
    _cache = await Hive.openBox('sea_cache');
    _outbox = await Hive.openBox('sea_outbox');
    pendingCount.value = _outbox.length;
  }

  // ── Caché de asistencias (se guarda como JSON para evitar problemas de tipos) ──
  static Future<void> cacheAssistances(List<Map<String, dynamic>> list) async {
    await _cache.put('assistances', jsonEncode(list));
  }

  static List<Map<String, dynamic>> cachedAssistances() {
    final raw = _cache.get('assistances');
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw) as List<dynamic>;
        return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      } catch (_) {}
    }
    return [];
  }

  /// Actualiza el estado de una asistencia en la caché (optimista).
  static Future<void> applyLocalStatus(int assistanceId, String status) async {
    final list = cachedAssistances();
    for (final a in list) {
      if (a['id'] == assistanceId) a['status'] = status;
    }
    await cacheAssistances(list);
  }

  // ── Cola de cambios de estado ──
  static Future<void> enqueueStatus({
    required int assistanceId,
    required String status,
    required String type, // 'status' | 'en_camino'
  }) async {
    final actionId =
        '${DateTime.now().millisecondsSinceEpoch}-$assistanceId-$status';
    await _outbox.add({
      'actionId': actionId,
      'type': type,
      'assistanceId': assistanceId,
      'status': status,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
    await applyLocalStatus(assistanceId, status);
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

  // ── Cola de subida de fotos/firma ──
  static Future<void> enqueueUpload({
    required int assistanceId,
    required String kind,
    required String localPath,
  }) async {
    await _outbox.add({
      'actionId': '${DateTime.now().millisecondsSinceEpoch}-up-$assistanceId-$kind',
      'type': 'upload_file',
      'assistanceId': assistanceId,
      'kind': kind,
      'localPath': localPath,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  // ── Cola de datos del conductor (cierre) ──
  static Future<void> enqueueConductor({
    required int assistanceId,
    required String nombre,
    required String dni,
    String? observaciones,
  }) async {
    await _outbox.add({
      'actionId': '${DateTime.now().millisecondsSinceEpoch}-cond-$assistanceId',
      'type': 'save_conductor',
      'assistanceId': assistanceId,
      'nombre': nombre,
      'dni': dni,
      'observaciones': observaciones,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  // ── Cola de captura de destino (GPS al llegar) ──
  static Future<void> enqueueCaptureDestination({
    required int assistanceId,
    required double lat,
    required double lng,
  }) async {
    await _outbox.add({
      'actionId': '${DateTime.now().millisecondsSinceEpoch}-dest-$assistanceId',
      'type': 'capture_destination',
      'assistanceId': assistanceId,
      'lat': lat,
      'lng': lng,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }
}
