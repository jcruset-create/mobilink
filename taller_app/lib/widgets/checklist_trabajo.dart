import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme.dart';

/// Checklist del trabajo.
///
/// Las plantillas se definen en WorkPlanner (menú Plantillas) y aquí el técnico
/// las marca. Al aplicar una, sus puntos se copian al trabajo: si luego alguien
/// edita la plantilla, lo ya comprobado no cambia.
///
/// Cada punto se guarda por separado, no la lista entera: con dos técnicos en
/// el mismo trabajo, mandar todo haría que el último en guardar borrase lo que
/// marcó el otro.
class ChecklistTrabajo extends StatefulWidget {
  final ApiService api;
  final int jobId;

  const ChecklistTrabajo({super.key, required this.api, required this.jobId});

  @override
  State<ChecklistTrabajo> createState() => _ChecklistTrabajoState();
}

class _ChecklistTrabajoState extends State<ChecklistTrabajo> {
  Map<String, dynamic>? _checklist;
  bool _cargando = true;
  int? _guardando;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    final actual = await widget.api.checklistDe(widget.jobId);
    if (!mounted) return;
    setState(() {
      _checklist = actual;
      _cargando = false;
    });
  }

  List<Map<String, dynamic>> get _items {
    final items = _checklist?['items'];
    if (items is! List) return [];
    return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  int get _hechos => _items.where((i) => i['hecho'] == true).length;

  Future<void> _elegirPlantilla() async {
    final plantillas = await widget.api.plantillasChecklist();
    if (!mounted) return;

    if (plantillas.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
          'No hay plantillas creadas. Se definen en WorkPlanner, menú Plantillas.',
        ),
      ));
      return;
    }

    final elegida = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text('Aplicar checklist',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ),
            for (final p in plantillas)
              ListTile(
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 4),
                title: Text('${p['nombre']}', style: const TextStyle(fontSize: 17)),
                subtitle: Text(
                  '${(p['items'] as List?)?.length ?? 0} puntos'
                  '${p['area'] != null ? ' · ${p['area']}' : ''}',
                  style: const TextStyle(color: AppColors.textMuted),
                ),
                onTap: () => Navigator.pop(context, p),
              ),
          ],
        ),
      ),
    );

    if (elegida == null) return;

    try {
      final aplicado =
          await widget.api.aplicarChecklist(widget.jobId, elegida['id'] as int);
      if (!mounted) return;
      setState(() => _checklist = aplicado);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
      ));
    }
  }

  Future<void> _marcar(int indice, bool hecho) async {
    setState(() => _guardando = indice);
    try {
      final actualizado =
          await widget.api.marcarChecklist(widget.jobId, indice, hecho);
      if (!mounted) return;
      setState(() => _checklist = actualizado);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')),
      ));
    } finally {
      if (mounted) setState(() => _guardando = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('Cargando checklist…',
            style: TextStyle(color: AppColors.textMuted)),
      );
    }

    final items = _items;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('CHECKLIST',
                style: TextStyle(
                    fontSize: 12, color: AppColors.textMuted, letterSpacing: 0.4)),
            if (items.isNotEmpty) ...[
              const SizedBox(width: 8),
              Text('$_hechos/${items.length}',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: _hechos == items.length
                          ? const Color(0xFF10B981)
                          : AppColors.textMuted)),
            ],
            const Spacer(),
            TextButton.icon(
              onPressed: _elegirPlantilla,
              icon: const Icon(Icons.checklist, size: 18),
              label: Text(items.isEmpty ? 'Aplicar' : 'Cambiar'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        if (items.isEmpty)
          const Text('Sin checklist en este trabajo.',
              style: TextStyle(color: AppColors.textMuted))
        else
          ...items.asMap().entries.map((entrada) {
            final i = entrada.key;
            final item = entrada.value;
            final hecho = item['hecho'] == true;
            final obligatorio = item['obligatorio'] == true;

            return CheckboxListTile(
              value: hecho,
              onChanged: _guardando == null ? (v) => _marcar(i, v ?? false) : null,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              activeColor: const Color(0xFF10B981),
              title: Text(
                '${item['texto']}',
                style: TextStyle(
                  fontSize: 16,
                  decoration: hecho ? TextDecoration.lineThrough : null,
                  color: hecho ? AppColors.textMuted : null,
                ),
              ),
              subtitle: obligatorio && !hecho
                  ? const Text('Obligatorio',
                      style: TextStyle(fontSize: 12, color: Color(0xFFF59E0B)))
                  : (item['tecnico'] != null
                      ? Text('${item['tecnico']}',
                          style: const TextStyle(
                              fontSize: 12, color: AppColors.textMuted))
                      : null),
            );
          }),
      ],
    );
  }
}
