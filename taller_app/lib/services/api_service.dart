import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';
import '../models/job.dart';

/// Capa REST contra el backend Express. Auth por nombre+PIN (reusa el login
/// de operario) + endpoints /api/taller-operator/*.
class ApiService {
  final String techName;
  final String code;

  ApiService({required this.techName, required this.code});

  // ── Sesión (Bearer) capturada del login ──────────────────────
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

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'x-roadside-operator-name': Uri.encodeComponent(techName),
        'x-roadside-operator-code': code,
        if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      };

  Future<Map<String, String>> _authHeaders() async {
    if (_tokenCaducado) {
      try {
        await ApiService.login(techName, code);
      } catch (_) {/* offline: seguimos con cabeceras legacy */}
    }
    return _headers;
  }

  // ── Login (nombre + PIN) ─────────────────────────────────────
  static Future<Map<String, dynamic>> login(String techName, String code) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/login'),
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

  /// Técnicos con código (para el desplegable de login).
  static Future<List<String>> techNames() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/techs'),
    );
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list
        .map((e) => (e is Map ? e['name'] : e).toString())
        .where((s) => s.isNotEmpty)
        .toList();
  }

  // ── Rol del operario logueado ────────────────────────────────
  Future<bool> esSupervisor() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/taller-operator/me'),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) return false;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return data['esSupervisor'] == true;
  }

  // ── Trabajos ─────────────────────────────────────────────────
  Future<List<Job>> getJobs() async {
    final res = await http
        .get(
          Uri.parse('$kBackendUrl/api/taller-operator/jobs'),
          headers: await _authHeaders(),
        )
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception('Error cargando trabajos');
    }
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.map((e) => Job.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Técnicos para asignar (solo supervisor).
  Future<List<String>> getTechs() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/taller-operator/techs'),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.map((e) => (e as Map)['name'].toString()).toList();
  }

  /// Cambiar estado (activo | parado | cerrado | espera).
  Future<Job> setStatus(int id, String status) async {
    final res = await http.put(
      Uri.parse('$kBackendUrl/api/taller-operator/jobs/$id/status'),
      headers: await _authHeaders(),
      body: jsonEncode({'status': status}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error cambiando estado');
    }
    return Job.fromJson(data);
  }

  /// Crear/asignar trabajo (solo supervisor).
  Future<Job> createJob({
    required String area,
    required String plate,
    required String reason,
    required bool urgent,
    required List<String> assignedNames,
    String customerName = '',
    String customerPhone = '',
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
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error creando trabajo');
    }
    return Job.fromJson(data);
  }

  /// Reasignar (solo supervisor).
  Future<Job> assign(int id, List<String> assignedNames) async {
    final res = await http.put(
      Uri.parse('$kBackendUrl/api/taller-operator/jobs/$id/assign'),
      headers: await _authHeaders(),
      body: jsonEncode({'assignedNames': assignedNames}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error reasignando');
    }
    return Job.fromJson(data);
  }
}
