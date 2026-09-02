import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';
import '../models/models.dart';
import '../models/incidencias.dart';
import '../models/cliente_activo.dart';

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

  // ── Cliente activo de la sesión ──────────────────────────────
  /// Cliente (empresa) con el que se trabaja durante la sesión. null = aún no
  /// se ha seleccionado (obliga a pasar por la pantalla de selección).
  static final ValueNotifier<ClienteActivo?> clienteActivo =
      ValueNotifier<ClienteActivo?>(null);

  /// true cuando ya se ha elegido cliente (o el modo admin-todos).
  static bool get hayClienteSeleccionado => clienteActivo.value != null;

  /// Empresa por la que filtrar las consultas. null si no hay cliente o si es
  /// modo "Admin (Todos los clientes)" (en ese caso NO se filtra).
  static String? get empresaActivaId => clienteActivo.value?.empresaId;

  /// Empresas (clientes) con las que el técnico puede trabajar, para la
  /// pantalla inicial. La autorización multi-cliente vive en la M2M
  /// `tc_operador_empresas` (un operario puede tener varias empresas); la
  /// empresa directa del perfil (tc_empresas por RLS) no basta. Si el operario
  /// no tiene asignación explícita ("modo automático"), se usa lo que permita
  /// la RLS de tc_empresas.
  static Future<List<Map<String, dynamic>>> listarEmpresasCliente() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return [];

    // Fuente principal: backend con service-role. La RLS del SaaS restringe
    // tc_empresas al tenant del usuario, así que un técnico asignado a varios
    // clientes (tc_operador_empresas) no puede leer sus nombres directamente.
    try {
      final token = currentSessionToken;
      if (token != null) {
        final res = await http.get(
          Uri.parse('$kBackendUrl/api/tyrecontrol/mis-empresas'),
          headers: {'Authorization': 'Bearer $token'},
        ).timeout(const Duration(seconds: 12));
        if (res.statusCode == 200) {
          final body = jsonDecode(res.body) as Map<String, dynamic>;
          final lista = (body['empresas'] as List?) ?? const [];
          final out = lista.map((e) => Map<String, dynamic>.from(e as Map)).toList();
          if (out.isNotEmpty) return out;
        }
      }
    } catch (_) {/* sin red / backend caído → fallback directo (RLS) */}

    final porId = <String, String>{}; // id → nombre (dedup)

    // Solo se muestran clientes cuyo NOMBRE se puede leer (RLS); nunca "—".

    // 1) Empresas asignadas al operario (multi-cliente, tabla M2M).
    try {
      final asignadas = await _db
          .from('tc_operador_empresas')
          .select('empresa:tc_empresas(id, nombre)')
          .eq('usuario_id', uid);
      for (final e in (asignadas as List)) {
        final emp = (e as Map)['empresa'];
        final nombre = emp is Map ? emp['nombre'] as String? : null;
        if (emp is Map && emp['id'] != null && nombre != null && nombre.isNotEmpty) {
          porId[emp['id'] as String] = nombre;
        }
      }
    } catch (_) {/* sin M2M o sin permiso: se cubre con los vehículos */}

    // 2) Empresas presentes en los vehículos que el operario puede ver (misma
    //    derivación que la pantalla de Vehículos). Solo se añade si su nombre
    //    es legible (RLS de tc_empresas lo permite); si no, no se muestra.
    try {
      final vehis = await _db
          .from('tc_vehiculos')
          .select('empresa_id, empresa:tc_empresas(nombre)')
          .eq('activo', true);
      for (final v in (vehis as List)) {
        final m = Map<String, dynamic>.from(v as Map);
        final id = m['empresa_id'] as String?;
        final nombre = m['empresa'] is Map ? m['empresa']['nombre'] as String? : null;
        if (id != null && nombre != null && nombre.isNotEmpty) porId[id] = nombre;
      }
    } catch (_) {/* best-effort */}

    // 3) Fallback total: las que permita la RLS de tc_empresas.
    if (porId.isEmpty) {
      final todas = await _db.from('tc_empresas').select('id, nombre').order('nombre');
      for (final x in (todas as List)) {
        final m = Map<String, dynamic>.from(x as Map);
        if (m['id'] != null) porId[m['id'] as String] = (m['nombre'] as String?) ?? '—';
      }
    }

    final out = porId.entries.map((e) => {'id': e.key, 'nombre': e.value}).toList();
    out.sort((a, b) => (a['nombre'] as String).toLowerCase().compareTo((b['nombre'] as String).toLowerCase()));
    return out;
  }

  /// ¿El usuario autenticado es administrador? (para mostrar "Admin (Todos los
  /// clientes)"). Lee el perfil, que ya trae rol/es_admin/es_superadmin.
  static Future<bool> esAdmin() async {
    try {
      final p = await obtenerMiPerfil();
      if (p == null) return false;
      final rol = (p['rol'] as String?)?.toLowerCase().trim();
      return p['es_superadmin'] == true ||
          p['es_admin'] == true ||
          rol == 'administrador' ||
          rol == 'admin';
    } catch (_) {
      return false;
    }
  }

  /// Login de TyreControl: nombre + PIN PROPIO del usuario (independiente de
  /// Assist). El servidor comprueba que existe un usuario de TyreControl con
  /// ese nombre y acceso a la APK, y devuelve su email; el PIN se valida contra
  /// Supabase Auth (la contraseña del propio usuario, que se fija/cambia desde
  /// Usuarios). Los operarios de Assist ya NO pueden entrar aquí.
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
      throw Exception(data['error'] ?? 'Usuario o PIN incorrectos');
    }
    final email = data['email'] as String;

    try {
      final auth = await _db.auth.signInWithPassword(email: email, password: pin);
      if (auth.user == null) throw Exception('Usuario o PIN incorrectos');
    } on AuthException {
      throw Exception('Usuario o PIN incorrectos');
    }
  }

  static Future<void> signOut() async {
    // Al cerrar sesión se olvida el cliente para obligar a re-seleccionar.
    clienteActivo.value = null;
    await _db.auth.signOut();
  }

  static Future<Map<String, dynamic>?> obtenerMiPerfil() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return null;
    // Desambiguar el embed: hay 2 relaciones tc_usuarios↔tc_empresas (FK
    // directa empresa_id + M2M tc_operador_empresas). Sin el nombre de la FK,
    // PostgREST devuelve PGRST201 y la app peta al cargar el perfil.
    return await _db.from('tc_usuarios').select('*, empresa:tc_empresas!tc_usuarios_empresa_id_fkey(*)').eq('id', uid).maybeSingle();
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
    var q = _db
        .from('tc_vehiculos')
        .select('*, empresa:tc_empresas(*), tipo:tc_tipos_vehiculo(*)')
        .or('matricula.ilike.%$t%,numero_unidad.ilike.%$t%')
        .eq('activo', true);
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    final data = await q.order('matricula').limit(15);
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
  /// Conducción eficiente de la flota (Webfleet): OptiDrive, ralentí, km y
  /// excesos de velocidad, agregados en el backend.
  ///
  /// Combustible NO: los equipos no llevan enlace CAN/FMS, así que Webfleet
  /// devuelve fuel_usage y co2 siempre a 0 (el backend lo indica con
  /// combustible_disponible=false).
  static Future<Map<String, dynamic>?> conduccionWebfleet(String empresaId, {int dias = 30}) async {
    try {
      final uri = Uri.parse('$kBackendUrl/api/tyrecontrol/webfleet/conduccion?empresa=$empresaId&dias=$dias');
      final r = await http.get(uri, headers: {
        if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken',
      }).timeout(const Duration(seconds: 35));
      if (r.statusCode != 200) {
        final msg = () {
          try {
            return (jsonDecode(r.body) as Map<String, dynamic>)['error']?.toString();
          } catch (_) {
            return null;
          }
        }();
        throw Exception(msg ?? 'Webfleet no disponible (HTTP ${r.statusCode})');
      }
      return Map<String, dynamic>.from(jsonDecode(r.body) as Map);
    } on Exception {
      rethrow;
    } catch (e) {
      throw Exception('$e');
    }
  }

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
  /// no pasa nada, el km ya queda en la propia revisión u operación).
  ///
  /// [origen] distingue de dónde salió el dato: 'webfleet' cuando lo da la
  /// plataforma y 'manual' cuando lo teclea el técnico porque el vehículo no
  /// está enlazado con ninguna. Sin esa distinción no habría forma de saber
  /// qué km son de odómetro y cuáles de alguien mirando el cuadro.
  static Future<void> actualizarKmVehiculo(String vehiculoId, int km, {String origen = 'webfleet'}) async {
    try {
      await _db.from('tc_vehiculos').update({'km_actual': km, 'origen_km': origen}).eq('id', vehiculoId);
    } catch (_) {}
  }

  /// Corrige los km de una revisión ya creada. Hace falta cuando el técnico
  /// los informa después de empezar, o cuando arrastra una revisión que se
  /// creó sin ellos.
  static Future<void> actualizarKmRevision(String revisionId, num km) async {
    await _db.from('revisiones_vehiculo').update({'km_vehiculo': km}).eq('id', revisionId);
  }

  /// Imagen del plano del vehículo, con el mismo orden que el panel web:
  /// la de su configuración de ejes PARA SU MARCA (un 2x4 de MAN no se dibuja
  /// como uno de Volvo), si no la genérica de la configuración, y si tampoco
  /// la del tipo de vehículo. null si no hay ninguna.
  static Future<String?> obtenerImagenChasis(Vehiculo v) async {
    final delTipo = v.tipo?.imagenChasisUrl;
    try {
      final veh = await _db
          .from('tc_vehiculos')
          .select('config_ejes_id, marca, marca_id')
          .eq('id', v.id)
          .maybeSingle();
      final cid = veh?['config_ejes_id'];
      if (cid != null) {
        final url = await _imagenDeMarca(cid as String, veh?['marca_id'] as String?, veh?['marca'] as String?);
        if (url != null && url.isNotEmpty) return url;

        final ce = await _db.from('tc_config_ejes').select('imagen_chasis_url').eq('id', cid).maybeSingle();
        final generica = ce?['imagen_chasis_url'] as String?;
        if (generica != null && generica.isNotEmpty) return generica;
      }
    } catch (_) {
      // Si falla la consulta se cae al tipo, que es lo que había antes.
    }
    return (delTipo != null && delTipo.isNotEmpty) ? delTipo : null;
  }

  /// Imagen propia de la marca para esa configuración. La mayoría de
  /// vehículos guardan la marca como texto suelto y no enlazada al catálogo,
  /// así que si no hay marca_id se busca por nombre ignorando mayúsculas.
  static Future<String?> _imagenDeMarca(String configId, String? marcaId, String? marcaNombre) async {
    try {
      var id = marcaId;
      if (id == null && marcaNombre != null && marcaNombre.trim().isNotEmpty) {
        final m = await _db
            .from('tc_cat_marcas_vehiculo')
            .select('id')
            .ilike('nombre', marcaNombre.trim())
            .limit(1);
        final lista = m as List;
        if (lista.isNotEmpty) id = (lista.first as Map)['id'] as String?;
      }
      if (id == null) return null;
      final r = await _db
          .from('tc_config_ejes_marca')
          .select('imagen_chasis_url')
          .eq('config_ejes_id', configId)
          .eq('marca_id', id)
          .limit(1);
      final lista = r as List;
      return lista.isEmpty ? null : (lista.first as Map)['imagen_chasis_url'] as String?;
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

  /// Cierra la revisión con su cronometraje (Analítica de Productividad).
  /// [finAt] es el momento en que el técnico pulsó Finalizar — importa cuando
  /// el cierre llega por la cola offline horas después.
  static Future<void> completarRevisionConTiempos(
    String revisionId, {
    String estado = 'completada',
    DateTime? finAt,
    String? tipoRevision,
    int? nNeumaticos,
    int? pausaSeg,
    int? nPausas,
  }) async {
    final upd = <String, dynamic>{'estado_revision': estado};
    if (finAt != null) {
      upd['fin_at'] = finAt.toUtc().toIso8601String();
      // inicio_at se fijó al crear la revisión; se lee para la duración.
      final r = await _db.from('revisiones_vehiculo').select('inicio_at').eq('id', revisionId).maybeSingle();
      final ini = r?['inicio_at'] != null ? DateTime.tryParse(r!['inicio_at'] as String) : null;
      if (ini != null) {
        final dur = finAt.toUtc().difference(ini.toUtc()).inSeconds;
        if (dur >= 0) {
          upd['duracion_seg'] = dur;
          upd['trabajo_seg'] = (dur - (pausaSeg ?? 0)).clamp(0, dur);
        }
      }
    }
    if (tipoRevision != null) upd['tipo_revision'] = tipoRevision;
    if (nNeumaticos != null) upd['n_neumaticos'] = nNeumaticos;
    if (pausaSeg != null) upd['pausa_seg'] = pausaSeg;
    if (nPausas != null) upd['n_pausas'] = nPausas;
    await _db.from('revisiones_vehiculo').update(upd).eq('id', revisionId);
  }

  // ── Productividad: pausas y estadísticas ─────────────────────
  /// Guarda una pausa terminada. Best-effort: sin red no bloquea el trabajo
  /// (los totales de la sesión viajan igualmente en la fila padre).
  static Future<void> registrarPausa({
    required String contexto,
    required String empresaId,
    String? vehiculoId,
    String? revisionId,
    required String motivo,
    String? observaciones,
    required DateTime inicio,
    required DateTime fin,
  }) async {
    try {
      await _db.from('tc_pausas_trabajo').insert({
        'contexto': contexto,
        'empresa_id': empresaId,
        'tecnico_id': _db.auth.currentUser?.id,
        'vehiculo_id': vehiculoId,
        'revision_id': revisionId,
        'motivo': motivo,
        'observaciones': observaciones,
        'inicio_at': inicio.toUtc().toIso8601String(),
        'fin_at': fin.toUtc().toIso8601String(),
      });
    } catch (_) {/* sin red o RLS: la fila padre ya lleva los totales */}
  }

  /// Estadísticas agregadas (calculadas en Postgres, nunca en memoria).
  /// [tab] = 'revisiones' | 'operaciones'. Filtros null = sin filtrar.
  static Future<Map<String, dynamic>> estadisticasProductividad(
    String tab, {
    DateTime? desde,
    DateTime? hasta,
    String? empresaId,
    String? tecnicoId,
    String? tipoVehiculoId,
    String? tipo,
  }) async {
    String? d(DateTime? x) => x == null ? null : x.toIso8601String().substring(0, 10);
    final data = await _db.rpc(
      tab == 'operaciones' ? 'tc_prod_operaciones' : 'tc_prod_revisiones',
      params: {
        'p_desde': d(desde),
        'p_hasta': d(hasta),
        // Sin filtro explícito, manda el cliente activo de la sesión.
        'p_empresa': empresaId ?? empresaActivaId,
        'p_tecnico': tecnicoId,
        'p_tipo_vehiculo': tipoVehiculoId,
        'p_tipo': tipo,
      },
    );
    return data is Map ? Map<String, dynamic>.from(data) : {};
  }

  /// Técnicos visibles (filtro de Analítica). La RLS limita el alcance.
  static Future<List<({String id, String nombre})>> listarTecnicos() async {
    try {
      final data = await _db.from('tc_usuarios').select('id, nombre').eq('activo', true).order('nombre');
      return (data as List)
          .map((e) => (id: e['id'] as String, nombre: (e['nombre'] as String?) ?? '—'))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Tipos de vehículo (filtro de Analítica).
  static Future<List<({String id, String nombre})>> listarTiposVehiculo() async {
    try {
      final data = await _db.from('tc_tipos_vehiculo').select('id, nombre').order('nombre');
      return (data as List)
          .map((e) => (id: e['id'] as String, nombre: (e['nombre'] as String?) ?? '—'))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> completarRevision(String revisionId, {String estado = 'completada'}) async {
    await _db.from('revisiones_vehiculo').update({'estado_revision': estado}).eq('id', revisionId);
  }

  /// Cancela una revisión pendiente (borrador). Queda como 'anulada' en el
  /// historial: no se borra nada.
  static Future<void> anularRevision(String revisionId) async {
    await _db.from('revisiones_vehiculo').update({'estado_revision': 'anulada'}).eq('id', revisionId);
  }

  static Future<List<RevisionVehiculo>> listarRevisionesPendientesDelTecnico() async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return [];
    var q = _db
        .from('revisiones_vehiculo')
        .select()
        .eq('tecnico_id', uid)
        .eq('estado_revision', 'borrador');
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    final data = await q.order('fecha_revision', ascending: false);
    return (data as List).map((e) => RevisionVehiculo.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  /// Historial: últimas revisiones cerradas por el técnico (completadas, con
  /// incidencias y anuladas; la matrícula viene embebida para no hacer una
  /// consulta por cada una).
  static Future<List<RevisionVehiculo>> listarRevisionesCompletadasDelTecnico({int limite = 30}) async {
    final uid = _db.auth.currentUser?.id;
    if (uid == null) return [];
    var q = _db
        .from('revisiones_vehiculo')
        .select('*, vehiculo:tc_vehiculos(matricula, numero_unidad)')
        .eq('tecnico_id', uid)
        .inFilter('estado_revision', [
          'completada',
          'completada_con_incidencias',
          'completada_incidencia_pendiente',
          'anulada',
        ]);
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    final data = await q.order('created_at', ascending: false).limit(limite);
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

  /// Foto del flanco para identificar la goma. Va al mismo bucket que el
  /// resto de fotos de revisión: no se monta otro sistema de archivos.
  static Future<String> subirFotoFlanco(File file, {required String revisionId, required String posicionId}) async {
    final ext = file.path.split('.').last;
    final path = 'flancos/$revisionId/${posicionId}_${DateTime.now().microsecondsSinceEpoch}.$ext';
    await _db.storage.from(_bucketFotos).upload(path, file);
    return _db.storage.from(_bucketFotos).getPublicUrl(path);
  }

  // ── Corrección del neumático registrado ──────────────────────
  //
  // El técnico encuentra en la rueda una goma distinta de la que Mobilink
  // tiene fichada. Esto NO es un trabajo de taller: se corrige el dato, no se
  // monta nada. Cero coste y cero mano de obra.

  /// ¿Se puede ofrecer "Identificar con foto"? Sin IA configurada en el
  /// servidor, mejor no enseñar un botón que va a fallar.
  static Future<bool> flancoDisponible() async {
    try {
      final r = await http.get(
        Uri.parse('$kBackendUrl/api/tyrecontrol/flanco/estado'),
        headers: {if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken'},
      ).timeout(const Duration(seconds: 8));
      if (r.statusCode != 200) return false;
      return (jsonDecode(r.body) as Map)['disponible'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Lee el flanco de la foto. Devuelve lo que la IA PROPONE, nunca lo guarda.
  /// Si el servicio no responde o la foto no da, devuelve la propuesta vacía
  /// con su aviso: el técnico sigue a mano y la revisión no se bloquea.
  static Future<Map<String, dynamic>> leerFlanco(String imagenUrl) async {
    try {
      final r = await http.post(
        Uri.parse('$kBackendUrl/api/tyrecontrol/flanco/leer'),
        headers: {
          'Content-Type': 'application/json',
          if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken',
        },
        body: jsonEncode({'imagen_url': imagenUrl}),
      ).timeout(const Duration(seconds: 60));
      final cuerpo = jsonDecode(r.body);
      if (r.statusCode != 200) {
        return {'aviso': (cuerpo is Map ? cuerpo['error'] : null) ?? 'No se ha podido leer el flanco',
                'suficienteParaBuscar': false, 'dudosos': const []};
      }
      return Map<String, dynamic>.from(cuerpo as Map);
    } catch (e) {
      return {'aviso': 'No hay conexión con el servicio de identificación',
              'suficienteParaBuscar': false, 'dudosos': const []};
    }
  }

  /// Gomas de la empresa que se pueden poner en esta posición: las que NO
  /// están montadas en ningún sitio. Busca por número, serie, RFID o DOT.
  static Future<List<Neumatico>> buscarNeumaticosParaCorregir(
      String empresaId, String texto) async {
    var q = _db.from('tc_neumaticos').select()
        .eq('empresa_id', empresaId).eq('activo', true)
        .not('estado', 'in', '("montado","descartado")');
    final t = texto.trim();
    if (t.isNotEmpty) {
      q = q.or('numero_interno.ilike.%$t%,codigo_interno.ilike.%$t%,'
               'numero_serie.ilike.%$t%,rfid_epc.ilike.%$t%,dot.ilike.%$t%');
    }
    final data = await q.limit(50);
    return (data as List).map((e) => Neumatico.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  /// Referencias del catálogo que casan con lo leído, para elegir antes de
  /// crear nada. Se buscan por marca y medida; el modelo lo afina la pantalla.
  static Future<List<Map<String, dynamic>>> buscarReferencias(String marca, String medida) async {
    final data = await _db.from('tc_referencias_neumatico')
        .select('id, referencia_completa, pendiente_validar, '
                'modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), '
                'medida:tyre_sizes(medida)')
        .eq('activo', true).limit(200);
    String norm(String? x) => (x ?? '').toUpperCase().replaceAll(RegExp(r'[\s-]+'), '');
    final nm = norm(marca), nd = norm(medida);
    return (data as List)
        .map((e) => Map<String, dynamic>.from(e))
        .where((r) {
          final m = r['modelo'] as Map?;
          final marcaRef = (m?['marca'] as Map?)?['nombre'] as String?;
          final medidaRef = (r['medida'] as Map?)?['medida'] as String?;
          return norm(marcaRef) == nm && norm(medidaRef) == nd;
        }).toList();
  }

  /// Da de alta una referencia que no está en el catálogo. Nace PROVISIONAL:
  /// un administrador la valida después. La base de datos reutiliza marca,
  /// modelo y medida si ya existen escritas de otra manera.
  static Future<Map<String, dynamic>> crearReferenciaProvisional({
    required String empresaId,
    required String marca,
    required String modelo,
    required String medida,
    required String cargaSimple,
    String? cargaDoble,
    String? velocidad,
  }) async {
    final r = await _db.rpc('tc_crear_referencia_provisional', params: {
      'p_empresa': empresaId, 'p_marca': marca, 'p_modelo': modelo, 'p_medida': medida,
      'p_carga_simple': cargaSimple,
      'p_carga_doble': (cargaDoble ?? '').trim().isEmpty ? null : cargaDoble!.trim(),
      'p_velocidad': (velocidad ?? '').trim().isEmpty ? null : velocidad!.trim(),
    });
    return Map<String, dynamic>.from(r as Map);
  }

  /// Corrige QUÉ neumático hay en la posición. No genera trabajo ni coste: la
  /// goma que estaba mal fichada pasa a "no localizada" —no al almacén, que
  /// sería inventar stock— y queda todo atado a esta revisión.
  static Future<String> corregirMontado({
    required String montajeId,
    required String neumaticoCorrectoId,
    String? revisionId,
    String? metodo,
    String? fotoUrl,
    String? observaciones,
  }) async {
    final r = await _db.rpc('tc_corregir_montado', params: {
      'p_montaje': montajeId,
      'p_neumatico_correcto': neumaticoCorrectoId,
      'p_obs': observaciones,
      'p_revision': revisionId,
      'p_metodo': metodo,
      'p_foto_url': fotoUrl,
    });
    return r as String;
  }

  /// La goma encontrada no existe ni como ficha: se da de alta Y se corrige el
  /// montaje en la misma llamada. Juntas a propósito: una ficha que no llegara
  /// a montarse por un corte de red quedaría contando como stock inexistente.
  static Future<Map<String, dynamic>> corregirMontadoNuevaFicha({
    required String montajeId,
    required String marca,
    String? modelo,
    required String medida,
    String? dot,
    String? numeroSerie,
    String? revisionId,
    String? metodo,
    String? fotoUrl,
    String? observaciones,
  }) async {
    final r = await _db.rpc('tc_corregir_montado_nueva_ficha', params: {
      'p_montaje': montajeId, 'p_marca': marca,
      'p_modelo': (modelo ?? '').trim().isEmpty ? null : modelo!.trim(),
      'p_medida': medida,
      'p_dot': (dot ?? '').trim().isEmpty ? null : dot!.trim(),
      'p_numero_serie': (numeroSerie ?? '').trim().isEmpty ? null : numeroSerie!.trim(),
      'p_obs': observaciones, 'p_revision': revisionId,
      'p_metodo': metodo, 'p_foto_url': fotoUrl,
    });
    return Map<String, dynamic>.from(r as Map);
  }

  // ── Parte de servicio por fotografías ────────────────────────
  //
  // Una vía de entrada OPCIONAL: el técnico fotografía matrícula,
  // cuentakilómetros y flancos, la IA propone y él confirma. Termina en una
  // intervención con sus operaciones, no en un documento suelto.

  /// ¿Se puede ofrecer? Sin IA configurada, mejor no enseñar el botón.
  static Future<bool> parteDisponible() async {
    try {
      final r = await http.get(
        Uri.parse('$kBackendUrl/api/tyrecontrol/parte/estado'),
        headers: {if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken'},
      ).timeout(const Duration(seconds: 8));
      if (r.statusCode != 200) return false;
      return (jsonDecode(r.body) as Map)['disponible'] == true;
    } catch (_) {
      return false;
    }
  }

  /// Sube una foto del parte. Van al bucket que ya existe, en su carpeta.
  static Future<String> subirFotoParte(File file, {required String carpeta}) async {
    final ext = file.path.split('.').last;
    final path = 'partes/$carpeta/${DateTime.now().microsecondsSinceEpoch}.$ext';
    await _db.storage.from(_bucketFotos).upload(path, file);
    return _db.storage.from(_bucketFotos).getPublicUrl(path);
  }

  /// Manda TODAS las fotos juntas: así el modelo puede cruzarlas y reconocer
  /// que dos son de la misma rueda. Devuelve lo que PROPONE, nunca lo guarda.
  static Future<Map<String, dynamic>> leerParte(List<String> imagenes) async {
    try {
      final r = await http.post(
        Uri.parse('$kBackendUrl/api/tyrecontrol/parte/leer'),
        headers: {
          'Content-Type': 'application/json',
          if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken',
        },
        body: jsonEncode({'imagenes': imagenes}),
      ).timeout(const Duration(minutes: 3));
      final cuerpo = jsonDecode(r.body);
      if (r.statusCode != 200) {
        return {'warnings': [(cuerpo is Map ? cuerpo['error'] : null) ?? 'No se ha podido leer el parte'],
                'utilizable': false, 'tires': const []};
      }
      return Map<String, dynamic>.from(cuerpo as Map);
    } catch (_) {
      return {'warnings': const ['No hay conexión con el servicio de lectura'],
              'utilizable': false, 'tires': const []};
    }
  }

  /// Las líneas de servicio facturables del parte. Se reemplazan enteras: es
  /// más simple y no deja líneas viejas de un intento anterior.
  static Future<void> guardarServiciosParte(
      String intervencionId, Map<String, num> cantidades) async {
    await _db.from('tc_intervencion_servicios').delete().eq('intervencion_id', intervencionId);
    final filas = cantidades.entries
        .where((e) => e.value > 0)
        .map((e) => {'intervencion_id': intervencionId, 'servicio': e.key, 'cantidad': e.value})
        .toList();
    if (filas.isNotEmpty) await _db.from('tc_intervencion_servicios').insert(filas);
  }

  /// El catálogo de servicios facturables, para pintar la lista.
  static Future<List<Map<String, dynamic>>> listarServiciosCatalogo() async {
    final d = await _db.from('tc_cat_servicios').select().eq('activo', true).order('orden');
    return (d as List).map((e) => Map<String, dynamic>.from(e)).toList();
  }

  /// Firmas y datos de cabecera que el parte pide y la intervención no traía.
  static Future<void> guardarCabeceraParte(String intervencionId, Map<String, dynamic> datos) async {
    await _db.from('tc_intervenciones').update(datos).eq('id', intervencionId);
  }

  /// Sube una firma dibujada en la tablet. Mismo bucket: no hay otro sistema
  /// de archivos, y una firma es una imagen como las demás.
  static Future<String> subirFirma(Uint8List png, {required String intervencionId, required String quien}) async {
    final path = 'firmas/$intervencionId/$quien.png';
    await _db.storage.from(_bucketFotos).uploadBinary(path, png,
        fileOptions: const FileOptions(upsert: true, contentType: 'image/png'));
    return _db.storage.from(_bucketFotos).getPublicUrl(path);
  }

  /// Un enlace al PDF del parte que se pueda abrir con el visor del sistema.
  ///
  /// No se devuelve la ruta del servidor: el visor lanza una petición SIN la
  /// cabecera de sesión y recibiría un 401. El servidor comprueba aquí el
  /// permiso —con la sesión, como debe ser—, guarda el parte y devuelve un
  /// enlace firmado y caducable.
  static Future<String> enlacePdfParte(String intervencionId) async {
    final r = await http.post(
      Uri.parse('$kBackendUrl/api/tyrecontrol/parte/$intervencionId/pdf/enlace'),
      headers: {if (currentSessionToken != null) 'Authorization': 'Bearer $currentSessionToken'},
    ).timeout(const Duration(seconds: 60));
    final cuerpo = jsonDecode(r.body);
    if (r.statusCode != 200) {
      throw Exception((cuerpo is Map ? cuerpo['error'] : null) ?? 'No se ha podido generar el PDF');
    }
    return (cuerpo as Map)['url'] as String;
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

  /// Crea una incidencia desde un payload serializable (lo usa la cola
  /// offline). Las claves coinciden con los parámetros de [crearIncidencia].
  static Future<String> crearIncidenciaDesdeMapa(Map<String, dynamic> p) {
    return crearIncidencia(
      empresaId: p['empresaId'] as String,
      vehiculoId: p['vehiculoId'] as String,
      posicionId: p['posicionId'] as String?,
      neumaticoId: p['neumaticoId'] as String?,
      revisionId: p['revisionId'] as String?,
      tipos: (p['tipos'] as List).cast<String>(),
      gravedad: p['gravedad'] as String,
      gravedadAuto: p['gravedadAuto'] as String?,
      estado: p['estado'] as String,
      motivoPendiente: p['motivoPendiente'] as String?,
      motivoObservacion: p['motivoObservacion'] as String?,
      accionRecomendada: p['accionRecomendada'] as String?,
      fechaRecomendada: p['fechaRecomendada'] as String?,
      autorizaPersona: p['autorizaPersona'] as String?,
      medicionInicial: p['medicionInicial'] == null ? null : Map<String, dynamic>.from(p['medicionInicial'] as Map),
      fotoUrl: p['fotoUrl'] as String?,
    );
  }

  /// Última medición conocida por posición (de revisiones YA completadas),
  /// para mostrarla como referencia en el plano. Excluye la revisión actual.
  static Future<Map<String, UltimaMedicion>> ultimasMedicionesVehiculo(
    String vehiculoId, {
    String? excluirRevisionId,
  }) async {
    final rows = await _db
        .from('revisiones_neumaticos_detalle')
        .select(
            'posicion_id, profundidad_mm, presion_bar, revision:revisiones_vehiculo(id, fecha_revision, created_at, estado_revision)')
        .eq('vehiculo_id', vehiculoId);
    final completadas = {
      'completada', 'completada_con_incidencias', 'completada_incidencia_pendiente', 'enviada'
    };
    final porPos = <String, UltimaMedicion>{};
    final tsPorPos = <String, int>{};
    for (final r in (rows as List)) {
      final rev = r['revision'];
      if (rev is! Map) continue;
      if (!completadas.contains(rev['estado_revision'])) continue;
      if (excluirRevisionId != null && rev['id'] == excluirRevisionId) continue;
      final posId = r['posicion_id'] as String?;
      if (posId == null) continue;
      final createdAt = DateTime.tryParse('${rev['created_at'] ?? ''}');
      final ts = createdAt?.millisecondsSinceEpoch ?? 0;
      if (tsPorPos.containsKey(posId) && ts <= tsPorPos[posId]!) continue;
      tsPorPos[posId] = ts;
      porPos[posId] = UltimaMedicion(
        fecha: DateTime.tryParse('${rev['fecha_revision'] ?? ''}') ?? createdAt,
        profundidadMm: (r['profundidad_mm'] as num?)?.toDouble(),
        presionBar: (r['presion_bar'] as num?)?.toDouble(),
      );
    }
    return porPos;
  }

  /// Umbrales de profundidad de la empresa + overrides por medida.
  /// Devuelve el umbral de empresa (o null) y un mapa medida(normalizada)→umbral.
  static Future<({UmbralConfig? empresa, Map<String, UmbralConfig> porMedida})> umbralesDeEmpresa(
    String empresaId,
  ) async {
    UmbralConfig? emp;
    final porMedida = <String, UmbralConfig>{};
    try {
      final e = await _db.from('tc_config_umbrales').select().eq('empresa_id', empresaId).maybeSingle();
      if (e != null && e['profundidad_minima_mm'] != null) {
        emp = UmbralConfig(
          minimaMm: (e['profundidad_minima_mm'] as num).toDouble(),
          avisoMm: (e['profundidad_aviso_mm'] as num?)?.toDouble() ?? (e['profundidad_minima_mm'] as num).toDouble(),
        );
      }
      final ms = await _db.from('tc_config_umbrales_medida').select().eq('empresa_id', empresaId);
      for (final m in (ms as List)) {
        final medida = (m['medida'] as String?);
        if (medida == null || m['profundidad_minima_mm'] == null) continue;
        porMedida[_normMedida(medida)] = UmbralConfig(
          minimaMm: (m['profundidad_minima_mm'] as num).toDouble(),
          avisoMm: (m['profundidad_aviso_mm'] as num?)?.toDouble() ?? (m['profundidad_minima_mm'] as num).toDouble(),
        );
      }
    } catch (_) {
      // sin cobertura o sin config: se usará el umbral por defecto de la app
    }
    return (empresa: emp, porMedida: porMedida);
  }

  static String _normMedida(String s) => s.toUpperCase().replaceAll(RegExp(r'\s+'), '');

  // ── Cambio rápido de neumático (stock, montar, desmontar) ──────────────────
  /// Stock del cliente de almacén enlazado, por producto (nuevo/usado).
  static Future<List<StockAlmacenLinea>> stockAlmacenEmpresa(String empresaId) async {
    final data = await _db.rpc('tc_stock_almacen_empresa', params: {'p_empresa': empresaId});
    return ((data as List?) ?? [])
        .map((r) => StockAlmacenLinea.fromJson(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  /// ¿Esta empresa controla individualmente los neumáticos de esta medida?
  ///
  /// Lo resuelve el servidor (`tc_identificacion_resuelve`) para no duplicar
  /// aquí la regla de la política. Solo decide si la APK PIDE la identidad: el
  /// que la aplica de verdad es el RPC de montaje.
  static Future<bool> pideIdentidad({required String empresaId, required String medida}) async {
    try {
      final r = await _db.rpc('tc_identificacion_resuelve', params: {
        'p_empresa': empresaId,
        'p_medida': medida,
      });
      return r == true;
    } catch (_) {
      // Servidor sin la política todavía: se comporta como siempre (genérico).
      return false;
    }
  }

  /// Identidad de un neumático para el aviso de «reconocido»: su número
  /// interno y de qué vehículo venía la última vez. Devuelve null si es la
  /// primera vez que se monta (no hay nada que reconocer).
  static Future<({String numero, String? matriculaAnterior})?> reconocimiento(String neumaticoId) async {
    try {
      final n = await _db.from('tc_neumaticos').select('numero_interno').eq('id', neumaticoId).maybeSingle();
      if (n == null) return null;
      final h = await _db
          .from('tc_historial_montajes')
          .select('vehiculo:tc_vehiculos(matricula)')
          .eq('neumatico_id', neumaticoId)
          .order('fecha_desmontaje', ascending: false)
          .limit(1)
          .maybeSingle();
      if (h == null) return null; // nunca había estado montado: es goma nueva
      return (
        numero: (n['numero_interno'] as String?) ?? '',
        matriculaAnterior: (h['vehiculo'] as Map?)?['matricula'] as String?,
      );
    } catch (_) {
      return null; // el aviso es un extra: si falla, no se estorba al técnico
    }
  }

  /// Quién es la goma que se acaba de leer, sin lanzar excepción: sirve para
  /// pintar el diálogo del conflicto. De una ficha de otra empresa el servidor
  /// solo dice que existe.
  static Future<Map<String, dynamic>?> neumaticoPorIdentidad({
    required String empresaId, String? rfidEpc, String? numeroSerie,
  }) async {
    try {
      final r = await _db.rpc('tc_neumatico_por_identidad', params: {
        'p_empresa': empresaId,
        'p_rfid': (rfidEpc ?? '').trim().isEmpty ? null : rfidEpc!.trim(),
        'p_serie': (numeroSerie ?? '').trim().isEmpty ? null : numeroSerie!.trim(),
      });
      return r == null ? null : Map<String, dynamic>.from(r as Map);
    } catch (_) {
      return null;
    }
  }

  /// Registra el desmontaje que no se llegó a apuntar, para poder montar la
  /// goma donde está de verdad. NO devuelve stock: la rueda no ha pasado por
  /// el almacén, va de un camión al otro.
  static Future<void> regularizarDesmontaje(String neumaticoId, {String? observaciones}) async {
    await _db.rpc('tc_regularizar_desmontaje', params: {
      'p_neumatico': neumaticoId,
      'p_obs': observaciones,
    });
  }

  /// Pone identidad a una goma que YA está montada, sin desmontarla ni
  /// cambiarle el estado. Rellena huecos; el servidor nunca pisa un RFID o una
  /// serie que ya estuviera puesta.
  static Future<void> identificarNeumatico({
    required String neumaticoId,
    String? rfidEpc,
    String? numeroSerie,
    String? dot,
    String? observaciones,
  }) async {
    await _db.rpc('tc_identificar_neumatico', params: {
      'p_neumatico': neumaticoId,
      'p_rfid': (rfidEpc ?? '').trim().isEmpty ? null : rfidEpc!.trim(),
      'p_serie': (numeroSerie ?? '').trim().isEmpty ? null : numeroSerie!.trim(),
      'p_dot': (dot ?? '').trim().isEmpty ? null : dot!.trim(),
      'p_obs': observaciones,
    });
  }

  /// Inicia (o recupera, si ya hay una abierta de este técnico y vehículo) la
  /// intervención de la sesión de trabajo en BD. Devuelve su id, o null si la
  /// BD aún no tiene la fase 1/3 o no hay red: en ese caso la pantalla sigue
  /// con el flujo antiguo (operaciones huérfanas + red de seguridad) y no se
  /// pierde nada. El número de parte se asigna al CERRAR, no aquí.
  static Future<String?> iniciarIntervencion(String vehiculoId) async {
    try {
      final r = await _db.rpc('tc_iniciar_intervencion', params: {'p_vehiculo': vehiculoId});
      if (r is Map && r['id'] is String) return r['id'] as String;
    } catch (_) {/* flujo antiguo */}
    return null;
  }

  /// Ejecuta un RPC de operación DENTRO de la intervención activa: la fila
  /// nace con su intervencion_id (fase 3). Con [intervencionId] null llama al
  /// RPC directo, que es el comportamiento de siempre. Los nombres de [params]
  /// son los del RPC real (p_vehiculo, p_montaje…); el envoltorio de BD
  /// devuelve {resultado, intervencion, …} y aquí se extrae el resultado para
  /// que el que llama no note la diferencia.
  static Future<dynamic> _rpcOperacion(String rpc, Map<String, dynamic> params, String? intervencionId) async {
    if (intervencionId == null) return _db.rpc(rpc, params: params);
    final r = await _db.rpc('tc_ejecutar_en_intervencion', params: {
      'p_intervencion': intervencionId,
      'p_rpc': rpc,
      'p_args': params,
    });
    return (r is Map) ? r['resultado'] : r;
  }

  /// Monta un producto del almacén en una posición (descuenta stock).
  /// [condicion] = 'nuevo' | 'usado'. En usado, [profundidadUsado] se guarda
  /// como profundidad actual del neumático.
  ///
  /// [rfidEpc] y [numeroSerie] identifican la goma: si ya existe una ficha con
  /// esa identidad, el RPC la REUTILIZA en vez de crear otra, y con ella viajan
  /// su historial, sus km y su coste. Se manda `p_control_individual: null`
  /// para que decida la política de la empresa (genérico / identificado /
  /// mixto); sin política configurada resuelve genérico, como siempre.
  ///
  /// Devuelve el id del neumático montado.
  static Future<String?> montarDesdeAlmacen({
    required String vehiculoId,
    required String posicionId,
    required String productoAlmacenId,
    String condicion = 'nuevo',
    num? km,
    String? observaciones,
    double? profundidadUsado,
    bool forzarMedida = false,
    String? rfidEpc,
    String? numeroSerie,
    String? dot,
    String? intervencionId,
  }) async {
    final datos = _datosIdentidad(rfidEpc: rfidEpc, numeroSerie: numeroSerie, dot: dot);
    if (condicion == 'usado' && profundidadUsado != null) {
      datos['profundidad_actual_mm'] = profundidadUsado.toString();
    }
    final r = await _rpcOperacion('tc_montar_desde_almacen', {
      'p_vehiculo': vehiculoId,
      'p_posicion': posicionId,
      'p_producto_almacen': productoAlmacenId,
      'p_control_individual': null,
      'p_datos': datos,
      'p_km': km,
      'p_fecha': null,
      'p_obs': observaciones,
      'p_forzar_medida': forzarMedida,
      'p_condicion': condicion,
    }, intervencionId);
    return r as String?;
  }

  /// Identidad para `p_datos`. Lo que va en blanco NO se manda: una cadena
  /// vacía en RFID o serie choca contra los índices únicos parciales
  /// (ver tyrecontrol_fix_rfid_serie_vacios.sql).
  static Map<String, dynamic> _datosIdentidad({String? rfidEpc, String? numeroSerie, String? dot}) {
    final datos = <String, dynamic>{};
    final r = rfidEpc?.trim();
    final s = numeroSerie?.trim();
    final d = dot?.trim();
    if (r != null && r.isNotEmpty) datos['rfid_epc'] = r;
    if (s != null && s.isNotEmpty) datos['numero_serie'] = s;
    if (d != null && d.isNotEmpty) datos['dot'] = d;
    return datos;
  }

  /// Clave normalizada marca|modelo|medida-base (ignora índice y espacios).
  /// Monta una referencia del CATÁLOGO en una posición, SIN control de stock:
  /// no descuenta almacén ni genera movimientos de inventario. El neumático
  /// queda con origen 'catalogo_sin_stock' (el marcador para los informes).
  /// Nuevo → el RPC asigna la profundidad de dibujo del catálogo; usado →
  /// [profundidadUsado] son los mm reales medidos por el técnico.
  static Future<String?> montarDesdeCatalogo({
    required String vehiculoId,
    required String posicionId,
    required String referenciaId,
    String condicion = 'nuevo',
    double? profundidadUsado,
    bool forzarMedida = false,
    num? km,
    String? rfidEpc,
    String? numeroSerie,
    String? dot,
    String? intervencionId,
  }) async {
    final datos = _datosIdentidad(rfidEpc: rfidEpc, numeroSerie: numeroSerie, dot: dot);
    if (condicion == 'usado' && profundidadUsado != null) {
      datos['profundidad_actual_mm'] = profundidadUsado.toString();
    }
    final r = await _rpcOperacion('tc_montar_desde_catalogo', {
      'p_vehiculo': vehiculoId,
      'p_posicion': posicionId,
      'p_referencia': referenciaId,
      'p_control_individual': null,
      'p_datos': datos,
      'p_km': km,
      'p_fecha': null,
      'p_obs': 'Montaje sin control de stock (APK)',
      'p_forzar_medida': forzarMedida,
      'p_condicion': condicion,
    }, intervencionId);
    return r as String?;
  }

  static String claveCatalogo(String? marca, String? modelo, String? medida) {
    final base = (medida ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');
    final m = RegExp(r'(\d{2,3})(?:/(\d{2,3}))?R?(\d{1,2}(?:[.,]\d)?)').firstMatch(base);
    final mb = m == null ? base : '${m.group(1)}${m.group(2) != null ? '/${m.group(2)}' : ''}R${m.group(3)!.replaceAll(',', '.')}';
    return '${(marca ?? '').toLowerCase().trim()}|${(modelo ?? '').toLowerCase().trim()}|$mb';
  }

  /// Datos técnicos del catálogo por modelo (profundidad de dibujo + presión
  /// máxima), para usarlos como referencia cuando el neumático no los tiene.
  static Future<Map<String, ({double? prof, double? pres})>> datosCatalogoPorModelo() async {
    try {
      final data = await _db.from('tc_referencias_neumatico').select(
          'profundidad_dibujo_mm, presion_maxima_bar, modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes(medida)');
      final out = <String, ({double? prof, double? pres})>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final marca = r['modelo'] is Map ? (r['modelo']['marca'] is Map ? r['modelo']['marca']['nombre'] : null) : null;
        final modelo = r['modelo'] is Map ? r['modelo']['nombre'] : null;
        final medida = r['tyre_size'] is Map ? r['tyre_size']['medida'] : null;
        if (marca == null || modelo == null || medida == null) continue;
        out[claveCatalogo(marca, modelo, medida)] = (
          prof: (r['profundidad_dibujo_mm'] as num?)?.toDouble(),
          pres: (r['presion_maxima_bar'] as num?)?.toDouble(),
        );
      }
      return out;
    } catch (_) {
      return {};
    }
  }

  /// Catálogo de referencias de neumático (para la pantalla de consulta de la
  /// APK): marca, modelo, medida y specs. Solo lectura.
  static Future<List<Map<String, dynamic>>> listarCatalogoReferencias() async {
    final data = await _db.from('tc_referencias_neumatico').select(
        'id, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg, referencia_completa, '
        'modelo:tc_cat_modelos_neumatico(nombre, foto_modelo_url, marca:tc_cat_marcas_neumatico(nombre)), '
        'tyre_size:tyre_sizes(medida, indice_carga_simple, codigo_velocidad)')
        .eq('activo', true).limit(2000);
    final out = <Map<String, dynamic>>[];
    for (final e in (data as List)) {
      final r = Map<String, dynamic>.from(e as Map);
      final mo = r['modelo'] is Map ? r['modelo'] as Map : null;
      final ma = mo != null && mo['marca'] is Map ? mo['marca'] as Map : null;
      final ts = r['tyre_size'] is Map ? r['tyre_size'] as Map : null;
      out.add({
        'id': r['id'],
        'marca': ma?['nombre'],
        'modelo': mo?['nombre'],
        'medida': ts?['medida'] ?? r['referencia_completa'],
        'indice_carga': ts?['indice_carga_simple'],
        'codigo_vel': ts?['codigo_velocidad'],
        'foto': mo?['foto_modelo_url'],
        'prof': (r['profundidad_dibujo_mm'] as num?)?.toDouble(),
        'pres': (r['presion_maxima_bar'] as num?)?.toDouble(),
        'carga': (r['carga_maxima_kg'] as num?)?.toDouble(),
      });
    }
    return out;
  }

  /// Intervenciones (sesiones de cambio con su informe) de un vehículo.
  static Future<List<Map<String, dynamic>>> listarIntervencionesVehiculo(String vehiculoId) async {
    // Antes de listar se envuelven las operaciones que se quedaron sueltas
    // (las del panel y las de resolver incidencias, que no pasan por
    // Finalizar): así salen con su número de parte. Solo toca lo que lleva más
    // de media hora huérfano, para no romper una sesión de Cambios abierta.
    // Best-effort: si falla, el histórico se enseña igual.
    try {
      await _db.rpc('tc_agrupar_operaciones_sueltas', params: {'p_minutos': 30});
    } catch (_) {/* se consolidará en la siguiente visita */}
    final data = await _db.from('tc_intervenciones').select()
        .eq('vehiculo_id', vehiculoId).order('created_at', ascending: false);
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Operaciones de una intervención (con posición y neumático).
  static Future<List<Map<String, dynamic>>> listarOperacionesDeIntervencion(String intervencionId) async {
    final data = await _db.from('operaciones_neumaticos').select(
        'id, tipo_operacion, motivo, is_anulada, fecha_operacion, created_at, '
        'posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(codigo_posicion, nombre), '
        'posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(codigo_posicion, nombre), '
        'neumatico:tc_neumaticos(marca, modelo, medida, numero_interno)')
        .eq('intervencion_id', intervencionId).order('created_at', ascending: true);
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Permuta dos neumáticos montados (intercambia sus posiciones). Las ruedas
  /// no salen del vehículo: se cambian de sitio y queda registrado como
  /// operación 'intercambio' con sus dos movimientos.
  static Future<String> intercambiarPosiciones({
    required String montajeAId,
    required String montajeBId,
    num? km,
    String? observaciones,
    String? intervencionId,
  }) async {
    final res = await _rpcOperacion('tc_intercambiar_posiciones', {
      'p_montaje_a': montajeAId,
      'p_montaje_b': montajeBId,
      'p_km': km,
      'p_obs': observaciones ?? 'Permuta en el mismo vehículo (APK)',
    }, intervencionId);
    return '$res';
  }

  /// Aplica un PLAN de permutación (varias ruedas a la vez) en una sola
  /// transacción: o entra entero o no entra nada. [destinos] va indexado por
  /// POSICIÓN de destino: {posicionDestinoId: montajeId}, igual que el plan de
  /// la pantalla (una posición solo puede recibir una rueda).
  static Future<String> permutarPlan({
    required String vehiculoId,
    required Map<String, String> destinos,
    num? km,
    String? observaciones,
    String? intervencionId,
  }) async {
    final lista = destinos.entries
        .map((e) => {'montaje': e.value, 'posicion': e.key})
        .toList();
    final res = await _rpcOperacion('tc_permutar_plan', {
      'p_vehiculo': vehiculoId,
      'p_destinos': lista,
      'p_km': km,
      'p_obs': observaciones,
    }, intervencionId);
    return '$res';
  }

  /// Marcas que son de recauchutado (p. ej. INSA). El dato vive en la marca,
  /// no en el neumático: así la ficha lo enseña sin marcar rueda a rueda.
  static Set<String>? _marcasRecau;
  static Future<Set<String>> marcasRecauchutadas() async {
    if (_marcasRecau != null) return _marcasRecau!;
    try {
      final data = await _db.from('tc_cat_marcas_neumatico')
          .select('nombre').eq('es_recauchutado', true).eq('activo', true);
      _marcasRecau = (data as List)
          .map((e) => ((e as Map)['nombre'] as String? ?? '').trim().toUpperCase())
          .where((e) => e.isNotEmpty)
          .toSet();
    } catch (_) {
      _marcasRecau = <String>{}; // sin red o columna aún sin migrar
    }
    return _marcasRecau!;
  }

  static bool esMarcaRecauchutada(String? marca) {
    if (marca == null || marca.trim().isEmpty) return false;
    return (_marcasRecau ?? const <String>{}).contains(marca.trim().toUpperCase());
  }

  /// Aplica un PLAN DE TRABAJO completo (movimientos + reesculturados + giros
  /// + reparaciones) en una sola transacción.
  static Future<String> aplicarPlanTrabajo({
    required String vehiculoId,
    required List<Map<String, dynamic>> acciones,
    num? km,
    String? observaciones,
    String? intervencionId,
  }) async {
    final res = await _rpcOperacion('tc_aplicar_plan_trabajo', {
      'p_vehiculo': vehiculoId,
      'p_acciones': acciones,
      'p_km': km,
      'p_obs': observaciones,
    }, intervencionId);
    return '$res';
  }

  /// Mueve un neumático montado a una posición LIBRE del mismo vehículo
  /// (operación 'cambio_posicion'). Si el destino está ocupado, la función de
  /// BD lo rechaza: en ese caso hay que usar [intercambiarPosiciones].
  static Future<String> cambiarPosicion({
    required String montajeId,
    required String posicionDestinoId,
    num? km,
    String? observaciones,
    String? intervencionId,
  }) async {
    final res = await _rpcOperacion('tc_cambiar_posicion', {
      'p_montaje': montajeId,
      'p_posicion_destino': posicionDestinoId,
      'p_km': km,
      'p_obs': observaciones ?? 'Cambio de posición en el mismo vehículo (APK)',
    }, intervencionId);
    return '$res';
  }

  /// TODAS las operaciones de un vehículo (montajes, sustituciones, cambios de
  /// posición…), estén o no agrupadas en una intervención. Los montajes sueltos
  /// (p. ej. montar desde catálogo sin cerrar intervención) no tienen
  /// intervencion_id, así que sin esto no aparecían en ningún sitio.
  static Future<List<Map<String, dynamic>>> listarOperacionesVehiculo(String vehiculoId) async {
    final data = await _db.from('operaciones_neumaticos').select(
        'id, tipo_operacion, motivo, is_anulada, fecha_operacion, created_at, intervencion_id, observaciones, '
        'posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(codigo_posicion, nombre), '
        'posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(codigo_posicion, nombre), '
        'neumatico:tc_neumaticos(marca, modelo, medida, numero_interno)')
        .eq('vehiculo_id', vehiculoId).order('created_at', ascending: false).limit(500);
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Cierra la intervención de cambio (agrupa operaciones + informe con IA)
  /// llamando al backend. Best-effort: si falla, no bloquea el flujo.
  ///
  /// [montajeAntes] = estado del vehículo al abrir la pantalla (posición →
  /// neumático) para el plano "antes"; [incidencias] = las averías de origen.
  /// El backend calcula el estado "después" y redacta el informe con IA.
  /// Cierra la sesión de cambio y devuelve el NÚMERO DE PARTE asignado
  /// (OP-2026-000143), o null si el servidor no respondió. No lanza: el
  /// informe se puede regenerar y no debe bloquear al técnico.
  static Future<String?> cerrarIntervencion(
    String vehiculoId,
    DateTime desde, {
    List<Map<String, dynamic>>? montajeAntes,
    List<Map<String, dynamic>>? incidencias,
    String? imagenChasis,
    int? pausaSeg,
    int? nPausas,
    String? intervencionId,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$kBackendUrl/api/tyrecontrol/intervencion/cerrar'),
        headers: {
          'Content-Type': 'application/json',
          // Sesión unificada: requerido por el backend en AUTH_MODE=strict.
          if (currentSessionToken != null)
            'Authorization': 'Bearer $currentSessionToken',
        },
        body: jsonEncode({
          'vehiculoId': vehiculoId,
          'desde': desde.toUtc().toIso8601String(),
          // Fase 3: si la sesión existe en BD (tc_iniciar_intervencion), el
          // servidor CIERRA esa intervención en vez de crear otra.
          if (intervencionId != null) 'intervencionId': intervencionId,
          // Cronometraje: la sesión de cambio va de abrir la pantalla a pulsar
          // Finalizar; el servidor calcula duración y tiempo efectivo.
          'inicioAt': desde.toUtc().toIso8601String(),
          'finAt': DateTime.now().toUtc().toIso8601String(),
          if (pausaSeg != null) 'pausaSeg': pausaSeg,
          if (nPausas != null) 'nPausas': nPausas,
          if (montajeAntes != null) 'montajeAntes': montajeAntes,
          if (incidencias != null) 'incidencias': incidencias,
          if (imagenChasis != null) 'imagenChasis': imagenChasis,
        }),
      ).timeout(const Duration(seconds: 25));
      if (res.statusCode == 200) {
        final j = jsonDecode(res.body);
        if (j is Map && j['numero'] is String) return j['numero'] as String;
      }
    } catch (_) {/* el informe se puede regenerar; no bloquea */}
    return null;
  }

  /// Deshace la última operación de montaje/desmontaje del vehículo desde
  /// [desde] (sesión de cambio). Devuelve una descripción de lo deshecho.
  static Future<String> deshacerUltimaOperacion(String vehiculoId, DateTime desde) async {
    final data = await _db.rpc('tc_deshacer_ultima_operacion', params: {
      'p_vehiculo': vehiculoId,
      'p_desde': desde.toUtc().toIso8601String(),
    });
    return (data as String?) ?? 'Nada que deshacer';
  }

  /// Desmonta un neumático. [destino] = 'almacen' (vuelve como usado) |
  /// 'pendiente_reciclaje' (papelera) | 'descartado' (baja) | 'reparacion'.
  static Future<void> desmontarNeumatico({
    required String montajeId,
    String destino = 'almacen',
    num? km,
    String motivo = 'desgaste',
    String? observaciones,
    String? intervencionId,
  }) async {
    await _rpcOperacion('tc_desmontar_neumatico', {
      'p_montaje': montajeId,
      'p_km': km,
      'p_motivo': motivo,
      'p_nuevo_estado': destino,
      'p_obs': observaciones,
    }, intervencionId);
  }

  /// Catálogo configurable de tipos de incidencia (tabla tc_cat_tipos_incidencia).
  /// Devuelve filas crudas activas ordenadas; el mapeo lo hace incidencias.dart.
  static Future<List<Map<String, dynamic>>> fetchTiposIncidencia() async {
    final data = await _db
        .from('tc_cat_tipos_incidencia')
        .select('clave, etiqueta, icono, gravedad_sugerida, operacion_sugerida, orden')
        .eq('activo', true)
        .order('orden');
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Catálogo configurable de motivos "pendiente" (tabla tc_cat_motivos_pendiente).
  static Future<List<Map<String, dynamic>>> fetchMotivosPendiente() async {
    final data = await _db
        .from('tc_cat_motivos_pendiente')
        .select('clave, etiqueta, orden')
        .eq('activo', true)
        .order('orden');
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Lista de incidencias con vehículo/posición/problemas embebidos.
  /// [estados] filtra por estado (vacío = todas).
  static Future<List<Incidencia>> listarIncidencias({List<String> estados = const []}) async {
    var q = _db.from('tc_incidencias').select(
        '*, vehiculo:tc_vehiculos(matricula, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), posicion:tc_posiciones_vehiculo(nombre, codigo_posicion, eje), problemas:tc_incidencia_problemas(id, tipo, estado), revision:revisiones_vehiculo(id, fecha_revision, created_at, estado_revision, tecnico:tc_usuarios(nombre))');
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    if (estados.isNotEmpty) q = q.inFilter('estado', estados);
    final data = await q.order('detectada_at', ascending: false);
    final lista = (data as List)
        .map((e) => Incidencia.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
    return lista;
  }

  /// Incidencias de un vehículo que todavía tienen algún problema abierto.
  ///
  /// La pantalla de cambio las carga por su cuenta en vez de fiarse de quien
  /// la abre: entrando desde la ficha del vehículo nadie se las pasaba, así
  /// que se cambiaba la rueda y la incidencia se quedaba abierta para siempre.
  /// Best-effort: sin red devuelve vacío y se trabaja con las que hayan venido.
  static Future<List<Incidencia>> incidenciasAbiertasDeVehiculo(String vehiculoId) async {
    try {
      var q = _db
          .from('tc_incidencias')
          .select(
              '*, vehiculo:tc_vehiculos(matricula, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), posicion:tc_posiciones_vehiculo(nombre, codigo_posicion, eje), problemas:tc_incidencia_problemas(id, tipo, estado), revision:revisiones_vehiculo(id, fecha_revision, created_at, estado_revision, tecnico:tc_usuarios(nombre))')
          .eq('vehiculo_id', vehiculoId);
      if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
      final data = await q.order('detectada_at', ascending: false);
      return (data as List)
          .map((e) => Incidencia.fromJson(Map<String, dynamic>.from(e as Map)))
          // El estado de la incidencia no basta: manda que le quede algún
          // problema sin solucionar.
          .where((i) => i.problemas.any((p) => p.abierto))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Presión objetivo (bar) y margen para una posición, o null si no está
  /// configurada. Reusa el RPC con precedencia vehículo > tipo, eje concreto
  /// antes que "todos".
  static Future<({num presion, num margen})?> presionObjetivo(String vehiculoId, int? eje) async {
    try {
      final data = await _db.rpc('tc_presion_objetivo', params: {'p_vehiculo': vehiculoId, 'p_eje': eje});
      if (data is List && data.isNotEmpty) {
        final r = Map<String, dynamic>.from(data.first as Map);
        return (presion: r['presion'] as num, margen: (r['margen'] as num?) ?? 0.5);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Objetivos de presión por eje para un vehículo (resuelve la precedencia
  /// vehículo > tipo). Devuelve mapa eje → (presión, margen). Best-effort.
  static Future<Map<int, ({num presion, num margen})>> presionesObjetivoDeVehiculo(
      String vehiculoId, List<int> ejes) async {
    final out = <int, ({num presion, num margen})>{};
    for (final eje in ejes) {
      final o = await presionObjetivo(vehiculoId, eje);
      if (o != null) out[eje] = o;
    }
    return out;
  }

  /// Resuelve (total o parcialmente) una incidencia: marca los problemas
  /// indicados como solucionados, registra la operación y cascada el estado
  /// de la incidencia y de la revisión. Todo en una transacción en el
  /// servidor (RPC). Devuelve el nuevo estado de la incidencia.
  static Future<String> resolverIncidencia({
    required String incidenciaId,
    required List<String> problemaIds,
    required String tipoOperacion,
    Map<String, dynamic>? medicionFinal,
    String? material,
    String? resultado,
    String? observaciones,
    String? fotoUrl,
    int? tiempoSeg,
  }) async {
    final data = await _db.rpc('tc_resolver_incidencia_parcial', params: {
      'p_incidencia_id': incidenciaId,
      'p_problema_ids': problemaIds,
      'p_tipo': tipoOperacion,
      'p_medicion_final': medicionFinal,
      'p_material': material,
      'p_resultado': resultado,
      'p_observaciones': observaciones,
      'p_foto_url': fotoUrl,
      'p_tiempo_seg': tiempoSeg,
    });
    return data as String;
  }

  /// Incidencias de una revisión concreta (para resolver en caliente y
  /// recalcular el estado de la revisión al finalizar).
  static Future<List<Incidencia>> listarIncidenciasDeRevision(String revisionId) async {
    final data = await _db
        .from('tc_incidencias')
        .select(
            '*, vehiculo:tc_vehiculos(matricula, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), posicion:tc_posiciones_vehiculo(nombre, codigo_posicion, eje), problemas:tc_incidencia_problemas(id, tipo, estado), revision:revisiones_vehiculo(id, fecha_revision, created_at, estado_revision, tecnico:tc_usuarios(nombre))')
        .eq('revision_id', revisionId);
    return (data as List)
        .map((e) => Incidencia.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  /// Refresca el contador de pendientes (no solucionadas/canceladas).
  static Future<int> contarIncidenciasPendientes() async {
    try {
      var q = _db
          .from('tc_incidencias')
          .select('id')
          .not('estado', 'in', '(solucionada,cancelada,no_procede)');
      if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
      final data = await q;
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
    var q = _db
        .from('tc_vehiculos')
        .select(
            'id, matricula, numero_unidad, empresa_id, delegacion_id, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)')
        .eq('activo', true);
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    final data = await q;
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
    var q = _db
        .from('tc_vehiculos')
        .select(
            '*, empresa:tc_empresas(id, nombre), delegacion:tc_delegaciones(nombre), tipo:tc_tipos_vehiculo(*), config_ejes:tc_config_ejes(nombre, descripcion, imagen_chasis_url)');
    if (empresaActivaId != null) q = q.eq('empresa_id', empresaActivaId!);
    final data = await q.order('matricula');
    return (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  /// Un vehículo con todos los campos y joins (para la ficha de solo lectura).
  static Future<Map<String, dynamic>?> obtenerVehiculoCompleto(String id) async {
    final data = await _db
        .from('tc_vehiculos')
        .select(
            '*, empresa:tc_empresas(id, nombre), delegacion:tc_delegaciones(nombre), tipo:tc_tipos_vehiculo(*), config_ejes:tc_config_ejes(nombre, descripcion, imagen_chasis_url)')
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

  /// Última medición (profundidad/presión) por posición del vehículo, para
  /// mostrarla en el plano de la ficha. Se toma el detalle más reciente de
  /// cada posición entre las últimas revisiones.
  /// Última medición por NEUMÁTICO (no por posición): así un neumático recién
  /// montado no hereda la medición del que había antes en esa posición.
  static Future<Map<String, RevisionDetalleDraft>> ultimasMedicionesPorNeumatico(String vehiculoId) async {
    try {
      final data = await _db
          .from('revisiones_neumaticos_detalle')
          .select('neumatico_id, profundidad_mm, presion_bar, created_at')
          .eq('vehiculo_id', vehiculoId)
          .order('created_at', ascending: false)
          .limit(400);
      final out = <String, RevisionDetalleDraft>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final nid = r['neumatico_id'] as String?;
        if (nid == null || out.containsKey(nid)) continue;
        final prof = (r['profundidad_mm'] as num?)?.toDouble();
        final pres = (r['presion_bar'] as num?)?.toDouble();
        if (prof == null && pres == null) continue;
        // La fecha es la que decide si esta medición sigue valiendo o si la
        // profundidad del propio neumático es más reciente (ver
        // profundidadVigente en models.dart).
        out[nid] = RevisionDetalleDraft(
          posicionId: '', neumaticoId: nid, profundidadMm: prof, presionBar: pres,
          medidoEn: DateTime.tryParse('${r['created_at'] ?? ''}'),
        );
      }
      return out;
    } catch (_) {
      return {};
    }
  }

  static Future<Map<String, RevisionDetalleDraft>> ultimasMedicionesPorPosicion(String vehiculoId) async {
    try {
      final data = await _db
          .from('revisiones_neumaticos_detalle')
          .select('posicion_id, profundidad_mm, presion_bar, created_at')
          .eq('vehiculo_id', vehiculoId)
          .order('created_at', ascending: false)
          .limit(120);
      final out = <String, RevisionDetalleDraft>{};
      for (final e in (data as List)) {
        final r = Map<String, dynamic>.from(e as Map);
        final posId = r['posicion_id'] as String?;
        if (posId == null || out.containsKey(posId)) continue; // la más reciente gana
        final prof = (r['profundidad_mm'] as num?)?.toDouble();
        final pres = (r['presion_bar'] as num?)?.toDouble();
        if (prof == null && pres == null) continue;
        out[posId] = RevisionDetalleDraft(
          posicionId: posId,
          profundidadMm: prof,
          presionBar: pres,
        );
      }
      return out;
    } catch (_) {
      return {};
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
