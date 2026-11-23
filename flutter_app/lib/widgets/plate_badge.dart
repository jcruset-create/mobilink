import 'package:flutter/material.dart';

import '../services/matricula_es.dart';

/// Matrícula del vehículo, dibujada como la placa de su país.
///
/// El técnico identifica el vehículo por la matrícula, así que cuando viene
/// informada tiene que leerse de un vistazo (también con guantes y a pleno sol,
/// de ahí el tamaño extra en modo exterior). Si no está informada no se pinta:
/// quien la use debe envolverla en `if (plate.isNotEmpty)`.
///
/// Las españolas se dibujan como son —la actual con su banda azul y la «E», la
/// de remolque en rojo, la antigua de provincia sin banda—, y las de otro país
/// de la UE con su letra, o sin letra si el país no se sabe. Qué es cada una
/// lo decide [dibujoMatricula]; [pais] es el que indicó la oficina, si lo hizo.
class PlateBadge extends StatelessWidget {
  final String plate;

  /// El «País de la matrícula» guardado. Sin él se deduce de la forma.
  final String? pais;

  /// Tamaño de letra. Sin él, grande (el de las tarjetas); en listas, ~15.
  final double? fontSize;

  const PlateBadge({super.key, required this.plate, this.pais, this.fontSize});

  static const _negro = Color(0xFF111111);
  static const _azulUe = Color(0xFF003399);
  static const _rojoRemolque = Color(0xFFD52B1E);
  static const _rojoLetras = Color(0xFFB42318);

  @override
  Widget build(BuildContext context) {
    // titleLarge sigue el modo exterior (24 normal / 28 exterior).
    final base = Theme.of(context).textTheme.titleLarge?.fontSize ?? 24;
    final fuente = fontSize ?? base + 4;
    final compacta = fuente < 20;
    final d = dibujoMatricula(plate, pais);
    final fondo = switch (d.fondo) {
      FondoMatricula.rojo => _rojoRemolque,
      FondoMatricula.amarillo => const Color(0xFFF7C600),
      FondoMatricula.liso => const Color(0xFFE8ECF5),
      FondoMatricula.blanco => Colors.white,
    };
    final estilo = TextStyle(
      color: d.letrasRojas ? _rojoLetras : _negro,
      fontSize: fuente,
      fontWeight: FontWeight.w900,
      letterSpacing: compacta ? 1 : 2,
      height: 1.1,
    );
    final hueco = d.separador == ' ' ? fuente * 0.35 : fuente * 0.12;

    return Semantics(
      label: 'Matrícula ${d.partes.join(' ')}',
      child: ExcludeSemantics(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: fondo,
              borderRadius: BorderRadius.circular(compacta ? 4 : 6),
              border: Border.all(color: _negro, width: compacta ? 1.5 : 2),
            ),
            child: IntrinsicHeight(
              child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (d.banda)
                  Container(
                    width: fuente * 0.72,
                    color: _azulUe,
                    padding: EdgeInsets.symmetric(vertical: compacta ? 2 : 4),
                    child: Column(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      // El círculo de estrellas, en pequeño.
                      Container(
                        width: fuente * 0.36,
                        height: fuente * 0.36,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFFFFCC00), width: compacta ? 1 : 1.5),
                        ),
                      ),
                      // La letra del país; si no se sabe, la banda va sola.
                      if (d.pais.isNotEmpty)
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(d.pais,
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: fuente * 0.36,
                                  fontWeight: FontWeight.w900,
                                  height: 1)),
                        ),
                    ]),
                  ),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: compacta ? 7 : 12, vertical: compacta ? 3 : 6),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    for (var i = 0; i < d.partes.length; i++) ...[
                      if (i > 0) ...[
                        SizedBox(width: hueco),
                        if (d.separador != ' ') ...[Text(d.separador, style: estilo), SizedBox(width: hueco)],
                      ],
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
