import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Planificación de revisiones — réplica de la pantalla del panel web.
///
/// Misma fuente de datos (RPC `tc_plan_estado` + planes + vehículos), mismos
/// campos y el mismo layout de tabla: todo en una línea, con scroll horizontal.
/// Las acciones de escritorio (Excel, Plantillas, Registrar, Ficha y las vistas
/// Por cliente / Por base / Calendario / Indicadores) se muestran igual pero se
/// resuelven en el panel web (aviso al pulsarlas).
class PlanificacionScreen extends StatefulWidget {
  final bool embedded;
  const PlanificacionScreen({super.key, this.embedded = false});

  @override
  State<PlanificacionScreen> createState() => _PlanificacionScreenState();
}

enum _Tab {
  pendientes,
  hoy,
  semana,
  atrasadas,
  realizadas,
  porCliente,
  porBase,
  calendario,
  indicadores,
}

const _tabLabels = {
  _Tab.pendientes: 'Pendientes',
  _Tab.hoy: 'Hoy',
  _Tab.semana: 'Esta semana',
  _Tab.atrasadas: 'Atrasadas',
  _Tab.realizadas: 'Realizadas',
  _Tab.porCliente: 'Por cliente',
  _Tab.porBase: 'Por base',
  _Tab.calendario: 'Calendario',
  _Tab.indicadores: 'Indicadores',
};

// Estados con etiqueta (mismos que el panel web).
const _estadoLabels = {
  'correcta': 'Correcta',
  'proxima': 'Próxima',
  'vence_hoy': 'Vence hoy',
  'atrasada': 'Atrasada',
  'planificada': 'Planificada',
  'en_curso': 'En curso',
  'realizada': 'Realizada',
  'cancelada': 'Cancelada',
  'no_aplicable': 'No aplicable',
  'vehiculo_no_disponible': 'No disponible',
};

const _prioridadLabels = {
  'critica': 'Crítica',
  'alta': 'Alta',
  'media': 'Media',
  'baja': 'Baja',
  'sin': '—',
};

// Anchos de columna (en px lógicos). Suman el ancho total de la tabla.
const double _wCheck = 44,
    _wMatricula = 116,
    _wCliente = 130,
    _wBase = 92,
    _wRevision = 172,
    _wUltima = 92,
    _wProxima = 104,
    _wDias = 108,
    _wEstado = 120,
    _wPrioridad = 92,
    _wEnBase = 76,
    _wTecnico = 96,
    _wAcciones = 128;
const double _tableWidth = _wCheck +
    _wMatricula +
    _wCliente +
    _wBase +
    _wRevision +
    _wUltima +
    _wProxima +
    _wDias +
    _wEstado +
    _wPrioridad +
    _wEnBase +
    _wTecnico +
    _wAcciones;

class _PlanFila {
  final String planId;
  final String vehiculoId;
  final String empresaId;
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
  final String? tecnicoId;

  _PlanFila({
    required this.planId,
    required this.vehiculoId,
    required this.empresaId,
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
    required this.tecnicoId,
  });
}

