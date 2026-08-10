import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/push.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../theme.dart';
import 'assistance_screen.dart';
import 'login_screen.dart';
import 'profile_screen.dart';

/// Bandeja del operario: pendientes, activas y finalizadas.
///
/// Los avisos llegan por push (Central asigna → suena el móvil). El sondeo se
/// queda como red de seguridad por si el push falla o el dispositivo no lo
/// tiene disponible: cada 25 s sin push, cada 2 min con él.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, required this.session});
  final Session session;

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> with WidgetsBindingObserver {
  late final Api _api = Api(widget.session.token);
  Timer? _timer;
  StreamSubscription<PushEvent>? _push;
  int _tab = 0;
  bool _loading = true;
  bool _offline = false;
  String? _error;
  List<Map<String, dynamic>> _rows = const [];
  int _pending = 0;

  static const _scopes = ['pending', 'active', 'finished'];
  static const _labels = ['Pendientes', 'Activas', 'Finalizadas'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    // Con push, el sondeo solo cubre el hueco de un aviso perdido; sin él, es
    // lo único que trae las asistencias nuevas.
    _timer = Timer.periodic(
      Duration(seconds: Push.disponible ? 120 : 25),
      (_) => _load(silent: true),
    );
    _push = Push.events.listen(_alRecibirAviso);
    _registrarDispositivo();
  }

  /// El token de push viaja con el resto del estado del dispositivo, que es
  /// donde Central lo espera (connect_lite_devices). De paso va el estado de
  /// las colas: es lo que permite a Central detectar un móvil que lleva horas
  /// sin poder subir sus evidencias.
  Future<void> _registrarDispositivo() async {
    await _api.registerDevice({
      if (Push.token != null) 'fcmToken': Push.token,
      'notifPermission': Push.permiso,
      'appVersion': kAppVersion,
      ...estadoDeColas(),
    }).catchError((_) {});
  }

  Future<void> _alRecibirAviso(PushEvent e) async {
    // Token nuevo: si no se reenvía, los avisos se van a un dispositivo muerto
    if (e.type == 'token_refresh') {
      await _registrarDispositivo();
      return;
    }
    await _load(silent: true);
    if (!mounted) return;
    // Solo se navega si el operario ha tocado la notificación. Un aviso con la
    // app abierta no puede sacarle de lo que esté haciendo.
    if (e.abrir && e.assistanceId != null) {
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => AssistanceScreen(
          session: widget.session,
          assistanceId: e.assistanceId!,
        ),
      ));
      _load();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _push?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    // Antes de leer, se intenta vaciar lo que quedó pendiente sin cobertura
    try {
      await OfflineQueue.flush(_api);
      // Las evidencias van aparte: son binarios y se suben de una en una
      await FileQueue.flush(_api);
    } catch (_) {/* seguimos: se reintentará en el próximo ciclo */}
    try {
      final rows = await _api.assistances(_scopes[_tab]);
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _offline = false;
        _error = null;
        _loading = false;
        _pending = OfflineQueue.pendingCount;
      });
    } on OfflineError {
      if (!mounted) return;
      setState(() { _offline = true; _loading = false; _pending = OfflineQueue.pendingCount; });
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.isAuth) {
        await Session.clear();
        if (!mounted) return;
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
        return;
      }
      setState(() { _error = e.message; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final conflicts = OfflineQueue.conflicts();
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Asistencias', style: TextStyle(fontSize: 18)),
            Text(widget.session.workshopName,
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            icon: const Icon(Icons.refresh),
            onPressed: () => _load(),
          ),
          IconButton(
            tooltip: 'Perfil',
            icon: const Icon(Icons.account_circle),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => ProfileScreen(session: widget.session),
            )),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_offline || _pending > 0 || conflicts.isNotEmpty)
            _StatusBanner(offline: _offline, pending: _pending, conflicts: conflicts.length),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: SegmentedButton<int>(
              segments: List.generate(
                _labels.length,
                (i) => ButtonSegment(value: i, label: Text(_labels[i])),
              ),
              selected: {_tab},
              showSelectedIcon: false,
              onSelectionChanged: (s) {
                setState(() => _tab = s.first);
                _load();
              },
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => _load(),
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? _Message(icon: Icons.error_outline, text: _error!)
                      : _rows.isEmpty
                          ? _Message(
                              icon: Icons.inbox,
                              text: _offline
                                  ? 'Sin conexión. Se muestran los datos guardados.'
                                  : 'No hay asistencias en esta bandeja.')
                          : ListView.builder(
                              physics: const AlwaysScrollableScrollPhysics(),
                              itemCount: _rows.length,
                              itemBuilder: (_, i) => _AssistanceCard(
                                row: _rows[i],
                                onTap: () async {
                                  await Navigator.of(context).push(MaterialPageRoute(
                                    builder: (_) => AssistanceScreen(
                                      session: widget.session,
                                      assistanceId: (_rows[i]['id'] as num).toInt(),
                                    ),
                                  ));
                                  _load();
                                },
                              ),
                            ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.offline, required this.pending, required this.conflicts});
  final bool offline;
  final int pending;
  final int conflicts;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      if (offline) 'Sin conexión',
      if (pending > 0) '$pending operación(es) por enviar',
      if (conflicts > 0) '$conflicts conflicto(s) de estado',
    ];
    final color = conflicts > 0 ? AppColors.danger : AppColors.warn;
    return Container(
      width: double.infinity,
      color: color.withValues(alpha: 0.15),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(children: [
        Icon(conflicts > 0 ? Icons.warning_amber : Icons.cloud_off, color: color, size: 18),
        const SizedBox(width: 8),
        Expanded(child: Text(parts.join(' · '), style: TextStyle(color: color, fontSize: 13))),
      ]),
    );
  }
}

