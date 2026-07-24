import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme.dart';

const _areas = ['camion', 'movil', 'tacografo', 'turismo', 'mecanica'];

class CreateTaskScreen extends StatefulWidget {
  final ApiService api;
  const CreateTaskScreen({super.key, required this.api});

  @override
  State<CreateTaskScreen> createState() => _CreateTaskScreenState();
}

class _CreateTaskScreenState extends State<CreateTaskScreen> {
  String _area = 'mecanica';
  final _plateCtrl = TextEditingController();
  final _reasonCtrl = TextEditingController();
  final _customerCtrl = TextEditingController();
  bool _urgent = false;

  List<String> _techs = [];
  final Set<String> _assigned = {};
  bool _loadingTechs = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTechs();
  }

  Future<void> _loadTechs() async {
    final t = await widget.api.getTechs();
    if (!mounted) return;
    setState(() {
      _techs = t;
      _loadingTechs = false;
    });
  }

  Future<void> _save() async {
    final plate = _plateCtrl.text.trim().toUpperCase();
    if (plate.isEmpty) {
      setState(() => _error = 'La matrícula es obligatoria.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.createJob(
        area: _area,
        plate: plate,
        reason: _reasonCtrl.text.trim(),
        urgent: _urgent,
        assignedNames: _assigned.toList(),
        customerName: _customerCtrl.text.trim(),
      );
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nueva tarea')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            value: _area,
            decoration: const InputDecoration(labelText: 'Área'),
            dropdownColor: AppColors.surface,
            items: _areas
                .map((a) => DropdownMenuItem(value: a, child: Text(a)))
                .toList(),
            onChanged: (v) => setState(() => _area = v ?? 'mecanica'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _plateCtrl,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Matrícula'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reasonCtrl,
            decoration: const InputDecoration(labelText: 'Motivo / trabajo'),
            maxLines: 2,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _customerCtrl,
            decoration: const InputDecoration(labelText: 'Cliente (opcional)'),
          ),
          const SizedBox(height: 6),
          SwitchListTile(
            value: _urgent,
            activeColor: AppColors.primary,
            contentPadding: EdgeInsets.zero,
            title: const Text('Urgente'),
            onChanged: (v) => setState(() => _urgent = v),
          ),
          const SizedBox(height: 8),
          const Text('Asignar a', style: TextStyle(color: AppColors.textMuted)),
          const SizedBox(height: 6),
          if (_loadingTechs)
            const Center(child: CircularProgressIndicator(color: AppColors.primary))
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _techs.map((t) {
                final sel = _assigned.contains(t);
                return FilterChip(
                  label: Text(t),
                  selected: sel,
                  selectedColor: AppColors.primary.withOpacity(0.25),
                  checkmarkColor: AppColors.primary,
                  backgroundColor: AppColors.surfaceDeep,
                  onSelected: (v) => setState(() {
                    if (v) {
                      _assigned.add(t);
                    } else {
                      _assigned.remove(t);
                    }
                  }),
                );
              }).toList(),
            ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.primary)),
          ],
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.check),
              label: Text(_saving ? 'Guardando…' : 'Crear tarea'),
            ),
          ),
        ],
      ),
    );
  }
}