class _PlanificacionScreenState extends State<PlanificacionScreen> {
  bool _loading = true;
  String? _error;
  List<_PlanFila> _filas = [];
  Map<String, String> _tecnicos = {};
  _Tab _tab = _Tab.pendientes;
  String _q = '';
  String _fCliente = '';
  String _fEstado = '';
  String _fPrioridad = '';
  final Set<String> _sel = {};

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
      final tecnicos = await TyreControlApi.mapaTecnicos();
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
          planId: p['id'] as String,
          vehiculoId: v['id'] as String,
          empresaId: (v['empresa_id'] as String?) ?? '',
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
          tecnicoId: p['tecnico_id'] as String?,
        ));
      }
      filas.sort((a, b) =>
          (a.diasRestantes ?? 9999).compareTo(b.diasRestantes ?? 9999));
      if (!mounted) return;
      setState(() {
        _filas = filas;
        _tecnicos = tecnicos;
      });
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
        default:
          break; // pestañas de "próxima fase": muestran todo filtrado
      }
      if (_fCliente.isNotEmpty && f.empresaId != _fCliente) return false;
      if (_fEstado.isNotEmpty && e != _fEstado) return false;
      if (_fPrioridad.isNotEmpty && f.prioridad != _fPrioridad) return false;
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
    return _Kpis(veh.length, pend, hoy, semana, atras, cumpl);
  }

  bool get _esFaseFutura =>
      _tab == _Tab.porCliente ||
      _tab == _Tab.porBase ||
      _tab == _Tab.calendario;

  @override
  Widget build(BuildContext context) {
    final content = _loading
        ? const Center(child: CircularProgressIndicator())
        : (_error != null ? _errorView() : _mainView());
    if (widget.embedded) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Planificación de revisiones')),
      body: content,
    );
  }

  Widget _mainView() {
    final k = _kpis;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Cabecera: título + Excel / Plantillas ──
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Row(
            children: [
              const Expanded(
                child: Text('Planificación de revisiones',
                    style: TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w800)),
              ),
              _headerBtn(Icons.download, 'Excel'),
              const SizedBox(width: 8),
              _headerBtn(Icons.description_outlined, 'Plantillas'),
            ],
          ),
        ),
        // ── KPIs ──
        SizedBox(
          height: 78,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              _kpi('${k.controlados}', 'Controlados'),
              _kpi('${k.pendientes}', 'Pendientes'),
              _kpi('${k.hoy}', 'Hoy'),
              _kpi('${k.semana}', 'Esta semana'),
              _kpi('${k.atrasadas}', 'Atrasadas'),
              _kpi('0', 'En base pend.'),
              _kpi('0', 'Realizadas mes'),
              _kpi('${k.cumplimiento}%', 'Cumplimiento'),
            ],
          ),
        ),
        const SizedBox(height: 8),
        // ── Pestañas ──
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children:
                _Tab.values.map((t) => _tabChip(_tabLabels[t]!, t)).toList(),
          ),
        ),
        const SizedBox(height: 8),
        // ── Búsqueda + filtros ──
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Column(
            children: [
              TextField(
                onChanged: (v) => setState(() => _q = v),
                decoration: const InputDecoration(
                  hintText: 'Buscar matrícula o cliente',
                  prefixIcon: Icon(Icons.search),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              _filtroCliente(),
              const SizedBox(height: 8),
              _filtroEstado(),
              const SizedBox(height: 8),
              _filtroPrioridad(),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Text('${_visibles.length}',
              style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
        ),
        const SizedBox(height: 2),
        // ── Tabla ──
        Expanded(child: _tabla()),
      ],
    );
  }

  // ── Tabla (scroll horizontal + vertical) ─────────────────────
  Widget _tabla() {
    if (_esFaseFutura) {
      return _placeholder(Icons.hourglass_empty,
          'Vista "${_tabLabels[_tab]}" disponible en el panel web (próxima fase)');
    }
    final visibles = _visibles;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SizedBox(
        width: _tableWidth,
        child: Column(
          children: [
            _headerRow(),
            const Divider(height: 1, color: AppColors.cardBorder),
            Expanded(
              child: visibles.isEmpty
                  ? _placeholder(
                      Icons.event_available, 'Sin revisiones en esta pestaña')
                  : RefreshIndicator(
                      onRefresh: _cargar,
                      child: ListView.builder(
                        itemCount: visibles.length,
                        itemBuilder: (_, i) => _dataRow(visibles[i]),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _headerRow() {
    Widget h(String t, double w, {TextAlign align = TextAlign.left}) => SizedBox(
          width: w,
          child: Text(t.toUpperCase(),
              textAlign: align,
              style: const TextStyle(
                  color: AppColors.textHint,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4)),
        );
    final all = _visibles;
    final allSel = all.isNotEmpty && all.every((f) => _sel.contains(f.planId));
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: _wCheck,
            child: Checkbox(
              value: allSel,
              onChanged: (v) => setState(() {
                if (v == true) {
                  _sel.addAll(all.map((f) => f.planId));
                } else {
                  _sel.clear();
                }
              }),
            ),
          ),
          h('Matrícula', _wMatricula),
          h('Cliente', _wCliente),
          h('Base', _wBase),
          h('Revisión', _wRevision),
          h('Última', _wUltima),
          h('Próxima', _wProxima),
          h('Días', _wDias),
          h('Estado', _wEstado),
          h('Prioridad', _wPrioridad),
          h('En base', _wEnBase),
          h('Técnico', _wTecnico),
          h('Acciones', _wAcciones),
        ],
      ),
    );
  }

  Widget _dataRow(_PlanFila f) {
    final atrasada = f.estado == 'atrasada';
    final tec = f.tecnicoId != null ? (_tecnicos[f.tecnicoId] ?? '—') : '—';
    Widget c(String t, double w,
            {Color? color, FontWeight weight = FontWeight.w500}) =>
        SizedBox(
          width: w,
          child: Text(t,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: color ?? AppColors.textPrimary,
                  fontSize: 13,
                  fontWeight: weight)),
        );
    return Container(
      decoration: BoxDecoration(
        color: atrasada ? AppColors.danger.withValues(alpha: 0.06) : null,
        border: const Border(
            bottom: BorderSide(color: AppColors.cardBorder, width: 0.5)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: _wCheck,
            child: Checkbox(
              value: _sel.contains(f.planId),
              onChanged: (v) => setState(() {
                if (v == true) {
                  _sel.add(f.planId);
                } else {
                  _sel.remove(f.planId);
                }
              }),
            ),
          ),
          c(f.matricula, _wMatricula, weight: FontWeight.w800),
          c(f.cliente, _wCliente, color: AppColors.textSecondary),
          c(f.base, _wBase, color: AppColors.textSecondary),
          c(f.revision, _wRevision, color: AppColors.textPrimary),
          c(_fecha(f.ultimaFecha), _wUltima, color: AppColors.textSecondary),
          c(_fecha(f.proximaFecha) + _km(f.proximaKm), _wProxima,
              color: AppColors.textSecondary),
          c(_diasTexto(f.diasRestantes), _wDias,
              color: _colorDias(f.diasRestantes)),
          SizedBox(width: _wEstado, child: _EstadoBadge(estado: f.estado)),
          c(_prioridadLabels[f.prioridad] ?? '—', _wPrioridad,
              color: AppColors.textSecondary),
          c('—', _wEnBase, color: AppColors.textHint),
          c(tec, _wTecnico, color: AppColors.textSecondary),
          SizedBox(
            width: _wAcciones,
            child: Row(
              children: [
                _accion('Registrar', AppColors.success),
                const SizedBox(width: 10),
                _accion('Ficha', AppColors.info),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _accion(String label, Color color) => InkWell(
        onTap: () => _avisoWeb(label),
        child: Text(label,
            style: TextStyle(
                color: color, fontSize: 12, fontWeight: FontWeight.w700)),
      );

  // ── Piezas de UI ─────────────────────────────────────────────
  Widget _headerBtn(IconData icon, String label) => InkWell(
        onTap: () => _avisoWeb(label),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.cardBorder),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text(label,
                  style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      );

  Widget _kpi(String value, String label) => Container(
        width: 108,
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
                style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w800)),
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 11)),
          ],
        ),
      );

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

  Widget _filtroCliente() {
    final clientes = <String, String>{};
    for (final f in _filas) {
      if (f.empresaId.isNotEmpty) clientes[f.empresaId] = f.cliente;
    }
    final items = clientes.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return _dropdown(
      value: _fCliente,
      hint: 'Todos los clientes',
      items: items.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
      onChanged: (v) => setState(() => _fCliente = v ?? ''),
    );
  }

  Widget _filtroEstado() => _dropdown(
        value: _fEstado,
        hint: 'Todos los estados',
        items: const ['correcta', 'proxima', 'vence_hoy', 'atrasada', 'planificada']
            .map((e) => DropdownMenuItem(value: e, child: Text(_estadoLabels[e]!)))
            .toList(),
        onChanged: (v) => setState(() => _fEstado = v ?? ''),
      );

  Widget _filtroPrioridad() => _dropdown(
        value: _fPrioridad,
        hint: 'Toda prioridad',
        items: const ['critica', 'alta', 'media', 'baja']
            .map((e) => DropdownMenuItem(value: e, child: Text(_prioridadLabels[e]!)))
            .toList(),
        onChanged: (v) => setState(() => _fPrioridad = v ?? ''),
      );

  Widget _dropdown({
    required String value,
    required String hint,
    required List<DropdownMenuItem<String>> items,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      value: value.isEmpty ? null : value,
      isExpanded: true,
      decoration: const InputDecoration(isDense: true),
      hint: Text(hint, style: const TextStyle(color: AppColors.textSecondary)),
      dropdownColor: AppColors.surfaceVariant,
      items: [
        DropdownMenuItem(value: '', child: Text(hint)),
        ...items,
      ],
      onChanged: onChanged,
    );
  }

  Widget _placeholder(IconData icon, String texto) => ListView(
        children: [
          const SizedBox(height: 60),
          Icon(icon, size: 44, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Text(texto,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary)),
            ),
          ),
        ],
      );

  Widget _errorView() => RefreshIndicator(
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
                child: Text(_error ?? '',
                    textAlign: TextAlign.center,
                    style:
                        const TextStyle(color: AppColors.textHint, fontSize: 12)),
              ),
            ),
          ],
        ),
      );

  void _avisoWeb(String accion) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('"$accion" se realiza en el panel web')),
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
    if (d == null) return AppColors.textSecondary;
    if (d < 0) return AppColors.danger;
    if (d == 0) return const Color(0xFFF97316);
    if (d <= 7) return AppColors.warning;
    return AppColors.textSecondary;
  }
}

