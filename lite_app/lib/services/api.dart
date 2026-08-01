import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import '../config.dart';
import 'session.dart';

/// Error de la API con el código que devuelve el backend, para que la UI
/// pueda distinguir un conflicto de estado de un fallo de red.
class ApiError implements Exception {
  final int statusCode;
  final String code;
  final String message;
  final List<String> detail;

  ApiError(this.statusCode, this.code, this.message, [this.detail = const []]);

  bool get isAuth => statusCode == 401 || statusCode == 403;
  bool get isConflict => statusCode == 409;

  @override
  String toString() => message;
}

/// Sin conexión: el llamante debe encolar la operación.
class OfflineError implements Exception {
  @override
  String toString() => 'Sin conexión';
}

/// Capa REST contra /api/connect/lite. Un único punto de entrada para que
/// toda la app trate los errores igual.
class Api {
  final String token;
  Api(this.token);

  static const _base = '$kBackendUrl/api/connect/lite';
  static const _timeout = Duration(seconds: 20);

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  static Never _fail(http.Response res) {
    try {
      final body = jsonDecode(res.body);
      final e = body is Map ? body['error'] : null;
      final detail = e is Map && e['detail'] is List
          ? (e['detail'] as List).map((x) => x.toString()).toList()
          : <String>[];
      throw ApiError(
        res.statusCode,
        (e is Map ? e['code'] : null)?.toString() ?? 'error',
        (e is Map ? e['message'] : null)?.toString() ?? 'Error ${res.statusCode}',
        detail,
      );
    } on FormatException {
      throw ApiError(res.statusCode, 'error', 'Error ${res.statusCode}');
    }
  }

  Future<dynamic> _get(String path) async {
    try {
      final res = await http.get(Uri.parse('$_base$path'), headers: _headers).timeout(_timeout);
      if (res.statusCode >= 400) _fail(res);
      return jsonDecode(res.body);
    } on SocketException {
      throw OfflineError();
    } on HttpException {
      throw OfflineError();
    }
  }

  Future<dynamic> _post(String path, [Map<String, dynamic>? body]) async {
    try {
      final res = await http
          .post(Uri.parse('$_base$path'), headers: _headers, body: jsonEncode(body ?? {}))
          .timeout(_timeout);
      if (res.statusCode >= 400) _fail(res);
      return res.body.isEmpty ? {} : jsonDecode(res.body);
    } on SocketException {
      throw OfflineError();
    } on HttpException {
      throw OfflineError();
    }
  }

  Future<dynamic> _delete(String path) async {
    try {
      final res = await http.delete(Uri.parse('$_base$path'), headers: _headers).timeout(_timeout);
      if (res.statusCode >= 400) _fail(res);
      return res.body.isEmpty ? {} : jsonDecode(res.body);
    } on SocketException {
      throw OfflineError();
    }
  }

  // ── Sesión ─────────────────────────────────────────────────────────────

