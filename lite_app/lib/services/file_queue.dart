import 'dart:convert';
import 'dart:io';

import 'package:hive_flutter/hive_flutter.dart';
import 'package:path_provider/path_provider.dart';

import 'api.dart';
import 'queue.dart';

/// Cola de evidencias pendientes de subir: fotografías y firma.
///
/// La cola de operaciones (`OfflineQueue`) manda JSON, y para eso basta con
/// guardar el payload. Aquí hay binarios, así que el fichero se **copia a
/// almacenamiento persistente de la app** en cuanto se captura: la carpeta
/// temporal del sistema la puede vaciar Android en cualquier momento, y la
/// firma solo vivía en memoria. Antes, sin cobertura, se le pedía al operario
/// que repitiera la foto más tarde; en carretera eso es perderla.
///
/// El envío es idempotente por `clientActionId`: el backend ya lo comprueba
/// (`connect_lite_actions`), así que reintentar nunca duplica la evidencia.
class PendingFile {
  PendingFile({
    required this.id,
    required this.kind,
    required this.assistanceId,
    required this.path,
    required this.createdAtMs,
    this.category = 'other',
    this.lat,
    this.lng,
    this.meta = const {},
    this.attempts = 0,
    this.state = 'pending',
  });

  /// clientActionId: el mismo que verá el backend.
  final String id;

  /// photo | signature
  final String kind;
  final int assistanceId;

  /// Ruta en el almacenamiento privado de la app.
  final String path;
  final int createdAtMs;
  final String category;
  final double? lat;
  final double? lng;

  /// Datos del firmante, en la firma.
  final Map<String, dynamic> meta;

  int attempts;

  /// pending | failed
  String state;

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind,
        'assistanceId': assistanceId,
        'path': path,
        'createdAtMs': createdAtMs,
        'category': category,
        'lat': lat,
        'lng': lng,
        'meta': meta,
        'attempts': attempts,
        'state': state,
      };

  static PendingFile fromJson(Map<String, dynamic> j) => PendingFile(
        id: j['id'] as String,
        kind: j['kind'] as String,
        assistanceId: (j['assistanceId'] as num).toInt(),
        path: j['path'] as String,
        createdAtMs: (j['createdAtMs'] as num).toInt(),
        category: (j['category'] as String?) ?? 'other',
        lat: (j['lat'] as num?)?.toDouble(),
        lng: (j['lng'] as num?)?.toDouble(),
        meta: (j['meta'] as Map?)?.cast<String, dynamic>() ?? const {},
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
        state: (j['state'] as String?) ?? 'pending',
      );
}

class FileQueue {
  static const _boxName = 'lite_files';
  static Box? _box;

  static Future<void> init() async {
    _box = await Hive.openBox(_boxName);
    await _limpiarHuerfanos();
  }

  static List<PendingFile> all() {
    final box = _box;
    if (box == null) return [];
    return box.values
        .map((v) => PendingFile.fromJson((jsonDecode(v as String) as Map).cast<String, dynamic>()))
        .toList()
      ..sort((a, b) => a.createdAtMs.compareTo(b.createdAtMs));
  }

  static List<PendingFile> forAssistance(int assistanceId) =>
      all().where((f) => f.assistanceId == assistanceId).toList();

  static int get pendingCount => all().where((f) => f.state == 'pending').length;
  static int get failedCount => all().where((f) => f.state == 'failed').length;

  /// Carpeta propia dentro del almacenamiento privado de la app.
  static Future<Directory> _carpeta() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/evidencias');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Guarda el binario y lo deja en cola. Devuelve el registro creado.
  static Future<PendingFile> _encolar({
    required String kind,
    required int assistanceId,
    required List<int> bytes,
    required String extension,
    String category = 'other',
    double? lat,
    double? lng,
    Map<String, dynamic> meta = const {},
    String? actionId,
  }) async {
    final id = actionId ?? OfflineQueue.newActionId();
    final dir = await _carpeta();
    final destino = File('${dir.path}/$id.$extension');
    await destino.writeAsBytes(bytes, flush: true);

    final pf = PendingFile(
      id: id,
      kind: kind,
      assistanceId: assistanceId,
      path: destino.path,
      createdAtMs: DateTime.now().millisecondsSinceEpoch,
      category: category,
      lat: lat,
      lng: lng,
      meta: meta,
    );
    await _box?.put(pf.id, jsonEncode(pf.toJson()));
    return pf;
  }

  static Future<PendingFile> addPhoto({
    required int assistanceId,
    required File file,
    required String category,
    double? lat,
    double? lng,
    String? actionId,
  }) =>
      _encolar(
        kind: 'photo',
        assistanceId: assistanceId,
        bytes: file.readAsBytesSync(),
        extension: 'jpg',
        category: category,
        lat: lat,
        lng: lng,
        actionId: actionId,
      );

