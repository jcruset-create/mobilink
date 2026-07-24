import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../theme.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  final ApiService api;
  const HomeScreen({super.key, required this.api});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('employeeId');
    await prefs.remove('pin');
    await prefs.remove('employeeName');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      EpisTab(api: widget.api),
      DocumentosTab(api: widget.api),
      FormacionTab(api: widget.api),
    ];
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Mobilink Safety',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            Text(widget.api.employeeName,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
            onPressed: _logout,
          ),
        ],
      ),
      body: tabs[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.construction), label: 'Mis EPIs'),
          NavigationDestination(
              icon: Icon(Icons.description), label: 'Documentos'),
          NavigationDestination(icon: Icon(Icons.school), label: 'Formación'),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers de formato
// ─────────────────────────────────────────────────────────────

String _fmtDate(dynamic iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso.toString());
  if (d == null) return '—';
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

String _fmtDateTime(dynamic iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso.toString())?.toLocal();
  if (d == null) return '—';
  return '${_fmtDate(iso)} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}

int? _daysTo(dynamic iso) {
  if (iso == null) return null;
  final d = DateTime.tryParse(iso.toString());
  if (d == null) return null;
  return d.difference(DateTime.now()).inDays;
}

Widget _badge(String text, Color color) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withOpacity(0.15),
      border: Border.all(color: color.withOpacity(0.4)),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(text,
        style: TextStyle(
            fontSize: 11, fontWeight: FontWeight.bold, color: color)),
  );
}

Widget _emptyState(IconData icon, String text) {
  return Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 48, color: AppColors.border),
        const SizedBox(height: 10),
        Text(text, style: const TextStyle(color: AppColors.textMuted)),
      ],
    ),
  );
}

Widget _card({required Widget child}) {
  return Container(
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: AppColors.surface,
      border: Border.all(color: AppColors.border),
      borderRadius: BorderRadius.circular(12),
    ),
    child: child,
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 1 — Mis EPIs (entregados + solicitudes + solicitar)
// ─────────────────────────────────────────────────────────────

class EpisTab extends StatefulWidget {
  final ApiService api;
  const EpisTab({super.key, required this.api});

  @override
  State<EpisTab> createState() => _EpisTabState();
}

class _EpisTabState extends State<EpisTab> {
  List<Map<String, dynamic>>? _epis;
  List<Map<String, dynamic>>? _requests;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.api.myEpis(),
        widget.api.myRequests(),
      ]);
      if (!mounted) return;
      setState(() {
        _epis = results[0];
        _requests = results[1];
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(
          () => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Color _estadoColor(String estado) {
    switch (estado) {
      case 'entregado':
      case 'aprobada':
      case 'entregada':
        return AppColors.ok;
      case 'pendiente':
        return AppColors.primary;
      case 'perdido':
      case 'rechazada':
        return AppColors.danger;
      default:
        return AppColors.textMuted;
    }
  }

  Future<void> _solicitarEpi() async {
    List<Map<String, dynamic>> catalog;
    try {
      catalog = await widget.api.epiCatalog();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
      return;
    }
    if (!mounted) return;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (_) => _RequestEpiSheet(api: widget.api, catalog: catalog),
    );
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return _emptyState(Icons.wifi_off, _error!);
    }
    if (_epis == null) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.primary));
    }
    final requests = _requests ?? [];
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        onPressed: _solicitarEpi,
        icon: const Icon(Icons.add),
        label: const Text('Solicitar EPI'),
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(14),
          children: [
            if (requests.isNotEmpty) ...[
              const Text('MIS SOLICITUDES',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textMuted)),
              const SizedBox(height: 8),
              ...requests.map((r) {
                final epi = r['sm_epis'] as Map<String, dynamic>?;
                final estado = (r['estado'] ?? '').toString();
                return _card(
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(epi?['nombre'] ?? '—',
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold)),
                            const SizedBox(height: 2),
                            Text(
                              '${r['cantidad']} ud. · ${_fmtDate(r['created_at'])}'
                              '${(r['talla'] ?? '').toString().isNotEmpty ? ' · talla ${r['talla']}' : ''}',
                              style: const TextStyle(
                                  fontSize: 12, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                      _badge(estado, _estadoColor(estado)),
                    ],
                  ),
                );
              }),
              const SizedBox(height: 12),
            ],
            const Text('EPIS ENTREGADOS',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textMuted)),
            const SizedBox(height: 8),
            if (_epis!.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 30),
                child: Center(
                  child: Text('Sin EPIs entregados.',
                      style: TextStyle(color: AppColors.textMuted)),
                ),
              )
            else
              ..._epis!.map((e) {
                final epi = e['sm_epis'] as Map<String, dynamic>?;
                final estado = (e['estado'] ?? '').toString();
                final caduca = _daysTo(e['fecha_caducidad']);
                return _card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(epi?['nombre'] ?? '—',
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold)),
                          ),
                          _badge(estado, _estadoColor(estado)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${epi?['codigo'] ?? ''} · ${e['cantidad']} ud.'
                        '${(e['talla'] ?? '').toString().isNotEmpty ? ' · talla ${e['talla']}' : ''}'
                        ' · entregado ${_fmtDate(e['fecha_entrega'])}',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.textMuted),
                      ),
                      if (caduca != null) ...[
                        const SizedBox(height: 6),
                        _badge(
                          caduca < 0
                              ? 'Caducado hace ${-caduca}d'
                              : 'Caduca en ${caduca}d',
                          caduca < 0
                              ? AppColors.danger
                              : caduca < 30
                                  ? AppColors.warn
                                  : AppColors.textMuted,
                        ),
                      ],
                    ],
                  ),
                );
              }),
            const SizedBox(height: 70),
          ],
        ),
      ),
    );
  }
}

