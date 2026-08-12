import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import '../config.dart';
import '../models/job.dart';
import 'offline_store.dart';

bool _isNetworkError(Object e) =>
    e is SocketException || e is TimeoutException || e is http.ClientException;

/// Capa REST contra el backend Express. Auth por nombre+PIN (reusa el login
/// de operario) + endpoints /api/taller-operator/*. Offline-first con Hive.
class ApiService {
  final String techName;
  final String code;

  ApiService({required this.techName, required this.code});

  // ── Sesión (Bearer) ──────────────────────────────────────────
  static String? _accessToken;
  static DateTime? _tokenExpiresAt;

  static void _captureSession(Map<String, dynamic> data) {
    final session = data['session'];
    if (session is Map) {
      _accessToken = session['access_token'] as String?;
      final expiresIn = (session['expires_in'] as num?)?.toInt() ?? 3600;
      _tokenExpiresAt = DateTime.now().add(Duration(seconds: expiresIn - 300));
    }
  }

  bool get _tokenCaducado =>
      _accessToken == null ||
      _tokenExpiresAt == null ||
      DateTime.now().isAfter(_tokenExpiresAt!);

  /// Se envían las dos credenciales posibles: el backend acepta el PIN de
  /// taller (techs.workshopPin) o el código de operario
  /// (techs.roadsideOperatorCode), y el técnico no tiene por qué saber cuál de
  /// los dos tiene asignado.
  Map<String, String> get _operatorHeaders => {
        'x-roadside-operator-name': Uri.encodeComponent(techName),
        'x-roadside-operator-code': code,
        'x-operator-name': Uri.encodeComponent(techName),
        'x-operator-pin': code,
        if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      };

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        ..._operatorHeaders,
      };

  /// Cabeceras con clave de idempotencia: el servidor descarta el reintento de
  /// algo que ya aplicó en vez de duplicarlo.
  Map<String, String> _headersCon(String? clave) => {
        ..._headers,
        if (clave != null) 'x-idempotency-key': clave,
      };

  Future<Map<String, String>> _authHeaders() async {
    if (_tokenCaducado) {
      try {
        await ApiService.login(techName, code);
      } catch (_) {/* offline: seguimos con cabeceras legacy */}
    }
    return _headers;
  }

  // ── Login ────────────────────────────────────────────────────
  static Future<Map<String, dynamic>> login(String techName, String code) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/taller-operator/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'techName': techName, 'code': code}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error de login');
    }
    _captureSession(data);
    return data;
  }

  static Future<List<String>> techNames() async {
    final res = await http.get(
        Uri.parse('$kBackendUrl/api/taller-operator/techs-list'));
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list
        .map((e) => (e is Map ? e['name'] : e).toString())
        .where((s) => s.isNotEmpty)
        .toList();
  }

  Future<bool> esSupervisor() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/taller-operator/me'),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) return false;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['esSupervisor'] == true;
  }

  // ── Trabajos (offline-first) ─────────────────────────────────
  Future<List<Job>> getJobs() async {
    await flushOutbox();
    try {
      final res = await http
          .get(
            Uri.parse('$kBackendUrl/api/taller-operator/jobs'),
            headers: await _authHeaders(),
          )
          .timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) throw Exception('Error cargando trabajos');
      final list = (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
      OfflineStore.offline.value = false;
      await OfflineStore.cacheJobs(list);
      return list.map((e) => Job.fromJson(e)).toList();
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        return OfflineStore.cachedJobs().map((e) => Job.fromJson(e)).toList();
      }
      rethrow;
    }
  }

  Future<List<String>> getTechs() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/taller-operator/techs'),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.map((e) => (e as Map)['name'].toString()).toList();
  }

  /// Cambiar estado (activo | parado | cerrado | espera). Offline → se encola.
  Future<Job> setStatus(int id, String status) async {
    try {
      final res = await http
          .put(
            Uri.parse('$kBackendUrl/api/taller-operator/jobs/$id/status'),
            headers: await _authHeaders(),
            body: jsonEncode({'status': status}),
          )
          .timeout(const Duration(seconds: 15));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200) {
        throw Exception(data['error'] ?? 'Error cambiando estado');
      }
      OfflineStore.offline.value = false;
      return Job.fromJson(data);
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueStatus(jobId: id, status: status);
        final cached = OfflineStore.cachedJobs()
            .firstWhere((j) => OfflineStore.mismoJob(j['id'], id),
                orElse: () => <String, dynamic>{});
        if (cached.isNotEmpty) return Job.fromJson(cached);
        return Job.fromJson({'id': id, 'status': status, 'assignedNames': const []});
      }
      rethrow;
    }
  }

  Future<Job> createJob({
    required String area,
    required String plate,
    required String reason,
    required bool urgent,
    required List<String> assignedNames,
    String customerName = '',
    String customerPhone = '',
    String? workshopId,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/taller-operator/jobs'),
      headers: await _authHeaders(),
      body: jsonEncode({
        'area': area,
        'plate': plate,
        'reason': reason,
        'urgent': urgent,
        'assignedNames': assignedNames,
        'customerName': customerName,
        'customerPhone': customerPhone,
        'workshopId': workshopId,
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['error'] ?? 'Error creando trabajo');
    return Job.fromJson(data);
  }

  Future<Job> assign(int id, List<String> assignedNames) async {
    final res = await http.put(
      Uri.parse('$kBackendUrl/api/taller-operator/jobs/$id/assign'),
      headers: await _authHeaders(),
      body: jsonEncode({'assignedNames': assignedNames}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['error'] ?? 'Error reasignando');
    return Job.fromJson(data);
  }

  // ── Fotos ────────────────────────────────────────────────────
  Future<List<Map<String, dynamic>>> getFiles(int jobId) async {
    try {
      final res = await http.get(
        Uri.parse('$kBackendUrl/api/taller-operator/jobs/$jobId/files'),
        headers: await _authHeaders(),
      );
      if (res.statusCode != 200) return [];
      return (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  /// Sube una foto (comprimida). Offline → se encola para reenvío.
  Future<void> uploadPhoto(int jobId, String localPath) async {
    // La clave se crea aquí y se reutiliza si hay que encolar: así el envío
    // directo y su posterior reintento son la misma operación para el servidor.
    final clave = OfflineStore.nuevaClave('up-$jobId');
    try {
      await _uploadFromPath(jobId, localPath, clave: clave);
      OfflineStore.offline.value = false;
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueUpload(
            jobId: jobId, localPath: localPath, clave: clave);
        return;
      }
      rethrow;
    }
  }

  Future<bool> _uploadFromPath(int jobId, String path,
      {String? clave, String tipo = 'foto'}) async {
    final compressed = await FlutterImageCompress.compressWithFile(
      path,
      quality: 70,
      minWidth: 1280,
      minHeight: 1280,
    );
    final bytes = compressed ?? await File(path).readAsBytes();
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/taller-operator/jobs/$jobId/files'),
    );
    req.headers.addAll(_operatorHeaders);
    if (clave != null) req.headers['x-idempotency-key'] = clave;
    req.fields['tipo'] = tipo;
    req.files.add(http.MultipartFile.fromBytes(
      'file',
      bytes,
      filename: '${tipo}_$jobId.jpg',
      contentType: MediaType('image', 'jpeg'),
    ));
    final streamed = await req.send().timeout(const Duration(seconds: 30));
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode != 200) throw Exception('Error subiendo foto');
    return true;
  }

  /// Sube la firma del cliente. Va por la misma vía que las fotos —misma
  /// tabla, misma cola offline, misma clave de idempotencia— pero marcada como
  /// `firma`, y el servidor sustituye la anterior si ya había una.
  Future<void> subirFirma(int jobId, String localPath) async {
    final clave = OfflineStore.nuevaClave('firma-$jobId');
    try {
      await _uploadFromPath(jobId, localPath, clave: clave, tipo: 'firma');
      OfflineStore.offline.value = false;
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueUpload(
            jobId: jobId, localPath: localPath, clave: clave, tipo: 'firma');
        return;
      }
      rethrow;
    }
  }

  // ── Checklist ────────────────────────────────────────────────

  /// Plantillas activas, para elegir cuál aplicar al trabajo.
  Future<List<Map<String, dynamic>>> plantillasChecklist() async {
    try {
      final res = await http
          .get(Uri.parse('$kBackendUrl/api/taller-operator/checklist-plantillas'),
              headers: await _authHeaders())
          .timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) return [];
      return (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  /// Checklist del trabajo, o null si todavía no se le ha aplicado ninguno.
  Future<Map<String, dynamic>?> checklistDe(int jobId) async {
    try {
      final res = await http
          .get(Uri.parse('$kBackendUrl/api/taller-operator/jobs/$jobId/checklist'),
              headers: await _authHeaders())
          .timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) return null;
      final data = jsonDecode(res.body);
      return data is Map ? Map<String, dynamic>.from(data) : null;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> aplicarChecklist(int jobId, int plantillaId) async {
    final res = await http
        .post(Uri.parse('$kBackendUrl/api/taller-operator/jobs/$jobId/checklist'),
            headers: await _authHeaders(),
            body: jsonEncode({'plantillaId': plantillaId}))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception(_errorDe(res.body, 'No se ha podido aplicar el checklist'));
    }
    return Map<String, dynamic>.from(jsonDecode(res.body) as Map);
  }

  /// Marca o desmarca UN punto. Se envía solo el índice, no la lista entera:
  /// con dos técnicos en el mismo trabajo, mandar todo haría que el último
  /// guardado borrase lo que marcó el otro.
  Future<Map<String, dynamic>?> marcarChecklist(
      int jobId, int indice, bool hecho) async {
    final res = await http
        .put(
            Uri.parse(
                '$kBackendUrl/api/taller-operator/jobs/$jobId/checklist/$indice'),
            headers: await _authHeaders(),
            body: jsonEncode({'hecho': hecho}))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception(_errorDe(res.body, 'No se ha podido guardar el punto'));
    }
    return Map<String, dynamic>.from(jsonDecode(res.body) as Map);
  }

  // ── Pausas ───────────────────────────────────────────────────
  // Son las mismas que registra la pantalla /operario/taller: comparten
  // endpoint y tabla, así que el tiempo real del trabajo sale igual se marque
  // desde la tablet o desde el kiosko. No tienen nada que ver con el fichaje
  // de jornada del módulo Presencia, que es otra cosa.

  static const tiposPausa = <String, String>{
    'cigarro': 'Cigarro',
    'cafe': 'Café',
    'descanso': 'Descanso',
    'otro': 'Otro',
  };

  Map<String, String> get _headersPausa => {
        'Content-Type': 'application/json',
        'x-operator-name': Uri.encodeComponent(techName),
        'x-operator-pin': code,
      };

  /// Pausa abierta ahora mismo, o null. Devuelve null también si el técnico
  /// entró con código de operario y no tiene PIN de taller: en ese caso las
  /// pausas no le aplican y no tiene sentido dar un error.
  Future<Map<String, dynamic>?> pausaActual() async {
    try {
      final res = await http
          .get(Uri.parse('$kBackendUrl/api/workshop-operator/breaks/today'),
              headers: _headersPausa)
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return null;

      final data = jsonDecode(res.body);
      final lista = data is List
          ? data
          : (data is Map ? (data['breaks'] as List<dynamic>? ?? const []) : const []);

      for (final item in lista) {
        if (item is Map && item['endedAtMs'] == null) {
          return Map<String, dynamic>.from(item);
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<void> iniciarPausa(String tipo) async {
    final res = await http
        .post(Uri.parse('$kBackendUrl/api/workshop-operator/break/start'),
            headers: _headersPausa, body: jsonEncode({'breakType': tipo}))
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception(_errorDe(res.body, 'No se ha podido iniciar la pausa'));
    }
  }

  /// Termina la pausa abierta y devuelve los minutos que ha durado.
  Future<int> terminarPausa() async {
    final res = await http
        .post(Uri.parse('$kBackendUrl/api/workshop-operator/break/end'),
            headers: _headersPausa)
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception(_errorDe(res.body, 'No se ha podido cerrar la pausa'));
    }
    final data = jsonDecode(res.body);
    return data is Map && data['durationMin'] is num
        ? (data['durationMin'] as num).toInt()
        : 0;
  }

  String _errorDe(String cuerpo, String porDefecto) {
    try {
      final data = jsonDecode(cuerpo);
      if (data is Map && data['error'] != null) return data['error'].toString();
    } catch (_) {/* respuesta no JSON */}
    return porDefecto;
  }

  // ── Cola offline ─────────────────────────────────────────────
  bool _flushing = false;

  Future<void> flushOutbox() async {
    if (_flushing) return;
    _flushing = true;
    try {
      for (final entry in OfflineStore.pending()) {
        final item = entry.value;
        final type = item['type'] as String;
        final jobId = item['jobId'] as int;
        try {
          if (type == 'status') {
            final res = await http
                .put(
                  Uri.parse('$kBackendUrl/api/taller-operator/jobs/$jobId/status'),
                  headers: _headersCon(item['actionId'] as String?),
                  body: jsonEncode({'status': item['status']}),
                )
                .timeout(const Duration(seconds: 15));
            if (res.statusCode == 200) {
              await OfflineStore.removePending(entry.key);
            } else {
              // Error real del servidor → descartamos para no bloquear la cola
              await OfflineStore.removePending(entry.key);
            }
          } else if (type == 'upload_file') {
            await _uploadFromPath(jobId, item['localPath'] as String,
                clave: item['actionId'] as String?,
                tipo: (item['tipo'] as String?) ?? 'foto');
            await OfflineStore.removePending(entry.key);
          }
        } catch (e) {
          if (_isNetworkError(e)) break; // sin red: reintentamos más tarde
          await OfflineStore.removePending(entry.key); // error real: descartar
        }
      }
    } finally {
      _flushing = false;
    }
  }
}
