import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import '../services/api_service.dart';

class ArrivalPhotosScreen extends StatefulWidget {
  final ApiService api;
  final int assistanceId;
  // Si extraMode=true, solo pide fotos libres sin obligatorias
  final bool extraMode;
  // Callback opcional al confirmar (p.ej. cambiar estado)
  final Future<void> Function()? onDone;

  const ArrivalPhotosScreen({
    super.key,
    required this.api,
    required this.assistanceId,
    this.extraMode = false,
    this.onDone,
  });

  @override
  State<ArrivalPhotosScreen> createState() => _ArrivalPhotosScreenState();
}

class _ArrivalPhotosScreenState extends State<ArrivalPhotosScreen> {
  final _picker = ImagePicker();

  // Fotos obligatorias (solo en modo normal)
  File? _photoCamion;
  File? _photoRemolque;
  File? _photoAveria;
  bool _hasRemolque = false;

  // Fotos extra (disponibles en ambos modos)
  final List<File> _extraPhotos = [];

  bool _uploading = false;
  String? _uploadingLabel;

  bool get _canConfirm {
    if (widget.extraMode) return true; // en modo extra siempre se puede confirmar
    return _photoCamion != null &&
        _photoAveria != null &&
        (!_hasRemolque || _photoRemolque != null);
  }

