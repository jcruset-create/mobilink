import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'review_screen.dart';

class RevisionsScreen extends StatefulWidget {
  final bool embedded;
  /// Pestaña inicial: 0 = Pendientes, 1 = Historial.
  final int initialTab;
  const RevisionsScreen({super.key, this.embedded = false, this.initialTab = 0});

  @override
  State<RevisionsScreen> createState() => _RevisionsScreenState();
}

class _RevisionsScreenState extends State<RevisionsScreen> {
  bool _loading = true;
  List<RevisionVehiculo> _pendientes = [];
  List<RevisionVehiculo> _completadas = [];
  final Map<String, Vehiculo> _vehiculos = {};

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _loading = true);
    try {
      final pend = await TyreControlApi.listarRevisionesPendientesDelTecnico();
      final comp = await TyreControlApi.listarRevisionesCompletadasDelTecnico();
      // Solo las pendientes necesitan el vehículo completo (para reabrir la
      // revisión); el historial ya trae la matrícula en el propio registro.
      for (final r in pend) {
        if (!_vehiculos.containsKey(r.vehiculoId)) {
          final v = await TyreControlApi.obtenerVehiculo(r.vehiculoId);
          if (v != null) _vehiculos[r.vehiculoId] = v;
        }
      }
      if (!mounted) return;
      setState(() {
        _pendientes = pend;
        _completadas = comp;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = DefaultTabController(
      length: 2,
      initialIndex: widget.initialTab,
      child: Column(
        children: [
          const TabBar(
            tabs: [Tab(text: 'Pendientes'), Tab(text: 'Historial')],
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : TabBarView(
                    children: [_pendientesView(), _historialView()],
                  ),
          ),
        ],
      ),
    );
    if (widget.embedded) return content;
    return Scaffold(
      appBar: AppBar(title: Text(widget.initialTab == 1 ? 'Histórico de revisiones' : 'Revisiones')),
      body: content,
    );
  }

  /// Cancela una revisión pendiente, con confirmación. Queda en el
  /// historial como "cancelada"; no se borra nada.
  Future<void> _cancelarRevision(RevisionVehiculo r, String matricula) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancelar revisión'),
        content: Text('¿Cancelar la revisión de $matricula? Quedará en el historial como cancelada.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sí, cancelar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await TyreControlApi.anularRevision(r.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Revisión de $matricula cancelada')));
      await _cargar();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('No se pudo cancelar: ${e.toString().replaceFirst('Exception: ', '')}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  Widget _pendientesView() {
    return RefreshIndicator(
      onRefresh: _cargar,
      child: _pendientes.isEmpty
          ? _vacio(Icons.check_circle_outline, 'No hay revisiones pendientes')
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _pendientes.length,
              itemBuilder: (_, i) {
                final r = _pendientes[i];
                final v = _vehiculos[r.vehiculoId];
                final matricula = v?.matricula ?? '—';
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                    child: Column(
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.directions_car, color: AppColors.primary),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(matricula, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                  Text('${r.fechaRevision} · ${r.kmVehiculo ?? '—'} km · borrador',
                                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () => _cancelarRevision(r, matricula),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppColors.danger,
                                  side: BorderSide(color: AppColors.danger.withValues(alpha: 0.5)),
                                  minimumSize: const Size(0, 44),
                                ),
                                icon: const Icon(Icons.close, size: 18),
                                label: const Text('Cancelar'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: v == null
                                    ? null
                                    : () async {
                                        await Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => ReviewScreen(vehiculo: v, revisionExistente: r)),
                                        );
                                        _cargar(); // al volver, refresca (puede haber pasado a completada)
                                      },
                                style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
                                icon: const Icon(Icons.play_arrow, size: 18),
                                label: const Text('Continuar'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }

  Widget _historialView() {
    return RefreshIndicator(
      onRefresh: _cargar,
      child: _completadas.isEmpty
          ? _vacio(Icons.history, 'Aún no hay revisiones completadas')
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _completadas.length,
              itemBuilder: (_, i) {
                final r = _completadas[i];
                final matricula = r.matricula ?? _vehiculos[r.vehiculoId]?.matricula ?? '—';
                final (etiqueta, color, icono) = switch (r.estadoRevision) {
                  'anulada' => ('Cancelada', AppColors.danger, Icons.cancel),
                  'completada_con_incidencias' => ('Con incidencias solucionadas', AppColors.warning, Icons.build_circle),
                  'completada_incidencia_pendiente' => ('Con incidencia pendiente', AppColors.warning, Icons.warning_amber),
                  _ => ('Completada', AppColors.success, Icons.check_circle),
                };
                return Card(
                  child: ListTile(
                    leading: Icon(icono, color: color),
                    title: Text(matricula, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${_fechaHora(r)} · ${r.kmVehiculo ?? '—'} km'),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(etiqueta,
                          style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
                    ),
                  ),
                );
              },
            ),
    );
  }

  Widget _vacio(IconData icon, String texto) => ListView(
        children: [
          const SizedBox(height: 80),
          Icon(icon, size: 48, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          Center(child: Text(texto, style: const TextStyle(color: AppColors.textSecondary))),
        ],
      );

  // Fecha del día + hora real (de created_at) para el historial.
  String _fechaHora(RevisionVehiculo r) {
    final fecha = r.fechaRevision;
    if (r.createdAt == null) return fecha;
    final dt = DateTime.tryParse(r.createdAt!)?.toLocal();
    if (dt == null) return fecha;
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$fecha · $hh:$mm';
  }
}
