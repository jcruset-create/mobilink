import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'vehiculo_ficha_screen.dart';

/// Vehículos — réplica de la pantalla del panel web.
///
/// Misma estructura: KPIs Webfleet clicables (filtran), búsqueda, filtros por
/// empresa/delegación/tipo/estado, y tabla con las mismas columnas. La acción
/// "Ficha" abre la ficha del vehículo en solo lectura; Editar/Desactivar y
/// "+ Nuevo vehículo" se hacen en el panel web (aviso al pulsar).
class VehiculosScreen extends StatefulWidget {
  final bool embedded;
  const VehiculosScreen({super.key, this.embedded = false});

  @override
  State<VehiculosScreen> createState() => _VehiculosScreenState();
}

// Anchos de columna. Suman el ancho total de la tabla.
const double _wEmpresa = 118,
    _wMatricula = 104,
    _wUnidad = 76,
    _wDelegacion = 104,
    _wMarca = 88,
    _wConfig = 72,
    _wMedida = 104,
    _wKm = 84,
    _wWebfleet = 158,
    _wEstado = 76,
    _wAcciones = 150;
const double _tableWidth = _wEmpresa +
    _wMatricula +
    _wUnidad +
    _wDelegacion +
    _wMarca +
    _wConfig +
    _wMedida +
    _wKm +
    _wWebfleet +
    _wEstado +
    _wAcciones;

const _wfLabels = {
  'en_base': 'EN BASE',
  'otra_base': 'OTRA BASE',
  'en_ruta': 'EN RUTA',
  'sin_conexion': 'SIN CONEXIÓN',
  'sin_dispositivo': 'SIN WEBFLEET',
};

Color _wfColor(String e) {
  switch (e) {
    case 'en_base':
      return AppColors.success;
    case 'otra_base':
      return AppColors.info;
    case 'en_ruta':
      return AppColors.warning;
    case 'sin_conexion':
      return AppColors.textSecondary;
    default:
      return AppColors.textHint; // sin_dispositivo
  }
}

class _VehiculosScreenState extends State<VehiculosScreen> {
  bool _loading = true;
  bool _sincronizando = false;
  String? _error;
  List<Map<String, dynamic>> _items = [];
  Map<String, Map<String, dynamic>> _wf = {};
  Map<String, String> _rev = {};
  Map<String, String> _medidas = {};

