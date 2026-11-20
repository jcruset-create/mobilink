import 'package:flutter/material.dart';

import '../services/matricula_es.dart';

/// Matrícula del vehículo en grande, dibujada como la placa.
///
/// El técnico identifica el vehículo por la matrícula, así que cuando viene
/// informada tiene que leerse de un vistazo (también con guantes y a pleno sol,
/// de ahí el tamaño extra en modo exterior). Si no está informada no se pinta:
/// quien la use debe envolverla en `if (plate.isNotEmpty)`.
///
/// Las españolas se dibujan como son —la actual con su banda azul y la «E», la
/// de remolque en rojo, la antigua de provincia sin banda—, que es como el
/// operario las ve en el vehículo. Cualquier otra, tal cual está escrita.
class PlateBadge extends StatelessWidget {
  final String plate;

  const PlateBadge({super.key, required this.plate});

  static const _negro = Color(0xFF111111);
  static const _azulUe = Color(0xFF003399);
  static const _rojoRemolque = Color(0xFFD52B1E);

  @override
  Widget build(BuildContext context) {
    // titleLarge sigue el modo exterior (24 normal / 28 exterior).
    final base = Theme.of(context).textTheme.titleLarge?.fontSize ?? 24;
    final fuente = base + 4;
    final d = dibujoMatricula(plate);
    final conBanda = d.tipo == TipoMatricula.actual || d.tipo == TipoMatricula.remolque;
    final fondo = switch (d.tipo) {
      TipoMatricula.remolque => _rojoRemolque,
      TipoMatricula.otra => const Color(0xFFE8ECF5),
      _ => Colors.white,
    };
    final estilo = TextStyle(
      color: _negro,
      fontSize: fuente,
      fontWeight: FontWeight.w900,
      letterSpacing: 2,
      height: 1.1,
    );

    return Semantics(
      label: 'Matrícula ${d.partes.join(' ')}',
      child: ExcludeSemantics(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: fondo,
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: _negro, width: 2),
            ),
            child: IntrinsicHeight(
              child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (conBanda)
                  Container(
                    width: fuente * 0.72,
                    color: _azulUe,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      // El círculo de estrellas, en pequeño.
                      Container(
                        width: fuente * 0.36,
                        height: fuente * 0.36,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFFFFCC00), width: 1.5),
                        ),
                      ),
                      Text('E',
                          style: TextStyle(
                              color: Colors.white, fontSize: fuente * 0.36, fontWeight: FontWeight.w900, height: 1)),
                    ]),
                  ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    for (var i = 0; i < d.partes.length; i++) ...[
                      if (i > 0) SizedBox(width: fuente * 0.35),
                      Text(d.partes[i], maxLines: 1, style: estilo),
                    ],
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
