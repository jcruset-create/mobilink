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
          if (neu.isNotEmpty || pos.isNotEmpty)
            Text([neu, pos].where((s) => s.isNotEmpty).join(' · '),
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
