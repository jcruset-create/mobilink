import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Catálogo y modelos de las incidencias de neumático (Fase 1).
/// Los `tipo`/`gravedad`/`estado`/`motivo` son los mismos strings que la
/// migración tyrecontrol_fase34_incidencias.sql (los CHECK del servidor).

// ── Tipos de problema (incidencias rápidas) ──────────────────
class ProblemaTipo {
  final String key;
  final String label;
  final IconData icon;
  const ProblemaTipo(this.key, this.label, this.icon);
}

/// Semilla de fábrica (fallback offline antes de cargar el catálogo del
/// servidor). En cuanto la APK lee `tc_cat_tipos_incidencia`, `problemasTipos`
/// se sustituye por lo configurado en el panel de administración.
const kProblemasTipos = <ProblemaTipo>[
  ProblemaTipo('profundidad_baja', 'Profundidad baja', Icons.straighten),
  ProblemaTipo('presion_baja', 'Presión baja', Icons.south),
  ProblemaTipo('presion_alta', 'Presión alta', Icons.north),
  ProblemaTipo('pinchazo', 'Pinchazo / pérdida de aire', Icons.tire_repair),
  ProblemaTipo('objeto_clavado', 'Objeto clavado', Icons.push_pin),
  ProblemaTipo('desgaste_irregular', 'Desgaste irregular', Icons.blur_linear),
  ProblemaTipo('desgaste_interior', 'Desgaste interior', Icons.align_horizontal_left),
  ProblemaTipo('desgaste_exterior', 'Desgaste exterior', Icons.align_horizontal_right),
  ProblemaTipo('diferencia_gemelos', 'Diferencia entre gemelos', Icons.compare_arrows),
  ProblemaTipo('corte_grieta', 'Corte o grieta', Icons.content_cut),
  ProblemaTipo('dano_flanco', 'Daño en flanco', Icons.report_gmailerrorred),
  ProblemaTipo('deformacion', 'Deformación', Icons.change_history),
  ProblemaTipo('valvula_danada', 'Válvula dañada', Icons.air),
  ProblemaTipo('no_coincide_ficha', 'No coincide con la ficha', Icons.rule),
  ProblemaTipo('cambiado_posicion', 'Cambiado de posición', Icons.swap_horiz),
  ProblemaTipo('no_identificado', 'No identificado', Icons.help_outline),
  ProblemaTipo('necesita_sustitucion', 'Necesita sustitución', Icons.autorenew),
  ProblemaTipo('necesita_reparacion', 'Necesita reparación', Icons.build),
  ProblemaTipo('necesita_equilibrado', 'Necesita equilibrado', Icons.balance),
  ProblemaTipo('necesita_alineacion', 'Necesita alineación', Icons.linear_scale),
  ProblemaTipo('otra', 'Otra incidencia', Icons.more_horiz),
];

/// Lista efectiva de tipos (chips en la revisión). Empieza con la semilla y se
/// sustituye al cargar el catálogo configurable del servidor.
List<ProblemaTipo> problemasTipos = List<ProblemaTipo>.of(kProblemasTipos);

// Overrides cargados del catálogo (vacío = usar la lógica por defecto de abajo).
Map<String, Gravedad> _gravedadPorTipo = {};
Map<String, String> _operacionPorTipo = {};

/// Aplica el catálogo `tc_cat_tipos_incidencia` (filas ya filtradas por activo,
/// ordenadas por `orden`). Tolera campos ausentes.
void aplicarCatalogoDesdeJson(List<Map<String, dynamic>> filas) {
  final tipos = <ProblemaTipo>[];
  final grav = <String, Gravedad>{};
  final oper = <String, String>{};
  for (final f in filas) {
    final clave = (f['clave'] as String?)?.trim();
    if (clave == null || clave.isEmpty) continue;
    tipos.add(ProblemaTipo(
      clave,
      (f['etiqueta'] as String?)?.trim().isNotEmpty == true ? f['etiqueta'] as String : clave,
      iconoIncidenciaPorNombre(f['icono'] as String?),
    ));
    grav[clave] = gravedadFrom(f['gravedad_sugerida'] as String?);
    final op = (f['operacion_sugerida'] as String?)?.trim();
    if (op != null && op.isNotEmpty) oper[clave] = op;
  }
  if (tipos.isEmpty) return; // catálogo vacío o ilegible: conservamos lo actual
  problemasTipos = tipos;
  _gravedadPorTipo = grav;
  _operacionPorTipo = oper;
}

