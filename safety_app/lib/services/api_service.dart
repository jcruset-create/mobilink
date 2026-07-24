import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';

/// Capa REST contra el backend Express. Auth por empleado (sea_employees)
/// + PIN, igual que la APK de presencia: cabeceras x-presencia-employee
/// y x-presencia-pin en cada petición.
class ApiService {
  final String employeeId;
  final String pin;
  final String employeeName;

  ApiService({
    required this.employeeId,
    required this.pin,
    required this.employeeName,
  });

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'x-presencia-employee': employeeId,
        'x-presencia-pin': pin,
      };

  static Never _throwApi(http.Response res, String fallback) {
    try {
      final data = jsonDecode(res.body);
      throw Exception((data is Map ? data['error'] : null) ?? fallback);
    } on FormatException {
      throw Exception(fallback);
    }
  }

  // ── Login ────────────────────────────────────────────────────
  /// Lista de empleados activos para el selector del login.
  static Future<List<Map<String, dynamic>>> employees() async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/presencia-operator/employees'));
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  static Future<Map<String, dynamic>> login(
      String employeeId, String pin) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/presencia-operator/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'employeeId': employeeId, 'pin': pin}),
    );
    if (res.statusCode != 200) _throwApi(res, 'Error de login');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // ── Safety ───────────────────────────────────────────────────
  Future<List<Map<String, dynamic>>> _getList(String path) async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/safety-operator/$path'),
      headers: _headers,
    );
    if (res.statusCode != 200) _throwApi(res, 'Error cargando datos');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  /// Mis EPIs entregados.
  Future<List<Map<String, dynamic>>> myEpis() => _getList('epis');

  /// Catálogo de EPIs activos (para solicitar).
  Future<List<Map<String, dynamic>>> epiCatalog() => _getList('epi-catalog');

  /// Mis solicitudes de EPI.
  Future<List<Map<String, dynamic>>> myRequests() => _getList('epi-requests');

  /// Crear solicitud de EPI.
  Future<void> requestEpi({
    required String epiId,
    int cantidad = 1,
    String? talla,
    String? motivo,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/safety-operator/epi-requests'),
      headers: _headers,
      body: jsonEncode({
        'epiId': epiId,
        'cantidad': cantidad,
        'talla': talla ?? '',
        'motivo': motivo ?? '',
      }),
    );
    if (res.statusCode != 200) _throwApi(res, 'Error creando la solicitud');
  }

  /// Documentos publicados con mi estado de firma.
  Future<List<Map<String, dynamic>>> documents() => _getList('documents');

  /// Firmar la lectura de un documento.
  Future<void> ackDocument(String documentId) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/safety-operator/documents/$documentId/ack'),
      headers: _headers,
      body: jsonEncode({'dispositivo': 'APK Mobilink Safety'}),
    );
    if (res.statusCode != 200) _throwApi(res, 'Error firmando el documento');
  }

  /// Mis formaciones.
  Future<List<Map<String, dynamic>>> trainings() => _getList('trainings');

  /// Próximas reuniones de seguridad.
  Future<List<Map<String, dynamic>>> meetings() => _getList('meetings');
}
