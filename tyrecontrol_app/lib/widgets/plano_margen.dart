/// Margen del plano del vehículo. Tiene que coincidir con
/// `shared/planoMargen.ts` (panel y PDF del parte).
///
/// Dos márgenes distintos:
///
/// * `kMargenCoord*`: el espacio en el que están GUARDADAS las coordenadas de
///   las posiciones (`pos_x/y/w/h`, % de 0 a 100): la imagen más un 12 % a
///   cada lado y un 4 % arriba y abajo. No se cambia: obligaría a convertir
///   otra vez todas las coordenadas.
/// * `kMargenVista*`: con cuánto aire se DIBUJA la imagen. Se puede ajustar:
///   los recuadros se recolocan con [cajaAVista] (misma posición relativa a
///   la imagen) y conservan su tamaño en % del plano.
const double kMargenCoordX = 0.12;
const double kMargenCoordY = 0.04;
const double kMargenVistaX = 0.22;
const double kMargenVistaY = 0.08;

/// Aspecto (ancho/alto) del plano dibujado a partir del de la imagen.
double aspectoPlano(double aspectoImagen) =>
    aspectoImagen * (1 - 2 * kMargenVistaY) / (1 - 2 * kMargenVistaX);

/// Rectángulo de la imagen dentro de un plano dibujado de [ancho] × [alto].
({double x, double y, double w, double h}) rectImagenEnPlano(double ancho, double alto,
        {double mx = kMargenVistaX, double my = kMargenVistaY}) => (
      x: ancho * mx,
      y: alto * my,
      w: ancho * (1 - 2 * mx),
      h: alto * (1 - 2 * my),
    );

/// Un recuadro guardado (x, y, w, h en %) tal como hay que dibujarlo: su
/// centro se mueve con la imagen; ancho y alto se conservan.
({double x, double y, double w, double h}) cajaAVista(({double x, double y, double w, double h}) c,
    {double mx = kMargenVistaX, double my = kMargenVistaY}) {
  final ex = (1 - 2 * mx) / (1 - 2 * kMargenCoordX);
  final ey = (1 - 2 * my) / (1 - 2 * kMargenCoordY);
  final cx = mx * 100 + (c.x + c.w / 2 - kMargenCoordX * 100) * ex;
  final cy = my * 100 + (c.y + c.h / 2 - kMargenCoordY * 100) * ey;
  return (x: cx - c.w / 2, y: cy - c.h / 2, w: c.w, h: c.h);
}

/// Hasta dónde se deja crecer el margen lateral para llenar el ancho.
const double kMargenVistaXMax = 0.34;

/// El plano que cabe en [maxW] × [maxH] para una imagen de [aspectoImagen]
/// (ancho/alto): su tamaño y los márgenes con los que se dibuja.
///
/// Si con los márgenes de siempre cabe a lo ancho, se dibuja como siempre.
///
/// Si lo que manda es el ALTO —una tablet de 8" en vertical con la barra de
/// la sonda arriba y los botones abajo— antes se encogía el plano entero y
/// quedaban los lados vacíos y las tarjetas diminutas. Ahora la imagen se
/// queda con casi todo el alto (el margen vertical baja al de las
/// coordenadas) y el plano se ensancha hasta donde haya sitio: las tarjetas,
/// que miden un % del ancho del plano, crecen con él.
({double w, double h, double mx, double my}) ajustePlano(double maxW, double maxH, double aspectoImagen) {
  final hDeSiempre = maxW / aspectoPlano(aspectoImagen);
  if (hDeSiempre <= maxH) {
    return (w: maxW, h: hDeSiempre, mx: kMargenVistaX, my: kMargenVistaY);
  }
  const my = kMargenCoordY;
  // La imagen, todo lo alta que cabe; pero nunca más ancha que con el margen
  // lateral de siempre.
  var anchoImagen = maxH * (1 - 2 * my) * aspectoImagen;
  final tope = maxW * (1 - 2 * kMargenVistaX);
  if (anchoImagen > tope) anchoImagen = tope;
  final h = anchoImagen / aspectoImagen / (1 - 2 * my);
  // El plano, todo lo ancho que cabe sin pasarse del margen máximo.
  var w = maxW;
  final minimo = anchoImagen / (1 - 2 * kMargenVistaXMax);
  if (w > minimo) w = minimo;
  final mx = (1 - anchoImagen / w) / 2;
  return (w: w, h: h, mx: mx, my: my);
}
