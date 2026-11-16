import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../theme.dart';

/// Conversación con la central, dentro de una asistencia.
///
/// El equivalente en Lite de `ConversacionOficina` de Mobilink Assist Pro
/// (`flutter_app/lib/widgets/conversacion_oficina.dart`): el hilo completo,
/// respuestas rápidas de un toque y un campo para escribir.
///
/// Dos diferencias con Pro, y las dos vienen de la API, no de un capricho:
///
/// * **Sin urgencia ni escalado.** En Pro la oficina marca un mensaje como
///   urgente y el sonido se repite cada 15 s hasta que el técnico lo abre.
///   `connect_communications` no tiene ese campo, así que aquí un mensaje es
///   un mensaje. Si hiciera falta, es una columna más.
/// * **Sin sondeo propio.** Pro pregunta cada 15 s desde un servicio aparte;
///   Lite ya sondea la ficha de la asistencia y recibe el aviso push, así que
///   el hilo se refresca al abrirlo, al volver a la app y con cada aviso.
///
/// Lo que sí se trae de Pro: el acuse de lectura. Al abrir el hilo se marca
/// como leído en el servidor, y Central lo ve en su pestaña.
class ConversacionScreen extends StatefulWidget {
  const ConversacionScreen({
    super.key,
    required this.session,
    required this.assistanceId,
    this.expediente,
  });

  final Session session;
  final int assistanceId;
  final String? expediente;

  @override
  State<ConversacionScreen> createState() => _ConversacionScreenState();
}

class _ConversacionScreenState extends State<ConversacionScreen>
    with WidgetsBindingObserver {
  late final Api _api = Api(widget.session.token);
  final _texto = TextEditingController();
  final _scroll = ScrollController();

  List<Map<String, dynamic>> _hilo = const [];
  bool _cargando = true;
  bool _enviando = false;
  bool _offline = false;
  String? _error;

  /// Las de Assist Pro, más las dos que en Lite se usan a diario.
  static const _rapidas = [
    'Voy en camino',
    'Llamo ahora',
    'Necesito ayuda',
    'Tráfico intenso',
    'No localizo el vehículo',
    'Necesito autorización',
    'Necesito más información',
    'Necesito apoyo',
    'Trabajo finalizado',
    'Vehículo trasladado al taller',
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _cargar();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _texto.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Volver a la app es cuando puede haber llegado algo nuevo.
    if (state == AppLifecycleState.resumed) _cargar(silencioso: true);
  }

  Future<void> _cargar({bool silencioso = false}) async {
    if (!silencioso) setState(() => _cargando = true);
    try {
      final hilo = await _api.messages(widget.assistanceId);
      if (!mounted) return;
      setState(() {
        _hilo = hilo;
        _cargando = false;
        _offline = false;
        _error = null;
      });
      _alFinal();
      // El acuse va después de pintar: que el operario vea el mensaje no
      // depende de que el servidor acepte la marca.
      _api.markMessagesRead(widget.assistanceId).catchError((_) {});
    } on OfflineError {
      if (!mounted) return;
      setState(() { _offline = true; _cargando = false; });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() { _error = e.message; _cargando = false; });
    }
  }

  void _alFinal() {
    // Un hilo se lee por abajo, donde está lo último.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  Future<void> _enviar(String texto) async {
    final cuerpo = texto.trim();
    if (cuerpo.isEmpty || _enviando) return;
    setState(() => _enviando = true);
    final actionId = OfflineQueue.newActionId();
    try {
      await _api.sendMessage(widget.assistanceId, cuerpo, actionId);
      _texto.clear();
      await _cargar(silencioso: true);
    } on OfflineError {
      // Sin cobertura el mensaje NO se pierde: va a la cola y sale solo. Se
      // pinta ya en el hilo, marcado como pendiente, porque para el operario
      // lo que importa es que ha quedado dicho.
      // 'note' y no 'message': es el kind que entiende POST /sync, y acaba en
      // la misma fila de connect_communications (channel 'note', direction
      // 'inbound') que el envío en directo, así que sale en el hilo igual.
      // Lo único que se pierde es la alerta automática a Central cuando el
      // texto pide apoyo o autorización, que la levanta /messages al vuelo.
      await OfflineQueue.add(
        kind: 'note',
        assistanceId: widget.assistanceId,
        payload: {'body': cuerpo},
        actionId: actionId,
      );
      _texto.clear();
      if (!mounted) return;
      setState(() {
        _offline = true;
        _hilo = [
          ..._hilo,
          {
            'id': -DateTime.now().millisecondsSinceEpoch,
            'direction': 'inbound',
            'body': cuerpo,
            'byName': widget.session.userName,
            'createdAtMs': DateTime.now().millisecondsSinceEpoch,
            'pendiente': true,
          },
        ];
      });
      _alFinal();
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Central', style: TextStyle(fontSize: 17)),
            Text(widget.expediente ?? 'Asistencia #${widget.assistanceId}',
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Actualizar',
            icon: const Icon(Icons.refresh),
            onPressed: () => _cargar(),
          ),
        ],
      ),
      body: Column(children: [
        if (_offline)
          Container(
            width: double.infinity,
            color: AppColors.warn.withValues(alpha: 0.15),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: const Row(children: [
              Icon(Icons.cloud_off, size: 18, color: AppColors.warn),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Sin conexión. Lo que escribas se enviará al recuperar cobertura.',
                  style: TextStyle(color: AppColors.warn, fontSize: 13),
                ),
              ),
            ]),
          ),
        if (_error != null)
          Container(
            width: double.infinity,
            color: AppColors.danger.withValues(alpha: 0.15),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(_error!,
                style: const TextStyle(color: AppColors.danger, fontSize: 13)),
          ),
        Expanded(
          child: _cargando
              ? const Center(child: CircularProgressIndicator())
              : _hilo.isEmpty
                  ? const _Vacio()
                  : RefreshIndicator(
                      onRefresh: () => _cargar(silencioso: true),
                      child: ListView.builder(
                        controller: _scroll,
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                        itemCount: _hilo.length,
                        itemBuilder: (_, i) => _Burbuja(mensaje: _hilo[i]),
                      ),
                    ),
        ),
        _Redactor(
          controller: _texto,
          rapidas: _rapidas,
          enviando: _enviando,
          onEnviar: _enviar,
        ),
      ]),
    );
  }
}

