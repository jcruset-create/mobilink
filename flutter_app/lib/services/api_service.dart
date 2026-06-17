import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config.dart';

class ApiService {
  final String techName;
  final String code;

  ApiService({required this.techName, required this.code});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'x-roadside-operator-name': techName,
        'x-roadside-operator-code': code,
      };

  static Future<Map<String, dynamic>> login(
      String techName, String code) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'techName': techName, 'code': code}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error de login');
    }
    return data;
  }

  Future<List<Map<String, dynamic>>> getAssistances() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances'),
      headers: _headers,
    );
    if (res.statusCode != 200) {
      throw Exception('Error cargando asistencias');
    }
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> updateStatus(int id, String status) async {
    final res = await http.post(
      Uri.parse(
          '$kBackendUrl/api/roadside-operator/assistances/$id/status'),
      headers: _headers,
      body: jsonEncode({'status': status}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error actualizando estado');
    }
    return data;
  }

  // Usa el endpoint dedicado que envía WhatsApp al cliente
  Future<Map<String, dynamic>> enCamino(int id) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/en-camino'),
      headers: _headers,
      body: jsonEncode({}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error actualizando estado');
    }
    return data;
  }

  Future<void> sendLocation(int id, double lat, double lng) async {
    await http.post(
      Uri.parse(
          '$kBackendUrl/api/roadside-operator/assistances/$id/location'),
      headers: _headers,
      body: jsonEncode({'lat': lat, 'lng': lng}),
    );
  }

  Future<Map<String, dynamic>> saveConductor(
      int id, String nombre, String dni) async {
    final res = await http.post(
      Uri.parse(
          '$kBackendUrl/api/roadside-operator/assistances/$id/conductor'),
      headers: _headers,
      body: jsonEncode({'conductorNombre': nombre, 'conductorDni': dni}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error guardando conductor');
    }
    return data;
  }

  Future<Map<String, dynamic>> uploadFile(
      int id, File file, String kind) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/roadside-assistances/$id/files'),
    );
    req.headers.addAll({
      'x-roadside-operator-name': techName,
      'x-roadside-operator-code': code,
    });
    req.fields['kind'] = kind;
    req.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await req.send();
    final body = await streamed.stream.bytesToString();
    final data = jsonDecode(body) as Map<String, dynamic>;
    if (streamed.statusCode != 200) {
      throw Exception(data['error'] ?? 'Error subiendo foto');
    }
    return data;
  }
}
