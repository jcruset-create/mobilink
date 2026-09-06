import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/camara.dart';
import '../services/queue.dart';
import '../services/requisitos.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';
import 'photos_screen.dart';
import 'signature_screen.dart';

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
  Evidencias _ev = Evidencias.vacio;
  bool _revisando = true;

  /*
   * Por encima de esto el número deja de parecer los kilómetros de un servicio
   * y empieza a parecer la lectura del cuentakilómetros. No se bloquea el
   * cierre —el operario sabrá lo que ha hecho— pero se le pregunta, porque de
   * ese número salen los kilómetros que se facturan de más.
   */
  static const int _kmSospechosos = 2000;

  bool get _kmParecenOdometro {
    final v = int.tryParse(_km.text.trim());
    return v != null && v > _kmSospechosos;
  }

  @override
  void initState() {
    super.initState();
    _revisar();
  }

  /// Repasa las evidencias del servicio. Se llama al abrir y después de cada
  /// cosa que las cambia, para que el marcador de arriba no mienta nunca.
  Future<void> _revisar() async {
    setState(() => _revisando = true);
    List<Map<String, dynamic>> conceptos = const [];
    try {
      conceptos = await _api.concepts(widget.assistanceId);
    } catch (_) {/* sin conceptos: el servicio no llevaba neumáticos pactados */}
    final ev = await Evidencias.cargar(_api, widget.assistanceId, conceptos: conceptos);
    if (!mounted) return;
    setState(() { _ev = ev; _revisando = false; });
  }

  /// La foto del resultado del trabajo. Va por la cola como el resto: hecha
  /// en un punto sin cobertura no se pierde.
  Future<void> _fotoDeReparacion() async {
    final archivo = await Camara.fotoParaEvidencia(context);
    if (archivo == null) return;
    setState(() => _busy = true);
    try {
      final pos = await Tracker.currentPosition();
      await FileQueue.addPhoto(
        assistanceId: widget.assistanceId,
        file: archivo,
        category: Requisitos.catReparacion,
        lat: pos?.latitude,
        lng: pos?.longitude,
      );
      try { await FileQueue.flush(_api); } catch (_) {/* queda en cola */}
      await _revisar();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Lleva a la pantalla que resuelve lo que falta, en vez de dejar al
  /// operario buscándola.
  Future<void> _resolver(String falta) async {
    if (falta == 'Firma del cliente' ||
        falta.startsWith('Nombre') ||
        falta.startsWith('DNI')) {
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => SignatureScreen(
            session: widget.session, assistanceId: widget.assistanceId),
      ));
    } else if (falta == Requisitos.etiquetas[Requisitos.catReparacion]) {
      await _fotoDeReparacion();
      return;
    } else {
      await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PhotosScreen(
            session: widget.session, assistanceId: widget.assistanceId),
      ));
    }
    await _revisar();
  }

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

      // Comprobación única, con la foto recién hecha del estado real. Si falta
      // algo NO se llama a la API: se dice exactamente qué falta, una línea
      // por cosa, y el operario tiene el botón para resolverlo al lado.
      await _revisar();
      final faltan = Requisitos.alFinalizar(_ev);
      if (faltan.isNotEmpty) {
        setState(() => _errores = faltan);
        return;
      }
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
        _Checklist(
          evidencias: _ev,
          revisando: _revisando,
          onResolver: _busy ? null : _resolver,
        ),
        const SizedBox(height: 12),
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
                    if (reglas['requireOdometer'] == true) 'kilómetros recorridos',
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
              /*
               * "Kilómetros recorridos", no "Kilómetros" a secas.
               *
               * Con la etiqueta antigua había quien anotaba aquí la lectura
               * del cuentakilómetros del camión. Ese número se usa para
               * cobrar los kilómetros que se pasan del forfait, así que un
               * 234.567 en lugar de un 125 son miles de euros en una factura.
               */
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Kilómetros recorridos',
                helperText: 'Del servicio, no del cuentakilómetros',
                helperMaxLines: 2,
                errorText: _kmParecenOdometro
                    ? '¿Seguro? Parece la lectura del cuentakilómetros'
                    : null,
              ),
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
                Text('No puedes finalizar la asistencia. Falta:',
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

/// Lo que falta para cerrar, con el botón que lo resuelve al lado.
///
/// Es el mismo criterio que aplica `_finalizar`, así que no puede haber
/// sorpresa al final: lo que aquí sale en verde es lo que deja cerrar.
class _Checklist extends StatelessWidget {
  const _Checklist({
    required this.evidencias,
    required this.revisando,
    required this.onResolver,
  });

  final Evidencias evidencias;
  final bool revisando;
  final Future<void> Function(String)? onResolver;

  @override
  Widget build(BuildContext context) {
    if (revisando) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Row(children: [
          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 10),
          Text('Repasando las evidencias…',
              style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
        ]),
      );
    }
    final faltan = Requisitos.alFinalizar(evidencias);
    if (faltan.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.ok.withValues(alpha: 0.12),
          border: Border.all(color: AppColors.ok),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Row(children: [
          Icon(Icons.check_circle, color: AppColors.ok, size: 18),
          SizedBox(width: 8),
          Expanded(
            child: Text('Evidencias completas',
                style: TextStyle(color: AppColors.ok, fontWeight: FontWeight.bold)),
          ),
        ]),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warn.withValues(alpha: 0.12),
        border: Border.all(color: AppColors.warn),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Evidencias obligatorias pendientes',
            style: TextStyle(color: AppColors.warn, fontWeight: FontWeight.bold)),
        for (final f in faltan)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(children: [
              const Icon(Icons.warning_amber, size: 16, color: AppColors.warn),
              const SizedBox(width: 6),
              Expanded(child: Text(f, style: const TextStyle(fontSize: 13))),
              TextButton(
                onPressed: onResolver == null ? null : () => onResolver!(f),
                child: const Text('Hacer'),
              ),
            ]),
          ),
        if (evidencias.sinConexion)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Sin conexión: solo se ha podido comprobar lo que hay en el móvil.',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ),
      ]),
    );
  }
}