class _Vacio extends StatelessWidget {
  const _Vacio();

  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.forum_outlined, size: 44, color: AppColors.textMuted),
            SizedBox(height: 12),
            Text(
              'Todavía no hay mensajes.\nEscribe a la central o usa una respuesta rápida.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textMuted),
            ),
          ]),
        ),
      );
}

/// Un mensaje. A la derecha lo del taller, a la izquierda lo de la central,
/// que es como se lee cualquier conversación.
class _Burbuja extends StatelessWidget {
  const _Burbuja({required this.mensaje});
  final Map<String, dynamic> mensaje;

  @override
  Widget build(BuildContext context) {
    final mio = mensaje['direction'] == 'inbound';
    final pendiente = mensaje['pendiente'] == true;
    final autor = (mensaje['byName'] ?? '').toString();
    final ms = (mensaje['createdAtMs'] as num?)?.toInt();
    final urgente = mensaje['urgent'] == true;

    return Align(
      alignment: mio ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 320),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.fromLTRB(12, 9, 12, 7),
        decoration: BoxDecoration(
          color: urgente
              ? AppColors.danger.withValues(alpha: 0.14)
              : mio
                  ? AppColors.primary.withValues(alpha: 0.22)
                  : AppColors.surface,
          border: Border.all(
            // Un urgente se reconoce al desplazar el hilo semanas después:
            // enmarcado en rojo, no solo con una etiqueta que ya se leyó.
            color: urgente
                ? AppColors.danger.withValues(alpha: 0.7)
                : mio
                    ? AppColors.primary.withValues(alpha: 0.45)
                    : AppColors.surfaceDeep,
            width: urgente ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(14),
            topRight: const Radius.circular(14),
            bottomLeft: Radius.circular(mio ? 14 : 3),
            bottomRight: Radius.circular(mio ? 3 : 14),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (urgente)
              const Padding(
                padding: EdgeInsets.only(bottom: 3),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.notifications_active, size: 12, color: AppColors.danger),
                  SizedBox(width: 4),
                  Text('URGENTE',
                      style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.6,
                          color: AppColors.danger)),
                ]),
              ),
            if (!mio && autor.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text(autor,
                    style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: AppColors.info)),
              ),
            Text(mensaje['body']?.toString() ?? '',
                style: const TextStyle(fontSize: 14.5, height: 1.3)),
            const SizedBox(height: 3),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text(
                pendiente ? 'Sin enviar' : _hora(ms),
                style: TextStyle(
                  fontSize: 10.5,
                  color: pendiente ? AppColors.warn : AppColors.textMuted,
                ),
              ),
              if (pendiente) ...[
                const SizedBox(width: 4),
                const Icon(Icons.schedule, size: 11, color: AppColors.warn),
              ],
            ]),
          ],
        ),
      ),
    );
  }

  static String _hora(int? ms) {
    if (ms == null) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    final hoy = DateTime.now();
    String dd(int n) => n.toString().padLeft(2, '0');
    final hora = '${dd(d.hour)}:${dd(d.minute)}';
    final mismoDia = d.year == hoy.year && d.month == hoy.month && d.day == hoy.day;
    return mismoDia ? hora : '${dd(d.day)}/${dd(d.month)} $hora';
  }
}

/// Respuestas rápidas y campo de texto. Las rápidas van arriba porque en
/// carretera, con guantes, un toque es todo lo que hay.
class _Redactor extends StatelessWidget {
  const _Redactor({
    required this.controller,
    required this.rapidas,
    required this.enviando,
    required this.onEnviar,
  });

  final TextEditingController controller;
  final List<String> rapidas;
  final bool enviando;
  final Future<void> Function(String) onEnviar;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: AppColors.surfaceDeep,
          border: Border(top: BorderSide(color: AppColors.surface)),
        ),
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        child: Column(children: [
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: rapidas.length,
              separatorBuilder: (_, __) => const SizedBox(width: 7),
              itemBuilder: (_, i) => ActionChip(
                label: Text(rapidas[i], style: const TextStyle(fontSize: 12.5)),
                onPressed: enviando ? null : () => onEnviar(rapidas[i]),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 4,
                maxLength: 2000,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  hintText: 'Escribe a la central…',
                  counterText: '',
                  isDense: true,
                ),
                onSubmitted: enviando ? null : onEnviar,
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: enviando ? null : () => onEnviar(controller.text),
              icon: enviando
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.send),
            ),
          ]),
        ]),
      ),
    );
  }
}
