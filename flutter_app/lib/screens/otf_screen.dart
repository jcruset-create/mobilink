import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

const _tipos = ['Tractora', 'Remolque', 'Camión rígido', 'Furgoneta', 'Turismo', 'Maquinaria', 'Otros'];

Color _trabajoColor(String s) {
  switch (s) {
    case 'finalizado': return AppColors.success;
    case 'en_proceso': return AppColors.info;
    case 'no_realizado': return AppColors.danger;
    default: return AppColors.textHint;
  }
}

String _trabajoLabel(String s) {
  switch (s) {
    case 'finalizado': return 'Finalizado';
    case 'en_proceso': return 'En proceso';
    case 'no_realizado': return 'No realizado';
    default: return 'Pendiente';
  }
}

// ── Lista de OTF (tab) ──
class OtfListTab extends StatefulWidget {
  final ApiService api;
  const OtfListTab({super.key, required this.api});
  @override
  State<OtfListTab> createState() => _OtfListTabState();
}

class _OtfListTabState extends State<OtfListTab> {
  List<Map<String, dynamic>> _list = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final l = await widget.api.getOtfList();
      if (mounted) setState(() => _list = l);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    if (_loading) return Center(child: CircularProgressIndicator(color: AppColors.primary));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.wifi_off_outlined, color: AppColors.danger, size: 48),
        const SizedBox(height: 12),
        Text(_error!, style: tt.bodyMedium, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        SizedBox(width: 200, child: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Reintentar'))),
      ]));
    }
    if (_list.isEmpty) {
      return Center(child: Text('Sin órdenes de flota asignadas', style: tt.bodyLarge?.copyWith(color: AppColors.textSecondary)));
    }
    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        itemCount: _list.length,
        itemBuilder: (_, i) {
          final o = _list[i];
          final prog = o['progreso'] as Map<String, dynamic>? ?? {};
          return Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => OtfDetailScreen(api: widget.api, otfId: o['id'] as int),
                ));
                _load();
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(o['clientName'] ?? '', style: tt.titleMedium),
                    const SizedBox(height: 4),
                    Text(o['baseName'] ?? o['direccion'] ?? '—', style: tt.bodyMedium?.copyWith(color: AppColors.textHint)),
                    const SizedBox(height: 8),
                    Text('Progreso: ${prog['hechos'] ?? 0} / ${prog['total'] ?? 0}',
                        style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
                  ])),
                  const Icon(Icons.chevron_right, color: AppColors.primary, size: 28),
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Detalle de OTF ──
class OtfDetailScreen extends StatefulWidget {
  final ApiService api;
  final int otfId;
  const OtfDetailScreen({super.key, required this.api, required this.otfId});
  @override
  State<OtfDetailScreen> createState() => _OtfDetailScreenState();
}

class _OtfDetailScreenState extends State<OtfDetailScreen> {
  Map<String, dynamic>? _otf;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final o = await widget.api.getOtf(widget.otfId);
      if (mounted) setState(() => _otf = o);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setStatus(int tid, String status) async {
    try {
      await widget.api.updateOtfTrabajoStatus(tid, status);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _otf;
    final trabajos = (o?['trabajos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    final prog = o?['progreso'] as Map<String, dynamic>? ?? {};
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(o?['clientName'] ?? 'OTF'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
      ),
      floatingActionButton: o == null ? null : FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        icon: const Icon(Icons.add),
        label: const Text('Añadir trabajo'),
        onPressed: () async {
          final added = await Navigator.of(context).push<bool>(MaterialPageRoute(
            builder: (_) => OtfAddTrabajoScreen(api: widget.api, otfId: widget.otfId),
          ));
          if (added == true) _load();
        },
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : o == null
              ? const Center(child: Text('No se pudo cargar', style: TextStyle(color: AppColors.textSecondary)))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(o['baseName'] ?? o['direccion'] ?? '—', style: const TextStyle(color: AppColors.textSecondary)),
                        const SizedBox(height: 8),
                        Text('Progreso: ${prog['hechos'] ?? 0} / ${prog['total'] ?? 0}',
                            style: const TextStyle(color: AppColors.primary, fontSize: 18, fontWeight: FontWeight.w800)),
                      ]),
                    ),
                    const SizedBox(height: 16),
                    ...trabajos.map((t) => _trabajoCard(t)),
                    const SizedBox(height: 80),
                  ],
                ),
    );
  }

  Widget _trabajoCard(Map<String, dynamic> t) {
    final status = t['status'] as String? ?? 'pendiente';
    final color = _trabajoColor(status);
    final fotos = (t['fotos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    final esCampo = t['origen'] == 'tecnico_campo';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(t['plate'] ?? '—', style: const TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w800)),
          const SizedBox(width: 8),
          Text(t['tipoVehiculo'] ?? '', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
            child: Text(_trabajoLabel(status), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
        ]),
        if (esCampo)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(
            '➕ Añadido en campo${t['creadoPorTecnico'] != null ? ' · ${t['creadoPorTecnico']}' : ''}',
            style: const TextStyle(color: AppColors.warning, fontSize: 11, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Text(t['trabajo'] ?? '', style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
        if (fotos.isNotEmpty) Padding(
          padding: const EdgeInsets.only(top: 8),
          child: SizedBox(height: 56, child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: fotos.length,
            separatorBuilder: (_, __) => const SizedBox(width: 6),
            itemBuilder: (_, i) => ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.network(fotos[i]['url'] as String, width: 56, height: 56, fit: BoxFit.cover),
            ),
          )),
        ),
        const SizedBox(height: 10),
        Row(children: [
          _statusBtn(t['id'] as int, 'en_proceso', 'Empezar', status),
          const SizedBox(width: 8),
          _statusBtn(t['id'] as int, 'finalizado', 'Finalizar', status),
          const SizedBox(width: 8),
          _statusBtn(t['id'] as int, 'no_realizado', 'No realizado', status),
        ]),
      ]),
    );
  }

  Widget _statusBtn(int tid, String target, String label, String current) {
    final active = current == target;
    final color = _trabajoColor(target);
    return Expanded(child: OutlinedButton(
      onPressed: active ? null : () => _setStatus(tid, target),
      style: OutlinedButton.styleFrom(
        backgroundColor: active ? color.withValues(alpha: 0.18) : Colors.transparent,
        side: BorderSide(color: color.withValues(alpha: 0.5)),
        padding: const EdgeInsets.symmetric(vertical: 8),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
    ));
  }
}

