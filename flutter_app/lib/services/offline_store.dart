import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Almacenamiento local (Hive) para trabajar sin cobertura.
/// - Cachea la lista de asistencias asignadas (lectura offline).
/// - Mantiene una cola (outbox) de cambios de estado pendientes de enviar.
class OfflineStore {
  static late Box _cache;
  static late Box _outbox;
  static late Box _track; // migas de pan GPS offline

  /// Notifican a la UI: nº de cambios pendientes y si estamos offline.
  static final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);
  static final ValueNotifier<bool> offline = ValueNotifier<bool>(false);

  static Future<void> init() async {
    await Hive.initFlutter();
    _cache = await Hive.openBox('sea_cache');
    _outbox = await Hive.openBox('sea_outbox');
    _track = await Hive.openBox('sea_track');
    pendingCount.value = _outbox.length;
    perdidasCount.value = perdidas().length;
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
    int? serviceKm,
  }) async {
    final actionId =
        '${DateTime.now().millisecondsSinceEpoch}-$assistanceId-$status';
    await _outbox.add({
      'actionId': actionId,
      'type': type,
      'assistanceId': assistanceId,
      'status': status,
      if (serviceKm != null) 'serviceKm': serviceKm,
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

  // ── Qué evidencias faltan por subir ──────────────────────────────────
  //
  // Las fotos de llegada NO se suben todas igual: la matrícula del camión va
  // bloqueante —el servidor le hace OCR y puede preguntar—, y la avería y el
  // remolque van a esta cola. Si se pierde la cobertura justo después, la
  // pantalla deja seguir y la avería se queda aquí sin que nadie se entere.
  //
  // De ahí que haga falta poder preguntar, antes de cerrar el servicio, qué
  // hay pendiente DE ESTA asistencia.

  /// Las fotos obligatorias del parte. Sin ellas el informe sale cojo y no se
  /// puede justificar el servicio.
  static const kindsObligatorios = {
    'matricula_camion',
    'matricula_remolque',
    'foto_averia',
  };

  /// Tipos de foto de esta asistencia que siguen en la cola, sin repetir.
  static List<String> subidasPendientesDe(int assistanceId) {
    final kinds = <String>[];
    for (final e in pending()) {
      final item = e.value;
      if (item['type'] != 'upload_file') continue;
      if (item['assistanceId'] != assistanceId) continue;
      final kind = item['kind'] as String?;
      if (kind != null && !kinds.contains(kind)) kinds.add(kind);
    }
    return kinds;
  }

  /// De esas, las que el parte no puede permitirse perder.
  static List<String> obligatoriasPendientesDe(int assistanceId) =>
      subidasPendientesDe(assistanceId)
          .where(kindsObligatorios.contains)
          .toList();

  // ── Evidencias perdidas ──────────────────────────────────────────────
  //
  // Una foto encolada cuyo fichero local ha desaparecido —el sistema limpió
  // el directorio, se reinstaló la app— no se puede subir nunca. Antes se
  // descartaba marcándola como enviada: la cola bajaba, el contador bajaba y
  // no quedaba ni rastro de que esa foto existió.
  //
  // Ahora se apunta. No devuelve la foto, pero convierte una pérdida
  // silenciosa en una pérdida que alguien puede ver y arreglar yendo a por
  // otra foto mientras el camión sigue delante.
  static final ValueNotifier<int> perdidasCount = ValueNotifier<int>(0);

  static Future<void> registrarPerdida({
    required int assistanceId,
    required String kind,
    required String localPath,
  }) async {
    final lista = perdidas();
    lista.add({
      'assistanceId': assistanceId,
      'kind': kind,
      'localPath': localPath,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    await _cache.put('evidencias_perdidas', jsonEncode(lista));
    perdidasCount.value = lista.length;
  }

  static List<Map<String, dynamic>> perdidas() {
    final raw = _cache.get('evidencias_perdidas') as String?;
    if (raw == null || raw.isEmpty) return [];
    try {
      return (jsonDecode(raw) as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static List<Map<String, dynamic>> perdidasDe(int assistanceId) =>
      perdidas().where((p) => p['assistanceId'] == assistanceId).toList();

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

  // ── Migas de pan GPS (offline) ──
  static Future<void> enqueueLocation(
    int assistanceId,
    double lat,
    double lng, {
    double? accuracyM,
    double? speedKmh,
  }) async {
    await _track.add({
      'assistanceId': assistanceId,
      'lat': lat,
      'lng': lng,
      'ts': DateTime.now().millisecondsSinceEpoch,
      // Viajan con la miga de pan: al reconectar se mandan igual que en vivo,
      // así el rastro recuperado vale lo mismo que el que llegó a su hora.
      if (accuracyM != null) 'accuracyM': accuracyM,
      if (speedKmh != null) 'speedKmh': speedKmh,
    });
  }

  // Devuelve las migas agrupadas por asistencia: {assistanceId: [{lat,lng,ts}]}
  static Map<int, List<Map<String, dynamic>>> locationsByAssistance() {
    final out = <int, List<Map<String, dynamic>>>{};
    for (final v in _track.values) {
      final m = Map<String, dynamic>.from(v as Map);
      final id = m['assistanceId'] as int;
      out.putIfAbsent(id, () => []).add(m);
    }
    return out;
  }

  static bool hasLocations() => _track.isNotEmpty;

  static Future<void> clearLocations() async {
    await _track.clear();
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
