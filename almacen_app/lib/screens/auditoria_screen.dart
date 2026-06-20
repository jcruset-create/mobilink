import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final _db = Supabase.instance.client;

class AuditoriaScreen extends StatefulWidget {
  const AuditoriaScreen({super.key});

  @override
  State<AuditoriaScreen> createState() => _AuditoriaScreenState();
}

class _AuditoriaScreenState extends State<AuditoriaScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  final _codigoCtrl = TextEditingController();
  final _traspasoCtrl = TextEditingController();
  String _filtroAccion = '';
  DateTime? _desde;
  DateTime? _hasta;
  int _pagina = 0;
  bool _hayMas = false;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  @override
  void dispose() {
    _codigoCtrl.dispose();
    _traspasoCtrl.dispose();
    super.dispose();
  }

  Future<void> _cargar({bool masItems = false}) async {
    if (!masItems) setState(() { _loading = true; _error = null; });

    try {
      final rangoDesde = _pagina * 50;
      final rangoHasta = rangoDesde + 49;

      var qBase = _db.from('traspasos_auditoria_detalle').select('*');
      if (_codigoCtrl.text.trim().isNotEmpty) {
        qBase = qBase.ilike('codigo_personal', '%${_codigoCtrl.text.trim()}%');
      }
      if (_traspasoCtrl.text.trim().isNotEmpty) {
        qBase = qBase.ilike('traspaso_codigo', '%${_traspasoCtrl.text.trim()}%');
      }
      if (_filtroAccion.isNotEmpty) {
        qBase = qBase.eq('accion', _filtroAccion);
      }
      if (_desde != null) {
        qBase = qBase.gte('created_at',
            '${_desde!.toIso8601String().substring(0, 10)}T00:00:00');
      }
      if (_hasta != null) {
        qBase = qBase.lte('created_at',
            '${_hasta!.toIso8601String().substring(0, 10)}T23:59:59');
      }

      final res = await qBase
          .order('created_at', ascending: false)
          .range(rangoDesde, rangoHasta);
      final nuevos = List<Map<String, dynamic>>.from(res);

      if (mounted) {
        setState(() {
          if (masItems) {
            _items = [..._items, ...nuevos];
          } else {
            _items = nuevos;
            _pagina = 0;
          }
          _hayMas = nuevos.length == 50;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _cargarMas() async {
    setState(() => _pagina++);
    await _cargar(masItems: true);
  }

  Future<void> _limpiar() async {
    _codigoCtrl.clear();
    _traspasoCtrl.clear();
    setState(() { _filtroAccion = ''; _desde = null; _hasta = null; _pagina = 0; });
    await _cargar();
  }

  Future<void> _filtrarHoy() async {
    final hoy = DateTime.now();
    setState(() {
      _desde = DateTime(hoy.year, hoy.month, hoy.day);
      _hasta = _desde;
      _pagina = 0;
    });
    await _cargar();
  }

  Future<void> _filtrar7dias() async {
    final hoy = DateTime.now();
    setState(() {
      _hasta = DateTime(hoy.year, hoy.month, hoy.day);
      _desde = _hasta!.subtract(const Duration(days: 6));
      _pagina = 0;
    });
    await _cargar();
  }

  Future<void> _filtrar30dias() async {
    final hoy = DateTime.now();
    setState(() {
      _hasta = DateTime(hoy.year, hoy.month, hoy.day);
      _desde = _hasta!.subtract(const Duration(days: 29));
      _pagina = 0;
    });
    await _cargar();
  }

  Future<void> _seleccionarFecha(bool esDesdeFecha) async {
    final inicial =
        esDesdeFecha ? (_desde ?? DateTime.now()) : (_hasta ?? DateTime.now());
    final picked = await showDatePicker(
      context: context,
      initialDate: inicial,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
      builder: (context, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(primary: Colors.blue),
        ),
        child: child!,
      ),
    );
    if (picked != null && mounted) {
      setState(() {
        if (esDesdeFecha) _desde = picked;
        else _hasta = picked;
        _pagina = 0;
      });
    }
  }

  String _fmtDate(DateTime? d) {
    if (d == null) return 'Seleccionar';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
  }

  String _fmtDateTime(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return iso;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  Color _accionColor(String accion) {
    if (accion == 'recogida' || accion == 'aceptacion_transporte') return Colors.blue;
    if (accion == 'recepcion') return Colors.green;
    return Colors.grey;
  }

  String _accionLabel(String accion) {
    if (accion == 'aceptacion_transporte' || accion == 'recogida') return 'Recogida';
    if (accion == 'recepcion') return 'Recepción';
    return accion;
  }

  int get _totalRecogidas => _items
      .where((x) => x['accion'] == 'recogida' || x['accion'] == 'aceptacion_transporte')
      .length;
  int get _totalRecepciones =>
      _items.where((x) => x['accion'] == 'recepcion').length;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
        title: const Text('Auditoría',
            style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white)),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              onPressed: _cargar),
        ],
      ),
      body: Column(
        children: [
          // Panel de filtros
          Container(
            color: const Color(0xFF16213e),
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _codigoCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: _inputDeco('Código personal', Icons.person),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _traspasoCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration:
                            _inputDeco('Código traspaso', Icons.local_shipping),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  value: _filtroAccion.isEmpty ? null : _filtroAccion,
                  dropdownColor: const Color(0xFF16213e),
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDeco('Acción', Icons.filter_list),
                  items: const [
                    DropdownMenuItem(value: '', child: Text('Todas')),
                    DropdownMenuItem(
                        value: 'aceptacion_transporte',
                        child: Text('Recogidas')),
                    DropdownMenuItem(
                        value: 'recepcion', child: Text('Recepciones')),
                  ],
                  onChanged: (v) => setState(() => _filtroAccion = v ?? ''),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _seleccionarFecha(true),
                        icon: const Icon(Icons.calendar_today,
                            size: 14, color: Colors.white54),
                        label: Text('Desde: ${_fmtDate(_desde)}',
                            style: const TextStyle(
                                fontSize: 12, color: Colors.white70)),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Colors.white24),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _seleccionarFecha(false),
                        icon: const Icon(Icons.calendar_today,
                            size: 14, color: Colors.white54),
                        label: Text('Hasta: ${_fmtDate(_hasta)}',
                            style: const TextStyle(
                                fontSize: 12, color: Colors.white70)),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Colors.white24),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _btnFiltro('Hoy', _filtrarHoy)),
                    const SizedBox(width: 6),
                    Expanded(child: _btnFiltro('7 días', _filtrar7dias)),
                    const SizedBox(width: 6),
                    Expanded(child: _btnFiltro('30 días', _filtrar30dias)),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () {
                          setState(() => _pagina = 0);
                          _cargar();
                        },
                        icon: const Icon(Icons.search, size: 16),
                        label: const Text('Buscar'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.blue,
                          foregroundColor: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _limpiar,
                        icon: const Icon(Icons.clear,
                            size: 16, color: Colors.white54),
                        label: const Text('Limpiar',
                            style: TextStyle(color: Colors.white54)),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Colors.white24),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Resumen
          if (!_loading)
            Container(
              color: const Color(0xFF16213e),
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                      child: _resumenItem(
                          'Recogidas', '$_totalRecogidas', Colors.blue)),
                  Expanded(
                      child: _resumenItem(
                          'Recepciones', '$_totalRecepciones', Colors.green)),
                  Expanded(
                      child: _resumenItem(
                          'Total', '${_items.length}', Colors.white54)),
                ],
              ),
            ),

          const Divider(height: 1, color: Colors.white12),

          // Lista
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: Colors.blue))
                : _error != null
                    ? Center(
                        child: Text(_error!,
                            style:
                                const TextStyle(color: Colors.redAccent)))
                    : _items.isEmpty
                        ? const Center(
                            child: Text('No hay registros.',
                                style: TextStyle(color: Colors.white54)))
                        : ListView.builder(
                            padding: const EdgeInsets.all(12),
                            itemCount: _items.length + (_hayMas ? 1 : 0),
                            itemBuilder: (_, i) {
                              if (i == _items.length) {
                                return Padding(
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 8),
                                  child: ElevatedButton(
                                    onPressed: _cargarMas,
                                    style: ElevatedButton.styleFrom(
                                        backgroundColor: Colors.blue),
                                    child: const Text('Cargar más'),
                                  ),
                                );
                              }
                              final item = _items[i];
                              final accion =
                                  item['accion'] as String? ?? '';
                              final color = _accionColor(accion);
                              final label = _accionLabel(accion);

                              return Card(
                                color: const Color(0xFF16213e),
                                margin: const EdgeInsets.only(bottom: 8),
                                shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12)),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              item['traspaso_codigo']
                                                      as String? ??
                                                  'Sin código',
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 15,
                                                  color: Colors.white),
                                            ),
                                          ),
                                          Container(
                                            padding:
                                                const EdgeInsets.symmetric(
                                                    horizontal: 8,
                                                    vertical: 3),
                                            decoration: BoxDecoration(
                                              color: color.withOpacity(0.2),
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              border:
                                                  Border.all(color: color),
                                            ),
                                            child: Text(label,
                                                style: TextStyle(
                                                    color: color,
                                                    fontSize: 11,
                                                    fontWeight:
                                                        FontWeight.bold)),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                          'Operario: ${item['codigo_personal'] ?? '—'}',
                                          style: const TextStyle(
                                              color: Colors.white54,
                                              fontSize: 13)),
                                      const SizedBox(height: 2),
                                      Text(
                                        '${item['estado_anterior'] ?? '—'} → ${item['estado_nuevo'] ?? '—'}',
                                        style: const TextStyle(
                                            fontSize: 12,
                                            color: Colors.white70),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        _fmtDateTime(
                                            item['created_at'] as String?),
                                        style: const TextStyle(
                                            color: Colors.white38,
                                            fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }

  Widget _btnFiltro(String label, VoidCallback onTap) => OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 8),
          side: const BorderSide(color: Colors.white24),
          textStyle: const TextStyle(fontSize: 12),
          foregroundColor: Colors.white70,
        ),
        child: Text(label),
      );

  Widget _resumenItem(String label, String value, Color color) => Column(
        children: [
          Text(value,
              style: TextStyle(
                  color: color,
                  fontSize: 22,
                  fontWeight: FontWeight.w900)),
          Text(label,
              style:
                  const TextStyle(color: Colors.white38, fontSize: 11)),
        ],
      );

  InputDecoration _inputDeco(String hint, IconData icon) => InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white38),
        prefixIcon: Icon(icon, size: 18, color: Colors.white38),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        enabledBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Colors.white24),
          borderRadius: BorderRadius.circular(10),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: Colors.blue),
          borderRadius: BorderRadius.circular(10),
        ),
      );
}
