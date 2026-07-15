import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import '../models/incidencias.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Resolver las incidencias de una revisión (Fase 2a). Muestra las
/// incidencias con problemas abiertos; el técnico elige la operación y
/// resuelve total o parcialmente. Devuelve true si resolvió algo.
class ResolverIncidenciasScreen extends StatefulWidget {
  final String matricula;
  final String fechaRevision;
  final List<Incidencia> incidencias;

  const ResolverIncidenciasScreen({
    super.key,
    required this.matricula,
    required this.fechaRevision,
    required this.incidencias,
  });

  @override
  State<ResolverIncidenciasScreen> createState() => _ResolverIncidenciasScreenState();
}

class _ResolverIncidenciasScreenState extends State<ResolverIncidenciasScreen> {
  late List<Incidencia> _pendientes;
  bool _cambios = false;

  @override
  void initState() {
    super.initState();
    _pendientes = [...widget.incidencias];
  }

  Future<void> _resolver(Incidencia inc) async {
    final abiertos = inc.problemas.where((p) => p.abierto).toList();
    final res = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _OperacionSheet(incidencia: inc, abiertos: abiertos),
    );
    if (res == true) {
      _cambios = true;
      // Recargar el estado real de esta incidencia sería lo ideal; para el
      // menú basta con quitarla de la lista si quedó solucionada.
      setState(() => _pendientes.remove(inc));
      if (_pendientes.isEmpty && mounted) {
        Navigator.of(context).pop(true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_cambios);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.matricula, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              Text('Revisión: ${widget.fechaRevision}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            ],
          ),
        ),
        body: _pendientes.isEmpty
            ? const Center(child: Text('Todas resueltas', style: TextStyle(color: AppColors.textSecondary)))
            : ListView.builder(
                padding: const EdgeInsets.all(12),
                itemCount: _pendientes.length,
                itemBuilder: (_, i) {
                  final inc = _pendientes[i];
                  final abiertos = inc.problemas.where((p) => p.abierto).toList();
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(width: 12, height: 12, decoration: BoxDecoration(color: gravedadColor(inc.gravedad), shape: BoxShape.circle)),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(inc.posicionTexto,
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6, runSpacing: 6,
                            children: abiertos.map((p) => Chip(
                              label: Text(problemaLabel(p.tipo)),
                              backgroundColor: AppColors.surfaceVariant,
                              visualDensity: VisualDensity.compact,
                            )).toList(),
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: () => _resolver(inc),
                              icon: const Icon(Icons.build),
                              label: const Text('Resolver'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }
}

// ── Hoja de operación ────────────────────────────────────────
class _OperacionSheet extends StatefulWidget {
  final Incidencia incidencia;
  final List<ProblemaInc> abiertos;
  const _OperacionSheet({required this.incidencia, required this.abiertos});

  @override
  State<_OperacionSheet> createState() => _OperacionSheetState();
}

class _OperacionSheetState extends State<_OperacionSheet> {
  final _picker = ImagePicker();
  late Set<String> _problemasSel; // ids de problemas a resolver
  String? _operacion;
  final _presion = TextEditingController();
  final _material = TextEditingController();
  final _resultado = TextEditingController();
  final _obs = TextEditingController();
  File? _foto;
  ({num presion, num margen})? _objetivo;
  bool _guardando = false;
  final DateTime _inicio = DateTime.now();

  @override
  void initState() {
    super.initState();
    _problemasSel = widget.abiertos.map((p) => p.id).toSet();
    // Sugerir la primera operación disponible según los problemas.
    final sug = operacionesSugeridas(widget.abiertos.map((p) => p.tipo).toSet());
    _operacion = sug.firstWhere(
      (k) => operacionPorKey(k).disponible,
      orElse: () => 'otra',
    );
    _cargarObjetivo();
  }

  Future<void> _cargarObjetivo() async {
    final o = await TyreControlApi.presionObjetivo(widget.incidencia.vehiculoId, widget.incidencia.posicionEje);
    if (mounted) setState(() => _objetivo = o);
  }

  @override
  void dispose() {
    _presion.dispose();
    _material.dispose();
    _resultado.dispose();
    _obs.dispose();
    super.dispose();
  }

  bool get _esPresion => _operacion == 'corregir_presion';
  bool get _esReparacion => _operacion == 'reparar_pinchazo';

  bool get _valido {
    if (_operacion == null || _problemasSel.isEmpty) return false;
    if (!operacionPorKey(_operacion!).disponible) return false;
    if (_esPresion && num.tryParse(_presion.text.replaceAll(',', '.')) == null) return false;
    if (_operacion == 'otra' && _resultado.text.trim().isEmpty) return false;
    return true;
  }

  Future<void> _pickFoto() async {
    final x = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1600);
    if (x == null) return;
    final tmp = await getTemporaryDirectory();
    final out = '${tmp.path}/op_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final r = await FlutterImageCompress.compressAndGetFile(x.path, out, quality: 70, minWidth: 1600, minHeight: 900, keepExif: false);
    setState(() => _foto = r == null ? File(x.path) : File(r.path));
  }

  Future<void> _guardar() async {
    setState(() => _guardando = true);
    try {
      String? fotoUrl;
      if (_foto != null) fotoUrl = await TyreControlApi.subirFotoIncidencia(_foto!);
      final presionFinal = num.tryParse(_presion.text.replaceAll(',', '.'));
      await TyreControlApi.resolverIncidencia(
        incidenciaId: widget.incidencia.id,
        problemaIds: _problemasSel.toList(),
        tipoOperacion: _operacion!,
        medicionFinal: presionFinal == null ? null : {'presion_bar': presionFinal},
        material: _material.text.trim().isEmpty ? null : _material.text.trim(),
        resultado: _resultado.text.trim().isEmpty ? null : _resultado.text.trim(),
        observaciones: _obs.text.trim().isEmpty ? null : _obs.text.trim(),
        fotoUrl: fotoUrl,
        tiempoSeg: DateTime.now().difference(_inicio).inSeconds,
      );
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _guardando = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('No se pudo guardar: ${e.toString().replaceFirst('Exception: ', '')}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
        children: [
          Text(widget.incidencia.posicionTexto,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          // Qué problemas resuelve esta operación
          const Text('Problemas a resolver', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          ...widget.abiertos.map((p) => CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: _problemasSel.contains(p.id),
                title: Text(problemaLabel(p.tipo)),
                onChanged: (v) => setState(() {
                  v == true ? _problemasSel.add(p.id) : _problemasSel.remove(p.id);
                }),
              )),
          const SizedBox(height: 8),
          const Text('Operación', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8, runSpacing: 8,
            children: _operacionesOrdenadas().map((o) {
              final sel = _operacion == o.key;
              return ChoiceChip(
                label: Text(o.disponible ? o.label : '${o.label} (pronto)'),
                avatar: Icon(o.icon, size: 16, color: sel ? AppColors.onPrimary : AppColors.textSecondary),
                selected: sel,
                showCheckmark: false,
                onSelected: o.disponible ? (_) => setState(() => _operacion = o.key) : (_) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Sustitución y cambios de posición llegan en el próximo incremento.')));
                },
                selectedColor: AppColors.primary,
                backgroundColor: AppColors.surfaceVariant,
                labelStyle: TextStyle(
                    color: sel ? AppColors.onPrimary : (o.disponible ? AppColors.textPrimary : AppColors.textHint),
                    fontSize: 13, fontWeight: FontWeight.w600),
                side: const BorderSide(color: AppColors.cardBorder),
              );
            }).toList(),
          ),
          const SizedBox(height: 14),
          // Campos según operación
          if (_esPresion) ...[
            if (_objetivo != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('Objetivo: ${_objetivo!.presion} bar (±${_objetivo!.margen})',
                    style: const TextStyle(color: AppColors.info, fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            TextField(
              controller: _presion,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Presión final (bar) *', suffixText: 'bar'),
            ),
            const SizedBox(height: 12),
          ],
          if (_esReparacion) ...[
            TextField(controller: _material, decoration: const InputDecoration(labelText: 'Material utilizado')),
            const SizedBox(height: 12),
            TextField(
              controller: _presion,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Presión final (bar)', suffixText: 'bar'),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _resultado,
            decoration: InputDecoration(labelText: _operacion == 'otra' ? 'Descripción / resultado *' : 'Resultado'),
          ),
          const SizedBox(height: 12),
          TextField(controller: _obs, maxLines: 2, decoration: const InputDecoration(labelText: 'Observación')),
          const SizedBox(height: 12),
          // Foto opcional
          GestureDetector(
            onTap: _pickFoto,
            child: Container(
              height: 120,
              decoration: BoxDecoration(
                color: AppColors.surfaceVariant,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _foto != null ? AppColors.success : AppColors.cardBorder),
              ),
              child: _foto != null
                  ? ClipRRect(borderRadius: BorderRadius.circular(11), child: Image.file(_foto!, fit: BoxFit.cover, width: double.infinity))
                  : const Center(child: Text('Foto (opcional)', style: TextStyle(color: AppColors.textSecondary))),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: (_valido && !_guardando) ? _guardar : null,
            icon: _guardando
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.check),
            label: Text(_problemasSel.length == widget.abiertos.length
                ? 'Resolver incidencia'
                : 'Resolver ${_problemasSel.length} de ${widget.abiertos.length}'),
          ),
        ],
      ),
    );
  }

  List<OperacionTipo> _operacionesOrdenadas() {
    final sug = operacionesSugeridas(widget.abiertos.map((p) => p.tipo).toSet());
    final orden = <OperacionTipo>[];
    for (final k in sug) {
      orden.add(operacionPorKey(k));
    }
    for (final o in kOperaciones) {
      if (!orden.any((x) => x.key == o.key)) orden.add(o);
    }
    return orden;
  }
}
