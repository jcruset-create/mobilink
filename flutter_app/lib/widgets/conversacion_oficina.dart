import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../services/mensajes_oficina.dart';

/// La conversación con la oficina dentro de la asistencia: lo que ha mandado
/// la oficina, lo que ha contestado el operario, y para escribirle.
///
/// Se refresca cuando llega un mensaje nuevo (`MensajesOficina`) y cada 30 s,
/// para ver también lo que se contestó desde el aviso a pantalla completa.
class ConversacionOficina extends StatefulWidget {
  const ConversacionOficina({super.key, required this.api, required this.assistanceId});

  final ApiService api;
  final int assistanceId;

  @override
  State<ConversacionOficina> createState() => _ConversacionOficinaState();
}

class _ConversacionOficinaState extends State<ConversacionOficina> {
  final _texto = TextEditingController();
  List<Map<String, dynamic>> _mensajes = const [];
  Timer? _timer;
  bool _enviando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _cargar();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _cargar());
    MensajesOficina.instancia.addListener(_cargar);
  }

  @override
  void dispose() {
    _timer?.cancel();
    MensajesOficina.instancia.removeListener(_cargar);
    _texto.dispose();
    super.dispose();
  }

  Future<void> _cargar() async {
    final lista = await widget.api.getMensajesAsistencia(widget.assistanceId);
    if (mounted) setState(() => _mensajes = lista);
  }

  Future<void> _enviar(String texto) async {
    if (texto.trim().isEmpty) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    final ok = await MensajesOficina.instancia.responder(widget.assistanceId, texto.trim());
    if (!mounted) return;
    setState(() {
      _enviando = false;
      if (ok) {
        _texto.clear();
      } else {
        _error = 'No se ha podido enviar. Revisa la cobertura y vuelve a probar.';
      }
    });
    if (ok) await _cargar();
  }

  String _hora(Object? ms) {
    if (ms is! int) return '';
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final rapidas = MensajesOficina.instancia.respuestasRapidas;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF16213E),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('CONVERSACIÓN CON LA OFICINA',
              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          if (_mensajes.isEmpty)
            const Text('Sin mensajes. Si necesitas algo, escribe a la oficina.',
                style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 14)),
          for (final m in _mensajes)
            Align(
              alignment: m['de'] == 'oficina' ? Alignment.centerLeft : Alignment.centerRight,
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                constraints: const BoxConstraints(maxWidth: 420),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: m['de'] == 'oficina' ? const Color(0xFFF8FAFC) : const Color(0xFF15803D),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (m['urgente'] == true)
                      const Text('URGENTE',
                          style: TextStyle(color: Color(0xFFB91C1C), fontSize: 11, fontWeight: FontWeight.w900)),
                    Text('${m['texto'] ?? ''}',
                        style: TextStyle(
                          fontSize: 16,
                          color: m['de'] == 'oficina' ? const Color(0xFF0F172A) : Colors.white,
                        )),
                    const SizedBox(height: 4),
                    Text(
                      m['de'] == 'oficina' ? '${m['autor'] ?? 'Oficina'} · ${_hora(m['creadoAtMs'])}' : 'Tú · ${_hora(m['creadoAtMs'])}',
                      style: TextStyle(
                        fontSize: 12,
                        color: m['de'] == 'oficina' ? const Color(0xFF475569) : const Color(0xFFBBF7D0),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 6),
          Row(
            children: [
              for (final r in rapidas) ...[
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: OutlinedButton(
                      onPressed: _enviando ? null : () => _enviar(r),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Color(0xFF475569)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text(r, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ),
                ),
                if (r != rapidas.last) const SizedBox(width: 8),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _texto,
                  maxLength: 1000,
                  minLines: 1,
                  maxLines: 3,
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                  decoration: InputDecoration(
                    hintText: 'Escribir a la oficina…',
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
                  onPressed: _enviando ? null : () => _enviar(_texto.text),
                  child: const Text('Enviar', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
              ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 6),
            Text(_error!, style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 14)),
          ],
        ],
      ),
    );
  }
}