  Future<File> _normalizeImage(XFile xfile) async {
    final tmpDir = await getTemporaryDirectory();
    final outPath = '${tmpDir.path}/norm_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final result = await FlutterImageCompress.compressAndGetFile(
      xfile.path,
      outPath,
      quality: 85,
      minWidth: 1920,
      minHeight: 1080,
      keepExif: false, // elimina EXIF — la foto queda ya rotada correctamente
    );
    return result == null ? File(xfile.path) : File(result.path);
  }

  Future<void> _pickPhoto(String label, void Function(File) onPicked) async {
    final source = await _showSourceDialog(label);
    if (source == null) return;
    final xfile = await _picker.pickImage(source: source, maxWidth: 1920);
    if (xfile == null) return;
    final file = await _normalizeImage(xfile);
    setState(() => onPicked(file));
  }

  Future<void> _pickExtraPhoto() async {
    final source = await _showSourceDialog('Foto adicional');
    if (source == null) return;
    final xfile = await _picker.pickImage(source: source, maxWidth: 1920);
    if (xfile == null) return;
    final file = await _normalizeImage(xfile);
    setState(() => _extraPhotos.add(file));
  }

  Future<ImageSource?> _showSourceDialog(String label) {
    return showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: const Color(0xFF16213e),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(label,
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 16)),
            ),
            ListTile(
              leading: const Icon(Icons.camera_alt, color: Colors.white70),
              title: const Text('Cámara',
                  style: TextStyle(color: Colors.white70)),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library, color: Colors.white70),
              title: const Text('Galería',
                  style: TextStyle(color: Colors.white70)),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _handlePlateResult(Map<String, dynamic> result) async {
    final action = result['plateAction'] as String? ?? 'none';
    final detected = result['detectedPlate'] as String?;
    final current = result['currentPlate'] as String?;

    if (action == 'none' || !mounted) return;

    String title;
    String message;
    Color color;

    if (action == 'assigned') {
      title = 'Matrícula detectada';
      message = 'La IA ha leído la matrícula ${detected ?? ''} y la ha asignado a esta asistencia.';
      color = Colors.green;
    } else if (action == 'match') {
      title = '✓ Matrícula correcta';
      message = 'La matrícula detectada (${detected ?? ''}) coincide con la registrada.';
      color = Colors.green;
    } else {
      // Matrícula no coincide → diálogo con opciones
      await _showPlateMismatchDialog(detected: detected, current: current);
      return;
    }

    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }

  Future<void> _showPlateMismatchDialog({String? detected, String? current}) async {
    final plateCtrl = TextEditingController(text: detected ?? '');
    bool reporting = false;
    bool reported = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          backgroundColor: const Color(0xFF16213e),
          title: const Text('⚠️ Matrícula no coincide',
              style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              RichText(
                text: TextSpan(
                  style: const TextStyle(color: Colors.white70, fontSize: 14),
                  children: [
                    const TextSpan(text: 'IA detectó: '),
                    TextSpan(
                        text: detected ?? '(no legible)',
                        style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
                    const TextSpan(text: '\nAsistencia tiene: '),
                    TextSpan(
                        text: current ?? '(sin matrícula)',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const Text('¿Qué quieres hacer?',
                  style: TextStyle(color: Colors.white54, fontSize: 13)),
              const SizedBox(height: 10),
              // Campo para cambiar matrícula
              TextField(
                controller: plateCtrl,
                style: const TextStyle(color: Colors.white),
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                  labelText: 'Nueva matrícula',
                  labelStyle: const TextStyle(color: Colors.white38),
                  filled: true,
                  fillColor: Colors.white10,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: Colors.white24),
                      borderRadius: BorderRadius.circular(8)),
                ),
              ),
              if (reported)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Text('✓ Incidencia notificada a la oficina',
                      style: TextStyle(color: Colors.green, fontSize: 13)),
                ),
            ],
          ),
          actions: [
            // Avisar a oficina
            TextButton.icon(
              icon: reporting
                  ? const SizedBox(width: 14, height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orange))
                  : const Icon(Icons.warning_amber, color: Colors.orange, size: 18),
              label: Text(reported ? 'Notificado' : 'Avisar a oficina',
                  style: const TextStyle(color: Colors.orange)),
              onPressed: reported || reporting
                  ? null
                  : () async {
                      setS(() => reporting = true);
                      try {
                        await widget.api.reportPlateMismatch(
                            widget.assistanceId,
                            detected: detected,
                            current: current);
                        setS(() => reported = true);
                      } catch (_) {}
                      setS(() => reporting = false);
                    },
            ),
            // Cambiar matrícula
            ElevatedButton.icon(
              icon: const Icon(Icons.edit, size: 16),
              label: const Text('Cambiar matrícula'),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
              onPressed: () async {
                final newPlate = plateCtrl.text.trim().toUpperCase();
                if (newPlate.isEmpty) return;
                try {
                  await widget.api.updatePlate(widget.assistanceId, newPlate);
                } catch (_) {}
                if (ctx.mounted) Navigator.pop(ctx);
              },
            ),
            // Continuar sin cambiar
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Continuar así', style: TextStyle(color: Colors.white38)),
            ),
          ],
        ),
      ),
    );
    plateCtrl.dispose();
  }

  Future<void> _confirm() async {
    setState(() {
      _uploading = true;
      _uploadingLabel = 'Subiendo fotos...';
    });

    try {
      if (!widget.extraMode) {
        setState(() => _uploadingLabel = 'Subiendo matrícula camión...');
        final plateResult = await widget.api.uploadFile(
            widget.assistanceId, _photoCamion!, 'matricula_camion');
        await _handlePlateResult(plateResult);

        if (_hasRemolque && _photoRemolque != null) {
          setState(() => _uploadingLabel = 'Subiendo matrícula remolque...');
          await widget.api.uploadFile(
              widget.assistanceId, _photoRemolque!, 'matricula_remolque');
        }

        setState(() => _uploadingLabel = 'Subiendo foto avería...');
        await widget.api
            .uploadFile(widget.assistanceId, _photoAveria!, 'foto_averia');
      }

      for (int i = 0; i < _extraPhotos.length; i++) {
        setState(() =>
            _uploadingLabel = 'Subiendo foto extra ${i + 1}/${_extraPhotos.length}...');
        await widget.api.uploadFile(
            widget.assistanceId, _extraPhotos[i], 'foto_extra');
      }

      // Callback de estado (p.ej. inicio_reparacion)
      if (widget.onDone != null) {
        setState(() => _uploadingLabel = 'Actualizando estado...');
        await widget.onDone!();
      }

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
        backgroundColor: Colors.red,
      ));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      appBar: AppBar(
        toolbarHeight: 110,
        title: Image.asset('assets/logo_horizontal.png', height: 90),
        backgroundColor: const Color(0xFF16213e),
        foregroundColor: Colors.white,
      ),
      body: _uploading
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 16),
                  Text(_uploadingLabel ?? '',
                      style: const TextStyle(color: Colors.white70)),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.extraMode
                        ? 'Añade las fotos que necesites durante la reparación.'
                        : 'Fotografía el vehículo antes de iniciar la reparación.',
                    style: const TextStyle(color: Colors.white54, fontSize: 13),
                  ),
                  const SizedBox(height: 24),

                  // Fotos obligatorias (solo modo normal)
                  if (!widget.extraMode) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF16213e),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.info_outline, color: Colors.lightBlue, size: 18),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Matrícula BLANCA = camión · Matrícula ROJA = remolque.\n'
                              'Si en la foto salen las dos, la blanca es del camión y la roja del remolque.',
                              style: TextStyle(color: Colors.white60, fontSize: 12, height: 1.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _PhotoTile(
                      icon: Icons.local_shipping,
                      label: 'Matrícula del camión *',
                      photo: _photoCamion,
                      onTap: () => _pickPhoto('Matrícula del camión',
                          (f) => _photoCamion = f),
                    ),
                    const SizedBox(height: 16),
                    _RemolqueToggle(
                      value: _hasRemolque,
                      onChanged: (v) => setState(() {
                        _hasRemolque = v;
                        if (!v) _photoRemolque = null;
                      }),
                    ),
                    if (_hasRemolque) ...[
                      const SizedBox(height: 16),
                      _PhotoTile(
                        icon: Icons.rv_hookup,
                        label: 'Matrícula del remolque *',
                        photo: _photoRemolque,
                        onTap: () => _pickPhoto('Matrícula del remolque',
                            (f) => _photoRemolque = f),
                      ),
                    ],
                    const SizedBox(height: 16),
                    _PhotoTile(
                      icon: Icons.warning_amber,
                      label: 'Foto de la avería *',
                      photo: _photoAveria,
                      onTap: () => _pickPhoto(
                          'Foto de la avería', (f) => _photoAveria = f),
                    ),
                    const SizedBox(height: 24),
                    _label('Fotos adicionales (opcional)'),
                    const SizedBox(height: 8),
                  ],

                  // Fotos extra
                  ..._extraPhotos.asMap().entries.map((e) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _PhotoTile(
                          icon: Icons.photo_camera,
                          label: 'Foto extra ${e.key + 1}',
                          photo: e.value,
                          onTap: () => _pickPhoto(
                              'Foto extra', (f) {
                                setState(() => _extraPhotos[e.key] = f);
                              }),
                        ),
                      )),

                  // Botón añadir foto extra
                  GestureDetector(
                    onTap: _pickExtraPhoto,
                    child: Container(
                      height: 64,
                      decoration: BoxDecoration(
                        color: const Color(0xFF16213e),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: Colors.indigo.withOpacity(0.5), width: 1.5),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_a_photo,
                              color: Colors.indigo, size: 20),
                          SizedBox(width: 8),
                          Text('Añadir otra foto',
                              style: TextStyle(
                                  color: Colors.indigo, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),

                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _canConfirm ? _confirm : null,
                      icon: Icon(widget.extraMode
                          ? Icons.upload
                          : Icons.build),
                      label: Text(widget.extraMode
                          ? 'Subir fotos'
                          : 'Confirmar e iniciar reparación'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _canConfirm
                            ? (widget.extraMode
                                ? Colors.indigo
                                : Colors.deepOrange)
                            : Colors.white12,
                        foregroundColor:
                            _canConfirm ? Colors.white : Colors.white38,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _label(String text) => Text(
        text,
        style: const TextStyle(
            color: Colors.white54,
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8),
      );
}

class _PhotoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final File? photo;
  final VoidCallback onTap;

  const _PhotoTile({
    required this.icon,
    required this.label,
    required this.photo,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 140,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: photo != null
                ? Colors.green
                : Colors.black26,
            width: 1.5,
          ),
        ),
        child: photo != null
            ? Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(11),
                    child: Image.file(photo!, fit: BoxFit.cover),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                          color: Colors.green, shape: BoxShape.circle),
                      child: const Icon(Icons.check,
                          color: Colors.white, size: 16),
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    left: 0,
                    right: 0,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.6),
                        borderRadius: const BorderRadius.vertical(
                            bottom: Radius.circular(11)),
                      ),
                      child: Text(label,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12)),
                    ),
                  ),
                ],
              )
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, color: Colors.black45, size: 32),
                  const SizedBox(height: 8),
                  Text(label,
                      style: const TextStyle(
                          color: Colors.black87, fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  const Text('Toca para fotografiar',
                      style:
                          TextStyle(color: Colors.black45, fontSize: 11)),
                ],
              ),
      ),
    );
  }
}

class _RemolqueToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const _RemolqueToggle({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF16213e),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Row(
            children: [
              Icon(Icons.rv_hookup, color: Colors.white54, size: 20),
              SizedBox(width: 10),
              Text('¿Lleva remolque?',
                  style: TextStyle(color: Colors.white70)),
            ],
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            activeColor: Colors.lightBlue,
          ),
        ],
      ),
    );
  }
}