// ── Añadir trabajo en campo (fotos obligatorias) ──
class OtfAddTrabajoScreen extends StatefulWidget {
  final ApiService api;
  final int otfId;
  const OtfAddTrabajoScreen({super.key, required this.api, required this.otfId});
  @override
  State<OtfAddTrabajoScreen> createState() => _OtfAddTrabajoScreenState();
}

class _OtfAddTrabajoScreenState extends State<OtfAddTrabajoScreen> {
  final _picker = ImagePicker();
  final _plate = TextEditingController();
  final _trabajo = TextEditingController();
  final _motivo = TextEditingController();
  String _tipo = 'Tractora';
  File? _fotoMatricula;
  File? _fotoAveria;
  bool _saving = false;

  bool get _canSave =>
      _plate.text.trim().isNotEmpty &&
      _trabajo.text.trim().isNotEmpty &&
      _motivo.text.trim().isNotEmpty &&
      _fotoMatricula != null &&
      _fotoAveria != null;

  @override
  void dispose() {
    _plate.dispose(); _trabajo.dispose(); _motivo.dispose();
    super.dispose();
  }

  Future<void> _pick(void Function(File) set) async {
    final x = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1920);
    if (x == null) return;
    setState(() => set(File(x.path)));
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final t = await widget.api.addOtfFieldTrabajo(
        widget.otfId,
        plate: _plate.text.trim().toUpperCase(),
        tipoVehiculo: _tipo,
        detalleManual: _trabajo.text.trim(),
        motivoAltaCampo: _motivo.text.trim(),
        status: 'en_proceso',
      );
      final tid = t['id'] as int;
      await widget.api.uploadOtfTrabajoFile(tid, _fotoMatricula!, 'matricula');
      await widget.api.uploadOtfTrabajoFile(tid, _fotoAveria!, 'averia');
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Nuevo trabajo en campo'),
        backgroundColor: AppColors.surface, foregroundColor: AppColors.textPrimary,
      ),
      body: _saving
          ? Center(child: CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _label('Matrícula *'),
                _input(_plate, 'Matrícula', upper: true),
                const SizedBox(height: 14),
                _label('Tipo de vehículo *'),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(8)),
                  child: DropdownButton<String>(
                    value: _tipo, isExpanded: true, underline: const SizedBox(),
                    dropdownColor: AppColors.surface,
                    style: const TextStyle(color: AppColors.textPrimary),
                    items: _tipos.map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
                    onChanged: (v) => setState(() => _tipo = v ?? 'Tractora'),
                  ),
                ),
                const SizedBox(height: 14),
                _label('Trabajo a realizar *'),
                _input(_trabajo, 'Ej: Reparar pinchazo rueda derecha'),
                const SizedBox(height: 14),
                _label('Motivo de alta en campo *'),
                _input(_motivo, 'Ej: Vehículo no incluido inicialmente'),
                const SizedBox(height: 18),
                _label('Fotos obligatorias *'),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: _photoBox('Matrícula', _fotoMatricula, () => _pick((f) => _fotoMatricula = f))),
                  const SizedBox(width: 12),
                  Expanded(child: _photoBox('Avería', _fotoAveria, () => _pick((f) => _fotoAveria = f))),
                ]),
                const SizedBox(height: 24),
                SizedBox(width: double.infinity, child: ElevatedButton.icon(
                  onPressed: _canSave ? _save : null,
                  icon: const Icon(Icons.check),
                  label: const Text('Guardar y empezar'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _canSave ? AppColors.primary : AppColors.disabledBtn,
                    foregroundColor: _canSave ? AppColors.onPrimary : AppColors.textDisabled,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                )),
              ]),
            ),
    );
  }

  Widget _label(String t) => Text(t, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700));

  Widget _input(TextEditingController c, String hint, {bool upper = false}) => TextField(
        controller: c,
        textCapitalization: upper ? TextCapitalization.characters : TextCapitalization.sentences,
        style: const TextStyle(color: AppColors.textPrimary),
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          hintText: hint, hintStyle: const TextStyle(color: AppColors.textHint),
          filled: true, fillColor: AppColors.surfaceVariant,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
        ),
      );

  Widget _photoBox(String label, File? file, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          height: 120,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: file != null ? Colors.green : Colors.black26, width: 1.5),
          ),
          child: file != null
              ? ClipRRect(borderRadius: BorderRadius.circular(11), child: Image.file(file, fit: BoxFit.cover, width: double.infinity))
              : Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.add_a_photo_outlined, color: Colors.black45, size: 30),
                  const SizedBox(height: 6),
                  Text(label, style: const TextStyle(color: Colors.black54, fontSize: 12, fontWeight: FontWeight.w600)),
                ]),
        ),
      );
}
