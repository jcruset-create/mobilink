import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../services/pausa_controller.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Analítica de Productividad — tiempos reales de revisiones y operaciones.
///
/// Todos los números vienen agregados de los RPCs tc_prod_revisiones /
/// tc_prod_operaciones (SUM/AVG/MIN/MAX/COUNT en Postgres): la pantalla no
/// carga filas sueltas y aguanta cientos de miles de registros.
class AnaliticaScreen extends StatelessWidget {
  const AnaliticaScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Analítica de Productividad'),
          bottom: const TabBar(isScrollable: true, tabs: [
            Tab(icon: Icon(Icons.fact_check_outlined), text: 'Revisiones'),
            Tab(icon: Icon(Icons.build_outlined), text: 'Operaciones'),
            Tab(icon: Icon(Icons.eco_outlined), text: 'Conducción'),
          ]),
        ),
        body: const TabBarView(children: [
          _TabProductividad(tab: 'revisiones'),
          _TabProductividad(tab: 'operaciones'),
          _TabConduccion(),
        ]),
      ),
    );
  }
}

// Etiquetas de los tipos de operación (claves de operaciones_neumaticos).
const _kTiposOperacion = {
  'montaje': 'Montaje',
  'desmontaje': 'Desmontaje',
  'sustitucion': 'Sustitución',
  'rotacion': 'Rotación',
  'reparacion': 'Reparación',
  'descarte': 'Descarte',
};

const _kTiposRevision = {
  'solo_profundidades': 'Solo profundidades',
  'profundidades_presiones': 'Profundidades + presiones',
};

String _fmtSeg(num? s) {
  if (s == null) return '—';
  final t = s.round();
  final h = t ~/ 3600, m = (t % 3600) ~/ 60, seg = t % 60;
  if (h > 0) return '${h}h ${m.toString().padLeft(2, '0')}m';
  if (m > 0) return '${m}m ${seg.toString().padLeft(2, '0')}s';
  return '${seg}s';
}

class _TabProductividad extends StatefulWidget {
  final String tab; // 'revisiones' | 'operaciones'
  const _TabProductividad({required this.tab});

  @override
  State<_TabProductividad> createState() => _TabProductividadState();
}

