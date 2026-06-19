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

  Future<List<Map<String, dynamic>>> getHistory() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/history'),
      headers: _headers,
    );
    if (res.statusCode != 200) {
      throw Exception('Error cargando historial');
    }
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getEta({
    required double originLat,
    required double originLng,
    required double destLat,
    required double destLng,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-eta'),
      headers: _headers,
      body: jsonEncode({
        'origen': {'lat': originLat, 'lng': originLng},
        'destino': {'lat': destLat, 'lng': destLng},
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['error'] ?? 'Error calculando ETA');
    return data;
  }

  Future<void> updatePlate(int id, String plate) async {
    final res = await http.patch(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/plate'),
      headers: _headers,
      body: jsonEncode({'plate': plate}),
    );
    if (res.statusCode != 200) throw Exception('Error actualizando matrícula');
  }

  Future<void> reportPlateMismatch(int id, {String? detected, String? current}) async {
    await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/report-plate-mismatch'),
      headers: _headers,
      body: jsonEncode({'detected': detected, 'current': current}),
    );
  }

  Future<void> sendEtaWhatsApp(int id, {int? etaMinutos, String? distanciaKm}) async {
    await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/send-eta'),
      headers: _headers,
      body: jsonEncode({'etaMinutos': etaMinutos, 'distanciaKm': distanciaKm}),
    );
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

  Future<Map<String, dynamic>?> getWhatsAppCapture(int id) async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/whatsapp-capture'),
      headers: _headers,
    );
    if (res.statusCode == 404 || res.body == 'null') return null;
    if (res.statusCode != 200) return null;
    final data = jsonDecode(res.body);
    if (data == null) return null;
    return data as Map<String, dynamic>;
  }

  Future<List<Map<String, dynamic>>> getCobros() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/cobros'),
      headers: _headers,
    );
    if (res.statusCode != 200) throw Exception('Error cargando cobros');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>?> getCobroForAssistance(int assistanceId) async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$assistanceId/cobro'),
      headers: _headers,
    );
    if (res.statusCode != 200 || res.body == 'null') return null;
    final data = jsonDecode(res.body);
    if (data == null) return null;
    return data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> marcarCobrado(
    int id, {
    required String metodoPago,
    required double importeCobrado,
    String? observaciones,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/cobros/$id/marcar-cobrado'),
      headers: _headers,
      body: jsonEncode({
        'metodoPago': metodoPago,
        'importeCobrado': importeCobrado,
        'observaciones': observaciones,
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['error'] ?? 'Error marcando cobro');
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
