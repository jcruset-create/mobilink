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

String problemaLabel(String key) =>
    kProblemasTipos.firstWhere((p) => p.key == key,
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

// ── Motivos rápidos para "dejar pendiente" ───────────────────
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

/// Una incidencia leída del servidor (para el menú "Incidencias").
class Incidencia {
  final String id;
  final String vehiculoId;
  final String? posicionId;
  final String? matricula;
  final String? cliente;
  final String? base;
  final String? posicionNombre;
  final Gravedad gravedad;
  final String estado;
  final String detectadaAt;
  final String? fotoUrl;
  final String? motivoPendiente;
  final List<String> tipos; // problemas abiertos

  Incidencia({
    required this.id,
    required this.vehiculoId,
    required this.posicionId,
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
  });

  factory Incidencia.fromJson(Map<String, dynamic> j) {
    final v = j['vehiculo'];
    final pos = j['posicion'];
    final problemas = (j['problemas'] as List?) ?? const [];
    return Incidencia(
      id: j['id'] as String,
      vehiculoId: j['vehiculo_id'] as String,
      posicionId: j['posicion_id'] as String?,
      matricula: v is Map ? v['matricula'] as String? : null,
      cliente: v is Map && v['empresa'] is Map ? v['empresa']['nombre'] as String? : null,
      base: v is Map && v['delegacion'] is Map ? v['delegacion']['nombre'] as String? : null,
      posicionNombre: pos is Map ? (pos['nombre'] as String?) ?? (pos['codigo_posicion'] as String?) : null,
      gravedad: gravedadFrom(j['gravedad'] as String?),
      estado: (j['estado'] as String?) ?? 'detectada',
      detectadaAt: (j['detectada_at'] as String?) ?? '',
      fotoUrl: j['foto_url'] as String?,
      motivoPendiente: j['motivo_pendiente'] as String?,
      tipos: problemas
          .map((p) => (p as Map)['tipo'] as String?)
          .whereType<String>()
          .toList(),
    );
  }

  int get diasPendiente {
    final d = DateTime.tryParse(detectadaAt);
    if (d == null) return 0;
    return DateTime.now().difference(d).inDays;
  }
}