class _RequestEpiSheet extends StatefulWidget {
  final ApiService api;
  final List<Map<String, dynamic>> catalog;
  const _RequestEpiSheet({required this.api, required this.catalog});

  @override
  State<_RequestEpiSheet> createState() => _RequestEpiSheetState();
}

class _RequestEpiSheetState extends State<_RequestEpiSheet> {
  String? _epiId;
  final _cantidadCtrl = TextEditingController(text: '1');
  final _tallaCtrl = TextEditingController();
  final _motivoCtrl = TextEditingController();
  bool _sending = false;
  String? _error;

  Future<void> _send() async {
    if (_epiId == null) {
      setState(() => _error = 'Elige un EPI.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.api.requestEpi(
        epiId: _epiId!,
        cantidad: int.tryParse(_cantidadCtrl.text.trim()) ?? 1,
        talla: _tallaCtrl.text.trim(),
        motivo: _motivoCtrl.text.trim(),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Solicitar EPI',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _epiId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'EPI'),
            dropdownColor: AppColors.surface,
            items: widget.catalog
                .map((e) => DropdownMenuItem(
                      value: e['id'] as String,
                      child: Text('${e['nombre']} (${e['codigo']})',
                          overflow: TextOverflow.ellipsis),
                    ))
                .toList(),
            onChanged: (v) => setState(() => _epiId = v),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _cantidadCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Cantidad'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _tallaCtrl,
                  decoration:
                      const InputDecoration(labelText: 'Talla (opcional)'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _motivoCtrl,
            decoration: const InputDecoration(labelText: 'Motivo (opcional)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: AppColors.danger)),
          ],
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _sending ? null : _send,
            child: _sending
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: AppColors.onPrimary),
                  )
                : const Text('Enviar solicitud'),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// TAB 2 — Documentos (lectura obligatoria + firma)
// ─────────────────────────────────────────────────────────────

class DocumentosTab extends StatefulWidget {
  final ApiService api;
  const DocumentosTab({super.key, required this.api});

  @override
  State<DocumentosTab> createState() => _DocumentosTabState();
}

class _DocumentosTabState extends State<DocumentosTab> {
  List<Map<String, dynamic>>? _docs;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final docs = await widget.api.documents();
      if (!mounted) return;
      setState(() {
        _docs = docs;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(
          () => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _firmar(Map<String, dynamic> doc) async {
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Confirmar lectura'),
        content: Text(
          'Declaro que he leído y comprendido el documento '
          '"${doc['titulo']}" (v${doc['version']}). '
          'Esta firma quedará registrada con fecha y hora.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar',
                style: TextStyle(color: AppColors.textMuted)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Firmar lectura'),
          ),
        ],
      ),
    );
    if (confirmado != true) return;
    try {
      await widget.api.ackDocument(doc['id'] as String);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Lectura firmada correctamente.')),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    }
  }

  Future<void> _abrir(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return _emptyState(Icons.wifi_off, _error!);
    if (_docs == null) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.primary));
    }
    final pendientes = _docs!
        .where((d) => d['lectura_obligatoria'] == true && d['firmado'] != true)
        .toList();
    final resto =
        _docs!.where((d) => !pendientes.contains(d)).toList();

    Widget docCard(Map<String, dynamic> d, {required bool pendiente}) {
      final archivoUrl = (d['archivo_url'] ?? '').toString();
      return _card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(d['titulo'] ?? '—',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
                if (d['lectura_obligatoria'] == true)
                  _badge(
                    d['firmado'] == true ? 'Firmado' : 'Pendiente firma',
                    d['firmado'] == true ? AppColors.ok : AppColors.danger,
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${d['tipo']} · v${d['version']} · ${_fmtDate(d['fecha_publicacion'])}'
              '${d['firmado'] == true ? ' · firmado ${_fmtDate(d['fecha_firma'])}' : ''}',
              style:
                  const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            if ((d['descripcion'] ?? '').toString().isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(d['descripcion'],
                  style: const TextStyle(fontSize: 13),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                if (archivoUrl.isNotEmpty)
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: AppColors.border),
                    ),
                    onPressed: () => _abrir(archivoUrl),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Ver documento'),
                  ),
                const Spacer(),
                if (pendiente)
                  ElevatedButton.icon(
                    onPressed: () => _firmar(d),
                    icon: const Icon(Icons.draw, size: 16),
                    label: const Text('Firmar'),
                  ),
              ],
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: _docs!.isEmpty
          ? ListView(children: [
              const SizedBox(height: 120),
              _emptyState(Icons.description, 'Sin documentos publicados.'),
            ])
          : ListView(
              padding: const EdgeInsets.all(14),
              children: [
                if (pendientes.isNotEmpty) ...[
                  Row(
                    children: [
                      const Text('PENDIENTES DE FIRMA',
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: AppColors.danger)),
                      const SizedBox(width: 8),
                      _badge('${pendientes.length}', AppColors.danger),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ...pendientes.map((d) => docCard(d, pendiente: true)),
                  const SizedBox(height: 12),
                ],
                const Text('DOCUMENTOS',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textMuted)),
                const SizedBox(height: 8),
                ...resto.map((d) => docCard(d, pendiente: false)),
              ],
            ),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// TAB 3 — Formación (mis registros + próximas reuniones)
// ─────────────────────────────────────────────────────────────

class FormacionTab extends StatefulWidget {
  final ApiService api;
  const FormacionTab({super.key, required this.api});

  @override
  State<FormacionTab> createState() => _FormacionTabState();
}

class _FormacionTabState extends State<FormacionTab> {
  List<Map<String, dynamic>>? _trainings;
  List<Map<String, dynamic>>? _meetings;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        widget.api.trainings(),
        widget.api.meetings(),
      ]);
      if (!mounted) return;
      setState(() {
        _trainings = results[0];
        _meetings = results[1];
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(
          () => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return _emptyState(Icons.wifi_off, _error!);
    if (_trainings == null) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.primary));
    }
    final meetings = _meetings ?? [];
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          if (meetings.isNotEmpty) ...[
            const Text('PRÓXIMAS REUNIONES',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textMuted)),
            const SizedBox(height: 8),
            ...meetings.map((m) => _card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(m['titulo'] ?? '—',
                          style:
                              const TextStyle(fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(
                        '${_fmtDateTime(m['fecha'])}'
                        '${(m['lugar'] ?? '').toString().isNotEmpty ? ' · ${m['lugar']}' : ''}'
                        '${m['duracion_minutos'] != null ? ' · ${m['duracion_minutos']} min' : ''}',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                )),
            const SizedBox(height: 12),
          ],
          const Text('MIS FORMACIONES',
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textMuted)),
          const SizedBox(height: 8),
          if (_trainings!.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 30),
              child: Center(
                child: Text('Sin formaciones registradas.',
                    style: TextStyle(color: AppColors.textMuted)),
              ),
            )
          else
            ..._trainings!.map((t) {
              final training = t['sm_trainings'] as Map<String, dynamic>?;
              final caduca = _daysTo(t['fecha_caducidad']);
              final estado = (t['estado'] ?? '').toString();
              final caducado =
                  estado == 'caducado' || (caduca != null && caduca < 0);
              return _card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(training?['titulo'] ?? '—',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold)),
                        ),
                        _badge(
                          caducado ? 'caducada' : estado,
                          caducado
                              ? AppColors.danger
                              : estado == 'completado'
                                  ? AppColors.ok
                                  : AppColors.primary,
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${training?['tipo'] ?? ''} · fin ${_fmtDate(t['fecha_fin'])}'
                      '${t['fecha_caducidad'] != null ? ' · caduca ${_fmtDate(t['fecha_caducidad'])}' : ''}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.textMuted),
                    ),
                    if (caduca != null && caduca >= 0 && caduca < 60) ...[
                      const SizedBox(height: 6),
                      _badge('Renueva en ${caduca}d', AppColors.warn),
                    ],
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}
