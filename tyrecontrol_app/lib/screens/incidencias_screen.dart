import 'package:flutter/material.dart';
import '../models/incidencias.dart';
import '../models/incidencias_grupos.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import 'vehiculo_ficha_screen.dart';

/// Menú "Incidencias": una tarjeta por REVISIÓN (no por incidencia), con
/// todas las incidencias de esa revisión dentro. La agrupación vive en
/// models/incidencias_grupos.dart (pura y testeada); aquí solo presentación.
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
const _vaciosPorTab = [
  'No hay revisiones con incidencias pendientes.',
  'No hay soluciones planificadas.',
  'No hay trabajos en curso.',
  'No hay incidencias solucionadas.',
];

class _IncidenciasScreenState extends State<IncidenciasScreen> {
  bool _loading = true;
  String? _error;
  List<Incidencia> _todas = [];
  final Set<String> _expandidas = {}; // claves de grupo expandidas

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

  List<Incidencia> _deTab(int tab) =>
      _todas.where((i) => _estadosPorTab[tab].contains(i.estado)).toList();

  @override
  Widget build(BuildContext context) {
    final content = DefaultTabController(
      length: _tabs.length,
      child: Column(
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              for (int i = 0; i < _tabs.length; i++)
                Tab(text: _etiquetaTab(i)),
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

  String _etiquetaTab(int i) {
    final c = conteoTab(_deTab(i));
    if (c.incidencias == 0) return _tabs[i];
    final rev = c.revisiones == 1 ? '1 revisión' : '${c.revisiones} revisiones';
    final inc = c.incidencias == 1 ? '1 incidencia' : '${c.incidencias} incidencias';
    return '${_tabs[i]} ($rev · $inc)';
  }

  Widget _lista(int tab) {
    final grupos = agruparPorRevision(_deTab(tab));
    return RefreshIndicator(
      onRefresh: _cargar,
      child: grupos.isEmpty
          ? ListView(children: [
              const SizedBox(height: 100),
              const Icon(Icons.check_circle_outline, size: 48, color: AppColors.textSecondary),
              const SizedBox(height: 12),
              Center(
                  child: Text(_vaciosPorTab[tab],
                      style: const TextStyle(color: AppColors.textSecondary))),
            ])
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: grupos.length,
              itemBuilder: (_, i) => _TarjetaRevision(
                grupo: grupos[i],
                tab: tab,
                expandida: _expandidas.contains(grupos[i].clave),
                onToggleExpandir: () => setState(() {
                  _expandidas.contains(grupos[i].clave)
                      ? _expandidas.remove(grupos[i].clave)
                      : _expandidas.add(grupos[i].clave);
                }),
                onIncidencia: _detalleIncidencia,
                onVerVehiculo: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => VehiculoFichaScreen(vehiculoId: grupos[i].vehiculoId))),
                onAccionFutura: _avisoFase2,
              ),
            ),
    );
  }

  void _avisoFase2(String accion) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('"$accion" llegará en la próxima versión.')));
  }

  void _detalleIncidencia(Incidencia inc) {
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
            Text('${inc.matricula ?? '—'} · ${inc.posicionTexto}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('Revisión: ${fechaCortaIncidencia(inc.revisionFecha ?? inc.detectadaAt)}',
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
            if (inc.accionRecomendada != null && inc.accionRecomendada!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Acción recomendada: ${inc.accionRecomendada}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ],
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
                  _avisoFase2('Solucionar');
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
          const SizedBox(height: 16),
          Center(child: OutlinedButton.icon(onPressed: _cargar, icon: const Icon(Icons.refresh), label: const Text('Reintentar'))),
        ]),
      );
}

// ── Tarjeta por revisión ─────────────────────────────────────
const _kVisiblesColapsada = 2;

class _TarjetaRevision extends StatelessWidget {
  final GrupoRevision grupo;
  final int tab;
  final bool expandida;
  final VoidCallback onToggleExpandir;
  final void Function(Incidencia) onIncidencia;
  final VoidCallback onVerVehiculo;
  final void Function(String accion) onAccionFutura;

  const _TarjetaRevision({
    required this.grupo,
    required this.tab,
    required this.expandida,
    required this.onToggleExpandir,
    required this.onIncidencia,
    required this.onVerVehiculo,
    required this.onAccionFutura,
  });

  String get _estadoGeneral => switch (tab) {
        1 => 'PLANIFICADO',
        2 => 'EN CURSO',
        3 => 'SOLUCIONADO',
        _ => gravedadLabel(grupo.gravedadMax).toUpperCase(),
      };

