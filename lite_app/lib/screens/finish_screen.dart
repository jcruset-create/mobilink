import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';

const Map<String, String> kResultados = {
  'repaired_on_site': 'Reparado en carretera',
  'towed': 'Trasladado',
  'taken_to_workshop': 'Vehículo llevado al taller',
  'not_repaired': 'No reparado',
  'customer_absent': 'Cliente ausente',
  'cancelled_on_site': 'Servicio cancelado',
  'other': 'Otro',
};

/// Cierre del servicio. Los requisitos (fotos mínimas, firma, resultado…) los
/// fija la central por taller; el backend vuelve a validarlos, así que aquí
/// solo se adelanta el aviso para no hacer perder tiempo al operario.
class FinishScreen extends StatefulWidget {
  const FinishScreen({super.key, required this.session, required this.assistanceId});
  final Session session;
  final int assistanceId;

  @override
  State<FinishScreen> createState() => _FinishScreenState();
}

class _FinishScreenState extends State<FinishScreen> {
  late final Api _api = Api(widget.session.token);
  final _notas = TextEditingController();
  final _km = TextEditingController();
  final _minutos = TextEditingController();
  String _resultado = 'repaired_on_site';
  bool _busy = false;
  List<String> _errores = const [];

  @override
  void dispose() {
    _notas.dispose();
    _km.dispose();
    _minutos.dispose();
    super.dispose();
  }

  Future<void> _finalizar() async {
    if (_notas.text.trim().isEmpty) {
      setState(() => _errores = ['Escribe una observación de resolución.']);
      return;
    }
    setState(() { _busy = true; _errores = const []; });
    try {
      // Las evidencias que quedaron en cola tienen que llegar ANTES del cierre:
      // si no, la central rechaza el cierre por "faltan fotos" mientras las
      // fotos están en el móvil del operario.
      try {
        await FileQueue.flush(_api);
      } catch (_) {/* si sigue sin cobertura, el cierre dirá lo que falta */}
      final pos = await Tracker.currentPosition();
      await _api.finish(
        widget.assistanceId,
        result: _resultado,
        resolutionNotes: _notas.text.trim(),
        odometerKm: int.tryParse(_km.text.trim()),
        workedMinutes: int.tryParse(_minutos.text.trim()),
        point: pos != null ? Tracker.pointOf(pos) : null,
        actionId: OfflineQueue.newActionId(),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _errores = e.detail.isNotEmpty ? e.detail : [e.message]);
    } on OfflineError {
      final evidencias = FileQueue.forAssistance(widget.assistanceId).length;
      setState(() => _errores = [
            'Sin conexión. El cierre necesita conexión porque la central debe '
                'validar los requisitos; se conservan tus datos para reintentarlo.',
            if (evidencias > 0)
              '$evidencias evidencia(s) están guardadas en el móvil y se '
                  'enviarán solas al recuperar cobertura.',
          ]);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final reglas = widget.session.finishRules;
    return Scaffold(
      appBar: AppBar(title: const Text('Finalizar servicio')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (reglas.isNotEmpty)
          Card(
            color: AppColors.surfaceDeep,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Requisitos de este taller',
                    style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Text(
                  [
                    if ((reglas['minPhotos'] as num? ?? 0) > 0)
                      '${reglas['minPhotos']} fotografía(s) mínimo',
                    if (reglas['requireSignature'] == true) 'firma del cliente',
                    if (reglas['requireResolutionNotes'] != false) 'observación de resolución',
                    if (reglas['requireOdometer'] == true) 'kilómetros',
                  ].join(' · '),
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                ),
              ]),
            ),
          ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          value: _resultado,
          decoration: const InputDecoration(labelText: 'Resultado del servicio *'),
          items: kResultados.entries
              .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
              .toList(),
          onChanged: (v) => setState(() => _resultado = v ?? 'other'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _notas,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Observación de resolución *',
            hintText: 'Qué se ha hecho y en qué estado queda el vehículo',
          ),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _km,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Kilómetros'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _minutos,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Minutos trabajados'),
            ),
          ),
        ]),
        if (_errores.isNotEmpty) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.danger.withValues(alpha: 0.12),
              border: Border.all(color: AppColors.danger),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [
                Icon(Icons.error_outline, color: AppColors.danger, size: 18),
                SizedBox(width: 6),
                Text('No se puede cerrar todavía',
                    style: TextStyle(color: AppColors.danger, fontWeight: FontWeight.bold)),
              ]),
              const SizedBox(height: 6),
              ..._errores.map((e) => Text('• $e')),
            ]),
          ),
        ],
        const SizedBox(height: 20),
        ElevatedButton.icon(
          onPressed: _busy ? null : _finalizar,
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.ok),
          icon: const Icon(Icons.flag),
          label: Text(_busy ? 'Cerrando…' : 'FINALIZAR SERVICIO'),
        ),
        const SizedBox(height: 12),
        const Text(
          'Al finalizar se detiene el seguimiento de tu ubicación. Después '
          'podrás indicar la vuelta al taller si procede.',
          style: TextStyle(color: AppColors.textMuted, fontSize: 12),
          textAlign: TextAlign.center,
        ),
      ]),
    );
  }
}
