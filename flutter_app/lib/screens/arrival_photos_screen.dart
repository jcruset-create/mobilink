import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_service.dart';

class ArrivalPhotosScreen extends StatefulWidget {
  final ApiService api;
  final int assistanceId;

  const ArrivalPhotosScreen(
      {super.key, required this.api, required this.assistanceId});

  @override
  State<ArrivalPhotosScreen> createState() => _ArrivalPhotosScreenState();
}

class _ArrivalPhotosScreenState extends State<ArrivalPhotosScreen> {
  final _picker = ImagePicker();

  File? _photoCamion;
  File? _photoRemolque;
  File? _photoAveria;
  bool _hasRemolque = false;

  bool _uploading = false;
  String? _uploadingLabel;

  bool get _canConfirm =>
      _photoCamion != null &&
      _photoAveria != null &&
      (!_hasRemolque || _photoRemolque != null);

  Future<void> _pickPhoto(String label, void Function(File) onPicked) async {
    final source = await _showSourceDialog(label);
    if (source == null) return;
    final xfile = await _picker.pickImage(
      source: source,
      imageQuality: 80,
      maxWidth: 1920,
    );
    if (xfile == null) return;
    onPicked(File(xfile.path));
  }

  Future<ImageSource?> _showSourceDialog(String label) async {
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

  Future<void> _confirm() async {
    setState(() {
      _uploading = true;
      _uploadingLabel = 'Subiendo fotos...';
    });

    try {
      setState(() => _uploadingLabel = 'Subiendo matrícula camión...');
      await widget.api
          .uploadFile(widget.assistanceId, _photoCamion!, 'matricula_camion');

      if (_hasRemolque && _photoRemolque != null) {
        setState(() => _uploadingLabel = 'Subiendo matrícula remolque...');
        await widget.api.uploadFile(
            widget.assistanceId, _photoRemolque!, 'matricula_remolque');
      }

      setState(() => _uploadingLabel = 'Subiendo foto avería...');
      await widget.api
          .uploadFile(widget.assistanceId, _photoAveria!, 'foto_averia');

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
        title: const Text('Fotos de llegada'),
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
                  const Text(
                    'Antes de marcar llegada, toma las fotos obligatorias.',
                    style: TextStyle(color: Colors.white54, fontSize: 13),
                  ),
                  const SizedBox(height: 24),
                  _PhotoTile(
                    icon: Icons.local_shipping,
                    label: 'Matrícula del camión *',
                    photo: _photoCamion,
                    onTap: () => _pickPhoto(
                        'Matrícula del camión',
                        (f) => setState(() => _photoCamion = f)),
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
                      onTap: () => _pickPhoto(
                          'Matrícula del remolque',
                          (f) => setState(() => _photoRemolque = f)),
                    ),
                  ],
                  const SizedBox(height: 16),
                  _PhotoTile(
                    icon: Icons.warning_amber,
                    label: 'Foto de la avería *',
                    photo: _photoAveria,
                    onTap: () => _pickPhoto(
                        'Foto de la avería',
                        (f) => setState(() => _photoAveria = f)),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _canConfirm ? _confirm : null,
                      icon: const Icon(Icons.check_circle),
                      label: const Text('Confirmar llegada'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor:
                            _canConfirm ? Colors.purple : Colors.white12,
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
}

class _PhotoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final File? photo;
  final VoidCallback onTap;

  const _PhotoTile(
      {required this.icon,
      required this.label,
      required this.photo,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 140,
        decoration: BoxDecoration(
          color: const Color(0xFF16213e),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: photo != null
                ? Colors.green.withOpacity(0.6)
                : Colors.white24,
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
                  Icon(icon, color: Colors.white38, size: 32),
                  const SizedBox(height: 8),
                  Text(label,
                      style: const TextStyle(
                          color: Colors.white54, fontSize: 13)),
                  const SizedBox(height: 4),
                  const Text('Toca para fotografiar',
                      style:
                          TextStyle(color: Colors.white30, fontSize: 11)),
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
