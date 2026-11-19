/// Cuánto puede crecer cada tarjeta de posición en el plano sin pisar a otra.
///
/// En la pantalla «Cambiar» las tarjetas van encima de la foto del chasis y
/// tienen que leerse de lejos y con guantes: cuanto más grandes, mejor. Pero
/// las gemelas de un eje están muy juntas y dos ejes traseros, uno encima del
/// otro. Aquí se decide, para cada tarjeta, el ancho y el alto máximos:
///
///   · El ancho, por sus vecinas de la MISMA fila (mismo `top`): no pasa de la
///     distancia a la del lado menos un hueco, ni del borde del área.
///   · El alto, por las tarjetas de FILAS de debajo que le caen encima en
///     horizontal, y por el borde inferior.
///
/// La tarjeta se pinta con ese ancho y, si su contenido no cabe en ese alto,
/// se encoge entera (letra incluida) en vez de montarse sobre la de abajo.
///
/// Es código puro: recibe centros y alturas en píxeles.
library;

class CajaTarjeta {
  /// Centro horizontal de la tarjeta (ya abierta hacia los lados).
  final double centroX;
  /// Borde superior.
  final double top;
  const CajaTarjeta(this.centroX, this.top);
}

class TamanoTarjeta {
  final double ancho;
  final double altoMax;
  const TamanoTarjeta(this.ancho, this.altoMax);
  @override
  String toString() => 'TamanoTarjeta($ancho, $altoMax)';
}

/// Dos tarjetas están en la misma fila si sus `top` difieren menos que esto.
const double kMismaFila = 24;

List<TamanoTarjeta> repartirTarjetas(
  List<CajaTarjeta> cajas, {
  required double areaAncho,
  required double areaAlto,
  double hueco = 8,
  double anchoMax = 200,
  double anchoMin = 70,
  double altoMax = 170,
  /// Sitio que hay que dejar libre ENCIMA de cada tarjeta (la etiqueta de la
  /// medida de su eje): las de la fila de arriba no pueden bajar hasta él.
  List<double>? reservaArriba,
}) {
  final n = cajas.length;
  final anchos = List<double>.filled(n, anchoMax);
  for (int i = 0; i < n; i++) {
    final a = cajas[i];
    // Bordes del área: centrada en su rueda, no puede salirse.
    var w = 2 * (a.centroX < areaAncho - a.centroX ? a.centroX : areaAncho - a.centroX);
    for (int j = 0; j < n; j++) {
      if (i == j) continue;
      final b = cajas[j];
      if ((a.top - b.top).abs() >= kMismaFila) continue;
      // Con las dos del mismo ancho, cada una puede llegar hasta la mitad del
      // camino a la otra, menos medio hueco.
      final d = (a.centroX - b.centroX).abs() - hueco;
      if (d < w) w = d;
    }
    if (w > anchoMax) w = anchoMax;
    if (w < anchoMin) w = anchoMin;
    anchos[i] = w;
  }
  return [
    for (int i = 0; i < n; i++)
      () {
        final a = cajas[i];
        var h = areaAlto - a.top;
        for (int j = 0; j < n; j++) {
          if (i == j) continue;
          final b = cajas[j];
          if (b.top - a.top < kMismaFila) continue; // misma fila o por encima
          final seTocan = (a.centroX - b.centroX).abs() < (anchos[i] + anchos[j]) / 2;
          if (!seTocan) continue;
          final d = b.top - (reservaArriba?[j] ?? 0) - a.top - hueco;
          if (d < h) h = d;
        }
        if (h > altoMax) h = altoMax;
        if (h < 40) h = 40;
        return TamanoTarjeta(anchos[i], h);
      }(),
  ];
}
