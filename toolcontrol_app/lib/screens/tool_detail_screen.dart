import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme.dart';

class ToolDetailScreen extends StatefulWidget {
  final String itemId;
  final bool isMachine;
  final String employeeId;
  const ToolDetailScreen({
    super.key,
    required this.itemId,
    required this.employeeId,
    this.isMachine = false,
  });

  @override
  State<ToolDetailScreen> createState() => _ToolDetailScreenState();
}

class _ToolDetailScreenState extends State<ToolDetailScreen> {
  Map<String, dynamic>? _item;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final item = widget.isMachine
          ? await ApiService.getMachine(widget.itemId)
          : await ApiService.getTool(widget.itemId);
      if (mounted) setState(() => _item = item);
    } catch (e) {
      _snack('Error cargando: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _run(Future<String?> Function() action, String okMsg) async {
    setState(() => _busy = true);
    try {
      final error = await action();
      if (error != null) {
        _snack(error);
      } else {
        _snack(okMsg);
        await _load();
      }
    } catch (e) {
      _snack('Error: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _usar() => _run(
        () => ApiService.usarTool(widget.itemId, widget.employeeId),
        'Herramienta en uso',
      );

  Future<String?> _pickLocation(String title) async {
    List<Map<String, dynamic>> locations;
    try {
      locations = await ApiService.getLocations();
    } catch (e) {
      _snack('Error cargando ubicaciones: $e');
      return null;
    }
    if (!mounted) return null;
    return showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(title,
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.bold)),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: locations
                    .map((l) => ListTile(
                          leading: const Icon(Icons.place_outlined,
                              color: AppColors.primary),
                          title: Text(l['nombre'] as String? ?? ''),
                          onTap: () =>
                              Navigator.of(ctx).pop(l['id'] as String),
                        ))
                    .toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _devolver() async {
    final ubicacion = await _pickLocation('¿Dónde la devuelves?');
    if (ubicacion == null) return;
    await _run(
      () => ApiService.devolverTool(widget.itemId, widget.employeeId, ubicacion),
      'Herramienta devuelta',
    );
  }

  Future<void> _mover() async {
    final ubicacion = await _pickLocation('Nueva ubicación');
    if (ubicacion == null) return;
    await _run(
      () => ApiService.moverTool(widget.itemId, widget.employeeId, ubicacion),
      'Ubicación actualizada',
    );
  }

  Future<void> _reportarIncidencia() async {
    final descCtrl = TextEditingController();
    String gravedad = 'media';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          backgroundColor: AppColors.surface,
          title: const Text('Reportar incidencia'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: descCtrl,
                maxLines: 3,
                decoration:
                    const InputDecoration(labelText: 'Descripción'),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: gravedad,
                decoration: const InputDecoration(labelText: 'Gravedad'),
                dropdownColor: AppColors.surface,
                items: const [
                  DropdownMenuItem(value: 'baja', child: Text('Baja')),
                  DropdownMenuItem(value: 'media', child: Text('Media')),
                  DropdownMenuItem(value: 'alta', child: Text('Alta')),
                ],
                onChanged: (v) => setLocal(() => gravedad = v ?? 'media'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Enviar'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if (descCtrl.text.trim().isEmpty) {
      _snack('La descripción es obligatoria');
      return;
    }
    await _run(
      () => ApiService.reportarIncidencia(
        toolId: widget.isMachine ? null : widget.itemId,
        machineId: widget.isMachine ? widget.itemId : null,
        employeeId: widget.employeeId,
        descripcion: descCtrl.text.trim(),
        gravedad: gravedad,
      ),
      'Incidencia reportada',
    );
  }

  Widget _infoRow(String label, String? value) {
    if (value == null || value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(label,
                style: const TextStyle(color: AppColors.textMuted)),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;
    return Scaffold(
      appBar: AppBar(
          title: Text(widget.isMachine ? 'Máquina' : 'Herramienta')),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.primary))
          : item == null
              ? const Center(
                  child: Text('No encontrada',
                      style: TextStyle(color: AppColors.textMuted)))
              : _buildDetail(item),
    );
  }

  Widget _buildDetail(Map<String, dynamic> item) {
    final estado = (item['estado'] as String?) ?? '';
    final color = toolStatusColor(estado);
    final fotoUrl = item['foto_url'] as String?;
    final ubicacion =
        (item['ubicacion'] as Map?)?['nombre'] as String?;
    final categoria =
        (item['categoria'] as Map?)?['nombre'] as String?;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (fotoUrl != null && fotoUrl.isNotEmpty)
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.network(
              fotoUrl,
              height: 200,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: Text(
                '${item['codigo'] ?? ''} — ${item['nombre'] ?? ''}',
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.bold),
              ),
            ),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: color.withOpacity(0.15),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: color.withOpacity(0.5)),
              ),
              child: Text(toolStatusLabel(estado),
                  style: TextStyle(color: color, fontSize: 13)),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Card(
          color: AppColors.surface,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _infoRow('Marca', item['marca'] as String?),
                _infoRow('Modelo', item['modelo'] as String?),
                _infoRow('Categoría', categoria),
                _infoRow('Ubicación', ubicacion),
                _infoRow('Descripción', item['descripcion'] as String?),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        if (!widget.isMachine) ...[
          if (estado == 'disponible')
            _actionButton(
                'Utilizar', Icons.play_arrow, AppColors.primary, _usar),
          if (estado == 'en_uso')
            _actionButton('Devolver', Icons.assignment_return,
                const Color(0xFF10B981), _devolver),
          _actionButton('Mover ubicación', Icons.place,
              const Color(0xFF3B82F6), _mover),
        ],
        _actionButton('Reportar incidencia', Icons.report_problem,
            const Color(0xFFEF4444), _reportarIncidencia),
      ],
    );
  }

  Widget _actionButton(
      String label, IconData icon, Color color, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SizedBox(
        width: double.infinity,
        height: 52,
        child: ElevatedButton.icon(
          onPressed: _busy ? null : onTap,
          icon: Icon(icon),
          label: Text(label, style: const TextStyle(fontSize: 16)),
          style: ElevatedButton.styleFrom(
            backgroundColor: color,
            foregroundColor: Colors.white,
          ),
        ),
      ),
    );
  }
}
