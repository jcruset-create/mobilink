import 'package:flutter/material.dart';
import '../theme.dart';

/// Matrícula del vehículo en grande, con aspecto de placa.
///
/// El operario identifica el vehículo por la matrícula, así que cuando viene
/// informada tiene que leerse de un vistazo. Si no está informada no se pinta:
/// quien la use debe envolverla en `if (plate.isNotEmpty)`.
class PlateBadge extends StatelessWidget {
  final String plate;

  /// Tamaño de letra. Por defecto el de la ficha; en listados se baja un poco.
  final double fontSize;

  const PlateBadge({super.key, required this.plate, this.fontSize = 26});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.surfaceDeep, width: 2),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          plate.trim().toUpperCase(),
          maxLines: 1,
          style: TextStyle(
            color: AppColors.surfaceDeep,
            fontSize: fontSize,
            fontWeight: FontWeight.w900,
            letterSpacing: 2,
            height: 1.1,
          ),
        ),
      ),
    );
  }
}
