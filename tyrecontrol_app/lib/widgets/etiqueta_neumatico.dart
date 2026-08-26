import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Distintivo pequeño del propio neumático: NEW, RECAUCH., REESC., GIRADO.
///
/// Vive aquí y no dentro de una pantalla porque los recuadros del neumático
/// salen en tres sitios (plano de revisión, plano de cambios y plano del
/// historial) y las tres etiquetas tienen que verse iguales.
///
/// Con [fondo] va RELLENA y la tinta pasa a oscura. Es lo que hace falta
/// encima de los recuadros de banda de profundidad, que son claros: un texto
/// naranja sobre el verde "8-10" se queda en 1.9:1 y no se lee. Y lleva borde
/// oscuro porque, sobre la banda ámbar, la pastilla naranja llena se fundiría
/// con el fondo aunque su texto sí se leyera.
class EtiquetaNeu extends StatelessWidget {
  final String txt;
  final Color color; // tinta cuando va sin relleno
  final Color? fondo;
  final double fontSize;

  const EtiquetaNeu({
    super.key,
    required this.txt,
    required this.color,
    this.fondo,
    this.fontSize = 8,
  });

  @override
  Widget build(BuildContext context) {
    final f = fondo;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: fontSize / 2, vertical: 1),
      decoration: BoxDecoration(
        color: f,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
            color: f != null ? AppColors.background : color.withValues(alpha: 0.55)),
      ),
      child: Text(
        txt,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: FontWeight.w800,
          color: f != null ? AppColors.background : color,
          height: 1.1,
        ),
      ),
    );
  }
}
