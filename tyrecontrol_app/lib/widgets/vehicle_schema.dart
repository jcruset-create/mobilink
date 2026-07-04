import 'package:flutter/material.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';

/// Esquema generico del vehiculo, vista de planta. Se construye SOLO a
/// partir de las posiciones reales (eje/lado/interior_exterior/orden_visual)
/// que ya vienen del panel web -- no hay plantillas fijas por tipo de
/// vehiculo, asi que furgoneta, rigido, tractora, semirremolque o tren
/// de carretera funcionan igual sin tocar codigo.
class VehicleSchema extends StatelessWidget {
  final List<PosicionVehiculo> posiciones;
  final Map<String, TireStatus> estados;
  final String? seleccionadaId;
  final void Function(PosicionVehiculo) onTap;

  const VehicleSchema({
    super.key,
    required this.posiciones,
    required this.estados,
    required this.seleccionadaId,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final ejes = posiciones.map((p) => p.eje ?? 0).toSet().toList()..sort();

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Silueta simplificada del chasis (linea central) para dar contexto
        // visual sin depender de una foto real del vehiculo.
        for (final eje in ejes) _EjeRow(
              posiciones: posiciones.where((p) => (p.eje ?? 0) == eje).toList()
                ..sort((a, b) => a.ordenVisual.compareTo(b.ordenVisual)),
              estados: estados,
              seleccionadaId: seleccionadaId,
              onTap: onTap,
            ),
      ],
    );
  }
}

class _EjeRow extends StatelessWidget {
  final List<PosicionVehiculo> posiciones;
  final Map<String, TireStatus> estados;
  final String? seleccionadaId;
  final void Function(PosicionVehiculo) onTap;

  const _EjeRow({required this.posiciones, required this.estados, required this.seleccionadaId, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final izq = posiciones.where((p) => p.lado == 'izq').toList()
      ..sort((a, b) => _extIntOrder(a).compareTo(_extIntOrder(b)));
    final der = posiciones.where((p) => p.lado == 'der').toList()
      ..sort((a, b) => _extIntOrder(a).compareTo(_extIntOrder(b)));
    final sinLado = posiciones.where((p) => p.lado != 'izq' && p.lado != 'der').toList();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(mainAxisSize: MainAxisSize.min, children: izq.map((p) => _TireTile(p: p, status: _statusOf(p), selected: p.id == seleccionadaId, onTap: () => onTap(p))).toList()),
          Expanded(
            child: Container(height: 3, margin: const EdgeInsets.symmetric(horizontal: 12), color: AppColors.cardBorder),
          ),
          if (sinLado.isNotEmpty)
            Row(mainAxisSize: MainAxisSize.min, children: sinLado.map((p) => _TireTile(p: p, status: _statusOf(p), selected: p.id == seleccionadaId, onTap: () => onTap(p))).toList()),
          Row(mainAxisSize: MainAxisSize.min, children: der.map((p) => _TireTile(p: p, status: _statusOf(p), selected: p.id == seleccionadaId, onTap: () => onTap(p))).toList()),
        ],
      ),
    );
  }

  TireStatus _statusOf(PosicionVehiculo p) => estados[p.id] ?? TireStatus.pendiente;

  // Exterior primero (mas lejos del chasis), interior despues (ruedas gemelas)
  int _extIntOrder(PosicionVehiculo p) => p.interiorExterior == 'int' ? 1 : 0;
}

class _TireTile extends StatelessWidget {
  final PosicionVehiculo p;
  final TireStatus status;
  final bool selected;
  final VoidCallback onTap;

  const _TireTile({required this.p, required this.status, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final sz = AppSizes(exterior: false);
    final color = selected ? AppColors.tireSeleccionado : tireStatusColor(status);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: sz.tileMinSize,
            height: sz.tileMinSize + 12,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.22),
              border: Border.all(color: color, width: selected ? 3 : 2),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(tireStatusIcon(status), color: color, size: 20),
                const SizedBox(height: 2),
                Text(
                  p.nombre ?? p.codigoPosicion,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
