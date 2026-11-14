import 'package:flutter/material.dart';

import '../navegacion.dart';
import '../screens/otf_screen.dart';
import '../services/mensajes_oficina.dart';

/// El aviso a pantalla completa de un mensaje de la oficina, encima de
/// cualquier pantalla de la app, hasta que el operario pulsa «Entendido» o
/// contesta. Si hay varios, de uno en uno, el más antiguo primero.
///
/// Va en `MaterialApp.builder`, por encima del navegador: así sale esté donde
/// esté el operario dentro de la app.
class AvisoMensajes extends StatelessWidget {
  const AvisoMensajes({super.key, required this.child, this.mensajes});

  final Widget child;

  /// Para las pruebas; en la app, el de siempre.
  final MensajesOficina? mensajes;

  @override
  Widget build(BuildContext context) {
    final servicio = mensajes ?? MensajesOficina.instancia;
    return AnimatedBuilder(
      animation: servicio,
      builder: (context, _) {
        final pendientes = servicio.pendientes;
        // Los mensajes primero; si no hay, las OTF nuevas.
        final otfs = pendientes.isEmpty ? servicio.otfParaAvisar : const <Map<String, dynamic>>[];
        return Stack(
          children: [
            child,
            if (otfs.isNotEmpty)
              Positioned.fill(
                child: _AvisoOtf(
                  key: ValueKey('otf-${otfs.first['id']}'),
                  otf: otfs.first,
                  quedan: otfs.length - 1,
                  servicio: servicio,
                ),
              ),
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
  final MensajesOficina servicio;

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

  Future<void> _responder(String texto) async {
    final asistencia = widget.mensaje['assistanceId'];
    final otf = widget.mensaje['otfId'];
    if ((asistencia is! int && otf is! int) || texto.trim().isEmpty) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    final ok = await widget.servicio.responder(
      assistanceId: asistencia is int ? asistencia : null,
      otfId: otf is int ? otf : null,
      texto: texto.trim(),
    );
    if (!mounted) return;
    setState(() {
      _enviando = false;
      if (!ok) _error = 'No se ha podido enviar. Revisa la cobertura y vuelve a probar.';
    });
  }

  String _hora(Object? ms) {
    if (ms is! int) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.mensaje;
    final urgente = m['urgente'] == true || m['escalado'] == true;
    final fondo = urgente ? const Color(0xFF450A0A) : const Color(0xFF172554);
    final borde = urgente ? const Color(0xFFF87171) : const Color(0xFFFBBF24);
    final etiqueta = m['urgente'] == true
        ? 'URGENTE · OFICINA'
        : m['escalado'] == true
            ? 'SIN LEER · OFICINA'
            : 'OFICINA';

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
            padding: const EdgeInsets.all(22),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 30,
                        backgroundColor: borde,
                        child: const Icon(Icons.volume_up, color: Color(0xFF0E1B2E), size: 32),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(etiqueta,
                                style: TextStyle(color: borde, fontWeight: FontWeight.w700, letterSpacing: 1, fontSize: 13)),
                            const Text('Has recibido un mensaje nuevo',
                                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 26, height: 1.1)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'De ${m['autor'] ?? 'la oficina'} · ${_hora(m['creadoAtMs'])} · '
                    '${m['otfId'] != null ? 'OTF ${m['otfCliente'] ?? '#${m['otfId']}'}' : 'Asistencia #${m['assistanceId']}'}',
                    style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 14),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                    child: Text('${m['texto'] ?? ''}',
                        style: const TextStyle(color: Color(0xFF0F172A), fontSize: 24, fontWeight: FontWeight.w700, height: 1.3)),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    urgente
                        ? 'Sonará cada 15 segundos hasta que pulses «Entendido» o contestes.'
                        : 'Quedará aquí hasta que pulses «Entendido» o contestes.',
                    style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 14),
                  ),
                  if (widget.quedan > 0) ...[
                    const SizedBox(height: 6),
                    Text('Y ${widget.quedan} mensaje${widget.quedan == 1 ? '' : 's'} más después de este',
                        style: TextStyle(color: borde, fontSize: 14, fontWeight: FontWeight.w700)),
                  ],
                  const SizedBox(height: 18),
                  const Text('RESPONDER',
                      style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      for (final r in widget.servicio.respuestasRapidas) ...[
                        Expanded(
                          child: SizedBox(
                            height: 52,
                            child: OutlinedButton(
                              onPressed: _enviando ? null : () => _responder(r),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.white,
                                side: const BorderSide(color: Color(0xFF475569)),
                                backgroundColor: const Color(0xFF1E293B),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: Text(r, textAlign: TextAlign.center,
                                  style: const TextStyle(fontWeight: FontWeight.w700)),
                            ),
                          ),
                        ),
                        if (r != widget.servicio.respuestasRapidas.last) const SizedBox(width: 8),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_escribiendo)
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _texto,
                            autofocus: true,
                            maxLength: 1000,
                            minLines: 1,
                            maxLines: 3,
                            style: const TextStyle(color: Colors.white, fontSize: 16),
                            decoration: InputDecoration(
                              hintText: 'Escribe tu respuesta…',
                              hintStyle: const TextStyle(color: Color(0xFF94A3B8)),
                              counterText: '',
                              filled: true,
                              fillColor: const Color(0xFF0B1220),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          height: 52,
                          child: FilledButton(
                            onPressed: _enviando ? null : () => _responder(_texto.text),
                            child: const Text('Enviar', style: TextStyle(fontWeight: FontWeight.w900)),
                          ),
                        ),
                      ],
                    )
                  else
                    SizedBox(
                      height: 52,
                      child: OutlinedButton.icon(
                        onPressed: () => setState(() => _escribiendo = true),
                        icon: const Icon(Icons.edit),
                        label: const Text('Escribir respuesta', style: TextStyle(fontWeight: FontWeight.w700)),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Color(0xFF475569)),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 14)),
                  ],
                  const SizedBox(height: 14),
                  SizedBox(
                    height: 72,
                    child: FilledButton(
                      onPressed: _enviando
                          ? null
                          : () {
                              final id = m['id'];
                              if (id is int) widget.servicio.entendido(id);
                            },
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        foregroundColor: const Color(0xFF052E16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      child: const Text('Entendido', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
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


/// Aviso a pantalla completa de una OTF nueva asignada al operario.
class _AvisoOtf extends StatelessWidget {
  const _AvisoOtf({super.key, required this.otf, required this.quedan, required this.servicio});

  final Map<String, dynamic> otf;
  final int quedan;
  final MensajesOficina servicio;

  String? _fecha() {
    final ms = otf['fechaProgramadaMs'];
    if (ms is! int) return null;
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    const dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return '${dias[d.weekday - 1]} ${d.day} ${meses[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final id = otf['id'] as int;
    final base = otf['baseName'] ?? otf['direccion'];
    final fecha = _fecha();
    final num = otf['numTrabajos'];
    const amarillo = Color(0xFFFBBF24);
    return Material(
      color: const Color(0xB8020617),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF172554),
              border: Border.all(color: amarillo, width: 3),
              borderRadius: BorderRadius.circular(22),
            ),
            padding: const EdgeInsets.all(22),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Row(
                    children: [
                      CircleAvatar(
                        radius: 30,
                        backgroundColor: amarillo,
                        child: Icon(Icons.local_shipping, color: Color(0xFF0E1B2E), size: 32),
                      ),
                      SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('ORDEN DE TRABAJO DE FLOTA',
                                style: TextStyle(color: amarillo, fontWeight: FontWeight.w700, letterSpacing: 1, fontSize: 13)),
                            Text('Tienes una OTF nueva',
                                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 26, height: 1.1)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${otf['clientName'] ?? 'OTF'}',
                            style: const TextStyle(color: Color(0xFF0F172A), fontSize: 24, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 6),
                        if (base != null) Text('Base: $base', style: const TextStyle(color: Color(0xFF334155), fontSize: 16)),
                        if (fecha != null) Text('Programada: $fecha', style: const TextStyle(color: Color(0xFF334155), fontSize: 16)),
                        if (num is int) Text('$num trabajo${num == 1 ? '' : 's'}', style: const TextStyle(color: Color(0xFF334155), fontSize: 16)),
                        if ((otf['notas'] ?? '').toString().trim().isNotEmpty) ...[
                          const Divider(),
                          Text('Notas: ${otf['notas']}', style: const TextStyle(color: Color(0xFF475569), fontSize: 14)),
                        ],
                      ],
                    ),
                  ),
                  if (quedan > 0) ...[
                    const SizedBox(height: 10),
                    Text('Y $quedan OTF nueva${quedan == 1 ? '' : 's'} más',
                        style: const TextStyle(color: amarillo, fontSize: 14, fontWeight: FontWeight.w700)),
                  ],
                  const SizedBox(height: 18),
                  SizedBox(
                    height: 64,
                    child: FilledButton(
                      onPressed: () {
                        final api = servicio.api;
                        servicio.otfVista(id);
                        if (api != null) {
                          navegadorApp.currentState?.push(MaterialPageRoute(
                            builder: (_) => OtfDetailScreen(api: api, otfId: id),
                          ));
                        }
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF22C55E),
                        foregroundColor: const Color(0xFF052E16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      child: const Text('Ver la OTF', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 52,
                    child: OutlinedButton(
                      onPressed: () => servicio.otfPosponer(id),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Color(0xFF475569)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: const Text('Más tarde', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
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