/// Traduce el nombre de icono (compartido con la web) a un icono de Material.
IconData iconoIncidenciaPorNombre(String? nombre) {
  switch (nombre) {
    case 'straighten': return Icons.straighten;
    case 'south': return Icons.south;
    case 'north': return Icons.north;
    case 'tire_repair': return Icons.tire_repair;
    case 'push_pin': return Icons.push_pin;
    case 'blur_linear': return Icons.blur_linear;
    case 'align_horizontal_left': return Icons.align_horizontal_left;
    case 'align_horizontal_right': return Icons.align_horizontal_right;
    case 'compare_arrows': return Icons.compare_arrows;
    case 'content_cut': return Icons.content_cut;
    case 'report_gmailerrorred': return Icons.report_gmailerrorred;
    case 'change_history': return Icons.change_history;
    case 'air': return Icons.air;
    case 'rule': return Icons.rule;
    case 'swap_horiz': return Icons.swap_horiz;
    case 'help_outline': return Icons.help_outline;
    case 'autorenew': return Icons.autorenew;
    case 'build': return Icons.build;
    case 'balance': return Icons.balance;
    case 'linear_scale': return Icons.linear_scale;
    case 'more_horiz': return Icons.more_horiz;
    case 'gauge': return Icons.speed;
    case 'thermometer': return Icons.thermostat;
    case 'droplet': return Icons.water_drop;
    case 'snowflake': return Icons.ac_unit;
    case 'flame': return Icons.local_fire_department;
    case 'settings': return Icons.settings;
    default: return Icons.help_outline;
  }
}

String problemaLabel(String key) =>
    problemasTipos.firstWhere((p) => p.key == key,
        orElse: () => ProblemaTipo(key, key, Icons.help_outline)).label;

// ── Gravedad ─────────────────────────────────────────────────
enum Gravedad { leve, importante, critica }

String gravedadKey(Gravedad g) => switch (g) {
      Gravedad.leve => 'leve',
      Gravedad.importante => 'importante',
      Gravedad.critica => 'critica',
    };

Gravedad gravedadFrom(String? k) => switch (k) {
      'critica' => Gravedad.critica,
      'importante' => Gravedad.importante,
      _ => Gravedad.leve,
    };

String gravedadLabel(Gravedad g) => switch (g) {
      Gravedad.leve => 'Leve',
      Gravedad.importante => 'Importante',
      Gravedad.critica => 'Crítica',
    };

Color gravedadColor(Gravedad g) => switch (g) {
      Gravedad.leve => AppColors.warning,      // amarillo/ámbar
      Gravedad.importante => const Color(0xFFF97316), // naranja
      Gravedad.critica => AppColors.danger,    // rojo
    };

/// Gravedad propuesta automáticamente (Fase 1: sobre profundidad + tipo de
/// problema + estado visual; la presión la marca el técnico, no autodetecta).
/// El técnico puede modificarla después.
Gravedad gravedadAuto({
  required Set<String> tipos,
  double? profundidadMm,
  double profCriticaMm = 1.6,
  double profAvisoMm = 3.0,
}) {
  // Si hay catálogo cargado, la gravedad de cada tipo la define el panel.
  if (_gravedadPorTipo.isNotEmpty) {
    var peor = Gravedad.leve;
    for (final t in tipos) {
      final g = _gravedadPorTipo[t];
      if (g != null && g.index > peor.index) peor = g;
    }
    if (profundidadMm != null && profundidadMm <= profCriticaMm) return Gravedad.critica;
    if (peor == Gravedad.critica) return Gravedad.critica;
    if (profundidadMm != null && profundidadMm <= profAvisoMm) return Gravedad.importante;
    if (peor == Gravedad.importante) return Gravedad.importante;
    return Gravedad.leve;
  }

  const criticos = {
    'dano_flanco', 'deformacion', 'no_coincide_ficha', 'necesita_sustitucion',
  };
  const importantes = {
    'necesita_reparacion', 'valvula_danada', 'corte_grieta', 'pinchazo',
    'objeto_clavado', 'desgaste_irregular', 'necesita_alineacion',
    'necesita_equilibrado',
  };

  if (profundidadMm != null && profundidadMm <= profCriticaMm) return Gravedad.critica;
  if (tipos.any(criticos.contains)) return Gravedad.critica;

  if (profundidadMm != null && profundidadMm <= profAvisoMm) return Gravedad.importante;
  if (tipos.any(importantes.contains)) return Gravedad.importante;

  return Gravedad.leve;
}

// ── Estado de la incidencia ──────────────────────────────────
const kEstadoIncidenciaLabels = {
  'detectada': 'Detectada',
  'pendiente_autorizacion': 'Pendiente de autorización',
  'autorizada': 'Autorizada',
  'planificada': 'Planificada',
  'pendiente_material': 'Pendiente de material',
  'pendiente_vehiculo': 'Pendiente de vehículo',
  'en_curso': 'En curso',
  'solucionada': 'Solucionada',
  'cancelada': 'Cancelada',
  'no_procede': 'No procede',
};

