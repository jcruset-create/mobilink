import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'review_screen.dart';

class RevisionsScreen extends StatefulWidget {
  final bool embedded;
  const RevisionsScreen({super.key, this.embedded = false});

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
    return Scaffold(appBar: AppBar(title: const Text('Revisiones')), body: content);
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
                return Card(
                  child: ListTile(
                    leading: const Icon(Icons.directions_car, color: AppColors.primary),
                    title: Text(v?.matricula ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${r.fechaRevision} · ${r.kmVehiculo ?? '—'} km · borrador'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: v == null
                        ? null
                        : () async {
                            await Navigator.of(context).push(
                              MaterialPageRoute(builder: (_) => ReviewScreen(vehiculo: v, revisionExistente: r)),
                            );
                            _cargar(); // al volver, refresca (puede haber pasado a completada)
                          },
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
                return Card(
                  child: ListTile(
                    leading: const Icon(Icons.check_circle, color: AppColors.success),
                    title: Text(matricula, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${_fechaHora(r)} · ${r.kmVehiculo ?? '—'} km'),
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
