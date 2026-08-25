import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';
import '../widgets/plate_badge.dart';
import 'concepts_screen.dart';
import 'finish_screen.dart';
import 'photos_screen.dart';
import 'signature_screen.dart';

/// Pantalla de trabajo del operario. Todo lo que necesita durante el servicio
/// está aquí: estado, mapa, navegación, evidencias, firma y cierre.
class AssistanceScreen extends StatefulWidget {
  const AssistanceScreen({super.key, required this.session, required this.assistanceId});
  final Session session;
  final int assistanceId;

  @override
  State<AssistanceScreen> createState() => _AssistanceScreenState();
}

class _AssistanceScreenState extends State<AssistanceScreen> {
  late final Api _api = Api(widget.session.token);
  late final Tracker _tracker = Tracker(_api);
  StreamSubscription<TrackerState>? _trackerSub;
  Timer? _timer;

  Map<String, dynamic>? _a;
  List<Map<String, dynamic>> _conceptos = [];
  bool _busy = false;
  bool _loading = true;
  String? _error;
  bool _offline = false;
  String? _suggestion;
  int? _distanceM;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load(silent: true));
    _trackerSub = _tracker.stream.listen((s) {
      if (!mounted) return;
      setState(() {
        _offline = s.offline;
        _distanceM = s.distanceM ?? _distanceM;
      });
      if (s.suggestion != null && s.suggestion != _suggestion) {
        _suggestion = s.suggestion;
        _preguntarGeovalla(s.suggestion!);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _trackerSub?.cancel();
    _tracker.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final a = await _api.assistance(widget.assistanceId);
      // Los conceptos (neumáticos pactados) van aparte y su fallo no puede
      // tumbar la ficha: un servidor sin la ruta simplemente no enseña nada.
      List<Map<String, dynamic>> conceptos = _conceptos;
      try { conceptos = await _api.concepts(widget.assistanceId); } catch (_) {}
      if (!mounted) return;
      setState(() { _a = a; _conceptos = conceptos; _loading = false; _error = null; _offline = false; });
      await _tracker.sync(
        widget.assistanceId,
        a['status']?.toString() ?? '',
        trackWhileWorking: widget.session.trackWhileWorking,
      );
    } on OfflineError {
      if (!mounted) return;
      setState(() { _offline = true; _loading = false; });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() { _error = e.message; _loading = false; });
    }
  }

  String get _status => _a?['status']?.toString() ?? '';

  /// Lo pendiente por delante: es lo que hace que el operario entre.
  String _conceptosSubtitulo() {
    final previstos = _conceptos.where((c) => c['status'] == 'previsto').length;
    if (previstos > 0) {
      return '$previstos montaje${previstos == 1 ? '' : 's'} pactado${previstos == 1 ? '' : 's'} por confirmar con foto';
    }
    final confirmados = _conceptos.where((c) => c['status'] == 'confirmado').length;
    if (confirmados > 0) return '$confirmados confirmado${confirmados == 1 ? '' : 's'}';
    return 'Confirmar lo montado, con su foto';
  }
  String? get _next => _a?['nextStatus']?.toString();

  // ── Acciones ─────────────────────────────────────────────────────────────

  Future<void> _run(Future<void> Function() action) async {
    setState(() { _busy = true; _error = null; });
    try {
      await action();
      await _load(silent: true);
    } on ApiError catch (e) {
      if (!mounted) return;
      final detalle = e.detail.isNotEmpty ? '\n• ${e.detail.join('\n• ')}' : '';
      _aviso('${e.message}$detalle', error: true);
      await _load(silent: true);
    } on OfflineError {
      if (!mounted) return;
      _aviso('Sin conexión: la acción se enviará automáticamente al recuperar cobertura.');
    } catch (e) {
      if (!mounted) return;
      _aviso('Error: $e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _aviso(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? AppColors.danger : AppColors.surface,
      duration: Duration(seconds: error ? 6 : 3),
    ));
  }

  /// Cambio de estado: intenta enviarlo y, si no hay red, lo encola.
  Future<void> _cambiarEstado(String target, {String source = 'manual'}) async {
    final actionId = OfflineQueue.newActionId();
    final pos = await Tracker.currentPosition();
    final point = pos != null ? Tracker.pointOf(pos) : null;
    try {
      final res = await _api.setStatus(
        widget.assistanceId, target,
        actionId: actionId, point: point, source: source,
      );
      if (!mounted) return;
      setState(() => _a = res);
      await _tracker.sync(widget.assistanceId, target,
          trackWhileWorking: widget.session.trackWhileWorking);
      _aviso('Estado actualizado: ${statusStyle(target).label}');
    } on OfflineError {
      await OfflineQueue.add(
        kind: 'status',
        assistanceId: widget.assistanceId,
        payload: {'status': target},
        actionId: actionId,
      );
      if (!mounted) return;
      setState(() {
        _a = {...?_a, 'status': target};
        _offline = true;
      });
      _aviso('Sin conexión: el estado "${statusStyle(target).label}" se enviará al recuperar cobertura.');
    }
  }

  Future<void> _confirmarEstado(String target) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('¿Pasar a "${statusStyle(target).label}"?'),
        content: Text(_textoConfirmacion(target)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmar')),
        ],
      ),
    );
    if (ok == true) await _run(() => _cambiarEstado(target));
  }

  String _textoConfirmacion(String target) {
    switch (target) {
      case 'en_route':
        return 'Se empezará a compartir tu ubicación con la central hasta que '
            'termines el servicio.';
      case 'at_workshop':
        return 'Se cerrará el ciclo y dejará de compartirse tu ubicación.';
      case 'returning_to_workshop':
        return 'Se seguirá compartiendo tu ubicación durante el regreso al taller.';
      default:
        return 'Quedará registrado con la hora y tu posición actual.';
    }
  }

  Future<void> _preguntarGeovalla(String sugerido) async {
    if (!mounted || _busy) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.my_location, color: AppColors.info),
        title: Text('¿Has llegado?'),
        content: Text(
          'Estás a menos de ${_distanceM ?? 0} m del punto. '
          '¿Quieres marcar "${statusStyle(sugerido).label}"?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Todavía no')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sí, marcar')),
        ],
      ),
    );
    if (ok == true) await _run(() => _cambiarEstado(sugerido, source: 'geofence'));
  }

  Future<void> _aceptar() => _run(() async {
        final res = await _api.accept(widget.assistanceId, OfflineQueue.newActionId());
        if (mounted) setState(() => _a = res);
      });

  Future<void> _rechazar() async {
    final motivos = {
      'no_units': 'Sin unidades disponibles',
      'out_of_area': 'Fuera de mi zona',
      'no_capability': 'No puedo hacer este servicio',
      'other': 'Otro motivo',
    };
    String seleccion = 'no_units';
    final notas = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Rechazar asistencia'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            ...motivos.entries.map((e) => RadioListTile<String>(
                  value: e.key,
                  groupValue: seleccion,
                  title: Text(e.value),
                  onChanged: (v) => setLocal(() => seleccion = v!),
                )),
            TextField(
              controller: notas,
              decoration: const InputDecoration(labelText: 'Comentario (opcional)'),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Rechazar')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await _run(() async {
      await _api.reject(widget.assistanceId, seleccion, notas.text.trim(), OfflineQueue.newActionId());
      if (mounted) Navigator.of(context).pop();
    });
  }

  Future<void> _navegar() async {
    final lat = (_a?['latitude'] as num?)?.toDouble();
    final lng = (_a?['longitude'] as num?)?.toDouble();
    if (lat == null || lng == null) {
      _aviso('La asistencia no tiene coordenadas; usa la dirección.', error: true);
      return;
    }
    final opciones = {
      'Mapas del teléfono': Uri.parse('geo:$lat,$lng?q=$lat,$lng'),
      'Google Maps': Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng'),
      'Waze': Uri.parse('https://waze.com/ul?ll=$lat,$lng&navigate=yes'),
    };
    final elegido = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final nombre in opciones.keys)
            ListTile(
              leading: const Icon(Icons.navigation),
              title: Text(nombre),
              onTap: () => Navigator.pop(ctx, nombre),
            ),
        ]),
      ),
    );
    if (elegido == null) return;
    _api.navigationOpened(widget.assistanceId, elegido).catchError((_) {});
    await launchUrl(opciones[elegido]!, mode: LaunchMode.externalApplication);
  }

  Future<void> _llamar(String telefono) async {
    await launchUrl(Uri.parse('tel:$telefono'), mode: LaunchMode.externalApplication);
  }

  Future<void> _observacion() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Añadir observación'),
        content: TextField(controller: ctrl, maxLines: 4, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar')),
        ],
      ),
    );
    if (ok != true || ctrl.text.trim().isEmpty) return;
    final actionId = OfflineQueue.newActionId();
    try {
      await _api.addNote(widget.assistanceId, ctrl.text.trim(), actionId);
      _aviso('Observación guardada');
    } on OfflineError {
      await OfflineQueue.add(
        kind: 'note', assistanceId: widget.assistanceId,
        payload: {'body': ctrl.text.trim()}, actionId: actionId,
      );
      _aviso('Sin conexión: la observación se enviará más tarde.');
    }
  }

  Future<void> _mensajeRapido() async {
    const rapidos = [
      'Voy en camino', 'Tráfico intenso', 'No localizo el vehículo',
      'Necesito más información', 'Necesito autorización', 'Necesito apoyo',
      'Trabajo finalizado', 'Vehículo trasladado al taller',
    ];
    final elegido = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Mensaje a la central', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          for (final m in rapidos)
            ListTile(
              leading: const Icon(Icons.send),
              title: Text(m),
              onTap: () => Navigator.pop(ctx, m),
            ),
        ]),
      ),
    );
    if (elegido == null) return;
    final actionId = OfflineQueue.newActionId();
    try {
      await _api.sendMessage(widget.assistanceId, elegido, actionId);
      _aviso('Mensaje enviado a la central');
    } on OfflineError {
      await OfflineQueue.add(
        kind: 'note', assistanceId: widget.assistanceId,
        payload: {'body': elegido}, actionId: actionId,
      );
      _aviso('Sin conexión: el mensaje se enviará más tarde.');
    }
  }

  // ── Interfaz ─────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final a = _a;
    final st = statusStyle(_status);
    return Scaffold(
      appBar: AppBar(
        title: Text(a?['expedientNumber']?.toString() ?? 'Asistencia #${widget.assistanceId}'),
        actions: [
          if (_tracker.isActive)
            const Padding(
              padding: EdgeInsets.only(right: 12),
              child: Center(
                child: Row(children: [
                  Icon(Icons.gps_fixed, size: 16, color: AppColors.ok),
                  SizedBox(width: 4),
                  Text('GPS', style: TextStyle(fontSize: 12, color: AppColors.ok)),
                ]),
              ),
            ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: () => _load()),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : a == null
              ? Center(child: Text(_error ?? 'No se pudo cargar la asistencia'))
              : ListView(
                  padding: const EdgeInsets.only(bottom: 120),
                  children: [
                    if (_offline)
                      Container(
                        color: AppColors.warn.withValues(alpha: 0.15),
                        padding: const EdgeInsets.all(10),
                        child: const Row(children: [
                          Icon(Icons.cloud_off, size: 18, color: AppColors.warn),
                          SizedBox(width: 8),
                          Expanded(child: Text('Trabajando sin conexión. Todo se guarda y se envía después.',
                              style: TextStyle(color: AppColors.warn, fontSize: 13))),
                        ]),
                      ),

                    // Estado actual, siempre visible
                    Container(
                      margin: const EdgeInsets.all(12),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: st.color.withValues(alpha: 0.12),
                        border: Border.all(color: st.color),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(children: [
                        Icon(st.icon, color: st.color, size: 30),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            const Text('Estado actual',
                                style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                            Text(st.label,
                                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: st.color)),
                          ]),
                        ),
                        if (a['priority'] == 'urgente')
                          const Icon(Icons.priority_high, color: AppColors.danger, size: 28),
                      ]),
                    ),

                    _Bloque(titulo: 'Servicio', hijos: [
                      _Dato('Tipo', a['serviceType']?.toString()),
                      _Dato('Cliente / compañía', a['clientName']?.toString()),
                      _Dato('Descripción', a['description']?.toString()),
                      _Dato('Operario asignado', a['liteUserName']?.toString()),
                    ]),

                    _Bloque(titulo: 'Vehículo', hijos: [
                      // La matrícula manda: si viene informada, en grande y
                      // encabezando el bloque, no como una fila más.
                      if (((a['vehicle'] as Map?)?['plate']?.toString() ?? '').isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: PlateBadge(
                              plate: (a['vehicle'] as Map?)?['plate']?.toString() ?? '',
                            ),
                          ),
                        ),
                      _Dato('Tipo', (a['vehicle'] as Map?)?['type']?.toString()),
                      _Dato('Marca y modelo', [
                        (a['vehicle'] as Map?)?['make'],
                        (a['vehicle'] as Map?)?['model'],
                      ].where((x) => x != null).join(' ')),
                    ]),

                    _Bloque(titulo: 'Contacto', hijos: [
                      _Dato('Cliente', a['customerName']?.toString()),
                      if ((a['customerPhone']?.toString() ?? '').isNotEmpty)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.phone, color: AppColors.info),
                          title: Text(a['customerPhone'].toString()),
                          subtitle: const Text('Llamar al cliente'),
                          onTap: () => _llamar(a['customerPhone'].toString()),
                        ),
                    ]),

                    // Mapa y navegación
                    if (a['latitude'] != null)
                      Card(
                        child: Column(children: [
                          SizedBox(
                            height: 220,
                            child: ClipRRect(
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
                              child: FlutterMap(
                                options: MapOptions(
                                  initialCenter: LatLng(
                                    (a['latitude'] as num).toDouble(),
                                    (a['longitude'] as num).toDouble(),
                                  ),
                                  initialZoom: 14,
                                ),
                                children: [
                                  TileLayer(
                                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                                    userAgentPackageName: 'com.seatarragona.lite_app',
                                  ),
                                  MarkerLayer(markers: [
                                    Marker(
                                      point: LatLng(
                                        (a['latitude'] as num).toDouble(),
                                        (a['longitude'] as num).toDouble(),
                                      ),
                                      child: const Icon(Icons.place, color: AppColors.info, size: 38),
                                    ),
                                    if (a['operator'] != null)
                                      Marker(
                                        point: LatLng(
                                          ((a['operator'] as Map)['lat'] as num).toDouble(),
                                          ((a['operator'] as Map)['lng'] as num).toDouble(),
                                        ),
                                        child: const Icon(Icons.local_shipping,
                                            color: AppColors.primary, size: 32),
                                      ),
                                  ]),
                                ],
                              ),
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(children: [
                              Text(a['address']?.toString() ?? '',
                                  style: const TextStyle(fontSize: 15)),
                              if (a['distanceM'] != null || a['etaMinutes'] != null) ...[
                                const SizedBox(height: 4),
                                Text(
                                  [
                                    if (a['distanceM'] != null)
                                      '${((a['distanceM'] as num) / 1000).toStringAsFixed(1)} km',
                                    if (a['etaMinutes'] != null) 'aprox. ${a['etaMinutes']} min',
                                  ].join(' · '),
                                  style: const TextStyle(color: AppColors.textMuted),
                                ),
                              ],
                              const SizedBox(height: 10),
                              SizedBox(
                                width: double.infinity,
                                child: OutlinedButton.icon(
                                  onPressed: _navegar,
                                  icon: const Icon(Icons.navigation),
                                  label: const Text('Abrir navegación'),
                                ),
                              ),
                            ]),
                          ),
                        ]),
                      ),

                    // Evidencias, firma, observaciones
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Column(children: [
                        _AccionFila(
                          icono: Icons.photo_camera,
                          titulo: 'Fotografías',
                          subtitulo: '${(a['files'] as List?)?.length ?? 0} añadidas',
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => PhotosScreen(
                                session: widget.session, assistanceId: widget.assistanceId,
                              ),
                            ));
                            _load(silent: true);
                          },
                        ),
                        _AccionFila(
                          icono: Icons.tire_repair,
                          titulo: 'Neumáticos y materiales',
                          subtitulo: _conceptosSubtitulo(),
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => ConceptsScreen(
                                session: widget.session, assistanceId: widget.assistanceId,
                              ),
                            ));
                            _load(silent: true);
                          },
                        ),
                        _AccionFila(
                          icono: Icons.draw,
                          titulo: 'Firma del cliente',
                          subtitulo: a['signature'] != null
                              ? 'Firmado por ${(a['signature'] as Map)['signerName']}'
                              : 'Sin firma',
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(
                              builder: (_) => SignatureScreen(
                                session: widget.session, assistanceId: widget.assistanceId,
                              ),
                            ));
                            _load(silent: true);
                          },
                        ),
                        _AccionFila(
                          icono: Icons.note_add,
                          titulo: 'Añadir observación',
                          subtitulo: 'Queda en el historial de la asistencia',
                          onTap: _observacion,
                        ),
                        _AccionFila(
                          icono: Icons.forum,
                          titulo: 'Avisar a la central',
                          subtitulo: 'Mensajes rápidos',
                          onTap: _mensajeRapido,
                        ),
                      ]),
                    ),

                    // Línea temporal
                    if ((a['timeline'] as List?)?.isNotEmpty == true)
                      _Bloque(titulo: 'Historial', hijos: [
                        for (final t in (a['timeline'] as List).reversed.take(12))
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Icon(statusStyle(t['toStatus'].toString()).icon,
                                  size: 16, color: statusStyle(t['toStatus'].toString()).color),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(statusStyle(t['toStatus'].toString()).label,
                                      style: const TextStyle(fontSize: 13)),
                                  Text(
                                    _hora(t['occurredAtMs']),
                                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                                  ),
                                ]),
                              ),
                            ]),
                          ),
                      ]),
                  ],
                ),

      // Acción principal, siempre a mano y con el pulgar
      bottomNavigationBar: a == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: _acciones(),
              ),
            ),
    );
  }

  Widget _acciones() {
    if (_status == 'awaiting_acceptance' || (_status == 'assigned' && _a?['liteUserId'] == null)) {
      return Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _busy ? null : _rechazar,
            icon: const Icon(Icons.close),
            label: const Text('Rechazar'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          flex: 2,
          child: ElevatedButton.icon(
            onPressed: _busy ? null : _aceptar,
            icon: const Icon(Icons.check),
            label: const Text('Aceptar'),
          ),
        ),
      ]);
    }

    final next = _next;
    if (next == null) {
      return const SizedBox.shrink();
    }
    if (next == 'finished') {
      return ElevatedButton.icon(
        onPressed: _busy
            ? null
            : () async {
                final hecho = await Navigator.of(context).push<bool>(MaterialPageRoute(
                  builder: (_) => FinishScreen(
                    session: widget.session,
                    assistanceId: widget.assistanceId,
                  ),
                ));
                if (hecho == true) {
                  await _tracker.stop();
                  _load();
                }
              },
        icon: const Icon(Icons.flag),
        label: const Text('Finalizar servicio'),
      );
    }
    final st = statusStyle(next);
    return ElevatedButton.icon(
      onPressed: _busy ? null : () => _confirmarEstado(next),
      style: ElevatedButton.styleFrom(backgroundColor: st.color),
      icon: Icon(st.icon),
      label: Text(st.label.toUpperCase()),
    );
  }

  static String _hora(dynamic ms) {
    if (ms == null) return '';
    final d = DateTime.fromMillisecondsSinceEpoch((ms as num).toInt());
    String dd(int n) => n.toString().padLeft(2, '0');
    return '${dd(d.day)}/${dd(d.month)} ${dd(d.hour)}:${dd(d.minute)}';
  }
}

class _Bloque extends StatelessWidget {
  const _Bloque({required this.titulo, required this.hijos});
  final String titulo;
  final List<Widget> hijos;

  @override
  Widget build(BuildContext context) {
    final visibles = hijos.where((h) => h is! _Dato || h.valor != null && h.valor!.isNotEmpty).toList();
    if (visibles.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.primary)),
          const SizedBox(height: 8),
          ...visibles,
        ]),
      ),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato(this.etiqueta, this.valor);
  final String etiqueta;
  final String? valor;

  @override
  Widget build(BuildContext context) {
    if (valor == null || valor!.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          width: 120,
          child: Text(etiqueta, style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
        ),
        Expanded(child: Text(valor!, style: const TextStyle(fontSize: 14))),
      ]),
    );
  }
}

class _AccionFila extends StatelessWidget {
  const _AccionFila({
    required this.icono, required this.titulo, required this.subtitulo, required this.onTap,
  });
  final IconData icono;
  final String titulo;
  final String subtitulo;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: ListTile(
        leading: Icon(icono, color: AppColors.primary, size: 28),
        title: Text(titulo, style: const TextStyle(fontSize: 16)),
        subtitle: Text(subtitulo),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
