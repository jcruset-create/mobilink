import 'package:flutter/material.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';

/// Plano del vehículo con la FOTO real de fondo y una tarjeta por posición,
/// colocada en las coordenadas calibradas en el panel web (pos_x/y/w/h, en %).
/// Réplica en la tablet de la vista "Plano del vehículo" del panel.
class VehicleLayoutImage extends StatelessWidget {
  final String imagenUrl;
  final List<PosicionVehiculo> posiciones;
  final Map<String, MontajeActual> montajePorPosicion;
  final Map<String, RevisionDetalleDraft> detalles;
  final Map<String, TireStatus> estados;
  final String? seleccionadaId;
  final double? liveProf; // medida en curso de la rueda activa
  final double? livePres;
  final void Function(PosicionVehiculo) onTap;

  const VehicleLayoutImage({
    super.key,
    required this.imagenUrl,
    required this.posiciones,
    required this.montajePorPosicion,
    required this.detalles,
    required this.estados,
    required this.seleccionadaId,
    required this.liveProf,
    required this.livePres,
    required this.onTap,
  });

  // Coordenadas por defecto (%) si una posición aún no está calibrada.
  ({double x, double y, double w, double h}) _coords(PosicionVehiculo p, int i) {
    if (p.posX != null && p.posY != null && p.posW != null && p.posH != null) {
      return (x: p.posX!, y: p.posY!, w: p.posW!, h: p.posH!);
    }
    final col = i % 2;
    final row = i ~/ 2;
    return (x: col == 0 ? 6 : 78, y: 8 + row * 18, w: 16, h: 13);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final ancho = constraints.maxWidth;
        return Stack(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(
                imagenUrl,
                width: ancho,
                fit: BoxFit.fitWidth,
                errorBuilder: (_, __, ___) => Container(
                  width: ancho,
                  height: ancho * 1.4,
                  color: AppColors.surface,
                  child: const Center(child: Icon(Icons.directions_car, size: 48, color: AppColors.textHint)),
                ),
                loadingBuilder: (context, child, progress) {
                  if (progress == null) return child;
                  return Container(
                    width: ancho,
                    height: ancho * 1.4,
                    color: AppColors.surface,
                    child: const Center(child: CircularProgressIndicator()),
                  );
                },
              ),
            ),
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, c) {
                  final w = c.maxWidth;
                  final h = c.maxHeight;
                  return Stack(
                    children: [
                      for (int i = 0; i < posiciones.length; i++)
                        _cardPositioned(posiciones[i], i, w, h),
                    ],
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _cardPositioned(PosicionVehiculo p, int i, double w, double h) {
    final co = _coords(p, i);
    final cardW = (co.w / 100 * w).clamp(96.0, 220.0);
    return Positioned(
      left: (co.x / 100 * w).clamp(0.0, w - cardW),
      top: (co.y / 100 * h).clamp(0.0, h - 40),
      width: cardW,
      child: _TarjetaPosicion(
        p: p,
        neumatico: montajePorPosicion[p.id]?.neumatico,
        draft: detalles[p.id],
        status: estados[p.id] ?? TireStatus.pendiente,
        seleccionada: p.id == seleccionadaId,
        liveProf: p.id == seleccionadaId ? liveProf : null,
        livePres: p.id == seleccionadaId ? livePres : null,
        onTap: () => onTap(p),
      ),
    );
  }
}

class _TarjetaPosicion extends StatelessWidget {
  final PosicionVehiculo p;
  final Neumatico? neumatico;
  final RevisionDetalleDraft? draft;
  final TireStatus status;
  final bool seleccionada;
  final double? liveProf;
  final double? livePres;
  final VoidCallback onTap;

  const _TarjetaPosicion({
    required this.p,
    required this.neumatico,
    required this.draft,
    required this.status,
    required this.seleccionada,
    required this.liveProf,
    required this.livePres,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = seleccionada ? AppColors.tireSeleccionado : tireStatusColor(status);

    final prof = liveProf ?? draft?.profundidadMm;
    final pres = livePres ?? draft?.presionBar;
    final profTxt = prof != null ? '${prof.toStringAsFixed(1)} mm' : '— mm';
    final presTxt = pres != null ? '${pres.toStringAsFixed(1)} bar' : '— bar';

    final ic = [neumatico?.indiceCarga, neumatico?.indiceVelocidad].where((e) => e != null && e.isNotEmpty).join('');
    final medida = [neumatico?.medida, ic].where((e) => e != null && e.isNotEmpty).join(' ');

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: 0.92),
            border: Border.all(color: color, width: seleccionada ? 3 : 2),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                p.nombre ?? p.codigoPosicion,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              if (neumatico != null) ...[
                Text(
                  neumatico!.marca ?? '—',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if ((neumatico!.modelo ?? '').isNotEmpty)
                  Text(
                    neumatico!.modelo!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                if (medida.isNotEmpty)
                  Text(
                    medida,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ] else
                const Text('Sin neumático', style: TextStyle(fontSize: 10, color: AppColors.textHint)),
              const SizedBox(height: 2),
              Text(
                '$profTxt · $presTxt',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