class _TabProductividadState extends State<_TabProductividad>
    with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  bool _cargando = true;
  String? _error;
  Map<String, dynamic> _datos = {};

  // Filtros. El cliente parte del cliente activo de la sesión; "Todos los
  // clientes" solo aparece para administradores.
  bool _esAdmin = false;
  String? _fEmpresa = TyreControlApi.empresaActivaId; // null = todos
  String? _fTecnico;
  String? _fTipoVehiculo;
  String? _fTipo;
  DateTime? _fDesde;
  DateTime? _fHasta;

  List<Map<String, dynamic>> _clientes = []; // {id, nombre}
  List<({String id, String nombre})> _tecnicos = [];
  List<({String id, String nombre})> _tiposVehiculo = [];

  @override
  void initState() {
    super.initState();
    _cargarFiltros();
    _cargar();
  }

  Future<void> _cargarFiltros() async {
    try {
      // Mismas fuentes que la selección de cliente: no se duplica lógica.
      final r = await Future.wait([
        TyreControlApi.listarEmpresasCliente(),
        TyreControlApi.listarTecnicos(),
        TyreControlApi.listarTiposVehiculo(),
        TyreControlApi.esAdmin(),
      ]);
      if (!mounted) return;
      setState(() {
        _clientes = r[0] as List<Map<String, dynamic>>;
        _tecnicos = r[1] as List<({String id, String nombre})>;
        _tiposVehiculo = r[2] as List<({String id, String nombre})>;
        _esAdmin = r[3] as bool;
      });
    } catch (_) {/* los filtros que no carguen quedan vacíos */}
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final d = await TyreControlApi.estadisticasProductividad(
        widget.tab,
        desde: _fDesde,
        hasta: _fHasta,
        empresaId: _fEmpresa,
        tecnicoId: _fTecnico,
        tipoVehiculoId: _fTipoVehiculo,
        tipo: _fTipo,
      );
      if (!mounted) return;
      setState(() => _datos = d);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  Future<void> _fecha(bool desde) async {
    final ahora = DateTime.now();
    final sel = await showDatePicker(
      context: context,
      initialDate: (desde ? _fDesde : _fHasta) ?? ahora,
      firstDate: DateTime(2024),
      lastDate: DateTime(ahora.year + 1),
    );
    if (sel == null) return;
    setState(() => desde ? _fDesde = sel : _fHasta = sel);
    _cargar();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          _filtros(),
          const SizedBox(height: 14),
          if (_cargando)
            const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(children: [
                Text('No se han podido cargar las estadísticas.\n$_error',
                    textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
                const SizedBox(height: 10),
                const Text('¿Está ejecutada la migración tyrecontrol_productividad.sql?',
                    style: TextStyle(color: AppColors.textHint, fontSize: 12)),
              ]),
            )
          else ..._contenido(),
        ],
      ),
    );
  }

  // ── Filtros ──────────────────────────────────────────────────
  Widget _filtros() {
    String fecha(DateTime? d) =>
        d == null ? '—' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year % 100}';
    return Wrap(spacing: 8, runSpacing: 8, children: [
      if (_esAdmin)
        _drop<String?>('Cliente', _fEmpresa, [
          const DropdownMenuItem(value: null, child: Text('Todos los clientes')),
          for (final c in _clientes)
            DropdownMenuItem(value: c['id'] as String?, child: Text('${c['nombre'] ?? '—'}')),
        ], (v) {
          setState(() => _fEmpresa = v);
          _cargar();
        }),
      _drop<String?>('Técnico', _fTecnico, [
        const DropdownMenuItem(value: null, child: Text('Todos los técnicos')),
        for (final t in _tecnicos) DropdownMenuItem(value: t.id, child: Text(t.nombre)),
      ], (v) {
        setState(() => _fTecnico = v);
        _cargar();
      }),
      _drop<String?>('Tipo vehículo', _fTipoVehiculo, [
        const DropdownMenuItem(value: null, child: Text('Todos los vehículos')),
        for (final t in _tiposVehiculo) DropdownMenuItem(value: t.id, child: Text(t.nombre)),
      ], (v) {
        setState(() => _fTipoVehiculo = v);
        _cargar();
      }),
      _drop<String?>(
          widget.tab == 'revisiones' ? 'Tipo revisión' : 'Tipo operación',
          _fTipo,
          [
            DropdownMenuItem(
                value: null,
                child: Text(widget.tab == 'revisiones' ? 'Todas las revisiones' : 'Todas las operaciones')),
            for (final e in (widget.tab == 'revisiones' ? _kTiposRevision : _kTiposOperacion).entries)
              DropdownMenuItem(value: e.key, child: Text(e.value)),
          ], (v) {
        setState(() => _fTipo = v);
        _cargar();
      }),
      OutlinedButton.icon(
          onPressed: () => _fecha(true),
          icon: const Icon(Icons.event, size: 16),
          label: Text('Desde ${fecha(_fDesde)}')),
      OutlinedButton.icon(
          onPressed: () => _fecha(false),
          icon: const Icon(Icons.event, size: 16),
          label: Text('Hasta ${fecha(_fHasta)}')),
      if (_fDesde != null || _fHasta != null || _fTecnico != null || _fTipoVehiculo != null || _fTipo != null)
        IconButton(
          tooltip: 'Quitar filtros',
          onPressed: () {
            setState(() {
              _fDesde = null;
              _fHasta = null;
              _fTecnico = null;
              _fTipoVehiculo = null;
              _fTipo = null;
            });
            _cargar();
          },
          icon: const Icon(Icons.filter_alt_off, color: AppColors.textHint),
        ),
    ]);
  }

  Widget _drop<T>(String hint, T value, List<DropdownMenuItem<T>> items, ValueChanged<T> onChanged) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: DropdownButton<T>(
        value: value,
        hint: Text(hint),
        underline: const SizedBox.shrink(),
        items: items,
        onChanged: (v) => onChanged(v as T),
      ),
    );
  }

  // ── Contenido ────────────────────────────────────────────────
  List<Widget> _contenido() {
    final k = _datos['kpis'] is Map ? Map<String, dynamic>.from(_datos['kpis'] as Map) : <String, dynamic>{};
    if ((k['total'] as num? ?? 0) == 0) {
      return [
        const Padding(
          padding: EdgeInsets.all(40),
          child: Center(
            child: Text('Sin datos con los filtros actuales.\nLos tiempos se registran automáticamente al finalizar.',
                textAlign: TextAlign.center, style: TextStyle(color: AppColors.textHint)),
          ),
        ),
      ];
    }
    final esRev = widget.tab == 'revisiones';
    final pct = (k['pct_inactividad'] as num?)?.toDouble() ?? 0;
    return [
      // KPIs superiores
      _seccion('Indicadores', Wrap(spacing: 10, runSpacing: 10, children: [
        _kpi(esRev ? 'Revisiones' : 'Operaciones', '${k['total'] ?? 0}', Icons.numbers),
        _kpi('Tiempo medio', _fmtSeg(k['media_seg'] as num?), Icons.timer_outlined),
        _kpi('Tiempo total', _fmtSeg(k['total_seg'] as num?), Icons.functions),
        _kpi('Tiempo efectivo medio', _fmtSeg(k['media_trabajo_seg'] as num?), Icons.handyman),
        _kpi('Inactividad media', _fmtSeg(k['media_pausa_seg'] as num?), Icons.pause_circle_outline),
        _kpi('% inactividad', '${pct.toStringAsFixed(1)} %', Icons.hourglass_bottom,
            color: pct > 25 ? AppColors.danger : (pct > 10 ? AppColors.warning : AppColors.success)),
        _kpi('Productividad', '${(100 - pct).toStringAsFixed(1)} %', Icons.trending_up,
            color: pct > 25 ? AppColors.danger : (pct > 10 ? AppColors.warning : AppColors.success)),
        _kpi('Pausas por trabajo', '${k['media_pausas'] ?? '—'}', Icons.pause),
        if (esRev) ...[
          _kpi('Media solo profundidades', _fmtSeg(k['media_solo_prof'] as num?), Icons.straighten),
          _kpi('Media prof. + presiones', _fmtSeg(k['media_prof_pres'] as num?), Icons.speed),
        ],
        ..._kpisDestacados(esRev),
      ])),
      // Por tipo (operaciones) o tipo de revisión implícito en KPIs
      if (!esRev) _porTipoOperacion(),
      _porTecnico(esRev),
      _ranking(),
      _porTipoVehiculo(),
      _matriz(esRev),
      _evolucion(),
      _porCliente(),
      _porMotivo(),
    ];
  }

  List<Widget> _kpisDestacados(bool esRev) {
    Widget? de(String clave, String titulo, IconData icon, String Function(Map d) txt) {
      final d = _datos[clave];
      if (d is! Map) return null;
      return _kpi(titulo, txt(Map<String, dynamic>.from(d)), icon);
    }

    return [
      de(esRev ? 'tecnico_mas_revisiones' : 'tecnico_mas_operaciones',
          esRev ? 'Técnico con más revisiones' : 'Técnico con más operaciones', Icons.emoji_events,
          (d) => '${d['nombre']} (${d['n']})'),
      de('tecnico_mejor_media', 'Mejor tiempo medio', Icons.bolt,
          (d) => '${d['nombre']} · ${_fmtSeg(d['media_seg'] as num?)}'),
      if (esRev)
        de('vehiculo_mayor_media', 'Vehículo con mayor tiempo', Icons.local_shipping,
            (d) => '${d['matricula']} · ${_fmtSeg(d['media_seg'] as num?)}'),
      if (!esRev) ...[
        de('operacion_mas_frecuente', 'Operación más frecuente', Icons.star,
            (d) => '${_kTiposOperacion[d['tipo']] ?? d['tipo']} (${d['n']})'),
        de('operacion_mayor_duracion', 'Operación más larga', Icons.hourglass_top,
            (d) => '${_kTiposOperacion[d['tipo']] ?? d['tipo']} · ${_fmtSeg(d['media_seg'] as num?)}'),
      ],
    ].whereType<Widget>().toList();
  }

  List<Map<String, dynamic>> _lista(String clave) => _datos[clave] is List
      ? (_datos[clave] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : [];

  Widget _porTipoOperacion() {
    final filas = _lista('por_tipo_operacion');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Por tipo de operación',
      _GraficoBarras(
        datos: [
          for (final f in filas)
            (etiqueta: _kTiposOperacion[f['tipo']] ?? '${f['tipo']}',
             valor: (f['media_seg'] as num?)?.toDouble() ?? 0,
             detalle: '${f['n']} ops · ${_fmtSeg(f['media_seg'] as num?)}'),
        ],
        formato: _fmtSeg,
      ),
    );
  }

  Widget _porTecnico(bool esRev) {
    final filas = _lista('por_tecnico');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Por empleado',
      Column(children: [
        for (final f in filas)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.person, size: 18, color: AppColors.info),
                const SizedBox(width: 6),
                Expanded(
                    child: Text('${f['tecnico']}',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary))),
                Text('${f['n']} ${esRev ? 'revisiones' : 'operaciones'}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 14, runSpacing: 4, children: [
                _mini('Media', _fmtSeg(f['media_seg'] as num?)),
                _mini('Mín', _fmtSeg(f['min_seg'] as num?)),
                _mini('Máx', _fmtSeg(f['max_seg'] as num?)),
                _mini('Efectivo', _fmtSeg(f['media_trabajo_seg'] as num?)),
                _mini('Inactivo', _fmtSeg(f['media_pausa_seg'] as num?)),
                _mini('% inact.', '${f['pct_inactividad'] ?? 0} %'),
                _mini('Pausas', '${f['n_pausas'] ?? 0}'),
                if (esRev) ...[
                  _mini('Solo prof.', _fmtSeg(f['media_solo_prof'] as num?)),
                  _mini('Prof.+pres.', _fmtSeg(f['media_prof_pres'] as num?)),
                ],
              ]),
            ]),
          ),
      ]),
    );
  }

  Widget _ranking() {
    final filas = _lista('por_tecnico');
    if (filas.length < 2) return const SizedBox.shrink();
    final rapidos = [...filas]..sort((a, b) =>
        ((a['media_seg'] as num?) ?? 1 << 30).compareTo((b['media_seg'] as num?) ?? 1 << 30));
    final trabajadores = [...filas]
      ..sort((a, b) => ((b['n'] as num?) ?? 0).compareTo((a['n'] as num?) ?? 0));
    Widget lista(String titulo, List<Map<String, dynamic>> fs, String Function(Map<String, dynamic>) txt) =>
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(titulo, style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(height: 6),
            for (var i = 0; i < math.min(5, fs.length); i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(children: [
                  Text('${i + 1}.',
                      style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: i == 0 ? AppColors.warning : AppColors.textHint)),
                  const SizedBox(width: 6),
                  Expanded(
                      child: Text('${fs[i]['tecnico']} · ${txt(fs[i])}',
                          style: const TextStyle(color: AppColors.textPrimary, fontSize: 13),
                          overflow: TextOverflow.ellipsis)),
                ]),
              ),
          ]),
        );
    return _seccion(
      'Ranking',
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        lista('Más rápidos (media)', rapidos, (f) => _fmtSeg(f['media_seg'] as num?)),
        const SizedBox(width: 12),
        lista('Más trabajos', trabajadores, (f) => '${f['n']}'),
      ]),
    );
  }

  Widget _porTipoVehiculo() {
    final filas = _lista('por_tipo_vehiculo');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Por tipo de vehículo',
      _GraficoBarras(
        datos: [
          for (final f in filas)
            (etiqueta: '${f['tipo']}',
             valor: (f['media_seg'] as num?)?.toDouble() ?? 0,
             detalle: '${f['n']} · ${_fmtSeg(f['media_seg'] as num?)}'),
        ],
        formato: _fmtSeg,
      ),
    );
  }

  Widget _matriz(bool esRev) {
    final filas = _lista('matriz');
    if (filas.isEmpty) return const SizedBox.shrink();
    final tecnicos = filas.map((f) => '${f['tecnico']}').toSet().toList()..sort();
    final tipos = filas.map((f) => '${f['tipo']}').toSet().toList()..sort();
    final valores = {
      for (final f in filas) '${f['tecnico']}|${f['tipo']}': f['media_seg'] as num?,
    };
    String tipoLabel(String t) =>
        esRev ? t : (_kTiposOperacion[t] ?? t);
    return _seccion(
      esRev ? 'Matriz empleado × tipo de vehículo' : 'Matriz empleado × tipo de operación',
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingRowHeight: 40,
          dataRowMinHeight: 36,
          dataRowMaxHeight: 40,
          columns: [
            const DataColumn(label: Text('Empleado')),
            for (final t in tipos) DataColumn(label: Text(tipoLabel(t))),
          ],
          rows: [
            for (final tec in tecnicos)
              DataRow(cells: [
                DataCell(Text(tec, style: const TextStyle(fontWeight: FontWeight.w600))),
                for (final t in tipos) DataCell(Text(_fmtSeg(valores['$tec|$t']))),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _evolucion() {
    final filas = _lista('evolucion');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Evolución mensual',
      Column(children: [
        _GraficoBarras(
          datos: [
            for (final f in filas)
              (etiqueta: '${f['mes']}'.substring(2), // "26-07"
               valor: ((f['n'] as num?) ?? 0).toDouble(),
               detalle: '${f['n']} trabajos'),
          ],
          formato: (v) => '${v?.round() ?? 0}',
        ),
        const SizedBox(height: 12),
        _GraficoLinea(
          titulo: 'Tiempo medio mensual',
          datos: [
            for (final f in filas)
              (etiqueta: '${f['mes']}'.substring(2),
               valor: ((f['media_seg'] as num?) ?? 0).toDouble()),
          ],
          formato: _fmtSeg,
        ),
      ]),
    );
  }

  Widget _porCliente() {
    final filas = _lista('por_cliente');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Por cliente (esperas)',
      Column(children: [
        for (final f in filas)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              Expanded(
                  flex: 3,
                  child: Text('${f['cliente']}',
                      style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis)),
              Expanded(
                  flex: 2,
                  child: Text('media ${_fmtSeg(f['media_seg'] as num?)}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
              Expanded(
                  flex: 2,
                  child: Text('espera ${_fmtSeg(f['media_pausa_seg'] as num?)}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
              _pctPill((f['pct_inactividad'] as num?)?.toDouble() ?? 0),
            ]),
          ),
      ]),
    );
  }

  Widget _porMotivo() {
    final filas = _lista('por_motivo');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Causas de inactividad',
      _GraficoDonut(
        datos: [
          for (final f in filas)
            (etiqueta: kMotivosPausa[f['motivo']] ?? '${f['motivo']}',
             valor: ((f['total_seg'] as num?) ?? 0).toDouble(),
             detalle: '${f['n']} pausas · ${_fmtSeg(f['total_seg'] as num?)}'),
        ],
      ),
    );
  }

  // ── Piezas de UI ─────────────────────────────────────────────
  Widget _seccion(String titulo, Widget child) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
          const SizedBox(height: 10),
          child,
        ]),
      );

  Widget _kpi(String titulo, String valor, IconData icon, {Color? color}) => Container(
        width: 190,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 16, color: color ?? AppColors.info),
            const SizedBox(width: 6),
            Expanded(
                child: Text(titulo,
                    style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 6),
          Text(valor,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color ?? AppColors.textPrimary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
        ]),
      );

  Widget _mini(String t, String v) => Text.rich(TextSpan(children: [
        TextSpan(text: '$t: ', style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
        TextSpan(text: v, style: const TextStyle(color: AppColors.textPrimary, fontSize: 12, fontWeight: FontWeight.w600)),
      ]));

  Widget _pctPill(double pct) {
    final c = pct > 25 ? AppColors.danger : (pct > 10 ? AppColors.warning : AppColors.success);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
      child: Text('${pct.toStringAsFixed(0)} %',
          style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

// ── Gráficos (CustomPainter, mismo estilo Material 3 de la app) ──

// ── Conducción eficiente (Webfleet) ────────────────────────────
/// Datos de los equipos Webfleet de la flota: OptiDrive (puntuación de
/// conducción de TomTom), ralentí, km y excesos de velocidad.
///
/// NO hay consumo de combustible: los equipos no llevan enlace CAN/FMS y
/// Webfleet devuelve fuel_usage y co2 a 0. Se avisa en pantalla para que
/// nadie lo interprete como "consumo 0".
class _TabConduccion extends StatefulWidget {
  const _TabConduccion();

  @override
  State<_TabConduccion> createState() => _TabConduccionState();
}

class _TabConduccionState extends State<_TabConduccion> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  bool _cargando = true;
  String? _error;
  Map<String, dynamic> _datos = {};
  int _dias = 30;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final empresa = TyreControlApi.empresaActivaId;
    setState(() {
      _cargando = true;
      _error = null;
    });
    if (empresa == null) {
      // En modo "Admin (todos)" no hay una empresa concreta con la que pedir
      // credenciales de Webfleet: hay que elegir cliente.
      setState(() {
        _cargando = false;
        _error = 'Selecciona un cliente concreto para ver su flota Webfleet.';
      });
      return;
    }
    try {
      final d = await TyreControlApi.conduccionWebfleet(empresa, dias: _dias);
      if (!mounted) return;
      setState(() => _datos = d ?? {});
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e'.replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  List<Map<String, dynamic>> _lista(String clave) => _datos[clave] is List
      ? (_datos[clave] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : [];

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final k = _datos['kpis'] is Map ? Map<String, dynamic>.from(_datos['kpis'] as Map) : <String, dynamic>{};
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Wrap(spacing: 8, children: [
            for (final d in [7, 30, 90])
              ChoiceChip(
                label: Text('$d días'),
                selected: _dias == d,
                onSelected: (_) {
                  setState(() => _dias = d);
                  _cargar();
                },
              ),
          ]),
          const SizedBox(height: 12),
          if (_cargando)
            const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
            )
          else ...[
            _seccion('Indicadores de la flota', Wrap(spacing: 10, runSpacing: 10, children: [
              _kpi('Vehículos', '${k['vehiculos'] ?? 0}', Icons.local_shipping),
              _kpi('Viajes', '${k['viajes'] ?? 0}', Icons.route),
              _kpi('Kilómetros', '${k['km'] ?? 0} km', Icons.straighten),
              _kpi('Horas en marcha', '${k['horas'] ?? 0} h', Icons.schedule),
              _kpi('Ralentí', '${k['ralenti_horas'] ?? 0} h', Icons.hourglass_bottom,
                  color: _colorRalenti((k['pct_ralenti'] as num?)?.toDouble() ?? 0)),
              _kpi('% ralentí', '${k['pct_ralenti'] ?? 0} %', Icons.local_gas_station,
                  color: _colorRalenti((k['pct_ralenti'] as num?)?.toDouble() ?? 0)),
              if (k['optidrive'] != null)
                _kpi('OptiDrive medio', '${k['optidrive']} / 100', Icons.eco,
                    color: _colorOpti((k['optidrive'] as num).toDouble())),
            ])),
            _avisoCombustible(),
            _porVehiculo(),
            _porConductor(),
          ],
        ],
      ),
    );
  }

  Color _colorRalenti(double pct) =>
      pct > 30 ? AppColors.danger : (pct > 15 ? AppColors.warning : AppColors.success);
  Color _colorOpti(double v) =>
      v >= 80 ? AppColors.success : (v >= 60 ? AppColors.warning : AppColors.danger);

  Widget _avisoCombustible() {
    if (_datos['combustible_disponible'] == true) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: const Row(children: [
        Icon(Icons.info_outline, size: 18, color: AppColors.textHint),
        SizedBox(width: 8),
        Expanded(
          child: Text(
            'Sin consumo de combustible: los equipos de la flota no tienen enlace '
            'CAN/FMS con el vehículo, así que Webfleet no puede leerlo.',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ),
      ]),
    );
  }

  Widget _porVehiculo() {
    final filas = _lista('por_vehiculo');
    if (filas.isEmpty) {
      return _seccion('Por vehículo',
          const Text('Sin viajes en el periodo.', style: TextStyle(color: AppColors.textHint)));
    }
    return _seccion(
      'Por vehículo',
      Column(children: [
        for (final f in filas)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(f['enlazado'] == true ? Icons.link : Icons.link_off,
                    size: 16, color: f['enlazado'] == true ? AppColors.info : AppColors.textHint),
                const SizedBox(width: 6),
                Expanded(
                    child: Text('${f['vehiculo']}',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary))),
                if (f['optidrive'] != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: _colorOpti((f['optidrive'] as num).toDouble()).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text('OptiDrive ${f['optidrive']}',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: _colorOpti((f['optidrive'] as num).toDouble()))),
                  ),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 14, runSpacing: 4, children: [
                _mini('Km', '${f['km']}'),
                _mini('Viajes', '${f['viajes']}'),
                _mini('En marcha', '${f['horas']} h'),
                _mini('Ralentí', '${f['ralenti_min']} min'),
                _mini('% ralentí', '${f['pct_ralenti']} %'),
                _mini('V. máx', '${f['vmax']} km/h'),
                if (f['excesos'] != null) _mini('Excesos', '${f['excesos']}'),
              ]),
            ]),
          ),
      ]),
    );
  }

  Widget _porConductor() {
    final filas = _lista('por_conductor');
    if (filas.isEmpty) return const SizedBox.shrink();
    return _seccion(
      'Por conductor',
      Column(children: [
        for (final f in filas)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              Expanded(
                  flex: 3,
                  child: Text('${f['conductor']}',
                      style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis)),
              Expanded(flex: 2, child: Text('${f['km']} km', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
              Expanded(flex: 2, child: Text('ralentí ${f['pct_ralenti']} %', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
              if (f['optidrive'] != null)
                Text('${f['optidrive']}',
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: _colorOpti((f['optidrive'] as num).toDouble()))),
            ]),
          ),
      ]),
    );
  }

  // Mismas piezas visuales que las otras pestañas.
  Widget _seccion(String titulo, Widget child) => Container(
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
          const SizedBox(height: 10),
          child,
        ]),
      );

  Widget _kpi(String titulo, String valor, IconData icon, {Color? color}) => Container(
        width: 190,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(icon, size: 16, color: color ?? AppColors.info),
            const SizedBox(width: 6),
            Expanded(
                child: Text(titulo,
                    style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                    maxLines: 1, overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 6),
          Text(valor,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: color ?? AppColors.textPrimary),
              maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );

  Widget _mini(String t, String v) => Text.rich(TextSpan(children: [
        TextSpan(text: '$t: ', style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
        TextSpan(text: v, style: const TextStyle(color: AppColors.textPrimary, fontSize: 12, fontWeight: FontWeight.w600)),
      ]));
}

class _GraficoBarras extends StatelessWidget {
  final List<({String etiqueta, double valor, String detalle})> datos;
  final String Function(num?) formato;
  const _GraficoBarras({required this.datos, required this.formato});

  @override
  Widget build(BuildContext context) {
    final max = datos.fold<double>(0, (m, d) => math.max(m, d.valor));
    return Column(children: [
      for (final d in datos)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(children: [
            SizedBox(
                width: 110,
                child: Text(d.etiqueta,
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    overflow: TextOverflow.ellipsis)),
            Expanded(
              child: Stack(children: [
                Container(
                    height: 20,
                    decoration: BoxDecoration(
                        color: AppColors.surface, borderRadius: BorderRadius.circular(6))),
                FractionallySizedBox(
                  widthFactor: max <= 0 ? 0 : (d.valor / max).clamp(0.02, 1.0),
                  child: Container(
                      height: 20,
                      decoration: BoxDecoration(
                          color: AppColors.info.withValues(alpha: 0.75),
                          borderRadius: BorderRadius.circular(6))),
                ),
              ]),
            ),
            const SizedBox(width: 8),
            SizedBox(
                width: 110,
                child: Text(d.detalle,
                    style: const TextStyle(fontSize: 11, color: AppColors.textPrimary),
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis)),
          ]),
        ),
    ]);
  }
}

