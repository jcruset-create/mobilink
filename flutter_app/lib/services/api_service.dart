import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
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

  // ── Sesión unificada (fase 1 SaaS) ─────────────────────────
  // El login devuelve una sesión de Supabase; se envía como Bearer en todas
  // las llamadas (requerido por el backend al pasar a AUTH_MODE=strict).
  // Las cabeceras de operario se mantienen por compatibilidad.
  static String? _accessToken;
  static DateTime? _tokenExpiresAt;

  static void _captureSession(Map<String, dynamic> data) {
    final session = data['session'];
    if (session is Map) {
      _accessToken = session['access_token'] as String?;
      final expiresIn = (session['expires_in'] as num?)?.toInt() ?? 3600;
      // Margen de 5 minutos para renovar antes de que caduque.
      _tokenExpiresAt =
          DateTime.now().add(Duration(seconds: expiresIn - 300));
    }
  }

  bool get _tokenCaducado =>
      _accessToken == null ||
      _tokenExpiresAt == null ||
      DateTime.now().isAfter(_tokenExpiresAt!);

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        // Codificado: las cabeceras HTTP no admiten acentos/ñ (Iván, Jesús…)
        'x-roadside-operator-name': Uri.encodeComponent(techName),
        'x-roadside-operator-code': code,
        if (_accessToken != null) 'Authorization': 'Bearer $_accessToken',
      };

  /// Cabeceras con la sesión renovada si estaba caducada (re-login con las
  /// credenciales del operario). Best-effort: sin red, siguen las legacy.
  Future<Map<String, String>> _authHeaders() async {
    if (_tokenCaducado) {
      try {
        await ApiService.login(techName, code);
      } catch (_) {/* offline o backend antiguo: seguimos con legacy */}
    }
    return _headers;
  }

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
    _captureSession(data);
    return data;
  }

  Future<List<Map<String, dynamic>>> getAssistances() async {
    try {
      // Antes de leer, intentamos enviar los cambios pendientes
      await flushOutbox();

      final res = await http
          .get(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances'),
            headers: await _authHeaders(),
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

  /// Evita que dos flushOutbox simultáneos suban dos veces el mismo elemento
  /// (p. ej. el disparo tras encolar una foto y el refresco de la lista).
  bool _flushing = false;

  /// Envía a servidor las acciones encoladas (offline) en orden. Best-effort.
  Future<void> flushOutbox() async {
    if (_flushing) return;
    _flushing = true;
    try {
      await _flushOutboxInner();
    } finally {
      _flushing = false;
    }
  }

  Future<void> _flushOutboxInner() async {
    for (final entry in OfflineStore.pending()) {
      final item = entry.value;
      final id = item['assistanceId'] as int;
      final type = item['type'] as String;
      final actionId = item['actionId'] as String;
      try {
        bool ok = false;
        if (type == 'en_camino' || type == 'status') {
          final url = type == 'en_camino'
              ? '$kBackendUrl/api/roadside-operator/assistances/$id/en-camino'
              : '$kBackendUrl/api/roadside-operator/assistances/$id/status';
          final res = await http
              .post(Uri.parse(url), headers: await _authHeaders(),
                  body: jsonEncode(type == 'en_camino'
                      ? {'clientActionId': actionId}
                      : {'status': item['status'], 'clientActionId': actionId}))
              .timeout(const Duration(seconds: 12));
          ok = res.statusCode == 200;
        } else if (type == 'upload_file') {
          final path = item['localPath'] as String;
          final f = File(path);
          if (!await f.exists()) { ok = true; } // archivo ya no existe → descartar
          else {
            final req = http.MultipartRequest(
              'POST', Uri.parse('$kBackendUrl/api/roadside-assistances/$id/files'));
            req.headers.addAll((await _authHeaders())..remove('Content-Type'));
            req.fields['kind'] = item['kind'] as String;
            req.fields['clientActionId'] = actionId;
            req.files.add(await http.MultipartFile.fromPath('file', path));
            final streamed = await req.send().timeout(const Duration(seconds: 40));
            await streamed.stream.drain();
            ok = streamed.statusCode == 200;
            if (ok) { try { await f.delete(); } catch (_) {} }
          }
        } else if (type == 'save_conductor') {
          final res = await http
              .post(Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/conductor'),
                  headers: await _authHeaders(),
                  body: jsonEncode({
                    'conductorNombre': item['nombre'],
                    'conductorDni': item['dni'],
                    'clientActionId': actionId,
                    if (item['observaciones'] != null) 'observacionesReparacion': item['observaciones'],
                  }))
              .timeout(const Duration(seconds: 12));
          ok = res.statusCode == 200;
        } else if (type == 'capture_destination') {
          final res = await http
              .post(Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/capture-destination'),
                  headers: await _authHeaders(),
                  body: jsonEncode({'lat': item['lat'], 'lng': item['lng'], 'clientActionId': actionId}))
              .timeout(const Duration(seconds: 12));
          ok = res.statusCode == 200;
        } else {
          ok = true; // tipo desconocido → descartar
        }

        if (ok) {
          await OfflineStore.removePending(entry.key);
        } else {
          break; // error real del servidor: paramos para mantener el orden
        }
      } catch (e) {
        if (_isNetworkError(e)) return; // sigue sin red, reintentar luego
        break;
      }
    }

    // Migas de pan GPS guardadas offline → enviar en lote
    if (OfflineStore.hasLocations()) {
      final byAssist = OfflineStore.locationsByAssistance();
      var allOk = true;
      for (final entry in byAssist.entries) {
        try {
          final res = await http
              .post(
                Uri.parse('$kBackendUrl/api/roadside-operator/assistances/${entry.key}/locations-batch'),
                headers: await _authHeaders(),
                body: jsonEncode({'points': entry.value}),
              )
              .timeout(const Duration(seconds: 20));
          if (res.statusCode != 200) allOk = false;
        } catch (e) {
          if (_isNetworkError(e)) return;
          allOk = false;
        }
      }
      if (allOk) await OfflineStore.clearLocations();
    }
  }

  Future<List<Map<String, dynamic>>> getHistory() async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/history'),
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
      body: jsonEncode({'plate': plate}),
    );
    if (res.statusCode != 200) throw Exception('Error actualizando matrícula');
  }

  Future<void> reportPlateMismatch(int id, {String? detected, String? current}) async {
    await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/report-plate-mismatch'),
      headers: await _authHeaders(),
      body: jsonEncode({'detected': detected, 'current': current}),
    );
  }

  Future<void> sendEtaWhatsApp(int id, {int? etaMinutos, String? distanciaKm}) async {
    await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/send-eta'),
      headers: await _authHeaders(),
      body: jsonEncode({'etaMinutos': etaMinutos, 'distanciaKm': distanciaKm}),
    );
  }

  Future<Map<String, dynamic>> updateStatus(int id, String status) async {
    final actionId = '${DateTime.now().millisecondsSinceEpoch}-$id-$status';
    try {
      final res = await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/status'),
            headers: await _authHeaders(),
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
            headers: await _authHeaders(),
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
    try {
      await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/location'),
            headers: await _authHeaders(),
            body: jsonEncode({'lat': lat, 'lng': lng}),
          )
          .timeout(const Duration(seconds: 10));
    } catch (e) {
      if (_isNetworkError(e)) {
        // Sin red → guardar la posición como miga de pan para enviarla al reconectar
        await OfflineStore.enqueueLocation(id, lat, lng);
      }
      // No relanzamos: el seguimiento GPS no debe interrumpir al técnico
    }
  }

  // ── OTF (Órdenes de Trabajo de Flota) ──
  Future<List<Map<String, dynamic>>> getOtfList() async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/roadside-operator/otf'), headers: _headers)
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) throw Exception('Error cargando OTF');
    return (jsonDecode(res.body) as List<dynamic>).cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getOtf(int id) async {
    final res = await http
        .get(Uri.parse('$kBackendUrl/api/roadside-operator/otf/$id'), headers: _headers)
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) throw Exception('Error cargando OTF');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> addOtfFieldTrabajo(
    int otfId, {
    required String plate,
    required String tipoVehiculo,
    String? trabajoPlantilla,
    String? detalleManual,
    required String motivoAltaCampo,
    String? status,
  }) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/otf/$otfId/trabajos'),
      headers: await _authHeaders(),
      body: jsonEncode({
        'plate': plate,
        'tipoVehiculo': tipoVehiculo,
        'trabajoPlantilla': trabajoPlantilla,
        'detalleManual': detalleManual,
        'motivoAltaCampo': motivoAltaCampo,
        if (status != null) 'status': status,
      }),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['error'] ?? 'Error añadiendo trabajo');
    return data;
  }

  Future<void> updateOtfTrabajoStatus(int trabajoId, String status) async {
    final res = await http.put(
      Uri.parse('$kBackendUrl/api/roadside-operator/otf/trabajos/$trabajoId/status'),
      headers: await _authHeaders(),
      body: jsonEncode({'status': status}),
    );
    if (res.statusCode != 200) throw Exception('Error actualizando estado');
  }

  // Escanea una matrícula desde una foto. Devuelve {plate, assistanceId?}
  Future<Map<String, dynamic>> scanPlate(File file) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/roadside-operator/scan-plate'),
    );
    req.headers.addAll({
      'x-roadside-operator-name': Uri.encodeComponent(techName),
      'x-roadside-operator-code': code,
    });
    req.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await req.send().timeout(const Duration(seconds: 40));
    final body = await streamed.stream.bytesToString();
    if (streamed.statusCode != 200) throw Exception('Error escaneando matrícula');
    return jsonDecode(body) as Map<String, dynamic>;
  }

  // Check-in manual a la base de la OTF (si el GPS automático falla)
  Future<Map<String, dynamic>> checkinOtf(int otfId) async {
    final res = await http.post(
      Uri.parse('$kBackendUrl/api/roadside-operator/otf/$otfId/checkin'),
      headers: await _authHeaders(),
      body: jsonEncode({}),
    );
    if (res.statusCode != 200) throw Exception('Error en check-in');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // Finaliza la OTF con firma única (PNG) del responsable
  Future<void> finalizarOtf(int otfId, File firmaPng, String? firmanteNombre, String? firmanteDni) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/roadside-operator/otf/$otfId/finalizar'),
    );
    req.headers.addAll({
      'x-roadside-operator-name': Uri.encodeComponent(techName),
      'x-roadside-operator-code': code,
    });
    if (firmanteNombre != null) req.fields['firmanteNombre'] = firmanteNombre;
    if (firmanteDni != null) req.fields['firmanteDni'] = firmanteDni;
    req.files.add(await http.MultipartFile.fromPath('firma', firmaPng.path));
    final streamed = await req.send().timeout(const Duration(seconds: 30));
    await streamed.stream.drain();
    if (streamed.statusCode != 200) throw Exception('Error finalizando OTF');
  }

  Future<void> uploadOtfTrabajoFile(int trabajoId, File file, String kind) async {
    final req = http.MultipartRequest(
      'POST',
      Uri.parse('$kBackendUrl/api/roadside-operator/otf/trabajos/$trabajoId/files'),
    );
    req.headers.addAll({
      'x-roadside-operator-name': Uri.encodeComponent(techName),
      'x-roadside-operator-code': code,
    });
    req.fields['kind'] = kind;
    req.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await req.send().timeout(const Duration(seconds: 40));
    await streamed.stream.drain();
    if (streamed.statusCode != 200) throw Exception('Error subiendo foto');
  }

  Future<Map<String, dynamic>> saveConductor(
      int id, String nombre, String dni, {String? observaciones, String? actionId}) async {
    final body = <String, dynamic>{
      'conductorNombre': nombre,
      'conductorDni': dni,
      if (actionId != null) 'clientActionId': actionId,
      if (observaciones != null && observaciones.isNotEmpty)
        'observacionesReparacion': observaciones,
    };
    try {
      final res = await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/conductor'),
            headers: await _authHeaders(),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode != 200) {
        throw Exception(data['error'] ?? 'Error guardando conductor');
      }
      OfflineStore.offline.value = false;
      return data;
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueConductor(
            assistanceId: id, nombre: nombre, dni: dni, observaciones: observaciones);
        return {'offline': true};
      }
      rethrow;
    }
  }

  Future<Map<String, dynamic>?> getWhatsAppCapture(int id) async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/whatsapp-capture'),
      headers: await _authHeaders(),
    );
    if (res.statusCode == 404 || res.body == 'null') return null;
    if (res.statusCode != 200) return null;
    final data = jsonDecode(res.body);
    if (data == null) return null;
    return data as Map<String, dynamic>;
  }

  // Captura el GPS de destino al llegar. Devuelve {alreadyKnown, place?, offline?}
  Future<Map<String, dynamic>> captureDestination(int id, double lat, double lng) async {
    try {
      final res = await http
          .post(
            Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$id/capture-destination'),
            headers: await _authHeaders(),
            body: jsonEncode({'lat': lat, 'lng': lng}),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) throw Exception('Error capturando destino');
      OfflineStore.offline.value = false;
      return jsonDecode(res.body) as Map<String, dynamic>;
    } catch (e) {
      if (_isNetworkError(e)) {
        OfflineStore.offline.value = true;
        await OfflineStore.enqueueCaptureDestination(assistanceId: id, lat: lat, lng: lng);
        return {'alreadyKnown': false, 'offline': true};
      }
      rethrow;
    }
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
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) throw Exception('Error cargando cobros');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>?> getCobroForAssistance(int assistanceId) async {
    final res = await http.get(
      Uri.parse('$kBackendUrl/api/roadside-operator/assistances/$assistanceId/cobro'),
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
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
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) throw Exception('Error cargando historial de pagos');
    final list = jsonDecode(res.body) as List<dynamic>;
    return list.cast<Map<String, dynamic>>();
  }

  Future<void> cancelPayment(int id) async {
    final res = await http.delete(
      Uri.parse('$kBackendUrl/api/roadside-operator/payments/$id'),
      headers: await _authHeaders(),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) throw Exception(data['message'] ?? 'Error cancelando cobro');
  }

  Future<Map<String, dynamic>> uploadFile(
      int id, File file, String kind, {String? actionId}) async {
    try {
      final req = http.MultipartRequest(
        'POST',
        Uri.parse('$kBackendUrl/api/roadside-assistances/$id/files'),
      );
      req.headers.addAll({
        'x-roadside-operator-name': Uri.encodeComponent(techName),
        'x-roadside-operator-code': code,
      });
      req.fields['kind'] = kind;
      if (actionId != null) req.fields['clientActionId'] = actionId;
      req.files.add(await http.MultipartFile.fromPath('file', file.path));
      final streamed = await req.send().timeout(const Duration(seconds: 30));
      final body = await streamed.stream.bytesToString();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (streamed.statusCode != 200) {
        throw Exception(data['error'] ?? 'Error subiendo foto');
      }
      OfflineStore.offline.value = false;
      return data;
    } catch (e) {
      if (_isNetworkError(e)) {
        // Sin red → copiar el archivo a almacenamiento persistente y encolar
        OfflineStore.offline.value = true;
        final persisted = await _persistFile(file, kind);
        await OfflineStore.enqueueUpload(assistanceId: id, kind: kind, localPath: persisted);
        return {'plateAction': 'none', 'offline': true};
      }
      rethrow;
    }
  }

  /// Sube una foto EN SEGUNDO PLANO: la guarda en almacenamiento persistente,
  /// la encola en el outbox (con reintentos e idempotencia) y dispara la
  /// subida sin bloquear. El operario puede seguir con el siguiente paso.
  Future<void> uploadFileInBackground(int id, File file, String kind) async {
    final persisted = await _persistFile(file, kind);
    await OfflineStore.enqueueUpload(assistanceId: id, kind: kind, localPath: persisted);
    // Dispara la subida ya (sin esperar). Si falla, reintenta en el próximo
    // refresco de la lista (getAssistances → flushOutbox).
    unawaited(flushOutbox());
  }

  // Copia un archivo a un directorio permanente (sobrevive hasta subirse)
  Future<String> _persistFile(File file, String kind) async {
    final dir = await getApplicationDocumentsDirectory();
    final outDir = Directory('${dir.path}/offline_uploads');
    if (!await outDir.exists()) await outDir.create(recursive: true);
    final ext = file.path.split('.').last;
    final dest = '${outDir.path}/${kind}_${DateTime.now().microsecondsSinceEpoch}.$ext';
    await file.copy(dest);
    return dest;
  }
}
