import 'package:flutter/material.dart';

/// Matrícula del vehículo en grande, con aspecto de placa.
///
/// El técnico identifica el vehículo por la matrícula, así que cuando viene
/// informada tiene que leerse de un vistazo (también con guantes y a pleno sol,
/// de ahí el tamaño extra en modo exterior). Si no está informada no se pinta:
/// quien la use debe envolverla en `if (plate.isNotEmpty)`.
class PlateBadge extends StatelessWidget {
  final String plate;

  const PlateBadge({super.key, required this.plate});

  @override
  Widget build(BuildContext context) {
    // titleLarge sigue el modo exterior (24 normal / 28 exterior).
    final base = Theme.of(context).textTheme.titleLarge?.fontSize ?? 24;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: const Color(0xFF0D1B2A), width: 2),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          plate.trim().toUpperCase(),
          maxLines: 1,
          style: TextStyle(
            color: const Color(0xFF0D1B2A),
            fontSize: base + 4,
            fontWeight: FontWeight.w900,
            letterSpacing: 2,
            height: 1.1,
          ),
        ),
      ),
    );
  }
}