  Color get _colorGeneral => switch (tab) {
        1 => AppColors.info,
        2 => AppColors.primary,
        3 => AppColors.success,
        _ => gravedadColor(grupo.gravedadMax),
      };

  @override
  Widget build(BuildContext context) {
    final n = grupo.incidencias.length;
    final visibles = expandida ? grupo.incidencias : grupo.incidencias.take(_kVisiblesColapsada).toList();
    final ocultas = n - visibles.length;
    final sufijo = switch (tab) {
      1 => 'planificadas',
      2 => 'en curso',
      3 => 'solucionadas',
      _ => 'pendientes',
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Cabecera ──
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.local_shipping, color: AppColors.textSecondary, size: 30),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(grupo.matricula ?? '—',
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 2),
                      Text(
                        'Revisión: ${fechaCortaIncidencia(grupo.fechaRevision)}'
                        '${grupo.horaRevision != null ? ' · ${grupo.horaRevision}' : ''}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                      ),
                      Text(
                        '${grupo.cliente ?? 'Cliente no informado'} · ${grupo.base != null ? 'Base ${grupo.base}' : 'Base no informada'}',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                      ),
                      if (grupo.tecnicoNombre != null)
                        Text('Técnico: ${grupo.tecnicoNombre}',
                            style: const TextStyle(color: AppColors.textHint, fontSize: 12)),
                      if (grupo.sinRevision)
                        const Text('Sin revisión asociada',
                            style: TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: _colorGeneral,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(_estadoGeneral,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12, fontWeight: FontWeight.w900)),
                    ),
                    const SizedBox(height: 6),
                    Text('$n ${n == 1 ? 'incidencia' : 'incidencias'} $sufijo',
                        style: TextStyle(color: _colorGeneral, fontSize: 12, fontWeight: FontWeight.w700)),
                  ],
                ),
              ],
            ),
            const Divider(height: 22, color: AppColors.cardBorder),
            // ── Incidencias ──
            ...visibles.map((i) => _FilaIncidencia(incidencia: i, onTap: () => onIncidencia(i))),
            if (ocultas > 0 || (expandida && n > _kVisiblesColapsada))
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: onToggleExpandir,
                  icon: Icon(expandida ? Icons.expand_less : Icons.expand_more, size: 18),
                  label: Text(expandida
                      ? 'Mostrar menos'
                      : 'Ver las $n incidencias (+$ocultas más)'),
                ),
              ),
            const SizedBox(height: 4),
            // ── Acciones según pestaña ──
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onVerVehiculo,
                    icon: const Icon(Icons.assignment_outlined, size: 18),
                    label: const Text('Ver revisión'),
                  ),
                ),
                const SizedBox(width: 8),
                ..._botonesTab(),
              ],
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _botonesTab() {
    List<(String, IconData)> defs = switch (tab) {
      1 => [('Iniciar trabajo', Icons.play_arrow), ('Cambiar planificación', Icons.edit_calendar)],
      2 => [('Continuar', Icons.play_arrow)],
      3 => [('Ver solución', Icons.task_alt)],
      _ => [('Solucionar ahora', Icons.build), ('Planificar', Icons.event)],
    };
    final out = <Widget>[];
    for (var i = 0; i < defs.length; i++) {
      if (i > 0) out.add(const SizedBox(width: 8));
      final (label, icon) = defs[i];
      out.add(Expanded(
        child: OutlinedButton.icon(
          onPressed: () => onAccionFutura(label),
          icon: Icon(icon, size: 18),
          label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ));
    }
    return out;
  }
}

// ── Fila compacta de incidencia dentro de la tarjeta ─────────
class _FilaIncidencia extends StatelessWidget {
  final Incidencia incidencia;
  final VoidCallback onTap;
  const _FilaIncidencia({required this.incidencia, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final inc = incidencia;
    final color = gravedadColor(inc.gravedad);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Container(
                  width: 12, height: 12,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(inc.posicionTexto,
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: color.withValues(alpha: 0.4)),
                        ),
                        child: Text(gravedadLabel(inc.gravedad),
                            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(inc.tipos.map(problemaLabel).join(' · '),
                      style: const TextStyle(fontSize: 13, color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        '${kEstadoIncidenciaLabels[inc.estado] ?? inc.estado} · ${inc.diasTexto}',
                        style: const TextStyle(color: AppColors.textHint, fontSize: 12),
                      ),
                      if (inc.fotoUrl != null) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.photo_camera, size: 14, color: AppColors.textHint),
                      ],
                      const Spacer(),
                      const Icon(Icons.chevron_right, size: 18, color: AppColors.textHint),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
