import 'package:flutter/material.dart';
import '../models/incidencias.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Menú "Incidencias" (Fase 1): lista con pestañas y tarjetas. Las acciones
/// de resolver/reprogramar llegan en fases posteriores; aquí es consulta.
class IncidenciasScreen extends StatefulWidget {
  final bool embedded;
  const IncidenciasScreen({super.key, this.embedded = false});

  @override
  State<IncidenciasScreen> createState() => _IncidenciasScreenState();
}

const _tabs = ['Pendientes', 'Planificadas', 'En curso', 'Solucionadas'];
const _estadosPorTab = [
  ['detectada', 'pendiente_autorizacion', 'autorizada', 'pendiente_material', 'pendiente_vehiculo'],
  ['planificada'],
  ['en_curso'],
  ['solucionada'],
];

class _IncidenciasScreenState extends State<IncidenciasScreen> {
  bool _loading = true;
  String? _error;
  List<Incidencia> _todas = [];

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
      final lista = await TyreControlApi.listarIncidencias();
      await TyreControlApi.contarIncidenciasPendientes();
      if (!mounted) return;
      setState(() => _todas = lista);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = DefaultTabController(
      length: _tabs.length,
      child: Column(
        children: [
          TabBar(
            isScrollable: true,
            tabs: [
              for (int i = 0; i < _tabs.length; i++)
                Tab(text: '${_tabs[i]} (${_conteo(i)})'),
            ],
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _errorView()
                    : TabBarView(
                        children: [for (int i = 0; i < _tabs.length; i++) _lista(i)],
                      ),
          ),
        ],
      ),
    );
    if (widget.embedded) return content;
    return Scaffold(appBar: AppBar(title: const Text('Incidencias')), body: content);
  }

  int _conteo(int tab) =>
      _todas.where((i) => _estadosPorTab[tab].contains(i.estado)).length;

  List<Incidencia> _deTab(int tab) {
    final l = _todas.where((i) => _estadosPorTab[tab].contains(i.estado)).toList();
    // Orden: críticas primero, luego más antiguas.
    l.sort((a, b) {
      final g = b.gravedad.index.compareTo(a.gravedad.index);
      if (g != 0) return g;
      return a.detectadaAt.compareTo(b.detectadaAt);
    });
    return l;
  }

  Widget _lista(int tab) {
    final items = _deTab(tab);
    return RefreshIndicator(
      onRefresh: _cargar,
      child: items.isEmpty
          ? ListView(children: const [
              SizedBox(height: 100),
              Icon(Icons.check_circle_outline, size: 48, color: AppColors.textSecondary),
              SizedBox(height: 12),
              Center(child: Text('Sin incidencias', style: TextStyle(color: AppColors.textSecondary))),
            ])
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              itemBuilder: (_, i) => _Tarjeta(incidencia: items[i], onVerDetalle: () => _detalle(items[i])),
            ),
    );
  }

  void _detalle(Incidencia inc) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${inc.matricula ?? '—'} · ${inc.posicionNombre ?? ''}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('${inc.cliente ?? ''} · ${inc.base ?? ''}',
                style: const TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final t in inc.tipos)
                Chip(label: Text(problemaLabel(t)), backgroundColor: AppColors.surfaceVariant),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              Icon(Icons.circle, size: 12, color: gravedadColor(inc.gravedad)),
              const SizedBox(width: 6),
              Text(gravedadLabel(inc.gravedad)),
              const Spacer(),
              Text(kEstadoIncidenciaLabels[inc.estado] ?? inc.estado,
                  style: const TextStyle(color: AppColors.textSecondary)),
            ]),
            if (inc.fotoUrl != null) ...[
              const SizedBox(height: 12),
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.network(inc.fotoUrl!, height: 200, width: double.infinity, fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink()),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Resolver incidencias llegará en la próxima versión.')));
                },
                icon: const Icon(Icons.build),
                label: const Text('Solucionar'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorView() => RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(children: [
          const SizedBox(height: 80),
          const Icon(Icons.cloud_off, size: 48, color: AppColors.textSecondary),
          const SizedBox(height: 12),
          const Center(child: Text('No se pudieron cargar las incidencias', style: TextStyle(color: AppColors.textSecondary))),
          const SizedBox(height: 6),
          Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(_error ?? '', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textHint, fontSize: 12)))),
        ]),
      );
}

class _Tarjeta extends StatelessWidget {
  final Incidencia incidencia;
  final VoidCallback onVerDetalle;
  const _Tarjeta({required this.incidencia, required this.onVerDetalle});

  @override
  Widget build(BuildContext context) {
    final inc = incidencia;
    final color = gravedadColor(inc.gravedad);
    return Card(
      child: InkWell(
        onTap: onVerDetalle,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('${inc.matricula ?? '—'} · ${inc.posicionNombre ?? ''}',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                    child: Text(gravedadLabel(inc.gravedad).toUpperCase(),
                        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('${inc.cliente ?? ''}${inc.base != null ? ' · Base ${inc.base}' : ''}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 6),
              Text(inc.tipos.map(problemaLabel).join(' · '),
                  maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13)),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(kEstadoIncidenciaLabels[inc.estado] ?? inc.estado,
                      style: const TextStyle(color: AppColors.textHint, fontSize: 11)),
                  const Spacer(),
                  Text('${inc.diasPendiente} d',
                      style: const TextStyle(color: AppColors.textHint, fontSize: 11)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
