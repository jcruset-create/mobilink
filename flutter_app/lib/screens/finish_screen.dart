import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:signature/signature.dart';
import '../services/api_service.dart';

class FinishScreen extends StatefulWidget {
  final ApiService api;
  final int assistanceId;

  const FinishScreen(
      {super.key, required this.api, required this.assistanceId});

  @override
  State<FinishScreen> createState() => _FinishScreenState();
}

class _FinishScreenState extends State<FinishScreen> {
  final _picker = ImagePicker();
  final _sigController = SignatureController(
    penStrokeWidth: 3,
    penColor: Colors.black,
    exportBackgroundColor: Colors.white,
  );

  final _nombreCtrl = TextEditingController();
  final _dniCtrl = TextEditingController();
  final _obsCtrl = TextEditingController();

  File? _photoReparacion;
  bool _uploading = false;
  String? _uploadingLabel;

  bool get _canConfirm =>
      _photoReparacion != null &&
      !_sigController.isEmpty &&
      _nombreCtrl.text.trim().isNotEmpty &&
      _dniCtrl.text.trim().isNotEmpty &&
      _obsCtrl.text.trim().isNotEmpty;

  @override
  void dispose() {
    _sigController.dispose();
    _nombreCtrl.dispose();
    _dniCtrl.dispose();
    _obsCtrl.dispose();
    super.dispose();
  }

  Future<File> _normalizeImage(XFile xfile) async {
    final tmpDir = await getTemporaryDirectory();
    final outPath = '${tmpDir.path}/norm_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final result = await FlutterImageCompress.compressAndGetFile(
      xfile.path, outPath,
      quality: 85, minWidth: 1920, minHeight: 1080, keepExif: false,
    );
    return result == null ? File(xfile.path) : File(result.path);
  }

  Future<void> _pickPhoto() async {
    final source = await _showSourceDialog();
    if (source == null) return;
    final xfile = await _picker.pickImage(source: source, maxWidth: 1920);
    if (xfile == null) return;
    final file = await _normalizeImage(xfile);
    setState(() => _photoReparacion = file);
  }

  Future<ImageSource?> _showSourceDialog() {
    return showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: const Color(0xFF16213e),
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Foto de la reparación',
                  style: TextStyle(
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
              leading:
                  const Icon(Icons.photo_library, color: Colors.white70),
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

  Future<void> _confirm() async {
    setState(() {
      _uploading = true;
      _uploadingLabel = 'Subiendo foto reparación...';
    });

    try {
      await widget.api.uploadFile(
          widget.assistanceId, _photoReparacion!, 'foto_reparacion');

      setState(() => _uploadingLabel = 'Guardando firma...');
      final Uint8List? sigBytes =
          await _sigController.toPngBytes(height: 200, width: 600);
      if (sigBytes == null) throw Exception('No se pudo exportar la firma');

      final tmpDir = Directory.systemTemp;
      final sigFile = File('${tmpDir.path}/firma_${DateTime.now().millisecondsSinceEpoch}.png');
      await sigFile.writeAsBytes(sigBytes);
      await widget.api.uploadFile(widget.assistanceId, sigFile, 'firma');

      setState(() => _uploadingLabel = 'Guardando datos del conductor...');
      await widget.api.saveConductor(
        widget.assistanceId,
        _nombreCtrl.text.trim(),
        _dniCtrl.text.trim(),
        observaciones: _obsCtrl.text.trim().isNotEmpty ? _obsCtrl.text.trim() : null,
      );

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
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Columna izquierda: foto + datos ──
                  Expanded(
                    flex: 1,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _label('Foto de la reparación *'),
                        const SizedBox(height: 8),
                        GestureDetector(
                          onTap: _pickPhoto,
                          child: Container(
                            height: 180,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: _photoReparacion != null
                                    ? Colors.green
                                    : Colors.black26,
                                width: 1.5,
                              ),
                            ),
                            child: _photoReparacion != null
                                ? Stack(fit: StackFit.expand, children: [
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(11),
                                      child: Image.file(_photoReparacion!, fit: BoxFit.cover),
                                    ),
                                    Positioned(
                                      top: 8, right: 8,
                                      child: Container(
                                        padding: const EdgeInsets.all(4),
                                        decoration: const BoxDecoration(
                                            color: Colors.green, shape: BoxShape.circle),
                                        child: const Icon(Icons.check, color: Colors.white, size: 16),
                                      ),
                                    ),
                                  ])
                                : const Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(Icons.add_a_photo_outlined, color: Colors.black45, size: 40),
                                      SizedBox(height: 10),
                                      Text('Toca para fotografiar',
                                          style: TextStyle(color: Colors.black54, fontSize: 14, fontWeight: FontWeight.w500)),
                                    ],
                                  ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        _label('Datos del conductor *'),
                        const SizedBox(height: 8),
                        _TextField(
                          controller: _nombreCtrl,
                          hint: 'Nombre completo',
                          icon: Icons.person,
                          onChanged: (_) => setState(() {}),
                        ),
                        const SizedBox(height: 10),
                        _TextField(
                          controller: _dniCtrl,
                          hint: 'DNI / NIE / Pasaporte',
                          icon: Icons.badge,
                          onChanged: (_) => setState(() {}),
                        ),
                        const SizedBox(height: 20),
                        _label('Trabajos realizados *'),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _obsCtrl,
                          maxLines: 4,
                          onChanged: (_) => setState(() {}),
                          style: const TextStyle(color: Colors.white),
                          decoration: InputDecoration(
                            hintText: 'Describe los trabajos realizados...',
                            hintStyle: const TextStyle(color: Colors.white38, fontSize: 13),
                            filled: true,
                            fillColor: const Color(0xFF16213e),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Colors.white24),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Colors.white24),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(10),
                              borderSide: const BorderSide(color: Colors.teal),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        ListenableBuilder(
                          listenable: Listenable.merge([_nombreCtrl, _dniCtrl, _sigController]),
                          builder: (_, __) => SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: _canConfirm ? _confirm : null,
                              icon: const Icon(Icons.check_circle),
                              label: const Text('Confirmar finalización'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: _canConfirm ? Colors.teal : Colors.white12,
                                foregroundColor: _canConfirm ? Colors.white : Colors.white38,
                                padding: const EdgeInsets.symmetric(vertical: 16),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  // ── Columna derecha: firma grande ──
                  Expanded(
                    flex: 1,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _label('Firma del conductor *'),
                        const SizedBox(height: 8),
                        Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: _sigController.isEmpty
                                  ? Colors.black26
                                  : Colors.green.withOpacity(0.8),
                              width: 1.5,
                            ),
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(11),
                            child: Signature(
                              controller: _sigController,
                              height: 300,
                              backgroundColor: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton.icon(
                              onPressed: () => setState(() => _sigController.clear()),
                              icon: const Icon(Icons.refresh, size: 16, color: Colors.white38),
                              label: const Text('Borrar firma',
                                  style: TextStyle(color: Colors.white38, fontSize: 12)),
                            ),
                          ],
                        ),
                      ],
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

class _TextField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final ValueChanged<String> onChanged;

  const _TextField({
    required this.controller,
    required this.hint,
    required this.icon,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      style: const TextStyle(color: Colors.black87, fontSize: 15),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.black38, fontSize: 14),
        prefixIcon: Icon(icon, color: Colors.black45, size: 20),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.black26),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.black26),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Colors.black87, width: 2),
        ),
      ),
    );
  }
}
