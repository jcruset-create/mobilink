import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path_provider/path_provider.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';
import '../services/camara.dart';

/// Neumáticos y materiales del servicio.
///
/// Central pacta el cambio de antemano cuando se sabe: aquí aparece como
/// "previsto", y el operario solo tiene que CONFIRMARLO haciendo la foto de
/// montaje en el vehículo. Cuando la realidad se desvía —una reparación que
/// no pudo ser—, el operario declara el neumático que montó, también con su
/// foto: la foto es lo que sostiene la línea de la factura.
///
/// Aquí no hay precios a propósito. Los pone el tarifario pactado al cerrar
/// el servicio; lo que se declara es qué y cuántos.
///
/// Confirmar necesita cobertura: la foto tiene que subir para poder
/// referenciarla. La foto en sí nunca se pierde —la cola de fotos ya la
/// guarda—, así que sin señal el mensaje es "vuelve a intentarlo", no un
/// trabajo perdido.
class ConceptsScreen extends StatefulWidget {
  const ConceptsScreen({super.key, required this.session, required this.assistanceId});
  final Session session;
  final int assistanceId;

  @override
  State<ConceptsScreen> createState() => _ConceptsScreenState();
}

class _ConceptsScreenState extends State<ConceptsScreen> {
  late final Api _api = Api(widget.session.token);
  List<Map<String, dynamic>> _lista = [];
  bool _loading = true;
  bool _busy = false;
  double? _progreso;