  String _q = '';
  String _fEmpresa = '';
  String _fDele = '';
  String _fTipo = '';
  String _fEstado = 'todos';
  String _fWebfleet = ''; // '', en_base, pend_base, venc_base, en_ruta, sin_conexion

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
        TyreControlApi.listarVehiculosCompleto(),
        TyreControlApi.estadoWebfleetDetalle(),
        TyreControlApi.revisionEstadoPorVehiculo(),
        TyreControlApi.mapaMedidas(),
      ]);
      if (!mounted) return;
      setState(() {
        _items = results[0] as List<Map<String, dynamic>>;
        _wf = results[1] as Map<String, Map<String, dynamic>>;
        _rev = results[2] as Map<String, String>;
        _medidas = results[3] as Map<String, String>;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sincronizar() async {
    setState(() => _sincronizando = true);
    final err = await TyreControlApi.sincronizarWebfleet();
    if (!mounted) return;
    setState(() => _sincronizando = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(err == null ? '✔ Webfleet sincronizado' : 'Webfleet: $err')));
    if (err == null) await _cargar();
  }

  static String? _nombre(dynamic rel) =>
      rel is Map ? rel['nombre'] as String? : null;

  String _estadoDe(String id) =>
      (_wf[id]?['estado'] as String?) ?? 'sin_dispositivo';

  bool _revisarPend(String id) {
    final r = _rev[id];
    return r == 'sin_revision' || r == 'vencida' || r == 'proxima';
  }

  bool _revVencida(String id) {
    final r = _rev[id];
    return r == 'sin_revision' || r == 'vencida';
  }

  ({int enBase, int pendBase, int vencBase, int enRuta, int sinConexion}) get _kpis {
    int enBase = 0, pendBase = 0, vencBase = 0, enRuta = 0, sinConexion = 0;
    for (final v in _items) {
      final id = v['id'] as String;
      final e = _estadoDe(id);
      if (e == 'en_ruta') {
        enRuta++;
      } else if (e == 'sin_conexion') {
        sinConexion++;
      } else if (e == 'en_base') {
        enBase++;
        if (_revisarPend(id)) pendBase++;
        if (_revVencida(id)) vencBase++;
      }
    }
    return (enBase: enBase, pendBase: pendBase, vencBase: vencBase, enRuta: enRuta, sinConexion: sinConexion);
  }

  List<Map<String, dynamic>> get _visibles {
    final s = _q.trim().toLowerCase();
    return _items.where((v) {
      final id = v['id'] as String;
      if (_fEmpresa.isNotEmpty && v['empresa_id'] != _fEmpresa) return false;
      if (_fDele.isNotEmpty && v['delegacion_id'] != _fDele) return false;
      if (_fTipo.isNotEmpty && v['tipo_vehiculo_id'] != _fTipo) return false;
      final activo = (v['activo'] as bool?) ?? true;
      if (_fEstado == 'activos' && !activo) return false;
      if (_fEstado == 'inactivos' && activo) return false;
      final e = _estadoDe(id);
      if (_fWebfleet == 'en_base' && e != 'en_base') return false;
      if (_fWebfleet == 'en_ruta' && e != 'en_ruta') return false;
      if (_fWebfleet == 'sin_conexion' && e != 'sin_conexion') return false;
      if (_fWebfleet == 'pend_base' && !(e == 'en_base' && _revisarPend(id))) return false;
      if (_fWebfleet == 'venc_base' && !(e == 'en_base' && _revVencida(id))) return false;
      final mat = ((v['matricula'] as String?) ?? '').toLowerCase();
      final uni = ((v['numero_unidad'] as String?) ?? '').toLowerCase();
      if (s.isNotEmpty && !mat.contains(s) && !uni.contains(s)) return false;
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final content = _loading
        ? const Center(child: CircularProgressIndicator())
        : (_error != null ? _errorView() : _mainView());
    if (widget.embedded) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Vehículos')),
      body: content,
    );
  }

  Widget _mainView() {
    final k = _kpis;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Cabecera: título + acciones ──
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Row(
            children: [
              const Expanded(
                child: Text('Vehículos',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ),
              _headerBtn('📍 Bases', onTap: () => _avisoWeb('Bases')),
              const SizedBox(width: 8),
              _headerBtn(_sincronizando ? 'Sincronizando…' : '↻ Webfleet',
                  color: AppColors.info,
                  onTap: _sincronizando ? null : _sincronizar),
              const SizedBox(width: 8),
              _headerBtn('+ Nuevo', color: AppColors.success,
                  onTap: () => _avisoWeb('Nuevo vehículo')),
            ],
          ),
        ),
        // ── KPIs Webfleet (clicables para filtrar) ──
        SizedBox(
          height: 78,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              _kpi('en_base', '${k.enBase}', '🟢 En base'),
              _kpi('pend_base', '${k.pendBase}', '🔧 Pendientes en base'),
              _kpi('venc_base', '${k.vencBase}', '⏰ Vencidas en base'),
              _kpi('en_ruta', '${k.enRuta}', '🟠 En ruta'),
              _kpi('sin_conexion', '${k.sinConexion}', '⚪ Sin conexión'),
            ],
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
                  hintText: 'Buscar matrícula o nº unidad',
                  prefixIcon: Icon(Icons.search),
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              _filtroEmpresa(),
              const SizedBox(height: 8),
              _filtroDelegacion(),
              const SizedBox(height: 8),
              _filtroTipo(),
              const SizedBox(height: 8),
              _filtroEstado(),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Text('${_visibles.length} vehículo(s)',
              style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
        ),
        const SizedBox(height: 2),
        // ── Tabla ──
        Expanded(child: _tabla()),
      ],
    );
  }

  Widget _tabla() {
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
                  ? ListView(children: const [
                      SizedBox(height: 60),
                      Center(
                          child: Text('Sin vehículos.',
                              style: TextStyle(color: AppColors.textSecondary))),
                    ])
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
    Widget h(String t, double w) => SizedBox(
          width: w,
          child: Text(t.toUpperCase(),
              style: const TextStyle(
                  color: AppColors.textHint,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4)),
        );
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: [
          h('Empresa', _wEmpresa),
          h('Matrícula', _wMatricula),
          h('Nº unidad', _wUnidad),
          h('Delegación', _wDelegacion),
          h('Marca', _wMarca),
          h('Config.', _wConfig),
          h('Medida', _wMedida),
          h('Km', _wKm),
          h('Webfleet', _wWebfleet),
          h('Estado', _wEstado),
          h('Acciones', _wAcciones),
        ],
      ),
    );
  }

  Widget _dataRow(Map<String, dynamic> v) {
    final id = v['id'] as String;
    final activo = (v['activo'] as bool?) ?? true;
    final medida = (v['medidas_por_eje'] as bool?) == true
        ? 'por eje'
        : (_medidas[v['medida_id']] ?? '—');
    final km = (v['km_actual'] as num?) ?? 0;
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
      decoration: const BoxDecoration(
        border:
            Border(bottom: BorderSide(color: AppColors.cardBorder, width: 0.5)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: [
          c(_nombre(v['empresa']) ?? '—', _wEmpresa,
              color: AppColors.textSecondary),
          c((v['matricula'] as String?) ?? '—', _wMatricula,
              weight: FontWeight.w800),
          c((v['numero_unidad'] as String?) ?? '—', _wUnidad,
              color: AppColors.textSecondary),
          c(_nombre(v['delegacion']) ?? '—', _wDelegacion,
              color: AppColors.textSecondary),
          c((v['marca'] as String?) ?? '—', _wMarca,
              color: AppColors.textSecondary),
          c(_nombre(v['config_ejes']) ?? '—', _wConfig,
              color: AppColors.textSecondary),
          c(medida, _wMedida, color: AppColors.textSecondary),
          c(km > 0 ? km.round().toString() : '0', _wKm,
              color: AppColors.textSecondary),
          SizedBox(width: _wWebfleet, child: _wfBadge(id)),
          SizedBox(
            width: _wEstado,
            child: Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (activo ? AppColors.success : AppColors.textSecondary)
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(activo ? 'Activo' : 'Inactivo',
                    style: TextStyle(
                        color: activo
                            ? AppColors.success
                            : AppColors.textSecondary,
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ),
            ),
          ),
          SizedBox(
            width: _wAcciones,
            child: Row(
              children: [
                InkWell(
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => VehiculoFichaScreen(vehiculoId: id))),
                  child: const Text('Ficha',
                      style: TextStyle(
                          color: AppColors.info,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 10),
                InkWell(
                  onTap: () => _avisoWeb('Editar'),
                  child: const Text('Editar',
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
                ),
                const SizedBox(width: 10),
                InkWell(
                  onTap: () => _avisoWeb(activo ? 'Desactivar' : 'Activar'),
                  child: Text(activo ? 'Desactivar' : 'Activar',
                      style: const TextStyle(
                          color: AppColors.warning, fontSize: 12)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _wfBadge(String id) {
    final est = _wf[id];
    final e = (est?['estado'] as String?) ?? 'sin_dispositivo';
    final color = _wfColor(e);
    // Posición con más de 30 min: se sigue mostrando en base, con aviso.
    bool posAntigua = false;
    final pt = est?['pos_time'] as String?;
    if ((e == 'en_base' || e == 'otra_base') && pt != null) {
      final d = DateTime.tryParse(pt);
      posAntigua =
          d != null && DateTime.now().difference(d).inMinutes > 30;
    }
    final revisar = e == 'en_base' && _revisarPend(id);
    final label = revisar
        ? 'EN BASE · REVISAR'
        : '${_wfLabels[e] ?? e}${posAntigua ? ' · POS. ANT.' : ''}';
    final c = revisar ? AppColors.warning : color;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: c.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
            const SizedBox(width: 5),
            Flexible(
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: c,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3)),
            ),
          ],
        ),
      ),
    );
  }

  // ── Piezas de UI ─────────────────────────────────────────────
  Widget _headerBtn(String label, {Color? color, VoidCallback? onTap}) =>
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
                color: (color ?? AppColors.cardBorder).withValues(alpha: 0.6)),
          ),
          child: Text(label,
              style: TextStyle(
                  color: color ?? AppColors.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w700)),
        ),
      );

  Widget _kpi(String key, String value, String label) {
    final sel = _fWebfleet == key;
    return InkWell(
      onTap: () => setState(() => _fWebfleet = sel ? '' : key),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 128,
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
              color: sel ? AppColors.primary : AppColors.cardBorder,
              width: sel ? 2 : 1),
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
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Widget _filtroEmpresa() {
    final empresas = <String, String>{};
    for (final v in _items) {
      final id = v['empresa_id'] as String?;
      if (id != null) empresas[id] = _nombre(v['empresa']) ?? '—';
    }
    final items = empresas.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return _dropdown(
      value: _fEmpresa,
      hint: 'Todas las empresas',
      items: items
          .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
          .toList(),
      onChanged: (v) => setState(() {
        _fEmpresa = v ?? '';
        _fDele = '';
      }),
    );
  }

  Widget _filtroDelegacion() {
    final deles = <String, String>{};
    for (final v in _items) {
      if (_fEmpresa.isNotEmpty && v['empresa_id'] != _fEmpresa) continue;
      final id = v['delegacion_id'] as String?;
      if (id != null) deles[id] = _nombre(v['delegacion']) ?? '—';
    }
    final items = deles.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return _dropdown(
      value: deles.containsKey(_fDele) ? _fDele : '',
      hint: 'Todas las delegaciones',
      items: items
          .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
          .toList(),
      onChanged: (v) => setState(() => _fDele = v ?? ''),
    );
  }

  Widget _filtroTipo() {
    final tipos = <String, String>{};
    for (final v in _items) {
      final id = v['tipo_vehiculo_id'] as String?;
      final t = v['tipo'];
      if (id != null && t is Map) {
        tipos[id] = (t['descripcion'] as String?) ?? (t['nombre'] as String?) ?? '—';
      }
    }
    final items = tipos.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return _dropdown(
      value: _fTipo,
      hint: 'Todos los tipos',
      items: items
          .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
          .toList(),
      onChanged: (v) => setState(() => _fTipo = v ?? ''),
    );
  }

  Widget _filtroEstado() => _dropdown(
        value: _fEstado == 'todos' ? '' : _fEstado,
        hint: 'Todos',
        items: const [
          DropdownMenuItem(value: 'activos', child: Text('Activos')),
          DropdownMenuItem(value: 'inactivos', child: Text('Inactivos')),
        ],
        onChanged: (v) =>
            setState(() => _fEstado = (v == null || v.isEmpty) ? 'todos' : v),
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

  Widget _errorView() => RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(
          children: [
            const SizedBox(height: 80),
            const Icon(Icons.cloud_off, size: 48, color: AppColors.textSecondary),
            const SizedBox(height: 12),
            const Center(
              child: Text('No se pudieron cargar los vehículos',
                  style: TextStyle(color: AppColors.textSecondary)),
            ),
            const SizedBox(height: 6),
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(_error ?? '',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                        color: AppColors.textHint, fontSize: 12)),
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
}
