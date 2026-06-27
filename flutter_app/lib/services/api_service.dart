import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../config.dart';
import 'offline_store.dart';

/// ¿El error indica falta de conexión (no un error real del servidor)?
bool _isNetworkError(Object e) =>
    e is SocketException ||
    e is TimeoutException ||
    e is http.ClientException;

class ApiService {
  final String techName;
  final String code;

  ApiService({required this.techName, required this.code});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        // Codificado: las cabeceras HTTP no admiten acentos/ñ (Iván, Jesús…)
        'x-roadside-operator-name': Uri.encodeComponent(techName),
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
    try {
      // Antes de leer, intentamos enviar los cambios pendientes
      await flushOutbox();

      final res = await http
          .get(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances'),
            headers: _headers,
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) {
        throw Exception('Error cargando asistencias');
      }
      final list = (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
      OfflineStore.offline.value = false;
      await OfflineStore.cacheAssistances(list);
      return list;
    } catch (e) {
      if (_isNetworkError(e)) {
        // Sin cobertura → devolvemos la última copia cacheada
        OfflineStore.offline.value = true;
        return OfflineStore.cachedAssistances();
      }
      rethrow;
    }
  }

  /// Envía a servidor los cambios de estado encolados (offline). Best-effort.
  Future<void> flushOutbox() async {
    for (final entry in OfflineStore.pending()) {
      final item = entry.value;
      final id = item['assistanceId'] as int;
      final status = item['status'] as String;
      final type = item['type'] as String;
      final actionId = item['actionId'] as String;
      try {
        final url = type == 'en_camino'
            ? '$kBackendUrl/api/roadside-operator/assistances/$id/en-camino'
            : '$kBackendUrl/api/roadside-operator/assistances/$id/status';
        final res = await http
            .post(
              Uri.parse(url),
              headers: _headers,
              body: jsonEncode(type == 'en_camino'
                  ? {'clientActionId': actionId}
                  : {'status': status, 'clientActionId': actionId}),
            )
            .timeout(const Duration(seconds: 12));
        if (res.statusCode == 200) {
          await OfflineStore.removePending(entry.key);
        } else {
          break; // error real del servidor: paramos para no perder orden
        }
      } catch (e) {
        if (_isNetworkError(e)) return; // sigue sin red, reintentar luego
        break;
      }
    }
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
    final actionId = '${DateTime.now().millisecondsSinceEpoch}-$id-$status';
    try {
      final res = await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/status'),
            headers: _headers,
            body: jsonEncode({'status': status, 'clientActionId': actionId}),
          )
          .timeout(const Duration(seconds: 12));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200) {
        throw Exception(data['error'] ?? 'Error actualizando estado');
      }
      OfflineStore.offline.value = false;
      return data;
    } catch (e) {
      if (_isNetworkError(e)) {
        // Sin red → encolar y aplicar el cambio en local
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueStatus(assistanceId: id, status: status, type: 'status');
        return _localAssistance(id, status);
      }
      rethrow;
    }
  }

  // Usa el endpoint dedicado que envía WhatsApp al cliente
  Future<Map<String, dynamic>> enCamino(int id) async {
    final actionId = '${DateTime.now().millisecondsSinceEpoch}-$id-en_camino';
    try {
      final res = await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/en-camino'),
            headers: _headers,
            body: jsonEncode({'clientActionId': actionId}),
          )
          .timeout(const Duration(seconds: 12));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200) {
        throw Exception(data['error'] ?? 'Error actualizando estado');
      }
      OfflineStore.offline.value = false;
      return data;
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueStatus(assistanceId: id, status: 'en_camino', type: 'en_camino');
        return _localAssistance(id, 'en_camino');
      }
      rethrow;
    }
  }

  // Devuelve la asistencia desde la caché con el estado actualizado (modo offline)
  Map<String, dynamic> _localAssistance(int id, String status) {
    final cached = OfflineStore.cachedAssistances();
    final found = cached.firstWhere(
      (a) => a['id'] == id,
      orElse: () => <String, dynamic>{'id': id},
    );
    return {...found, 'status': status};
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
      int id, String nombre, String dni, {String? observaciones}) async {
    final body = <String, dynamic>{
      'conductorNombre': nombre,
      'conductorDni': dni,
      if (observaciones != null && observaciones.isNotEmpty)
        'observacionesReparacion': observaciones,
    };
    final res = await http.post(
      Uri.parse(
          '$kBackendUrl/api/roadside-operator/assistances/$id/conductor'),
      headers: _headers,
      body: jsonEncode(body),
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

  // Captura el GPS de destino al llegar. Devuelve {alreadyKnown, place?}
  Future<Map<String, dynamic>> captureDestination(int id, double lat, double lng) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/capture-destination'),
      headers: _headers,
      body: jsonEncode({'lat': lat, 'lng': lng}),
    );
    if (res.statusCode != 200) throw Exception('Error capturando destino');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // Crea un lugar conocido desde la APK (con dedup) y lo enlaza a la asistencia
  Future<Map<String, dynamic>> createKnownPlace({
    required int assistanceId,
    required String nombre,
    required String tipo,
    String? direccion,
    required double lat,
    required double lng,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/known-places'),
      headers: _headers,
      body: jsonEncode({
        'assistanceId': assistanceId,
        'nombre': nombre,
        'tipo': tipo,
        'direccion': direccion,
        'lat': lat,
        'lng': lng,
      }),
    );
    if (res.statusCode != 200) throw Exception('Error creando lugar');
    return jsonDecode(res.body) as Map<String, dynamic>;
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

  Future<Map<String, dynamic>> createPaymentLink({
    required String jobId,
    required String customerName,
    required String customerPhone,
    required double amountEuros,
    String description = '',
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/payments/create'),
      headers: _headers,
      body: jsonEncode({
        'jobId': jobId,
        'customerName': customerName,
        'customerPhone': customerPhone,
        'amountEuros': amountEuros,
        'description': description,
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200 || data['success'] != true) {
      throw Exception(data['message'] ?? data['error'] ?? 'Error ${res.statusCode} creando enlace');
    }
    return data;
  }

  Future<List<Map<String, dynamic>>> getPaymentHistory() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/payments/history'),
      headers: _headers,
    );
    if (res.statusCode != 200) throw Exception('Error cargando historial de pagos');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<void> cancelPayment(int id) async {
    final res = await http.delete(
      Uri.parse('$kBackendUrl/api/roadside-operator/payments/$id'),
      headers: _headers,
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['message'] ?? 'Error cancelando cobro');
  }

  Future<Map<String, dynamic>> uploadFile(
      int id, File file, String kind) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/roadside-assistances/$id/files'),
    );
    req.headers.addAll({
      'x-roadside-operator-name': Uri.encodeComponent(techName),
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
