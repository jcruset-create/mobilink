import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';

/// Kilómetros del vehículo cuando NO los da ninguna plataforma.
///
/// Con Webfleet enlazado los km llegan del odómetro y nadie tiene que
/// teclearlos. Sin enlazar, la revisión se creaba con 0 km y la operación se
/// guardaba sin ninguno: sin ese dato no se puede calcular ni el desgaste por
/// mil kilómetros ni la vida de una goma, que es justo para lo que sirve
/// llevar el control.
///
/// Se usa en Revisión y en Operaciones, así que vive aquí y no en una pantalla.

/// Pide los kilómetros. Devuelve null si el técnico cancela.
Future<int?> pedirKmVehiculo(
  BuildContext context, {
  required String matricula,
  int? actual,
}) async {
  final ctrl = TextEditingController(text: (actual ?? 0) > 0 ? '$actual' : '');
  return showDialog<int>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Kilómetros del vehículo'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('$matricula · este vehículo no está enlazado con ninguna plataforma, '
            'así que los km hay que mirarlos en el cuadro.',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        const SizedBox(height: 12),
        TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(labelText: 'Kilómetros', suffixText: 'km', hintText: 'p. ej. 415000'),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
        FilledButton(
          onPressed: () {
            final v = int.tryParse(ctrl.text.trim());
            Navigator.pop(ctx, (v != null && v > 0) ? v : null);
          },
          child: const Text('Guardar'),
        ),
      ],
    ),
  );
}

/// Chip con los km del vehículo. Si los da la plataforma se enseñan y no se
/// tocan; si no, se puede pulsar para informarlos, y avisa cuando faltan.
class ChipKmVehiculo extends StatelessWidget {
  final num? km;
  /// true cuando los km llegan solos (Webfleet u otra plataforma).
  final bool automaticos;
  final VoidCallback? onEditar;

  const ChipKmVehiculo({super.key, required this.km, required this.automaticos, this.onEditar});

  @override
  Widget build(BuildContext context) {
    final tiene = (km ?? 0) > 0;
    final falta = !automaticos && !tiene;
    final color = falta ? AppColors.warning : AppColors.textSecondary;

    final contenido = Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(automaticos ? Icons.satellite_alt : Icons.speed, size: 15, color: color),
      const SizedBox(width: 5),
      Text(
        tiene ? '${km!.round()} km' : 'Sin km',
        style: TextStyle(color: color, fontSize: 12, fontWeight: falta ? FontWeight.w700 : FontWeight.w600),
      ),
      if (falta) ...[
        const SizedBox(width: 5),
        const Text('· informar', style: TextStyle(color: AppColors.warning, fontSize: 12)),
      ],
      if (!automaticos && tiene) ...[
        const SizedBox(width: 4),
        const Icon(Icons.edit, size: 12, color: AppColors.textSecondary),
      ],
    ]);

    if (automaticos || onEditar == null) return contenido;
    return InkWell(
      onTap: onEditar,
      borderRadius: BorderRadius.circular(8),
      child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2), child: contenido),
    );
  }
}
