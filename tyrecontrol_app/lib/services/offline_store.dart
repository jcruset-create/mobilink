import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'supabase_service.dart';

/// Almacenamiento local (Hive). Igual que en la app de asistencias:
/// todo se guarda primero en local y una cola (outbox) se vacia sola
/// cuando hay red. El tecnico nunca debe notar si hay cobertura o no.
class OfflineStore {
  static late Box _cache;
  static late Box _outbox;
  static late Box _failed; // buzón de items rechazados por el servidor (no bloquean la cola)

  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  static final ValueNotifier<int> failedCount = ValueNotifier<int>(0);
  static final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  static Future<void> init() async {
    await Hive.initFlutter();
    _cache = await Hive.openBox('tc_cache');
    _outbox = await Hive.openBox('tc_outbox');
    _failed = await Hive.openBox('tc_failed');
    pendingCount.value = _outbox.length;
    failedCount.value = _failed.length;
  }

  // ── Caché de lectura (vehiculos recientes, posiciones, montajes) ──
  static Future<void> cacheJson(String key, dynamic value) async {
    await _cache.put(key, jsonEncode(value));
  }

  static dynamic cachedJson(String key) {
    final raw = _cache.get(key);
    if (raw is String && raw.isNotEmpty) {
      try {
        return jsonDecode(raw);
      } catch (_) {}
    }
    return null;
  }

  static Future<void> agregarVehiculoReciente(Map<String, dynamic> vehiculo) async {
    final raw = cachedJson('recientes');
    final list = raw is List ? List<Map<String, dynamic>>.from(raw.map((e) => Map<String, dynamic>.from(e))) : <Map<String, dynamic>>[];
    list.removeWhere((v) => v['id'] == vehiculo['id']);
    list.insert(0, vehiculo);
    await cacheJson('recientes', list.take(10).toList());
  }

  static List<Map<String, dynamic>> vehiculosRecientes() {
    final raw = cachedJson('recientes');
    if (raw is List) return raw.map((e) => Map<String, dynamic>.from(e)).toList();
    return [];
  }

  // ── Cola de guardado de detalle de revision ──────────────────
  static Future<void> enqueueDetalle(Map<String, dynamic> detalle) async {
    await _outbox.add({
      'type': 'detalle',
      'payload': detalle,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  static Future<void> enqueueCompletar(String revisionId) async {
    await _outbox.add({
      'type': 'completar',
      'revisionId': revisionId,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  /// Copia la foto a almacenamiento persistente y la encola para subir
  /// cuando haya red (la subida real de Storage necesita conexion).
  static Future<void> enqueueFoto(
    String localTempPath, {
    required String revisionId,
    required String posicionId,
    required String empresaId,
    required String vehiculoId,
  }) async {
    final dir = await getApplicationDocumentsDirectory();
    final outDir = Directory('${dir.path}/tc_offline_fotos');
    if (!await outDir.exists()) await outDir.create(recursive: true);
    final ext = localTempPath.split('.').last;
    final dest = '${outDir.path}/${posicionId}_${DateTime.now().microsecondsSinceEpoch}.$ext';
    await File(localTempPath).copy(dest);
    await _outbox.add({
      'type': 'foto',
      'revisionId': revisionId,
      'posicionId': posicionId,
      'empresaId': empresaId,
      'vehiculoId': vehiculoId,
      'localPath': dest,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    pendingCount.value = _outbox.length;
  }

  static List<MapEntry<dynamic, Map<String, dynamic>>> pending() {
    return _outbox.toMap().entries.map((e) => MapEntry(e.key, Map<String, dynamic>.from(e.value as Map))).toList();
  }

  static Future<void> _remove(dynamic key) async {
    await _outbox.delete(key);
    pendingCount.value = _outbox.length;
  }

  /// Aparta un item que el servidor ha RECHAZADO (dato inválido, etc.). No es
  /// falta de cobertura, así que reintentarlo en bucle no ayuda: se guarda en
  /// el buzón de errores para no bloquear el resto de la cola. Es recuperable:
  /// si luego se corrige la causa en el servidor, «Reintentar» lo reencola.
  static Future<void> parkFailed(Map<String, dynamic> item, String motivo) async {
    await _failed.add({...item, 'error': motivo, 'ts': DateTime.now().millisecondsSinceEpoch});
    failedCount.value = _failed.length;
  }

  /// Mueve todos los items del buzón de errores de vuelta a la cola y sincroniza.
  static Future<void> reintentarFallidos() async {
    for (final v in _failed.values.toList()) {
      final item = Map<String, dynamic>.from(v as Map)..remove('error');
      await _outbox.add(item);
    }
    await _failed.clear();
    failedCount.value = _failed.length;
    pendingCount.value = _outbox.length;
    await flush();
  }

  /// Intenta subir un item. Devuelve true si se subió, false si NO hay cobertura
  /// (para parar la cola y reintentar luego). Un rechazo del servidor se aparta
  /// al buzón de errores y NO detiene la cola (devuelve true = «seguir»).
  static Future<bool> _subir(dynamic key, Map<String, dynamic> item) async {
    final type = item['type'] as String;
    try {
      if (type == 'detalle') {
        await TyreControlApi.guardarDetalleRevision(Map<String, dynamic>.from(item['payload'] as Map));
      } else if (type == 'completar') {
        await TyreControlApi.completarRevision(item['revisionId'] as String);
      } else if (type == 'foto') {
        final path = item['localPath'] as String;
        final f = File(path);
        if (!await f.exists()) { await _remove(key); return true; }
        final url = await TyreControlApi.subirFotoRevision(f, revisionId: item['revisionId'] as String, posicionId: item['posicionId'] as String);
        await TyreControlApi.guardarDetalleRevision({
          'revision_id': item['revisionId'], 'posicion_id': item['posicionId'],
          'empresa_id': item['empresaId'], 'vehiculo_id': item['vehiculoId'], 'foto_url': url,
        });
        try { await f.delete(); } catch (_) {}
      }
      offline.value = false;
      await _remove(key);
      return true;
    } on PostgrestException catch (e) {
      // El servidor respondió y RECHAZÓ el dato: estamos online, pero el dato
      // es inválido. Apartar y seguir con el resto (no bloquear la cola).
      await parkFailed(item, e.message);
      await _remove(key);
      offline.value = false;
      return true;
    } catch (_) {
      // Sin cobertura / error transitorio: parar y reintentar más tarde.
      offline.value = true;
      return false;
    }
  }

  /// Vacía la cola en orden. Se detiene solo ante falta de cobertura; los
  /// rechazos del servidor se apartan al buzón de errores sin bloquear.
  static Future<void> flush() async {
    for (final entry in pending()) {
      final ok = await _subir(entry.key, entry.value);
      if (!ok) return; // sin red: reintentaremos luego
    }
  }
}