  static const Map<String, String> _posiciones = {
    'ANY': 'Cualquiera',
    'STEER': 'Dirección',
    'DRIVE': 'Tracción',
    'TRAILER': 'Remolque',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await _api.concepts(widget.assistanceId);
      if (!mounted) return;
      setState(() { _lista = data; _loading = false; });
    } on OfflineError {
      if (!mounted) return;
      setState(() => _loading = false);
      _aviso('Sin conexión. Vuelve a intentarlo con cobertura.', error: true);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      _aviso(e.message, error: true);
    }
  }

  void _aviso(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? AppColors.danger : null,
    ));
  }

  Future<File?> _comprimir(XFile origen) async {
    final dir = await getTemporaryDirectory();
    final destino = '${dir.path}/lite_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final out = await FlutterImageCompress.compressAndGetFile(
      origen.path, destino, quality: 78, minWidth: 1600, minHeight: 1600,
    );
    return out == null ? File(origen.path) : File(out.path);
  }

  /// La foto de montaje: se hace, se sube y devuelve su referencia (`c<id>`).
  /// Sube en directo y no por la cola porque la confirmación la necesita YA:
  /// sin la subida hecha no hay referencia que enviar.
  Future<String?> _fotoDeMontaje() async {
    final foto = await Camara.hacerFoto(context);
    if (foto == null) return null;

    setState(() { _busy = true; _progreso = 0.3; });
    try {
      final archivo = await _comprimir(foto);
      if (archivo == null) return null;
      setState(() => _progreso = 0.6);
      final pos = await Tracker.currentPosition();
      final subida = await _api.uploadPhoto(
        widget.assistanceId,
        file: archivo,
        category: 'mounting',
        actionId: OfflineQueue.newActionId(),
        lat: pos?.latitude,
        lng: pos?.longitude,
      );
      // Esta foto sube en directo, sin pasar por la cola, así que la cola no
      // se entera: se le anota aquí para que la comprobación de requisitos la
      // cuente aunque después se pierda la cobertura.
      await FileQueue.anotarSubida(widget.assistanceId, 'mounting');
      return 'c${subida['id']}';
    } on OfflineError {
      _aviso('Sin conexión: la foto no ha podido subir. Vuelve a intentarlo con cobertura.',
          error: true);
      return null;
    } on ApiError catch (e) {
      _aviso(e.message, error: true);
      return null;
    } finally {
      if (mounted) setState(() { _busy = false; _progreso = null; });
    }
  }

  Future<void> _confirmar(Map<String, dynamic> c) async {
    final ref = await _fotoDeMontaje();
    if (ref == null) return;
    setState(() => _busy = true);
    try {
      await _api.confirmConcept(
        widget.assistanceId, c['id'] as int,
        evidenceRef: ref, actionId: OfflineQueue.newActionId(),
      );
      _aviso('Confirmado. Queda en la tarifa del servicio.');
      await _load();
    } on OfflineError {
      _aviso('Sin conexión. La foto ya está subida: vuelve a darle a confirmar con cobertura.',
          error: true);
    } on ApiError catch (e) {
      _aviso(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _declarar() async {
    final medida = TextEditingController();
    final marca = TextEditingController();
    var posicion = 'ANY';
    var cantidad = 1;

    final seguir = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 16, right: 16, top: 16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
        ),
        child: StatefulBuilder(
          builder: (ctx, setSheet) => Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('Neumático montado',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text(
              'Para cuando se monta uno que no estaba pactado (la reparación no pudo ser). '
              'Después harás la foto de montaje: sin ella no se puede confirmar.',
              style: TextStyle(fontSize: 13, color: AppColors.textMuted),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: medida,
              decoration: const InputDecoration(
                labelText: 'Medida', hintText: '315/80R22.5',
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: marca,
              decoration: const InputDecoration(labelText: 'Marca', hintText: 'Hankook'),
            ),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: posicion,
                  decoration: const InputDecoration(labelText: 'Posición'),
                  items: _posiciones.entries
                      .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                      .toList(),
                  onChanged: (v) => setSheet(() => posicion = v ?? 'ANY'),
                ),
              ),
              const SizedBox(width: 12),
              Column(children: [
                const Text('Cantidad', style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
                Row(children: [
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline),
                    onPressed: cantidad > 1 ? () => setSheet(() => cantidad--) : null,
                  ),
                  Text('$cantidad', style: const TextStyle(fontSize: 18)),
                  IconButton(
                    icon: const Icon(Icons.add_circle_outline),
                    onPressed: cantidad < 8 ? () => setSheet(() => cantidad++) : null,
                  ),
                ]),
              ]),
            ]),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                icon: const Icon(Icons.photo_camera),
                label: const Text('Hacer la foto de montaje'),
                onPressed: () {
                  if (medida.text.trim().isEmpty) return;
                  Navigator.of(ctx).pop(true);
                },
              ),
            ),
          ]),
        ),
      ),
    );
    if (seguir != true || !mounted) return;

    final ref = await _fotoDeMontaje();
    if (ref == null) return;
    setState(() => _busy = true);
    try {
      await _api.declareConcept(
        widget.assistanceId,
        size: medida.text.trim(),
        brand: marca.text.trim().isEmpty ? null : marca.text.trim(),
        position: posicion,
        quantity: cantidad,
        evidenceRef: ref,
        actionId: OfflineQueue.newActionId(),
      );
      _aviso('Declarado y confirmado. Queda en la tarifa del servicio.');
      await _load();
    } on OfflineError {
      _aviso('Sin conexión. La foto ya está subida: vuelve a intentarlo con cobertura.',
          error: true);
    } on ApiError catch (e) {
      _aviso(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _titulo(Map<String, dynamic> c) {
    if (c['kind'] == 'MATERIAL') return c['conceptCode']?.toString() ?? 'Material';
    final partes = [
      c['size']?.toString() ?? '',
      if ((c['brand']?.toString() ?? '').isNotEmpty) c['brand'].toString(),
      if (c['position'] != null && c['position'] != 'ANY')
        _posiciones[c['position']] ?? c['position'].toString(),
    ];
    return partes.where((p) => p.isNotEmpty).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final previstos = _lista.where((c) => c['status'] == 'previsto').toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Neumáticos y materiales')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  if (_progreso != null) LinearProgressIndicator(value: _progreso),
                  if (previstos.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.warn.withValues(alpha: 0.12),
                        border: Border.all(color: AppColors.warn),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'La central tiene pactado${previstos.length == 1 ? '' : 's'} '
                        '${previstos.length} montaje${previstos.length == 1 ? '' : 's'}. '
                        'Confírmalo con la foto cuando lo tengas puesto: es lo que '
                        'permite facturar el servicio sin llamadas después.',
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                  if (_lista.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: Text(
                        'Nada pactado de antemano.\nSi montas un neumático, decláralo aquí '
                        'con su foto: sin eso no se puede facturar.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: AppColors.textMuted),
                      ),
                    ),
                  for (final c in _lista)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Icon(
                              c['kind'] == 'MATERIAL' ? Icons.build : Icons.trip_origin,
                              size: 20,
                              color: c['status'] == 'confirmado'
                                  ? AppColors.ok
                                  : c['status'] == 'no_usado'
                                      ? AppColors.textMuted
                                      : AppColors.warn,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                '${_titulo(c)}  ×${c['quantity']}',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                              ),
                            ),
                            _Chip(status: c['status'].toString()),
                          ]),
                          if (c['status'] == 'previsto') ...[
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton.icon(
                                icon: const Icon(Icons.photo_camera),
                                label: const Text('Montado: hacer la foto y confirmar'),
                                onPressed: _busy ? null : () => _confirmar(c),
                              ),
                            ),
                          ],
                          if (c['status'] == 'no_usado' &&
                              (c['statusReason']?.toString() ?? '').isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(c['statusReason'].toString(),
                                  style: const TextStyle(
                                      fontSize: 12, color: AppColors.textMuted)),
                            ),
                        ]),
                      ),
                    ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    icon: const Icon(Icons.add),
                    label: const Text('Montado un neumático no previsto'),
                    onPressed: _busy ? null : _declarar,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'El precio no se declara: lo pone la tarifa pactada al cerrar el servicio.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (texto, color) = switch (status) {
      'confirmado' => ('Confirmado', AppColors.ok),
      'no_usado' => ('No usado', AppColors.textMuted),
      _ => ('Por confirmar', AppColors.warn),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(texto, style: TextStyle(fontSize: 11, color: color)),
    );
  }
}
