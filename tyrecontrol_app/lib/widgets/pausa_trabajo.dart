import 'package:flutter/material.dart';
import '../services/pausa_controller.dart';
import '../theme/app_theme.dart';

/// Botón "Pausar trabajo" + overlay de pausa, compartidos por la revisión y
/// la pantalla de cambio para no duplicar el flujo.
///
/// Al pausar se exige el motivo (lista cerrada; "Otro" pide observaciones).
/// Mientras dura la pausa un overlay a pantalla completa deja claro que el
/// cronómetro de trabajo está detenido y solo ofrece "Reanudar trabajo".
class BotonPausa extends StatelessWidget {
  final PausaController controller;
  const BotonPausa({super.key, required this.controller});

  Future<void> _pedirMotivo(BuildContext context) async {
    String? motivo;
    final obs = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Pausar trabajo'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Motivo de la pausa (obligatorio):',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final e in kMotivosPausa.entries)
                      ChoiceChip(
                        label: Text(e.value),
                        selected: motivo == e.key,
                        onSelected: (_) => setLocal(() => motivo = e.key),
                      ),
                  ],
                ),
                if (motivo == 'otro') ...[
                  const SizedBox(height: 10),
                  TextField(
                    controller: obs,
                    decoration: const InputDecoration(hintText: 'Observaciones'),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancelar')),
            FilledButton(
              onPressed: motivo == null ? null : () => Navigator.of(ctx).pop(true),
              child: const Text('Pausar'),
            ),
          ],
        ),
      ),
    );
    if (ok == true && motivo != null) {
      controller.pausar(motivo!, observaciones: obs.text.trim().isEmpty ? null : obs.text.trim());
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => controller.enPausa
          ? const SizedBox.shrink()
          : IconButton(
              tooltip: 'Pausar trabajo',
              onPressed: () => _pedirMotivo(context),
              icon: const Icon(Icons.pause_circle_outline, color: Colors.white),
            ),
    );
  }
}

/// Envuelve el body de la pantalla: cuando hay pausa activa lo tapa con el
/// overlay de "Trabajo en pausa".
class PausaOverlay extends StatelessWidget {
  final PausaController controller;
  final Widget child;
  const PausaOverlay({super.key, required this.controller, required this.child});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        if (!controller.enPausa) return child;
        final p = controller.pausaActiva!;
        return Stack(children: [
          child,
          Positioned.fill(
            child: Container(
              color: AppColors.background.withValues(alpha: 0.96),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.pause_circle, size: 72, color: AppColors.warning),
                    const SizedBox(height: 14),
                    const Text('Trabajo en pausa',
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                    const SizedBox(height: 6),
                    Text(kMotivosPausa[p.motivo] ?? p.motivo,
                        style: const TextStyle(fontSize: 16, color: AppColors.textSecondary)),
                    // El tiempo de pausa sale del reloj (marcas de tiempo),
                    // no de un timer: se refresca al reconstruir.
                    const SizedBox(height: 22),
                    FilledButton.icon(
                      onPressed: controller.reanudar,
                      icon: const Icon(Icons.play_arrow),
                      label: const Text('Reanudar trabajo'),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(260, 56),
                        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ]);
      },
    );
  }
}
