import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';

class Employee {
  final String id;
  final String nombre;
  final String? apellidos;
  final String? cargo;

  Employee({required this.id, required this.nombre, this.apellidos, this.cargo});

  String get nombreCompleto =>
      [nombre, apellidos].where((s) => s != null && s.isNotEmpty).join(' ');

  factory Employee.fromJson(Map<String, dynamic> j) => Employee(
        id: j['id'] as String,
        nombre: j['nombre'] as String? ?? '',
        apellidos: j['apellidos'] as String?,
        cargo: j['cargo'] as String?,
      );
}

/// Capa REST contra el backend Express. Auth por empleado + PIN
/// (cabeceras x-presencia-* en cada petición, patrón de las demás APKs).
class ApiService {
  final String employeeId;
  final String pin;

  ApiService({required this.employeeId, required this.pin});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'x-presencia-employee': employeeId,
        'x-presencia-pin': pin,
      };

  // ── Login ────────────────────────────────────────────────────
  static Future<List<Employee>> employees() async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/presencia-operator/employees'))
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) return [];
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.map((e) => Employee.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<Employee> login(String employeeId, String pin) async {
    final res = await http
        .post(
          Uri.parse('$kBackendUrl/api/presencia-operator/login'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'employeeId': employeeId, 'pin': pin}),
        )
        .timeout(const Duration(seconds: 20));
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error de login');
    }
    return Employee.fromJson(data['employee'] as Map<String, dynamic>);
  }

  // ── Fichaje ──────────────────────────────────────────────────
  Future<Map<String, dynamic>?> hoy() async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/presencia-operator/hoy'), headers: _headers)
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) throw Exception('Error consultando fichaje');
    final data = jsonDecode(res.body);
    return data == null ? null : data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> fichar(String accion) async {
    final res = await http
        .post(
          Uri.parse('$kBackendUrl/api/presencia-operator/fichar'),
          headers: _headers,
          body: jsonEncode({'accion': accion}),
        )
        .timeout(const Duration(seconds: 15));
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error registrando fichaje');
    }
    return data;
  }

  Future<List<Map<String, dynamic>>> historial() async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/presencia-operator/historial'),
            headers: _headers)
        .timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) return [];
    return (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
  }
}