// ── Operaciones de resolución (Fase 2) ───────────────────────
class OperacionTipo {
  final String key;
  final String label;
  final IconData icon;
  /// false → cambia el neumático montado; llega en el siguiente incremento.
  final bool disponible;
  const OperacionTipo(this.key, this.label, this.icon, {this.disponible = true});
}

const kOperaciones = <OperacionTipo>[
  OperacionTipo('corregir_presion', 'Corregir presión', Icons.speed),
  OperacionTipo('reparar_pinchazo', 'Reparar pinchazo', Icons.tire_repair),
  OperacionTipo('cambiar_valvula', 'Cambiar válvula', Icons.air),
  OperacionTipo('equilibrar', 'Equilibrar', Icons.balance),
  OperacionTipo('solicitar_alineacion', 'Solicitar alineación', Icons.linear_scale),
  OperacionTipo('reapretar', 'Reapretar rueda', Icons.build_circle),
  OperacionTipo('actualizar_neumatico', 'Actualizar neumático instalado', Icons.rule),
  OperacionTipo('sustituir_neumatico', 'Sustituir neumático', Icons.autorenew, disponible: false),
  OperacionTipo('cambiar_posicion', 'Cambiar posición', Icons.swap_vert, disponible: false),
  OperacionTipo('intercambiar', 'Intercambiar neumáticos', Icons.swap_horiz, disponible: false),
  OperacionTipo('otra', 'Otra operación', Icons.more_horiz),
];

OperacionTipo operacionPorKey(String key) => kOperaciones.firstWhere(
    (o) => o.key == key,
    orElse: () => OperacionTipo(key, key, Icons.build));

/// Operaciones sugeridas para un conjunto de problemas (las más relevantes
/// primero; el técnico puede elegir cualquiera del catálogo).
List<String> operacionesSugeridas(Set<String> tipos) {
  final orden = <String>[];
  void add(String k) {
    if (!orden.contains(k)) orden.add(k);
  }
  // Operación configurada en el catálogo (prioritaria).
  for (final t in tipos) {
    final o = _operacionPorTipo[t];
    if (o != null && o.isNotEmpty) add(o);
  }
  for (final t in tipos) {
    switch (t) {
      case 'presion_baja':
      case 'presion_alta':
        add('corregir_presion');
      case 'pinchazo':
      case 'objeto_clavado':
        add('reparar_pinchazo');
      case 'valvula_danada':
        add('cambiar_valvula');
      case 'diferencia_gemelos':
      case 'necesita_equilibrado':
        add('equilibrar');
      case 'necesita_alineacion':
      case 'desgaste_irregular':
      case 'desgaste_interior':
      case 'desgaste_exterior':
        add('solicitar_alineacion');
      case 'corte_grieta':
      case 'necesita_reparacion':
        add('reparar_pinchazo');
      case 'profundidad_baja':
      case 'necesita_sustitucion':
      case 'dano_flanco':
      case 'deformacion':
        add('sustituir_neumatico');
      case 'no_coincide_ficha':
      case 'cambiado_posicion':
      case 'no_identificado':
        add('actualizar_neumatico');
    }
  }
  return orden;
}

// ── Motivos rápidos para "dejar pendiente" ───────────────────
/// Semilla de fábrica (fallback offline). Se sustituye por lo configurado en
/// el panel (tabla tc_cat_motivos_pendiente) en cuanto la APK la lee.
const kMotivosPendiente = <MapEntry<String, String>>[
  MapEntry('falta_autorizacion', 'Falta autorización del cliente'),
  MapEntry('falta_neumatico', 'Falta neumático'),
  MapEntry('falta_material', 'Falta material'),
  MapEntry('no_hay_tiempo', 'No hay tiempo'),
  MapEntry('vehiculo_debe_salir', 'El vehículo debe salir'),
  MapEntry('requiere_taller', 'Reparación requiere taller'),
  MapEntry('pendiente_presupuesto', 'Pendiente de presupuesto'),
  MapEntry('pendiente_unidad_movil', 'Pendiente de unidad móvil'),
  MapEntry('no_accesible', 'No se puede acceder correctamente'),
  MapEntry('otro', 'Otro motivo'),
];

/// Lista efectiva de motivos (chips en "dejar pendiente"). Empieza con la
/// semilla y se sustituye al cargar el catálogo del servidor.
List<MapEntry<String, String>> motivosPendiente = List<MapEntry<String, String>>.of(kMotivosPendiente);

/// Aplica el catálogo `tc_cat_motivos_pendiente` (filas activas, ordenadas).
void aplicarMotivosDesdeJson(List<Map<String, dynamic>> filas) {
  final out = <MapEntry<String, String>>[];
  for (final f in filas) {
    final clave = (f['clave'] as String?)?.trim();
    if (clave == null || clave.isEmpty) continue;
    final et = (f['etiqueta'] as String?)?.trim();
    out.add(MapEntry(clave, et != null && et.isNotEmpty ? et : clave));
  }
  if (out.isNotEmpty) motivosPendiente = out;
}