class _GraficoLinea extends StatelessWidget {
  final String titulo;
  final List<({String etiqueta, double valor})> datos;
  final String Function(num?) formato;
  const _GraficoLinea({required this.titulo, required this.datos, required this.formato});

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(titulo, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
      const SizedBox(height: 6),
      SizedBox(
        height: 120,
        width: double.infinity,
        child: CustomPaint(painter: _LineaPainter(datos)),
      ),
      const SizedBox(height: 4),
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          if (datos.isNotEmpty)
            Text(datos.first.etiqueta, style: const TextStyle(fontSize: 10, color: AppColors.textHint)),
          if (datos.length > 1)
            Text(datos.last.etiqueta, style: const TextStyle(fontSize: 10, color: AppColors.textHint)),
        ],
      ),
      if (datos.isNotEmpty)
        Text('Último: ${formato(datos.last.valor)}',
            style: const TextStyle(fontSize: 11, color: AppColors.textPrimary)),
    ]);
  }
}

class _LineaPainter extends CustomPainter {
  final List<({String etiqueta, double valor})> datos;
  _LineaPainter(this.datos);

  @override
  void paint(Canvas canvas, Size size) {
    if (datos.isEmpty) return;
    final max = datos.fold<double>(0, (m, d) => math.max(m, d.valor));
    final paintLinea = Paint()
      ..color = AppColors.info
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    final paintPunto = Paint()..color = AppColors.info;
    final path = Path();
    for (var i = 0; i < datos.length; i++) {
      final x = datos.length == 1 ? size.width / 2 : i * size.width / (datos.length - 1);
      final y = max <= 0 ? size.height : size.height - (datos[i].valor / max) * (size.height - 10) - 5;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
      canvas.drawCircle(Offset(x, y), 3.5, paintPunto);
    }
    canvas.drawPath(path, paintLinea);
  }