class _Kpis {
  final int controlados, pendientes, hoy, semana, atrasadas, cumplimiento;
  _Kpis(this.controlados, this.pendientes, this.hoy, this.semana,
      this.atrasadas, this.cumplimiento);
}

class _EstadoBadge extends StatelessWidget {
  final String estado;
  const _EstadoBadge({required this.estado});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _meta(estado);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
            Text(label.toUpperCase(),
                style: TextStyle(
                    color: color,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3)),
          ],
        ),
      ),
    );
  }

  static (String, Color) _meta(String e) {
    switch (e) {
      case 'correcta':
        return ('Correcta', AppColors.success);
      case 'proxima':
        return ('Próxima', AppColors.warning);
      case 'vence_hoy':
        return ('Vence hoy', const Color(0xFFF97316));
      case 'atrasada':
        return ('Atrasada', AppColors.danger);
      case 'planificada':
        return ('Planificada', AppColors.primary);
      case 'en_curso':
        return ('En curso', AppColors.info);
      case 'realizada':
        return ('Realizada', AppColors.success);
      case 'cancelada':
        return ('Cancelada', AppColors.textSecondary);
      case 'no_aplicable':
        return ('No aplicable', AppColors.textSecondary);
      case 'vehiculo_no_disponible':
        return ('No disponible', AppColors.textSecondary);
      default:
        return (e, AppColors.textSecondary);
    }
  }
}
