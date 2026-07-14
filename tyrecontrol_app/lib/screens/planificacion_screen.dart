import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Planificación de revisiones — versión móvil del operador.
///
/// Replica la pantalla del panel web (misma fuente de datos: el RPC
/// `tc_plan_estado` + los planes y vehículos), en formato lista/tarjeta
/// pensado para el móvil. No incluye las acciones de escritorio (Excel,
/// plantillas, selección masiva, calendario), que no aplican aquí.
class PlanificacionScreen extends StatefulWidget {
  final bool embedded;
  const PlanificacionScreen({super.key, this.embedded = false});

  @override
  State<PlanificacionScreen> createState() => _PlanificacionScreenState();
}

enum _Tab { pendientes, hoy, semana, atrasadas, todas }

class _PlanFila {
  final String matricula;
  final String cliente;
  final String base;
  final String revision;
  final String? ultimaFecha;
  final String? proximaFecha;
  final num? proximaKm;
  final int? diasRestantes;
  final String estado;
  final String prioridad;
  final String vehiculoId;

  _PlanFila({
    required this.matricula,
    required this.cliente,
    required this.base,
    required this.revision,
    required this.ultimaFecha,
    required this.proximaFecha,
    required this.proximaKm,
    required this.diasRestantes,
    required this.estado,
    required this.prioridad,
    required this.vehiculoId,
  });
}

