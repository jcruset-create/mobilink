import 'dart:convert';
import 'dart:math';
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

  /// ¿Es este el trabajo `jobId`? El backend serializa algunos números como
  /// cadena, así que comparar con `==` directamente falla en silencio y el
  /// cambio optimista no se aplica.
  static bool mismoJob(dynamic idCacheado, int jobId) {
    if (idCacheado is num) return idCacheado.toInt() == jobId;
    if (idCacheado is String) return int.tryParse(idCacheado.trim()) == jobId;
    return false;
  }

  /// Actualiza el estado de un trabajo en la caché (optimista).
  static Future<Map<String, dynamic>?> applyLocalStatus(int jobId, String status) async {
    final list = cachedJobs();
    Map<String, dynamic>? updated;
    for (final j in list) {
      if (mismoJob(j['id'], jobId)) {
        j['status'] = status;
        updated = j;
      }
    }
    await cacheJobs(list);
    return updated;
  }

  /// Clave única de una operación encolada.
  ///
  /// Viaja al servidor en `x-idempotency-key` y es lo que evita que un
  /// reintento (la respuesta se perdió, pero el servidor sí la recibió) suba
  /// la misma foto dos veces o cree el trabajo por duplicado. Se genera al
  /// encolar, no al enviar: si se generase al enviar, cada reintento traería
  /// una clave distinta y no serviría de nada.
  static String nuevaClave(String prefijo) {
    final azar = Random().nextInt(0x7fffffff).toRadixString(36);
    return '$prefijo-${DateTime.now().microsecondsSinceEpoch}-$azar';
  }

  // ── Cola de cambios de estado ──
  static Future<void> enqueueStatus({required int jobId, required String status}) async {
    await _outbox.add({
      'actionId': nuevaClave('st-$jobId'),
      'type': 'status',
      'jobId': jobId,
      'status': status,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
    await applyLocalStatus(jobId, status);
  }

  // ── Cola de subida de fotos ──
  static Future<void> enqueueUpload({
    required int jobId,
    required String localPath,
    String? clave,
    String tipo = 'foto',
  }) async {
    await _outbox.add({
      'actionId': clave ?? nuevaClave('up-$jobId'),
      'type': 'upload_file',
      'jobId': jobId,
      'localPath': localPath,
      'tipo': tipo,
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
