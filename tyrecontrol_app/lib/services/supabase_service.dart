import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';
import '../models/models.dart';

/// Capa fina sobre supabase_flutter. No reimplementa reglas de negocio:
/// las mismas RLS y RPCs que usa el panel web protegen y validan aqui.
class TyreControlApi {
  static SupabaseClient get _db => Supabase.instance.client;

  static Future<void> init() async {
    await Supabase.initialize(url: kSupabaseUrl, anonKey: kSupabaseAnonKey);
  }

  static bool get hasSession => _db.auth.currentSession != null;
  static User? get currentUser => _db.auth.currentUser;
  static String? get currentSessionToken => _db.auth.currentSession?.accessToken;

  /// Login unificado con la app de asistencias: mismo nombre + PIN de
  /// 4 digitos. El servidor valida el PIN contra la tabla de operarios
  /// y sincroniza por detras el usuario Supabase; aqui solo hacemos el
  /// signInWithPassword con el email sintetico que nos devuelve.
  static Future<void> signInOperario(String techName, String pin) async {
    final res = await http
        .post(
          Uri.parse('$kBackendUrl/api/tyrecontrol/login-operario'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'techName': techName, 'code': pin}),
        )
        .timeout(const Duration(seconds: 15));
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode != 200) {
      throw Exception(data['error'] ?? 'Operario o código incorrecto');
    }
    final email = data['email'] as String;

    final auth = await _db.auth.signInWithPassword(email: email, password: pin);
    if (auth.user == null) throw Exception('No se ha podido iniciar sesión');
  }

  static Future<void> signOut() => _db.auth.signOut();

  static Future<Map<String, dynamic>?> obtenerMiPerfil() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return null;
    return await _db.from('tc_usuarios').select('*, empresa:tc_empresas(*)').eq('id', uid).maybeSingle();
  }

  // ── Vehiculos ────────────────────────────────────────────────
  static Future<List<Vehiculo>> buscarVehiculos(String texto) async {
    final t = texto.trim();
    if (t.isEmpty) return [];
    final data = await _db
        .from('tc_vehiculos')
        .select('*, empresa:tc_empresas(*), tipo:tc_tipos_vehiculo(*)')
        .or('matricula.ilike.%$t%,numero_unidad.ilike.%$t%')
        .eq('activo', true)
        .order('matricula')
        .limit(15);
    return (data as List).map((e) => Vehiculo.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  static Future<Vehiculo?> obtenerVehiculo(String id) async {
    final data = await _db
        .from('tc_vehiculos')
        .select('*, empresa:tc_empresas(*), tipo:tc_tipos_vehiculo(*)')
        .eq('id', id)
        .maybeSingle();
    if (data == null) return null;
    return Vehiculo.fromJson(Map<String, dynamic>.from(data));
  }

  static Future<List<PosicionVehiculo>> listarPosiciones(String tipoVehiculoId) async {
    final data = await _db
        .from('tc_posiciones_vehiculo')
        .select()
        .eq('tipo_vehiculo_id', tipoVehiculoId)
        .eq('activo', true)
        .order('orden_visual');
    return (data as List).map((e) => PosicionVehiculo.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  static Future<List<MontajeActual>> listarMontajesVehiculo(String vehiculoId) async {
    final data = await _db
        .from('tc_montajes_actuales')
        .select('*, neumatico:tc_neumaticos(*)')
        .eq('vehiculo_id', vehiculoId);
    return (data as List).map((e) => MontajeActual.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  static Future<RevisionVehiculo?> obtenerUltimaRevision(String vehiculoId) async {
    final data = await _db
        .from('revisiones_vehiculo')
        .select()
        .eq('vehiculo_id', vehiculoId)
        .order('fecha_revision', ascending: false)
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (data == null) return null;
    return RevisionVehiculo.fromJson(Map<String, dynamic>.from(data));
  }

  // ── Revisiones ───────────────────────────────────────────────
  static Future<RevisionVehiculo> crearRevision({
    required String empresaId,
    required String vehiculoId,
    num? kmVehiculo,
  }) async {
    final uid = _db.auth.currentUser?.id;
    final data = await _db
        .from('revisiones_vehiculo')
        .insert({
          'empresa_id': empresaId,
          'vehiculo_id': vehiculoId,
          'km_vehiculo': kmVehiculo,
          'tecnico_id': uid,
          'estado_revision': 'borrador',
        })
        .select()
        .single();
    return RevisionVehiculo.fromJson(Map<String, dynamic>.from(data));
  }

  static Future<void> guardarDetalleRevision(Map<String, dynamic> detalle) async {
    await _db.from('revisiones_neumaticos_detalle').upsert(
          detalle,
          onConflict: 'revision_id,posicion_id',
        );
  }

  static Future<void> completarRevision(String revisionId) async {
    await _db.from('revisiones_vehiculo').update({'estado_revision': 'completada'}).eq('id', revisionId);
  }

  static Future<List<RevisionVehiculo>> listarRevisionesPendientesDelTecnico() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return [];
    final data = await _db
        .from('revisiones_vehiculo')
        .select()
        .eq('tecnico_id', uid)
        .eq('estado_revision', 'borrador')
        .order('fecha_revision', ascending: false);
    return (data as List).map((e) => RevisionVehiculo.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  // ── Fotos (Supabase Storage) ─────────────────────────────────
  static const _bucketFotos = 'tc-revisiones-fotos';

  static Future<String> subirFotoRevision(File file, {required String revisionId, required String posicionId}) async {
    final ext = file.path.split('.').last;
    final path = 'revisiones/$revisionId/${posicionId}_${DateTime.now().microsecondsSinceEpoch}.$ext';
    await _db.storage.from(_bucketFotos).upload(path, file);
    return _db.storage.from(_bucketFotos).getPublicUrl(path);
  }
}