class _PlanificacionScreenState extends State<PlanificacionScreen> {
  bool _loading = true;
  String? _error;
  List<_PlanFila> _filas = [];
  _Tab _tab = _Tab.pendientes;
  String _q = '';

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        TyreControlApi.listarPlanesMantenimiento(),
        TyreControlApi.listarPlanEstado(),
        TyreControlApi.listarVehiculosPlanificacion(),
      ]);
      final planes = results[0];
      final estados = {for (final e in results[1]) e['plan_id'] as String: e};
      final vehiculos = {for (final v in results[2]) v['id'] as String: v};

      final filas = <_PlanFila>[];
      for (final p in planes) {
        final est = estados[p['id']];
        final v = vehiculos[p['vehiculo_id']];
        if (est == null || v == null) continue;
        final op = p['operacion'];
        filas.add(_PlanFila(
          matricula: (v['matricula'] as String?) ?? '—',
          cliente: _nombre(v['empresa']) ?? '—',
          base: _nombre(v['delegacion']) ?? '—',
          revision: (p['nombre'] as String?)?.isNotEmpty == true
              ? p['nombre'] as String
              : (_nombre(op) ?? 'Revisión'),
          ultimaFecha: p['ultima_fecha'] as String?,
          proximaFecha: est['proxima_fecha_efec'] as String?,
          proximaKm: est['proxima_km_efec'] as num?,
          diasRestantes: (est['dias_restantes'] as num?)?.toInt(),
          estado: (est['estado'] as String?) ?? 'correcta',
          prioridad: (est['prioridad'] as String?) ?? 'sin',
          vehiculoId: v['id'] as String,
        ));
      }
      filas.sort((a, b) =>
          (a.diasRestantes ?? 9999).compareTo(b.diasRestantes ?? 9999));
      if (!mounted) return;
      setState(() => _filas = filas);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  static String? _nombre(dynamic rel) =>
      rel is Map ? rel['nombre'] as String? : null;

  bool _esPendiente(String e) =>
      e == 'proxima' || e == 'vence_hoy' || e == 'atrasada';

  List<_PlanFila> get _visibles {
    final s = _q.trim().toLowerCase();
    return _filas.where((f) {
      final e = f.estado, dr = f.diasRestantes;
      switch (_tab) {
        case _Tab.pendientes:
          if (!_esPendiente(e)) return false;
          break;
        case _Tab.hoy:
          if (e != 'vence_hoy') return false;
          break;
        case _Tab.semana:
          if (!(dr != null && dr >= 0 && dr <= 7)) return false;
          break;
        case _Tab.atrasadas:
          if (e != 'atrasada') return false;
          break;
        case _Tab.todas:
          break;
      }
      if (s.isNotEmpty &&
          !f.matricula.toLowerCase().contains(s) &&
          !f.cliente.toLowerCase().contains(s)) {
        return false;
      }
      return true;
    }).toList();
  }

  _Kpis get _kpis {
    final veh = <String>{};
    int pend = 0, hoy = 0, semana = 0, atras = 0;
    for (final f in _filas) {
      veh.add(f.vehiculoId);
      final e = f.estado, dr = f.diasRestantes;
      if (_esPendiente(e)) pend++;
      if (e == 'vence_hoy') hoy++;
      if (dr != null && dr >= 0 && dr <= 7) semana++;
      if (e == 'atrasada') atras++;
    }
    final total = _filas.length;
    final cumpl = total > 0 ? (((total - atras) / total) * 100).round() : 100;
    return _Kpis(
        controlados: veh.length,
        pendientes: pend,
        hoy: hoy,
        semana: semana,
        atrasadas: atras,
        cumplimiento: cumpl);
  }

  @override
  Widget build(BuildContext context) {
    final content = Column(
      children: [
        if (!_loading && _error == null) _cabecera(),
        Expanded(child: _cuerpo()),
      ],
    );
    if (widget.embedded) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Planificación de revisiones')),
      body: content,
    );
  }

  Widget _cabecera() {
    final k = _kpis;
    return Column(
      children: [
        SizedBox(
          height: 74,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
            children: [
              _kpiChip('Controlados', '${k.controlados}', AppColors.info),
              _kpiChip('Pendientes', '${k.pendientes}', AppColors.warning),
              _kpiChip('Hoy', '${k.hoy}', const Color(0xFFF97316)),
              _kpiChip('Esta semana', '${k.semana}', AppColors.primary),
              _kpiChip('Atrasadas', '${k.atrasadas}', AppColors.danger),
              _kpiChip('Cumplimiento', '${k.cumplimiento}%', AppColors.success),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
          child: TextField(
            onChanged: (v) => setState(() => _q = v),
            decoration: const InputDecoration(
              hintText: 'Buscar matrícula o cliente',
              prefixIcon: Icon(Icons.search),
              isDense: true,
            ),
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              _tabChip('Pendientes', _Tab.pendientes),
              _tabChip('Hoy', _Tab.hoy),
              _tabChip('Esta semana', _Tab.semana),
              _tabChip('Atrasadas', _Tab.atrasadas),
              _tabChip('Todas', _Tab.todas),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kpiChip(String label, String value, Color color) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value,
              style: TextStyle(
                  color: color, fontSize: 20, fontWeight: FontWeight.w800)),
          Text(label,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 11)),
        ],
      ),
    );
  }

  Widget _tabChip(String label, _Tab tab) {
    final sel = _tab == tab;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: sel,
        onSelected: (_) => setState(() => _tab = tab),
        showCheckmark: false,
        labelStyle: TextStyle(
          color: sel ? AppColors.onPrimary : AppColors.textSecondary,
          fontWeight: FontWeight.w600,
          fontSize: 13,
        ),
        selectedColor: AppColors.primary,
        backgroundColor: AppColors.surface,
        side: const BorderSide(color: AppColors.cardBorder),
      ),
    );
  }

  Widget _cuerpo() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(
          children: [
            const SizedBox(height: 80),
            const Icon(Icons.cloud_off, size: 48, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            const Center(
              child: Text('No se pudo cargar la planificación',
                  style: TextStyle(color: AppColors.textSecondary)),
            ),
            const SizedBox(height: 6),
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(_error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: AppColors.textHint, fontSize: 12)),
              ),
            ),
          ],
        ),
      );
    }
    final visibles = _visibles;
    return RefreshIndicator(
      onRefresh: _cargar,
      child: visibles.isEmpty
          ? ListView(
              children: const [
                SizedBox(height: 100),
                Icon(Icons.event_available,
                    size: 48, color: AppColors.textSecondary),
                SizedBox(height: 12),
                Center(
                  child: Text('Sin revisiones en esta pestaña',
                      style: TextStyle(color: AppColors.textSecondary)),
                ),
              ],
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
              itemCount: visibles.length,
              itemBuilder: (_, i) => _fila(visibles[i]),
            ),
    );
  }

  Widget _fila(_PlanFila f) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(f.matricula,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 17)),
                ),
                _EstadoBadge(estado: f.estado),
              ],
            ),
            const SizedBox(height: 2),
            Text('${f.cliente} · ${f.base}',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 2),
            Text(f.revision,
                style: const TextStyle(
                    color: AppColors.textPrimary, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 14,
              runSpacing: 4,
              children: [
                _campo('Última', _fecha(f.ultimaFecha)),
                _campo('Próxima', _fecha(f.proximaFecha) + _km(f.proximaKm)),
                _campo('Días', _diasTexto(f.diasRestantes),
                    color: _colorDias(f.diasRestantes)),
                _campo('Prioridad', _prioridadLabel(f.prioridad)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _campo(String label, String value, {Color? color}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: AppColors.textHint, fontSize: 10)),
        Text(value,
            style: TextStyle(
                color: color ?? AppColors.textPrimary,
                fontSize: 13,
                fontWeight: FontWeight.w600)),
      ],
    );
  }

  // ── Formato ──────────────────────────────────────────────────
  static String _fecha(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return '—';
    return '${d.day}/${d.month}/${d.year}';
  }

  static String _km(num? km) => km == null ? '' : ' · ${km.round()} km';

  static String _diasTexto(int? d) {
    if (d == null) return '—';
    if (d < 0) return '${d.abs()} d retraso';
    if (d == 0) return 'hoy';
    return '$d d';
  }

  static Color? _colorDias(int? d) {
    if (d == null) return null;
    if (d < 0) return AppColors.danger;
    if (d == 0) return const Color(0xFFF97316);
    if (d <= 7) return AppColors.warning;
    return null;
  }

  static String _prioridadLabel(String p) {
    switch (p) {
      case 'critica':
        return 'Crítica';
      case 'alta':
        return 'Alta';
      case 'media':
        return 'Media';
      case 'baja':
        return 'Baja';
      default:
        return '—';
    }
  }
}

