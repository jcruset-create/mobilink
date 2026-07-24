import 'package:supabase_flutter/supabase_flutter.dart';

/// Envoltorio de RPCs (migración 007) y consultas directas a Supabase.
class ApiService {
  static SupabaseClient get _db => Supabase.instance.client;

  // ---------- Login ----------
  /// Devuelve {id, nombre, rol} o null si las credenciales no valen.
  static Future<Map<String, dynamic>?> login(String codigo, String pin) async {
    final rows = await _db.rpc('tc_operator_login',
        params: {'p_codigo': codigo, 'p_pin': pin}) as List<dynamic>;
    if (rows.isEmpty) return null;
    return Map<String, dynamic>.from(rows.first as Map);
  }

  // ---------- Herramientas ----------
  static const _toolSelect =
      'id, codigo, nombre, marca, modelo, estado, foto_url, descripcion, '
      'ubicacion_actual_id, ubicacion:tc_locations!tc_tools_ubicacion_actual_id_fkey(nombre), '
      'categoria:tc_categories(nombre)';

  static Future<Map<String, dynamic>?> getTool(String id) async {
    final row = await _db
        .from('tc_tools')
        .select(_toolSelect)
        .eq('id', id)
        .maybeSingle();
    return row;
  }

  static Future<Map<String, dynamic>?> getMachine(String id) async {
    final row = await _db
        .from('tc_machines')
        .select('id, codigo, nombre, marca, modelo, estado, foto_url, '
            'descripcion, ubicacion:tc_locations(nombre), '
            'categoria:tc_categories(nombre)')
        .eq('id', id)
        .maybeSingle();
    return row;
  }

  static Future<List<Map<String, dynamic>>> searchTools(String query) async {
    final q = query.trim();
    var req = _db.from('tc_tools').select(_toolSelect).eq('activa', true);
    if (q.isNotEmpty) {
      req = req.or('codigo.ilike.%$q%,nombre.ilike.%$q%');
    }
    final rows = await req.order('codigo').limit(50);
    return List<Map<String, dynamic>>.from(rows);
  }

  static Future<List<Map<String, dynamic>>> misHerramientas(
      String employeeId) async {
    final rows = await _db.rpc('tc_op_mis_herramientas',
        params: {'p_employee': employeeId}) as List<dynamic>;
    return rows.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<List<Map<String, dynamic>>> getLocations() async {
    final rows = await _db
        .from('tc_locations')
        .select('id, nombre')
        .eq('activa', true)
        .order('nombre');
    return List<Map<String, dynamic>>.from(rows);
  }

  // ---------- Acciones (RPCs jsonb {ok, error}) ----------
  static Future<String?> _accion(String fn, Map<String, dynamic> params) async {
    final res = await Supabase.instance.client.rpc(fn, params: params);
    final map = Map<String, dynamic>.from(res as Map);
    if (map['ok'] == true) return null;
    return (map['error'] as String?) ?? 'Error desconocido';
  }

  /// Devuelven null si todo fue bien; mensaje de error en caso contrario.
  static Future<String?> usarTool(String toolId, String employeeId) =>
      _accion('tc_op_usar_tool', {'p_tool': toolId, 'p_employee': employeeId});

  static Future<String?> devolverTool(
          String toolId, String employeeId, String? ubicacionId) =>
      _accion('tc_op_devolver_tool', {
        'p_tool': toolId,
        'p_employee': employeeId,
        'p_ubicacion': ubicacionId,
      });

  static Future<String?> moverTool(
          String toolId, String employeeId, String ubicacionId) =>
      _accion('tc_op_mover_tool', {
        'p_tool': toolId,
        'p_employee': employeeId,
        'p_ubicacion': ubicacionId,
      });

  static Future<String?> reportarIncidencia({
    String? toolId,
    String? machineId,
    required String employeeId,
    required String descripcion,
    required String gravedad,
  }) =>
      _accion('tc_op_reportar_incidencia', {
        'p_tool': toolId,
        'p_employee': employeeId,
        'p_descripcion': descripcion,
        'p_gravedad': gravedad,
        'p_machine': machineId,
      });
}