/// Un problema concreto dentro de una incidencia (con su id para resolver).
class ProblemaInc {
  final String id;
  final String tipo;
  final String estado; // abierto | solucionado
  ProblemaInc({required this.id, required this.tipo, required this.estado});
  bool get abierto => estado != 'solucionado';
}

/// Una incidencia leída del servidor (para el menú "Incidencias").
class Incidencia {
  final String id;
  final String vehiculoId;
  final String? posicionId;
  final int? posicionEje;
  final String? matricula;
  final String? cliente;
  final String? base;
  final String? posicionNombre;
  final Gravedad gravedad;
  final String estado;
  final String detectadaAt;
  final String? fotoUrl;
  final String? motivoPendiente;
  final String? accionRecomendada;
  final List<String> tipos; // tipos de los problemas abiertos (para mostrar)
  final List<ProblemaInc> problemas; // todos, con id (para resolver)

  // Revisión de origen (para agrupar: una tarjeta por revisión).
  final String? revisionId;
  final String? revisionFecha; // fecha_revision (yyyy-MM-dd)
  final String? revisionCreatedAt; // hora real de la revisión
  final String? revisionEstado;
  final String? tecnicoNombre;

  Incidencia({
    required this.id,
    required this.vehiculoId,
    required this.posicionId,
    this.posicionEje,
    required this.matricula,
    required this.cliente,
    required this.base,
    required this.posicionNombre,
    required this.gravedad,
    required this.estado,
    required this.detectadaAt,
    required this.fotoUrl,
    required this.motivoPendiente,
    required this.tipos,
    this.problemas = const [],
    this.accionRecomendada,
    this.revisionId,
    this.revisionFecha,
    this.revisionCreatedAt,
    this.revisionEstado,
    this.tecnicoNombre,
  });

  factory Incidencia.fromJson(Map<String, dynamic> j) {
    final v = j['vehiculo'];
    final pos = j['posicion'];
    final rev = j['revision'];
    final tec = rev is Map ? rev['tecnico'] : null;
    final problemasRaw = (j['problemas'] as List?) ?? const [];
    final problemas = problemasRaw
        .map((p) => Map<String, dynamic>.from(p as Map))
        .where((p) => p['id'] != null)
        .map((p) => ProblemaInc(
              id: p['id'] as String,
              tipo: (p['tipo'] as String?) ?? 'otra',
              estado: (p['estado'] as String?) ?? 'abierto',
            ))
        .toList();
    return Incidencia(
      id: j['id'] as String,
      vehiculoId: j['vehiculo_id'] as String,
      posicionId: j['posicion_id'] as String?,
      posicionEje: pos is Map ? (pos['eje'] as num?)?.toInt() : null,
      matricula: v is Map ? v['matricula'] as String? : null,
      cliente: v is Map && v['empresa'] is Map ? v['empresa']['nombre'] as String? : null,
      base: v is Map && v['delegacion'] is Map ? v['delegacion']['nombre'] as String? : null,
      posicionNombre: pos is Map ? (pos['nombre'] as String?) ?? (pos['codigo_posicion'] as String?) : null,
      gravedad: gravedadFrom(j['gravedad'] as String?),
      estado: (j['estado'] as String?) ?? 'detectada',
      detectadaAt: (j['detectada_at'] as String?) ?? '',
      fotoUrl: j['foto_url'] as String?,
      motivoPendiente: j['motivo_pendiente'] as String?,
      accionRecomendada: j['accion_recomendada'] as String?,
      tipos: problemas.where((p) => p.abierto).map((p) => p.tipo).toList(),
      problemas: problemas,
      revisionId: j['revision_id'] as String?,
      revisionFecha: rev is Map ? rev['fecha_revision'] as String? : null,
      revisionCreatedAt: rev is Map ? rev['created_at'] as String? : null,
      revisionEstado: rev is Map ? rev['estado_revision'] as String? : null,
      tecnicoNombre: tec is Map ? tec['nombre'] as String? : null,
    );
  }

  int get diasPendiente {
    final d = DateTime.tryParse(detectadaAt);
    if (d == null) return 0;
    return DateTime.now().difference(d).inDays;
  }

  /// "Hoy", "1 día", "N días" — desde la detección de la incidencia.
  String get diasTexto {
    final n = diasPendiente;
    if (n <= 0) return 'Hoy';
    return n == 1 ? '1 día' : '$n días';
  }

  /// Posición legible; las incidencias sin posición son generales.
  String get posicionTexto => posicionNombre ?? 'Incidencia general del vehículo';
}
