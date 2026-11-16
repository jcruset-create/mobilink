import 'package:flutter/material.dart';

import '../services/mensajes_central.dart';

/// El aviso a pantalla completa de un mensaje de la central, por encima de
/// cualquier pantalla de la app, hasta que el operario pulsa «Entendido» o
/// contesta. Si hay varios, de uno en uno, el más antiguo primero.
///
/// Va en `MaterialApp.builder`, por encima del navegador: así sale esté donde
/// esté el operario dentro de la app, también a medio hacer una foto o
/// rellenando el cierre.
///
/// Es el equivalente en Lite de `AvisoMensajes` de Assist Pro.
class AvisoMensaje extends StatelessWidget {
  const AvisoMensaje({super.key, required this.child, this.mensajes});

  final Widget child;

  /// Para las pruebas; en la app, el de siempre.
  final MensajesCentral? mensajes;

  @override
  Widget build(BuildContext context) {
    final servicio = mensajes ?? MensajesCentral.instancia;
    return AnimatedBuilder(
      animation: servicio,
      builder: (context, _) {
        final pendientes = servicio.pendientes;
        return Stack(
          children: [
            child,
            if (pendientes.isNotEmpty)
              Positioned.fill(
                // El aviso lleva un campo de texto, que necesita un Overlay
                // propio: aquí estamos por encima del del navegador.
                child: Overlay(
                  initialEntries: [
                    OverlayEntry(
                      builder: (_) => _Aviso(
                        // Una clave por mensaje: al pasar al siguiente, el
                        // campo de texto empieza vacío.
                        key: ValueKey(pendientes.first['id']),
                        mensaje: pendientes.first,
                        quedan: pendientes.length - 1,
                        servicio: servicio,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Aviso extends StatefulWidget {
  const _Aviso({super.key, required this.mensaje, required this.quedan, required this.servicio});

  final Map<String, dynamic> mensaje;
  final int quedan;
  final MensajesCentral servicio;

  @override
  State<_Aviso> createState() => _AvisoState();
}

class _AvisoState extends State<_Aviso> {
  final _texto = TextEditingController();
  bool _escribiendo = false;
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _texto.dispose();
    super.dispose();
  }

  int? get _assistanceId {
    final id = widget.mensaje['assistanceId'];
    return id is int ? id : null;
  }

  Future<void> _responder(String texto) async {
    final asistencia = _assistanceId;
    if (asistencia == null || texto.trim().isEmpty) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    final ok = await widget.servicio.responder(assistanceId: asistencia, texto: texto.trim());
    if (!mounted) return;
    setState(() {
      _enviando = false;
      if (!ok) _error = 'No se ha podido enviar. Revisa la cobertura y vuelve a probar.';
    });
  }

  Future<void> _entendido() async {
    final id = widget.mensaje['id'];
    final asistencia = _assistanceId;
    if (id is! int || asistencia == null) return;
    setState(() => _enviando = true);
    await widget.servicio.entendido(id, asistencia);
  }

  static String _hora(Object? ms) {
    if (ms is! int) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.mensaje;
    final urgente = m['urgent'] == true;
    final escalado = m['escalado'] == true;
    final suena = urgente || escalado;
    final sinLeer = m['sinLeerMin'];

    final fondo = suena ? const Color(0xFF450A0A) : const Color(0xFF172554);
    final borde = suena ? const Color(0xFFF87171) : const Color(0xFFFBBF24);
    final etiqueta = urgente
        ? 'URGENTE · CENTRAL'
        : escalado
            ? 'SIN LEER · CENTRAL'
            : 'CENTRAL';

    return Material(
      color: const Color(0xB8020617),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Container(
            decoration: BoxDecoration(
              color: fondo,
              border: Border.all(color: borde, width: 3),
              borderRadius: BorderRadius.circular(22),
            ),
            padding: const EdgeInsets.all(20),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: borde,
                      child: Icon(suena ? Icons.notifications_active : Icons.forum,
                          color: const Color(0xFF0E1B2E), size: 30),
                    ),
                    const SizedBox(width: 13),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(etiqueta,
                              style: TextStyle(
                                  color: borde,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 1,
                                  fontSize: 12.5)),
                          const Text('Mensaje de la central',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w900,
                                  fontSize: 24,
                                  height: 1.1)),
                        ],
                      ),
                    ),
                  ]),
                  const SizedBox(height: 10),
                  Text(
                    [
                      'De ${m['byName'] ?? 'la central'}',
                      _hora(m['createdAtMs']),
                      m['expedientNumber']?.toString() ?? 'Asistencia #${m['assistanceId']}',
                    ].where((x) => x.isNotEmpty).join(' · '),
                    style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 13.5),
                  ),
                  const SizedBox(height: 13),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                        color: Colors.white, borderRadius: BorderRadius.circular(16)),
                    child: Text('${m['body'] ?? ''}',
                        style: const TextStyle(
                            color: Color(0xFF0F172A),
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            height: 1.3)),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    suena
                        ? 'Sonará cada 15 segundos hasta que pulses «Entendido» o contestes.'
                        : 'Quedará aquí hasta que pulses «Entendido» o contestes.',
                    style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 13.5),
                  ),
                  if (escalado && sinLeer is int) ...[
                    const SizedBox(height: 4),
                    Text('Llevaba $sinLeer minutos sin abrir.',
                        style: TextStyle(color: borde, fontSize: 13.5, fontWeight: FontWeight.w700)),
                  ],
                  if (widget.quedan > 0) ...[
                    const SizedBox(height: 4),
                    Text(
                        'Y ${widget.quedan} mensaje${widget.quedan == 1 ? '' : 's'} más después de este',
                        style: TextStyle(color: borde, fontSize: 13.5, fontWeight: FontWeight.w700)),
                  ],
                  const SizedBox(height: 16),
                  const Text('RESPONDER',
                      style: TextStyle(
                          color: Color(0xFF94A3B8), fontSize: 12.5, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 7),
                  // Las rápidas, en una fila de botones grandes: con guantes y
                  // lloviendo, un toque es todo lo que hay.
                  Row(children: [
                    for (final r in widget.servicio.respuestasRapidas) ...[
                      Expanded(
                        child: SizedBox(
                          height: 50,
                          child: OutlinedButton(
                            onPressed: _enviando ? null : () => _responder(r),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.white,
                              side: const BorderSide(color: Color(0xFF475569)),
                              backgroundColor: const Color(0xFF1E293B),
                              padding: EdgeInsets.zero,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12)),
                            ),
                            child: Text(r,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700, fontSize: 13)),
                          ),
                        ),
                      ),
                      if (r != widget.servicio.respuestasRapidas.last) const SizedBox(width: 7),
                    ],
                  ]),
                  const SizedBox(height: 8),
                  if (_escribiendo)
                    Row(children: [
                      Expanded(
                        child: TextField(
                          controller: _texto,
                          autofocus: true,
                          maxLength: 2000,
                          minLines: 1,
                          maxLines: 3,
                          textCapitalization: TextCapitalization.sentences,
                          style: const TextStyle(color: Colors.white, fontSize: 15),
                          decoration: InputDecoration(
                            hintText: 'Escribe tu respuesta…',
                            hintStyle: const TextStyle(color: Color(0xFF94A3B8)),
                            counterText: '',
                            filled: true,
                            fillColor: const Color(0xFF0B1220),
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        height: 50,
                        child: FilledButton(
                          onPressed: _enviando ? null : () => _responder(_texto.text),
                          child: const Text('Enviar',
                              style: TextStyle(fontWeight: FontWeight.w900)),
                        ),
                      ),
                    ])
                  else
                    SizedBox(
                      height: 50,
                      child: OutlinedButton.icon(
                        onPressed: _enviando ? null : () => setState(() => _escribiendo = true),
                        icon: const Icon(Icons.edit),
                        label: const Text('Escribir respuesta',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Color(0xFF475569)),
                          shape:
                              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!,
                        style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 13.5)),
                  ],
                  const SizedBox(height: 13),
                  SizedBox(
                    height: 68,
                    child: FilledButton(
                      onPressed: _enviando ? null : _entendido,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        foregroundColor: const Color(0xFF052E16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16)),
                      ),
                      child: const Text('Entendido',
                          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