  static Future<Session> login({
    required String workshopCode,
    required String username,
    required String pin,
    required Map<String, dynamic> device,
  }) async {
    final res = await http
        .post(
          Uri.parse('$_base/login'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'workshopCode': workshopCode,
            'username': username,
            'pin': pin,
            'device': device,
          }),
        )
        .timeout(_timeout);
    if (res.statusCode >= 400) _fail(res);
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return Session(
      token: data['token'] as String,
      user: (data['user'] as Map).cast<String, dynamic>(),
      workshop: (data['workshop'] as Map).cast<String, dynamic>(),
      config: (data['config'] as Map).cast<String, dynamic>(),
    );
  }

  Future<void> logout() => _post('/logout');

  Future<Map<String, dynamic>> me() async =>
      (await _get('/me') as Map).cast<String, dynamic>();

  Future<Map<String, dynamic>> config() async =>
      (await _get('/config') as Map).cast<String, dynamic>();

  Future<void> registerDevice(Map<String, dynamic> info) => _post('/device', info);

  // ── Asistencias ────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> assistances(String scope) async {
    final data = await _get('/assistances?scope=$scope') as Map;
    return (data['data'] as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  Future<Map<String, dynamic>> assistance(int id) async =>
      (await _get('/assistances/$id') as Map).cast<String, dynamic>();

  Future<Map<String, dynamic>> accept(int id, String actionId) async =>
      (await _post('/assistances/$id/accept', {'clientActionId': actionId}) as Map)
          .cast<String, dynamic>();

  Future<void> reject(int id, String reasonCode, String? notes, String actionId) =>
      _post('/assistances/$id/reject', {
        'reasonCode': reasonCode,
        'notes': notes,
        'clientActionId': actionId,
      });

  Future<Map<String, dynamic>> assignOperator(int id, int liteUserId) async =>
      (await _post('/assistances/$id/assign-operator', {'liteUserId': liteUserId}) as Map)
          .cast<String, dynamic>();

  Future<List<Map<String, dynamic>>> operators() async {
    final data = await _get('/operators') as Map;
    return (data['data'] as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  Future<Map<String, dynamic>> setStatus(
    int id,
    String status, {
    required String actionId,
    Map<String, dynamic>? point,
    String? note,
    String source = 'manual',
  }) async =>
      (await _post('/assistances/$id/status', {
        'status': status,
        'clientActionId': actionId,
        'point': point,
        'note': note,
        'source': source,
        'deviceTsMs': DateTime.now().millisecondsSinceEpoch,
      }) as Map)
          .cast<String, dynamic>();

  Future<Map<String, dynamic>> sendLocation(int id, Map<String, dynamic> point) async =>
      (await _post('/assistances/$id/location', point) as Map).cast<String, dynamic>();

  Future<Map<String, dynamic>> sendLocations(int id, List<Map<String, dynamic>> points) async =>
      (await _post('/assistances/$id/locations-batch', {'points': points}) as Map)
          .cast<String, dynamic>();

  Future<void> navigationOpened(int id, String app) =>
      _post('/assistances/$id/navigation', {'app': app});

  Future<Map<String, dynamic>> addNote(int id, String body, String actionId) async =>
      (await _post('/assistances/$id/notes', {'body': body, 'clientActionId': actionId}) as Map)
          .cast<String, dynamic>();

  Future<List<Map<String, dynamic>>> messages(int id) async {
    final data = await _get('/assistances/$id/messages') as Map;
    return (data['data'] as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  Future<Map<String, dynamic>> sendMessage(int id, String body, String actionId) async =>
      (await _post('/assistances/$id/messages', {'body': body, 'clientActionId': actionId}) as Map)
          .cast<String, dynamic>();

  Future<Map<String, dynamic>> files(int id) async =>
      (await _get('/assistances/$id/files') as Map).cast<String, dynamic>();

  Future<Map<String, dynamic>> uploadPhoto(
    int id, {
    required File file,
    required String category,
    required String actionId,
    double? lat,
    double? lng,
  }) async {
    try {
      final req = http.MultipartRequest('POST', Uri.parse('$_base/assistances/$id/files'))
        ..headers['Authorization'] = 'Bearer $token'
        ..fields['category'] = category
        ..fields['clientActionId'] = actionId
        ..fields['deviceTsMs'] = DateTime.now().millisecondsSinceEpoch.toString();
      if (lat != null) req.fields['lat'] = lat.toString();
      if (lng != null) req.fields['lng'] = lng.toString();
      req.files.add(await http.MultipartFile.fromPath(
        'file', file.path,
        contentType: MediaType('image', 'jpeg'),
      ));
      final streamed = await req.send().timeout(const Duration(seconds: 60));
      final res = await http.Response.fromStream(streamed);
      if (res.statusCode >= 400) _fail(res);
      return (jsonDecode(res.body) as Map).cast<String, dynamic>();
    } on SocketException {
      throw OfflineError();
    }
  }

  Future<void> deletePhoto(int id, int fileId) => _delete('/assistances/$id/files/$fileId');

  Future<Map<String, dynamic>> signature(
    int id, {
    required String imageBase64,
    required String signerName,
    String? signerDocument,
    String? consentText,
    double? lat,
    double? lng,
    required String actionId,
  }) async =>
      (await _post('/assistances/$id/signature', {
        'imageBase64': imageBase64,
        'signerName': signerName,
        'signerDocument': signerDocument,
        'consentText': consentText,
        'consentAccepted': true,
        'lat': lat,
        'lng': lng,
        'signedAtMs': DateTime.now().millisecondsSinceEpoch,
        'clientActionId': actionId,
      }) as Map)
          .cast<String, dynamic>();

  Future<Map<String, dynamic>> finish(
    int id, {
    required String result,
    required String resolutionNotes,
    int? odometerKm,
    int? workedMinutes,
    Map<String, dynamic>? point,
    required String actionId,
  }) async =>
      (await _post('/assistances/$id/finish', {
        'result': result,
        'resolutionNotes': resolutionNotes,
        'odometerKm': odometerKm,
        'workedMinutes': workedMinutes,
        'point': point,
        'clientActionId': actionId,
      }) as Map)
          .cast<String, dynamic>();

  Future<Map<String, dynamic>> sync(List<Map<String, dynamic>> operations) async =>
      (await _post('/sync', {'operations': operations}) as Map).cast<String, dynamic>();

  Future<List<Map<String, dynamic>>> history() async {
    final data = await _get('/history') as Map;
    return (data['data'] as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
  }
}