class _AssistanceCard extends StatelessWidget {
  const _AssistanceCard({required this.row, required this.onTap});
  final Map<String, dynamic> row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final st = statusStyle(row['status']?.toString() ?? '');
    final vehicle = (row['vehicle'] as Map?)?.cast<String, dynamic>() ?? const {};
    final urgent = row['priority'] == 'urgente';
    final sla = row['slaDeadlineAtMs'] as num?;
    final restMin = sla != null
        ? ((sla.toInt() - DateTime.now().millisecondsSinceEpoch) / 60000).round()
        : null;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(st.icon, color: st.color, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    row['expedientNumber']?.toString() ?? '#${row['id']}',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                  ),
                ),
                if (urgent)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text('URGENTE',
                        style: TextStyle(color: AppColors.danger, fontSize: 11, fontWeight: FontWeight.bold)),
                  ),
              ]),
              const SizedBox(height: 6),
              Text(st.label, style: TextStyle(color: st.color, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Text(
                [
                  row['serviceType']?.toString(),
                  [vehicle['make'], vehicle['model']].where((x) => x != null).join(' '),
                  vehicle['plate']?.toString(),
                ].where((x) => x != null && x.toString().isNotEmpty).join(' · '),
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 4),
              Row(children: [
                const Icon(Icons.place, size: 15, color: AppColors.textMuted),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(row['address']?.toString() ?? '—',
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
                ),
              ]),
              if (restMin != null) ...[
                const SizedBox(height: 6),
                Text(
                  restMin < 0
                      ? 'SLA superado en ${-restMin} min'
                      : 'Llegada objetivo en $restMin min',
                  style: TextStyle(
                    fontSize: 12,
                    color: restMin < 0 ? AppColors.danger : AppColors.textMuted,
                    fontWeight: restMin < 0 ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
              if (row['liteUserName'] != null) ...[
                const SizedBox(height: 4),
                Text('Operario: ${row['liteUserName']}',
                    style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 80),
        Icon(icon, size: 48, color: AppColors.textMuted),
        const SizedBox(height: 12),
        Text(text, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textMuted)),
      ],
    );
  }
}
