import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Badge de estado Webfleet, compartido por Vehículos y Planificación.
/// Mismos textos y colores que el panel web.
const kWebfleetLabels = {
  'en_base': 'EN BASE',
  'otra_base': 'OTRA BASE',
  'en_ruta': 'EN RUTA',
  'sin_conexion': 'SIN CONEXIÓN',
  'sin_dispositivo': 'SIN WEBFLEET',
};

Color webfleetColor(String e) {
  switch (e) {
    case 'en_base':
      return AppColors.success;
    case 'otra_base':
      return AppColors.info;
    case 'en_ruta':
      return AppColors.warning;
    case 'sin_conexion':
      return AppColors.textSecondary;
    default:
      return AppColors.textHint; // sin_dispositivo
  }
}

class WebfleetBadge extends StatelessWidget {
  final String estado;

  /// pos_time ISO de la última posición: si tiene más de 30 min y el vehículo
  /// está en base, se añade el sufijo "POS. ANT." (GPS dormido).
  final String? posTime;

  /// Si además hay revisión pendiente estando en base → "EN BASE · REVISAR".
  final bool revisar;

  const WebfleetBadge({
    super.key,
    required this.estado,
    this.posTime,
    this.revisar = false,
  });

  @override
  Widget build(BuildContext context) {
    bool posAntigua = false;
    if ((estado == 'en_base' || estado == 'otra_base') && posTime != null) {
      final d = DateTime.tryParse(posTime!);
      posAntigua = d != null && DateTime.now().difference(d).inMinutes > 30;
    }
    final esRevisar = revisar && estado == 'en_base';
    final label = esRevisar
        ? 'EN BASE · REVISAR'
        : '${kWebfleetLabels[estado] ?? estado}${posAntigua ? ' · POS. ANT.' : ''}';
    final c = esRevisar ? AppColors.warning : webfleetColor(estado);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: c.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
            const SizedBox(width: 5),
            Flexible(
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: c,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3)),
            ),
          ],
        ),
      ),
    );
  }
}
