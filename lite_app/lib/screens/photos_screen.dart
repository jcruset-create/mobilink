import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';

const Map<String, String> kCategorias = {
  'arrival': 'Vehículo al llegar',
  'damage': 'Daño o avería',
  'work': 'Trabajo realizado',
  'part': 'Pieza sustituida',
  'mounting': 'Montaje del neumático',
  'finished': 'Vehículo finalizado',
  'document': 'Documento',
  'other': 'Otros',
};

/// Evidencias fotográficas del servicio. Se comprimen en el móvil antes de
/// subir (el backend vuelve a normalizarlas) y se pueden eliminar mientras el
/// servicio siga abierto.
class PhotosScreen extends StatefulWidget {
  const PhotosScreen({super.key, required this.session, required this.assistanceId});
  final Session session;
  final int assistanceId;

  @override
  State<PhotosScreen> createState() => _PhotosScreenState();
}

class _PhotosScreenState extends State<PhotosScreen> {
  late final Api _api = Api(widget.session.token);
  List<Map<String, dynamic>> _files = const [];
  bool _loading = true;
  bool _busy = false;
  double? _progreso;
  String _categoria = 'arrival';

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<PendingFile> get _pendientes =>
      FileQueue.forAssistance(widget.assistanceId);

  Future<void> _reintentar(String id) async {
    setState(() => _busy = true);
    await FileQueue.retry(id);
    try {
      await FileQueue.flush(_api);
    } catch (_) {/* sigue en cola */}
    await _load();
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _load() async {
    try {
      final data = await _api.files(widget.assistanceId);
      if (!mounted) return;
      setState(() {
        _files = (data['files'] as List).map((e) => (e as Map).cast<String, dynamic>()).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<File?> _comprimir(XFile origen) async {
    final dir = await getTemporaryDirectory();
    final destino = '${dir.path}/lite_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final out = await FlutterImageCompress.compressAndGetFile(
      origen.path, destino, quality: 78, minWidth: 1600, minHeight: 1600,
    );
    return out == null ? File(origen.path) : File(out.path);
  }

  Future<void> _agregarFoto(ImageSource origen) async {
    final picker = ImagePicker();
    final foto = await picker.pickImage(source: origen, imageQuality: 90);
    if (foto == null) return;

    setState(() { _busy = true; _progreso = 0.2; });
    try {
      final archivo = await _comprimir(foto);
      if (archivo == null) return;
      setState(() => _progreso = 0.5);
      final pos = await Tracker.currentPosition();

      // Primero se guarda, luego se intenta subir. Así una foto hecha en un
      // punto sin cobertura no se pierde: queda en la cola y sale sola al
      // recuperar señal. El clientActionId evita que se duplique.
      await FileQueue.addPhoto(
        assistanceId: widget.assistanceId,
        file: archivo,
        category: _categoria,
        lat: pos?.latitude,
        lng: pos?.longitude,
      );
      setState(() => _progreso = 0.7);
      await FileQueue.flush(_api);
      await _load();
      if (mounted) {
        final quedan = FileQueue.forAssistance(widget.assistanceId).length;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(quedan == 0
              ? 'Fotografía subida'
              : 'Fotografía guardada. Se enviará al recuperar cobertura '
                  '($quedan pendiente${quedan == 1 ? '' : 's'}).'),
          backgroundColor: quedan == 0 ? null : AppColors.warn,
        ));
      }
    } on ApiError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppColors.danger),
      );
    } finally {
      if (mounted) setState(() { _busy = false; _progreso = null; });
    }
  }

  Future<void> _eliminar(Map<String, dynamic> f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('¿Eliminar la fotografía?'),
        content: const Text('Solo puedes eliminarla antes de cerrar el servicio.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.deletePhoto(widget.assistanceId, (f['id'] as num).toInt());
      await _load();
    } on ApiError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message), backgroundColor: AppColors.danger),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fotografías')),
      body: Column(children: [
        if (_progreso != null) LinearProgressIndicator(value: _progreso),
        Padding(
          padding: const EdgeInsets.all(12),
          child: DropdownButtonFormField<String>(
            value: _categoria,
            decoration: const InputDecoration(labelText: 'Tipo de fotografía'),
            items: kCategorias.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _categoria = v ?? 'other'),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(children: [
            Expanded(
              child: ElevatedButton.icon(
                onPressed: _busy ? null : () => _agregarFoto(ImageSource.camera),
                icon: const Icon(Icons.photo_camera),
                label: const Text('Cámara'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _busy ? null : () => _agregarFoto(ImageSource.gallery),
                icon: const Icon(Icons.photo_library),
                label: const Text('Galería'),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 8),
        // Evidencias hechas y aún no subidas: el operario tiene que poder ver
        // que están guardadas, no quedarse con la duda de si se han perdido.
        if (_pendientes.isNotEmpty)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.symmetric(horizontal: 12),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.warn.withValues(alpha: 0.12),
              border: Border.all(color: AppColors.warn),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_pendientes.length} evidencia(s) guardadas en el móvil, '
                  'pendientes de enviar',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                ..._pendientes.map((f) => Row(children: [
                      Icon(
                        f.state == 'failed' ? Icons.error_outline : Icons.schedule,
                        size: 16,
                        color: f.state == 'failed' ? AppColors.danger : AppColors.warn,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${f.kind == 'signature' ? 'Firma' : kCategorias[f.category] ?? f.category}'
                          '${f.state == 'failed' ? ' · la central la ha rechazado' : ''}',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                      if (f.state == 'failed')
                        TextButton(
                          onPressed: _busy ? null : () => _reintentar(f.id),
                          child: const Text('Reintentar'),
                        ),
                    ])),
              ],
            ),
          ),
        if (_pendientes.isNotEmpty) const SizedBox(height: 8),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _files.isEmpty
                  ? const Center(
                      child: Text('Sin fotografías todavía',
                          style: TextStyle(color: AppColors.textMuted)))
                  : GridView.builder(
                      padding: const EdgeInsets.all(12),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2, crossAxisSpacing: 10, mainAxisSpacing: 10,
                        childAspectRatio: 0.85,
                      ),
                      itemCount: _files.length,
                      itemBuilder: (_, i) {
                        final f = _files[i];
                        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Stack(fit: StackFit.expand, children: [
                                Image.network(f['url'].toString(), fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) =>
                                        const ColoredBox(color: AppColors.surface)),
                                Positioned(
                                  top: 4, right: 4,
                                  child: IconButton(
                                    style: IconButton.styleFrom(
                                        backgroundColor: Colors.black54, minimumSize: const Size(36, 36)),
                                    icon: const Icon(Icons.delete, size: 18, color: Colors.white),
                                    onPressed: () => _eliminar(f),
                                  ),
                                ),
                              ]),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(kCategorias[f['category']] ?? f['category'].toString(),
                              style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
                        ]);
                      },
                    ),
        ),
      ]),
    );
  }
}
