import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';
import '../models/models.dart';
import '../models/incidencias.dart';

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

  // ── Catalogo: fotos de modelo ────────────────────────────────
  /// Mapa "marca|modelo" (normalizado con [claveModeloCatalogo]) → URL de
  /// la foto del modelo. La foto se sube UNA vez en el panel web (Catalogo
  /// de neumaticos) y la heredan todos los neumaticos de esa marca+modelo.
  static Future<Map<String, String>> fotosCatalogoPorModelo() async {
    final data = await _db
        .from('tc_cat_modelos_neumatico')
        .select('nombre, foto_modelo_url, marca:tc_cat_marcas_neumatico(nombre)')
        .not('foto_modelo_url', 'is', null);
    final mapa = <String, String>{};
    for (final e in (data as List)) {
      final m = Map<String, dynamic>.from(e);
      final marca = m['marca'] is Map ? m['marca']['nombre'] as String? : null;
      final modelo = m['nombre'] as String?;
      final url = m['foto_modelo_url'] as String?;
      if (marca == null || modelo == null || url == null || url.isEmpty) continue;
      mapa[claveModeloCatalogo(marca, modelo)] = url;
    }
    return mapa;
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

  /// Km actuales del vehículo según Webfleet (odómetro real). Devuelve null si
  /// no está enlazado o no hay cobertura; no bloquea la revisión.
  static Future<int?> obtenerKmWebfleet(String empresaId, String objectno) async {
    try {
      final uri = Uri.parse('$kBackendUrl/api/tyrecontrol/webfleet/odometer?empresa=$empresaId&objectno=${Uri.encodeComponent(objectno)}');
      final r = await http.get(uri).timeout(const Duration(seconds: 20));
      if (r.statusCode != 200) return null;
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      final km = j['odometer_km'];
      return km is num ? km.round() : null;
    } catch (_) {
      return null;
    }
  }

  /// Actualiza el kilometraje del vehículo (best-effort; si RLS no lo permite
  /// no pasa nada, el km ya queda en la propia revisión).
  static Future<void> actualizarKmVehiculo(String vehiculoId, int km) async {
    try {
      await _db.from('tc_vehiculos').update({'km_actual': km, 'origen_km': 'webfleet'}).eq('id', vehiculoId);
    } catch (_) {}
  }

  /// Imagen del plano del vehículo: la del tipo si la tiene; si no, la
  /// heredada de la configuración de ejes del vehículo. null si no hay.
  static Future<String?> obtenerImagenChasis(Vehiculo v) async {
    final delTipo = v.tipo?.imagenChasisUrl;
    if (delTipo != null && delTipo.isNotEmpty) return delTipo;
    try {
      final veh = await _db.from('tc_vehiculos').select('config_ejes_id').eq('id', v.id).maybeSingle();
      final cid = veh?['config_ejes_id'];
      if (cid == null) return null;
      final ce = await _db.from('tc_config_ejes').select('imagen_chasis_url').eq('id', cid).maybeSingle();
      final url = ce?['imagen_chasis_url'] as String?;
      return (url != null && url.isNotEmpty) ? url : null;
    } catch (_) {
      return null;
    }
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

  static Future<void> completarRevision(String revisionId, {String estado = 'completada'}) async {
    await _db.from('revisiones_vehiculo').update({'estado_revision': estado}).eq('id', revisionId);
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

  /// Historial: últimas revisiones completadas por el técnico (con la matrícula
  /// del vehículo embebida para no hacer una consulta por cada una).
  static Future<List<RevisionVehiculo>> listarRevisionesCompletadasDelTecnico({int limite = 30}) async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return [];
    final data = await _db
        .from('revisiones_vehiculo')
        .select('*, vehiculo:tc_vehiculos(matricula, numero_unidad)')
        .eq('tecnico_id', uid)
        .eq('estado_revision', 'completada')
        .order('created_at', ascending: false)
        .limit(limite);
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

  // ── Incidencias (Fase 1: detección + pendientes) ─────────────
  /// Contador de incidencias pendientes (para el badge de Inicio). Se
  /// actualiza al llamar a [listarIncidencias] o [contarIncidenciasPendientes].
  static final ValueNotifier<int> incidenciasPendientesCount = ValueNotifier<int>(0);

  /// Sube la foto (obligatoria en las incidencias graves) al bucket de fotos.
  static Future<String> subirFotoIncidencia(File file) async {
    final ext = file.path.split('.').last;
    final path = 'incidencias/${DateTime.now().microsecondsSinceEpoch}.$ext';
    await _db.storage.from(_bucketFotos).upload(path, file);
    return _db.storage.from(_bucketFotos).getPublicUrl(path);
  }

  /// Crea una incidencia con sus problemas. Devuelve el id de la incidencia.
  /// Estado inicial: si trae [motivoPendiente] → según el motivo; si no,
  /// 'detectada'. La foto ya debe estar subida ([fotoUrl]).
  static Future<String> crearIncidencia({
    required String empresaId,
    required String vehiculoId,
    String? posicionId,
    String? neumaticoId,
    String? revisionId,
    required List<String> tipos,
    required String gravedad,
    String? gravedadAuto,
    required String estado,
    String? motivoPendiente,
    String? motivoObservacion,
    String? accionRecomendada,
    String? fechaRecomendada,
    String? autorizaPersona,
    Map<String, dynamic>? medicionInicial,
    String? fotoUrl,
  }) async {
    final uid = _db.auth.currentUser?.id;
    final inc = await _db
        .from('tc_incidencias')
        .insert({
          'empresa_id': empresaId,
          'vehiculo_id': vehiculoId,
          'posicion_id': posicionId,
          'neumatico_id': neumaticoId,
          'revision_id': revisionId,
          'gravedad': gravedad,
          'gravedad_auto': gravedadAuto,
          'estado': estado,
          'detectada_por': uid,
          'motivo_pendiente': motivoPendiente,
          'motivo_observacion': motivoObservacion,
          'accion_recomendada': accionRecomendada,
          'fecha_recomendada': fechaRecomendada,
          'autoriza_persona': autorizaPersona,
          'medicion_inicial': medicionInicial,
          'foto_url': fotoUrl,
        })
        .select('id')
        .single();
    final incidenciaId = inc['id'] as String;

    if (tipos.isNotEmpty) {
      await _db.from('tc_incidencia_problemas').insert(
            tipos.map((t) => {'incidencia_id': incidenciaId, 'tipo': t}).toList(),
          );
    }
    return incidenciaId;
  }

  /// Lista de incidencias con vehículo/posición/problemas embebidos.
  /// [estados] filtra por estado (vacío = todas).
  static Future<List<Incidencia>> listarIncidencias({List<String> estados = const []}) async {
    var q = _db.from('tc_incidencias').select(
        '*, vehiculo:tc_vehiculos(matricula, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), posicion:tc_posiciones_vehiculo(nombre, codigo_posicion), problemas:tc_incidencia_problemas(tipo, estado)');
    if (estados.isNotEmpty) q = q.inFilter('estado', estados);
    final data = await q.order('detectada_at', ascending: false);
    final lista = (data as List)
        .map((e) => Incidencia.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    return lista;
  }

  /// Refresca el contador de pendientes (no solucionadas/canceladas).
  static Future<int> contarIncidenciasPendientes() async {
    try {
      final data = await _db
          .from('tc_incidencias')
          .select('id')
          .not('estado', 'in', '(solucionada,cancelada,no_procede)');
      final n = (data as List).length;
      incidenciasPendientesCount.value = n;
      return n;
    } catch (_) {
      return incidenciasPendientesCount.value;
    }
  }

  // ── Planificación de revisiones ──────────────────────────────
  /// Estado calculado de cada plan (próxima fecha/km, días restantes, estado,
  /// prioridad). Reusa el mismo RPC que el panel web; no reimplementa lógica.
  static Future<List<Map<String, dynamic>>> listarPlanEstado() async {
    final data = await _db.rpc('tc_plan_estado');
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Planes de mantenimiento activos con el nombre de su operación.
  static Future<List<Map<String, dynamic>>> listarPlanesMantenimiento() async {
    final data = await _db
        .from('tc_planes_mantenimiento')
        .select('*, operacion:tc_operaciones_mantenimiento(nombre)')
        .eq('activo', true);
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Vehículos activos con cliente (empresa) y base (delegación) para la
  /// planificación. Ligero: solo los campos que la lista necesita.
  static Future<List<Map<String, dynamic>>> listarVehiculosPlanificacion() async {
    final data = await _db
        .from('tc_vehiculos')
        .select(
            'id, matricula, numero_unidad, empresa_id, delegacion_id, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)')
        .eq('activo', true);
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Estado Webfleet por vehículo (en_base, en_ruta, …) para la columna y el
  /// filtro "En base". Best-effort: si RLS no lo permite devuelve vacío.
  static Future<Map<String, String>> estadoWebfleetPorVehiculo() async {
    try {
      final data = await _db
          .from('tc_vehiculo_webfleet_estado')
          .select('vehiculo_id, estado');
      final m = <String, String>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final id = r['vehiculo_id'] as String?;
        if (id != null) m[id] = (r['estado'] as String?) ?? '';
      }
      return m;
    } catch (_) {
      return {};
    }
  }

  // ── Vehículos (lista + ficha, réplica del panel web) ─────────
  /// Todos los vehículos (activos e inactivos, como el panel) con los joins
  /// que la tabla necesita: empresa, delegación, tipo y config de ejes.
  static Future<List<Map<String, dynamic>>> listarVehiculosCompleto() async {
    final data = await _db
        .from('tc_vehiculos')
        .select(
            '*, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre), tipo:tc_tipos_vehiculo(*), config_ejes:tc_config_ejes(nombre, descripcion)')
        .order('matricula');
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Un vehículo con todos los campos y joins (para la ficha de solo lectura).
  static Future<Map<String, dynamic>?> obtenerVehiculoCompleto(String id) async {
    final data = await _db
        .from('tc_vehiculos')
        .select(
            '*, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre), tipo:tc_tipos_vehiculo(*), config_ejes:tc_config_ejes(nombre, descripcion)')
        .eq('id', id)
        .maybeSingle();
    return data == null ? null : Map<String, dynamic>.from(data);
  }

  /// Estado Webfleet con detalle (estado + pos_time) para el badge de la
  /// tabla de vehículos (sufijo "POS. ANT."). Best-effort.
  static Future<Map<String, Map<String, dynamic>>> estadoWebfleetDetalle() async {
    try {
      final data = await _db
          .from('tc_vehiculo_webfleet_estado')
          .select('vehiculo_id, estado, pos_time');
      final m = <String, Map<String, dynamic>>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final id = r['vehiculo_id'] as String?;
        if (id != null) m[id] = r;
      }
      return m;
    } catch (_) {
      return {};
    }
  }

  /// Estado de la periodicidad de revisión por vehículo (mismo RPC que el
  /// panel): sin_revision | vencida | proxima | al_dia. Best-effort.
  static Future<Map<String, String>> revisionEstadoPorVehiculo() async {
    try {
      final data = await _db.rpc('tc_revision_estado');
      final m = <String, String>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final id = r['vehiculo_id'] as String?;
        if (id != null) m[id] = (r['estado'] as String?) ?? '';
      }
      return m;
    } catch (_) {
      return {};
    }
  }

  /// Catálogo de medidas id→valor (p. ej. "385/65R22.5").
  static Future<Map<String, String>> mapaMedidas() async {
    try {
      final data = await _db.from('tc_cat_medidas_neumatico').select('id, valor');
      final m = <String, String>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        if (r['id'] != null) m[r['id'] as String] = (r['valor'] as String?) ?? '—';
      }
      return m;
    } catch (_) {
      return {};
    }
  }

  /// Tipos de llanta (para etiquetas legibles en la ficha). Best-effort.
  static Future<List<Map<String, dynamic>>> listarTiposLlantaCat() async {
    try {
      final data = await _db.from('tc_tipos_llanta').select('*').eq('activo', true);
      return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// Medida/llanta por eje del vehículo (si usa medidas por eje).
  static Future<List<Map<String, dynamic>>> listarEjesDeVehiculo(String vehiculoId) async {
    try {
      final data = await _db
          .from('tc_vehiculo_ejes')
          .select('eje, ruedas, medida_id, tipo_llanta_id')
          .eq('vehiculo_id', vehiculoId)
          .order('eje');
      return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// Inspecciones (revisiones) del vehículo, más recientes primero.
  static Future<List<Map<String, dynamic>>> listarRevisionesDeVehiculo(String vehiculoId) async {
    try {
      final data = await _db
          .from('revisiones_vehiculo')
          .select()
          .eq('vehiculo_id', vehiculoId)
          .order('fecha_revision', ascending: false)
          .order('created_at', ascending: false)
          .limit(30);
      return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// Lanza la sincronización Webfleet en el backend (misma llamada que el
  /// botón del panel web).
  static Future<String?> sincronizarWebfleet() async {
    try {
      final r = await http
          .post(Uri.parse('$kBackendUrl/api/tyrecontrol/webfleet/sync'))
          .timeout(const Duration(seconds: 60));
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      if (r.statusCode != 200 || j['error'] != null) {
        return (j['error'] as String?) ?? 'Error al sincronizar';
      }
      return null; // sin error
    } catch (e) {
      return '$e';
    }
  }
}