  static Future<PendingFile> addSignature({
    required int assistanceId,
    required List<int> png,
    required String signerName,
    String? signerDocument,
    String? consentText,
    double? lat,
    double? lng,
    String? actionId,
  }) =>
      _encolar(
        kind: 'signature',
        assistanceId: assistanceId,
        bytes: png,
        extension: 'png',
        lat: lat,
        lng: lng,
        actionId: actionId,
        meta: {
          'signerName': signerName,
          'signerDocument': signerDocument,
          'consentText': consentText,
        },
      );

  static Future<void> _update(PendingFile f) async =>
      _box?.put(f.id, jsonEncode(f.toJson()));

  /// Borra el registro y el fichero: solo cuando el servidor ha confirmado.
  static Future<void> _cerrar(PendingFile f) async {
    await _box?.delete(f.id);
    try {
      final file = File(f.path);
      if (await file.exists()) await file.delete();
    } catch (_) {/* el hueco se recupera en el próximo _limpiarHuerfanos */}
  }

  /// Reintenta una evidencia que se había dado por fallida.
  static Future<void> retry(String id) async {
    final f = all().where((x) => x.id == id).firstOrNull;
    if (f == null) return;
    f.state = 'pending';
    f.attempts = 0;
    await _update(f);
  }

  /// Descarta una evidencia pendiente (el operario decide no enviarla).
  static Future<void> discard(String id) async {
    final f = all().where((x) => x.id == id).firstOrNull;
    if (f != null) await _cerrar(f);
  }

  /// Ficheros en disco sin registro en la cola: sobras de un cierre a medias.
  static Future<void> _limpiarHuerfanos() async {
    try {
      final dir = await _carpeta();
      final vivos = all().map((f) => f.path).toSet();
      await for (final e in dir.list()) {
        if (e is File && !vivos.contains(e.path)) await e.delete();
      }
    } catch (_) {/* no es crítico */}
  }

  /// Sube lo pendiente. Se corta al primer corte de red: si no hay cobertura,
  /// insistir con el resto solo gasta batería.
  static Future<void> flush(Api api) async {
    for (final f in all().where((x) => x.state == 'pending')) {
      final file = File(f.path);
      if (!await file.exists()) {
        // El fichero ya no está: el registro no sirve de nada.
        await _box?.delete(f.id);
        continue;
      }
      try {
        if (f.kind == 'photo') {
          await api.uploadPhoto(
            f.assistanceId,
            file: file,
            category: f.category,
            actionId: f.id,
            lat: f.lat,
            lng: f.lng,
          );
        } else {
          await api.signature(
            f.assistanceId,
            imageBase64: base64Encode(await file.readAsBytes()),
            signerName: '${f.meta['signerName'] ?? ''}',
            signerDocument: f.meta['signerDocument'] as String?,
            consentText: f.meta['consentText'] as String?,
            lat: f.lat,
            lng: f.lng,
            actionId: f.id,
          );
        }
        await _cerrar(f);
      } on OfflineError {
        return; // sigue sin cobertura: se reintenta en el próximo ciclo
      } on ApiError catch (e) {
        // 4xx que no sea de sesión: el servidor no lo va a aceptar nunca
        // (categoría inválida, asistencia ya cerrada). Se marca y se avisa.
        if (e.isAuth) return;
        f.attempts++;
        if (f.attempts >= 5) f.state = 'failed';
        await _update(f);
      } catch (_) {
        f.attempts++;
        if (f.attempts >= 5) f.state = 'failed';
        await _update(f);
      }
    }
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}

/// Resumen de las dos colas (operaciones y evidencias) para enviarlo a Central.
///
/// Una cola atascada no la ve nadie desde el móvil: el operario cree que la
/// foto está subida y Central no sabe que le falta. Informando del pendiente y
/// de la marca más antigua, el panel puede avisar antes de que el servicio se
/// cierre sin su documentación. No viaja ningún contenido, solo cuentas.
Map<String, dynamic> estadoDeColas() {
  final ops = OfflineQueue.all();
  final ficheros = FileQueue.all();
  final pendientes = [
    ...ops.where((o) => o.state == 'pending').map((o) => o.createdAtMs),
    ...ficheros.where((f) => f.state == 'pending').map((f) => f.createdAtMs),
  ];
  final atascados = ops.where((o) => o.state != 'pending').length +
      ficheros.where((f) => f.state != 'pending').length;

  return {
    'queuePending': pendientes.length,
    // Conflictos y evidencias descartadas: no se reintentan solas, hace falta
    // que alguien mire.
    'queueFailed': atascados,
    'queueOldestAtMs':
        pendientes.isEmpty ? null : pendientes.reduce((a, b) => a < b ? a : b),
  };
}
