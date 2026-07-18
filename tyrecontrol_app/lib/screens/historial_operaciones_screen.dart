import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Histórico de operaciones de un vehículo, agrupado por intervención
/// (sesión de cambio) con su informe. Al tocar una intervención se ven sus
/// operaciones (la "ficha" de cada una).
class HistorialOperacionesScreen extends StatefulWidget {
  final String vehiculoId;
  final String matricula;
  const HistorialOperacionesScreen({super.key, required this.vehiculoId, this.matricula = ''});

  @override
  State<HistorialOperacionesScreen> createState() => _HistorialOperacionesScreenState();
}

const _tipoLabels = {
  'montaje': 'Montaje', 'desmontaje': 'Desmontaje', 'sustitucion': 'Sustitución', 'rotacion': 'Rotación',
  'reparacion': 'Reparación', 'descarte': 'Descarte', 'entrada_almacen': 'Entrada almacén', 'salida_almacen': 'Salida almacén',
  'revision_vehiculo': 'Revisión', 'cambio_posicion': 'Cambio de posición', 'intercambio': 'Intercambio',
  'correccion_posicion': 'Corrección posición', 'correccion_montado': 'Corrección montado',
};

class _HistorialOperacionesScreenState extends State<HistorialOperacionesScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _intervenciones = [];

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { _loading = true; _error = null; });
    try {
      final iv = await TyreControlApi.listarIntervencionesVehiculo(widget.vehiculoId);
      if (!mounted) return;
      setState(() => _intervenciones = iv);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verDetalle(Map<String, dynamic> iv) async {
    List<Map<String, dynamic>> ops = [];
    try { ops = await TyreControlApi.listarOperacionesDeIntervencion(iv['id'] as String); } catch (_) {}
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => DraggableScrollableSheet(
        expand: false, initialChildSize: 0.7, maxChildSize: 0.95,
        builder: (_, scroll) => ListView(
          controller: scroll,
          padding: const EdgeInsets.all(16),
          children: [
            Text('Intervención · ${_fecha(iv['fecha'] as String?)}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.success.withValues(alpha: 0.3)),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('INFORME', style: TextStyle(color: AppColors.success, fontSize: 11, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(((iv['resumen_ia'] as String?)?.isNotEmpty == true ? iv['resumen_ia'] : iv['resumen']) as String? ?? '—',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
              ]),
            ),
            ..._trazabilidad(iv),
            const SizedBox(height: 12),
            const Text('OPERACIONES', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            if (ops.isEmpty)
              const Text('Sin operaciones registradas.', style: TextStyle(color: AppColors.textHint))
            else
              ...ops.map(_filaOperacion),
          ],
        ),
      ),
    );
  }

  static List<Map<String, dynamic>> _lista(dynamic v) =>
      v is List ? v.map((e) => Map<String, dynamic>.from(e as Map)).toList() : <Map<String, dynamic>>[];

  /// Bloque de trazabilidad: avería de origen + planos Antes/Después.
  List<Widget> _trazabilidad(Map<String, dynamic> iv) {
    final incidencias = _lista(iv['incidencias']);
    final antes = _lista(iv['montaje_antes']);
    final despues = _lista(iv['montaje_despues']);
    final imagen = iv['imagen_chasis'] as String?;
    if (incidencias.isEmpty && antes.isEmpty && despues.isEmpty) return const [];

    // Posiciones cuyo neumático cambió (verde en el "después").
    final antesPorPos = {for (final a in antes) a['posicion_id']: a};
    final cambiadas = <String>{};
    for (final d in despues) {
      final a = antesPorPos[d['posicion_id']];
      if (a == null || a['marca'] != d['marca'] || a['medida'] != d['medida'] || a['mm'] != d['mm']) {
        if (d['posicion_id'] != null) cambiadas.add(d['posicion_id'] as String);
      }
    }
    return [
      const SizedBox(height: 12),
      if (incidencias.isNotEmpty) ...[
        const Text('AVERÍA DE ORIGEN', style: TextStyle(color: AppColors.danger, fontSize: 11, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        ...incidencias.map((i) {
          final averias = i['averias'] is List ? (i['averias'] as List).whereType<String>().toList() : <String>[];
          return Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Text('${i['codigo'] ?? '—'}: ${averias.join(' · ')}${i['gravedad'] != null ? ' (${i['gravedad']})' : ''}',
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
          );
        }),
        const SizedBox(height: 10),
      ],
      if (antes.isNotEmpty || despues.isNotEmpty)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('ANTES', style: TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            _SnapshotPlano(imagen: imagen, items: antes, conAveria: true),
          ])),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('DESPUÉS', style: TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w800)),
            const SizedBox(height: 3),
            _SnapshotPlano(imagen: imagen, items: despues, cambiadas: cambiadas),
          ])),
        ]),
    ];
  }

  static String _fechaHora(Map<String, dynamic> o) {
    final f = _fecha(o['fecha_operacion'] as String?);
    final ca = DateTime.tryParse('${o['created_at'] ?? ''}');
    if (ca == null) return f;
    final h = '${ca.hour.toString().padLeft(2, '0')}:${ca.minute.toString().padLeft(2, '0')}';
    return '$f · $h';
  }

  Widget _filaOperacion(Map<String, dynamic> o) {
    final tipo = _tipoLabels[o['tipo_operacion']] ?? '${o['tipo_operacion']}';
    final n = o['neumatico'];
    final neu = n is Map ? [n['marca'], n['medida']].whereType<String>().join(' ') : '';
    final pd = o['posicion_destino'], po = o['posicion_origen'];
    final pos = (pd is Map ? pd['codigo_posicion'] : null) ?? (po is Map ? po['codigo_posicion'] : null) ?? '';
    final anulada = (o['is_anulada'] as bool?) == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$tipo${anulada ? ' (anulada)' : ''}',
              style: TextStyle(color: anulada ? AppColors.textHint : AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
          Text([_fechaHora(o), neu, pos].where((s) => s.isNotEmpty).join(' · '),
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ])),
      ]),
    );
  }

  static String _fecha(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso);
    return d == null ? iso : '${d.day}/${d.month}/${d.year}';
  }

  // (_SnapshotPlano se define fuera de la clase, más abajo)

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.matricula.isEmpty ? 'Operaciones' : 'Operaciones · ${widget.matricula}')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
              : _intervenciones.isEmpty
                  ? const Center(child: Padding(padding: EdgeInsets.all(24),
                      child: Text('Sin intervenciones registradas para este vehículo.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textHint))))
                  : RefreshIndicator(
                      onRefresh: _cargar,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _intervenciones.length,
                        itemBuilder: (_, i) {
                          final iv = _intervenciones[i];
                          final informe = ((iv['resumen_ia'] as String?)?.isNotEmpty == true ? iv['resumen_ia'] : iv['resumen']) as String? ?? '—';
                          return Card(
                            color: AppColors.surface,
                            margin: const EdgeInsets.only(bottom: 8),
                            child: ListTile(
                              title: Text('${_fecha(iv['fecha'] as String?)} · ${iv['n_operaciones'] ?? 0} operación(es)',
                                  style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                              subtitle: Text(informe, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
                              trailing: const Icon(Icons.chevron_right, color: AppColors.textHint),
                              onTap: () => _verDetalle(iv),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

/// Plano de un snapshot pintado sobre la imagen real del chasis, con una
/// tarjeta por posición en sus coordenadas (%). Si no hay imagen, cae a una
/// lista compacta por posición.
class _SnapshotPlano extends StatefulWidget {
  final String? imagen;
  final List<Map<String, dynamic>> items;
  final bool conAveria;
  final Set<String> cambiadas;
  const _SnapshotPlano({this.imagen, required this.items, this.conAveria = false, this.cambiadas = const {}});

  @override
  State<_SnapshotPlano> createState() => _SnapshotPlanoState();
}

class _SnapshotPlanoState extends State<_SnapshotPlano> {
  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  @override
  void initState() {
    super.initState();
    final url = widget.imagen;
    if (url != null && url.isNotEmpty) _resolver(url);
  }

  @override
  void dispose() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    super.dispose();
  }

  void _resolver(String url) {
    final img = NetworkImage(url);
    _stream = img.resolve(ImageConfiguration.empty);
    _listener = ImageStreamListener((info, _) {
      final w = info.image.width.toDouble(), h = info.image.height.toDouble();
      if (h > 0 && mounted) setState(() => _aspect = w / h);
    }, onError: (_, __) { if (mounted) setState(() => _aspect = 0.62); });
    _stream!.addListener(_listener!);
  }

  Color _borde(Map<String, dynamic> s) {
    final averia = widget.conAveria && s['averias'] is List && (s['averias'] as List).isNotEmpty;
    if (averia) return AppColors.danger;
    if (widget.cambiadas.contains(s['posicion_id'])) return AppColors.success;
    return AppColors.cardBorder;
  }

  Widget _tarjeta(Map<String, dynamic> s, double w, double h) {
    final x = (s['x'] as num?)?.toDouble() ?? 0;
    final y = (s['y'] as num?)?.toDouble() ?? 0;
    final cw = (s['w'] as num?)?.toDouble() ?? 16;
    final cardW = (cw / 100 * w).clamp(58.0, 150.0);
    final borde = _borde(s);
    final marca = s['marca'] as String?;
    final mm = s['mm'];
    final averias = s['averias'] is List ? (s['averias'] as List).whereType<String>().toList() : const <String>[];
    return Positioned(
      left: (x / 100 * w).clamp(0.0, w - cardW),
      top: (y / 100 * h).clamp(0.0, h - 24),
      width: cardW,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
        decoration: BoxDecoration(
          color: AppColors.surface.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: borde, width: 1.5),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s['codigo']?.toString() ?? '—', style: TextStyle(fontSize: 7, fontWeight: FontWeight.w700, color: borde), maxLines: 1, overflow: TextOverflow.ellipsis),
          Text(marca ?? 'Libre', style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w600, color: AppColors.textPrimary), maxLines: 1, overflow: TextOverflow.ellipsis),
          if (marca != null)
            Text(mm != null ? '$mm mm' : '— mm', style: const TextStyle(fontSize: 7, color: AppColors.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
          if (widget.conAveria && averias.isNotEmpty)
            Text('⚠ ${averias.join(' · ')}', style: const TextStyle(fontSize: 7, fontWeight: FontWeight.w700, color: AppColors.danger), maxLines: 2, overflow: TextOverflow.ellipsis),
        ]),
      ),
    );
  }

  Widget _listaFallback() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final s in widget.items)
        Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: Text(
            '${s['codigo'] ?? '—'}: ${s['marca'] ?? 'Libre'}${s['medida'] != null ? ' ${s['medida']}' : ''}'
            '${s['mm'] != null ? ' · ${s['mm']} mm' : ''}'
            '${widget.conAveria && s['averias'] is List && (s['averias'] as List).isNotEmpty ? '  ⚠ ${(s['averias'] as List).join(' · ')}' : ''}',
            style: TextStyle(
              fontSize: 11,
              color: _borde(s) == AppColors.cardBorder ? AppColors.textSecondary : _borde(s),
            ),
          ),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.imagen;
    if (url == null || url.isEmpty || _aspect == null) return _listaFallback();
    return LayoutBuilder(builder: (ctx, c) {
      final w = c.maxWidth;
      final h = w / _aspect!;
      return SizedBox(
        width: w, height: h,
        child: Stack(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(url, width: w, height: h, fit: BoxFit.fill,
                errorBuilder: (_, __, ___) => Container(color: AppColors.surfaceVariant)),
          ),
          for (final s in widget.items) _tarjeta(s, w, h),
        ]),
      );
    });
  }
}
