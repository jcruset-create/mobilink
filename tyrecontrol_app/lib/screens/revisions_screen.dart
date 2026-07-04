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
  final Map<String, Vehiculo> _vehiculos = {};

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _loading = true);
    try {
      final revs = await TyreControlApi.listarRevisionesPendientesDelTecnico();
      for (final r in revs) {
        if (!_vehiculos.containsKey(r.vehiculoId)) {
          final v = await TyreControlApi.obtenerVehiculo(r.vehiculoId);
          if (v != null) _vehiculos[r.vehiculoId] = v;
        }
      }
      if (!mounted) return;
      setState(() => _pendientes = revs);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = RefreshIndicator(
      onRefresh: _cargar,
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : _pendientes.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: 80),
                    Icon(Icons.check_circle_outline, size: 48, color: AppColors.textSecondary),
                    SizedBox(height: 12),
                    Center(child: Text('No hay revisiones pendientes', style: TextStyle(color: AppColors.textSecondary))),
                  ],
                )
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
                            : () => Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => ReviewScreen(vehiculo: v, revisionExistente: r)),
                                ),
                      ),
                    );
                  },
                ),
    );
    if (widget.embedded) return body;
    return Scaffold(appBar: AppBar(title: const Text('Revisiones pendientes')), body: body);
  }
}