  @override
  bool shouldRepaint(_LineaPainter old) => old.datos != datos;
}

class _GraficoDonut extends StatelessWidget {
  final List<({String etiqueta, double valor, String detalle})> datos;
  const _GraficoDonut({required this.datos});

  static const _colores = [
    AppColors.info,
    AppColors.warning,
    AppColors.success,
    AppColors.danger,
    Color(0xFFA78BFA),
    Color(0xFFF472B6),
    Color(0xFF34D399),
    Color(0xFF94A3B8),
  ];

  @override
  Widget build(BuildContext context) {
    final total = datos.fold<double>(0, (a, d) => a + d.valor);
    return Row(children: [
      SizedBox(width: 130, height: 130, child: CustomPaint(painter: _DonutPainter(datos, total))),
      const SizedBox(width: 16),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (var i = 0; i < datos.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(children: [
                Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                        color: _colores[i % _colores.length], borderRadius: BorderRadius.circular(3))),
                const SizedBox(width: 6),
                Expanded(
                    child: Text('${datos[i].etiqueta} · ${datos[i].detalle}',
                        style: const TextStyle(fontSize: 12, color: AppColors.textPrimary),
                        overflow: TextOverflow.ellipsis)),
                Text(total > 0 ? '${(100 * datos[i].valor / total).toStringAsFixed(0)}%' : '—',
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ]),
            ),
        ]),
      ),
    ]);
  }
}

class _DonutPainter extends CustomPainter {
  final List<({String etiqueta, double valor, String detalle})> datos;
  final double total;
  _DonutPainter(this.datos, this.total);

  @override
  void paint(Canvas canvas, Size size) {
    if (total <= 0) return;
    final rect = Rect.fromLTWH(8, 8, size.width - 16, size.height - 16);
    var inicio = -math.pi / 2;
    for (var i = 0; i < datos.length; i++) {
      final barrido = 2 * math.pi * datos[i].valor / total;
      final paint = Paint()
        ..color = _GraficoDonut._colores[i % _GraficoDonut._colores.length]
        ..style = PaintingStyle.stroke
        ..strokeWidth = 18;
      canvas.drawArc(rect, inicio, math.max(0.02, barrido - 0.03), false, paint);
      inicio += barrido;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.datos != datos || old.total != total;
}