class _Kpis {
  final int controlados, pendientes, hoy, semana, atrasadas, cumplimiento;
  _Kpis({
    required this.controlados,
    required this.pendientes,
    required this.hoy,
    required this.semana,
    required this.atrasadas,
    required this.cumplimiento,
  });
}

class _EstadoBadge extends StatelessWidget {
  final String estado;
  const _EstadoBadge({required this.estado});

  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = _meta(estado);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 11, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  static (String, Color, IconData) _meta(String e) {
    switch (e) {
      case 'correcta':
        return ('Correcta', AppColors.success, Icons.check_circle);
      case 'proxima':
        return ('Próxima', AppColors.warning, Icons.schedule);
      case 'vence_hoy':
        return ('Vence hoy', const Color(0xFFF97316), Icons.today);
      case 'atrasada':
        return ('Atrasada', AppColors.danger, Icons.error);
      case 'planificada':
        return ('Planificada', AppColors.primary, Icons.event);
      case 'en_curso':
        return ('En curso', AppColors.info, Icons.build);
      case 'realizada':
        return ('Realizada', AppColors.success, Icons.task_alt);
      case 'cancelada':
        return ('Cancelada', AppColors.textSecondary, Icons.block);
      case 'no_aplicable':
        return ('No aplicable', AppColors.textSecondary, Icons.remove_circle);
      case 'vehiculo_no_disponible':
        return ('No disponible', AppColors.textSecondary, Icons.no_transfer);
      default:
        return (e, AppColors.textSecondary, Icons.help_outline);
    }
  }
}
