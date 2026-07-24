import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/job.dart';
import '../services/api_service.dart';
import '../theme.dart';

class TaskDetailScreen extends StatefulWidget {
  final ApiService api;
  final Job job;
  final bool esSupervisor;
  const TaskDetailScreen({
    super.key,
    required this.api,
    required this.job,
    required this.esSupervisor,
  });

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  late Job _job;
  bool _busy = false;
  bool _changed = false;
  List<Map<String, dynamic>> _files = [];
  bool _uploadingPhoto = false;

  @override
  void initState() {
    super.initState();
    _job = widget.job;
    _loadFiles();
  }

  Future<void> _loadFiles() async {
    final files = await widget.api.getFiles(_job.id);
    if (!mounted) return;
    setState(() => _files = files);
  }

  Future<void> _addPhoto() async {
    final picker = ImagePicker();
    final shot = await picker.pickImage(
      source: ImageSource.camera,
      imageQuality: 85,
      maxWidth: 1600,
    );
    if (shot == null) return;
    setState(() => _uploadingPhoto = true);
    try {
      await widget.api.uploadPhoto(_job.id, shot.path);
      await _loadFiles();
      if (!mounted) return;
      setState(() => _uploadingPhoto = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingPhoto = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
      ));
    }
  }

  Future<void> _setStatus(String status) async {
    setState(() => _busy = true);
    try {
      final updated = await widget.api.setStatus(_job.id, status);
      if (!mounted) return;
      setState(() {
        _job = updated;
        _busy = false;
        _changed = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
      ));
    }
  }

  Future<void> _confirmFinish() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Finalizar tarea'),
        content: const Text('¿Marcar esta tarea como finalizada?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Finalizar')),
        ],
      ),
    );
    if (ok == true) _setStatus('cerrado');
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        Navigator.pop(context, _changed);
      },
      child: Scaffold(
        appBar: AppBar(title: Text(_job.plate.isEmpty ? 'Tarea' : _job.plate)),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(children: [
              _pill(statusLabel(_job.status), statusColor(_job.status)),
              const SizedBox(width: 8),
              if (_job.urgent) _pill('Urgente', AppColors.primary),
            ]),
            const SizedBox(height: 16),
            _info('Matrícula', _job.plate.isEmpty ? '—' : _job.plate),
            _info('Área', _job.area),
            _info('Motivo', _job.reason.isEmpty ? '—' : _job.reason),
            _info('Asignado a',
                _job.assignedNames.isEmpty ? 'Sin asignar' : _job.assignedNames.join(', ')),
            if (_job.customerName.isNotEmpty) _info('Cliente', _job.customerName),
            if (_job.actualMinutes != null)
              _info('Tiempo total', '${_job.actualMinutes} min'),
            const SizedBox(height: 24),
            if (_busy)
              const Center(child: CircularProgressIndicator(color: AppColors.primary))
            else
              ..._actions(),
            const SizedBox(height: 24),
            const Divider(color: AppColors.border),
            const SizedBox(height: 8),
            Row(
              children: [
                const Text('FOTOS',
                    style: TextStyle(
                        fontSize: 12, color: AppColors.textMuted, letterSpacing: 0.4)),
                const Spacer(),
                TextButton.icon(
                  onPressed: _uploadingPhoto ? null : _addPhoto,
                  icon: _uploadingPhoto
                      ? const SizedBox(
                          height: 16,
                          width: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.add_a_photo, size: 18),
                  label: const Text('Añadir'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_files.isEmpty)
              const Text('Sin fotos.', style: TextStyle(color: AppColors.textMuted))
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _files
                    .map((f) => ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            (f['url'] ?? '').toString(),
                            width: 100,
                            height: 100,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              width: 100,
                              height: 100,
                              color: AppColors.surfaceDeep,
                              child: const Icon(Icons.broken_image,
                                  color: AppColors.textMuted),
                            ),
                          ),
                        ))
                    .toList(),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _actions() {
    final s = _job.status;
    final widgets = <Widget>[];

    if (s == 'espera' || s == 'validacion') {
      widgets.add(_bigButton('Empezar', Icons.play_arrow, AppColors.primary,
          () => _setStatus('activo')));
    } else if (s == 'activo') {
      widgets.add(_bigButton('Pausar', Icons.pause, const Color(0xFFF59E0B),
          () => _setStatus('parado')));
      widgets.add(const SizedBox(height: 10));
      widgets.add(_bigButton('Finalizar', Icons.check, const Color(0xFF10B981),
          _confirmFinish));
    } else if (s == 'parado') {
      widgets.add(_bigButton('Reanudar', Icons.play_arrow, AppColors.primary,
          () => _setStatus('activo')));
      widgets.add(const SizedBox(height: 10));
      widgets.add(_bigButton('Finalizar', Icons.check, const Color(0xFF10B981),
          _confirmFinish));
    } else if (s == 'cerrado') {
      widgets.add(const Center(
        child: Text('Tarea finalizada', style: TextStyle(color: AppColors.textMuted)),
      ));
    } else {
      widgets.add(const Center(
        child: Text('Sin acciones disponibles',
            style: TextStyle(color: AppColors.textMuted)),
      ));
    }
    return widgets;
  }

  Widget _bigButton(String label, IconData icon, Color color, VoidCallback onTap) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        style: ElevatedButton.styleFrom(backgroundColor: color),
        icon: Icon(icon),
        label: Text(label, style: const TextStyle(fontSize: 16)),
        onPressed: onTap,
      ),
    );
  }

  Widget _info(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textMuted, letterSpacing: 0.4)),
            const SizedBox(height: 2),
            Text(value, style: const TextStyle(fontSize: 15)),
          ],
        ),
      );

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.18),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text,
            style: TextStyle(fontWeight: FontWeight.bold, color: color)),
      );
}
