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

const double _escalaX = (1 - 2 * kMargenVistaX) / (1 - 2 * kMargenCoordX);
const double _escalaY = (1 - 2 * kMargenVistaY) / (1 - 2 * kMargenCoordY);

/// Aspecto (ancho/alto) del plano dibujado a partir del de la imagen.
double aspectoPlano(double aspectoImagen) =>
    aspectoImagen * (1 - 2 * kMargenVistaY) / (1 - 2 * kMargenVistaX);

/// Rectángulo de la imagen dentro de un plano dibujado de [ancho] × [alto].
({double x, double y, double w, double h}) rectImagenEnPlano(double ancho, double alto) => (
      x: ancho * kMargenVistaX,
      y: alto * kMargenVistaY,
      w: ancho * (1 - 2 * kMargenVistaX),
      h: alto * (1 - 2 * kMargenVistaY),
    );

/// Un recuadro guardado (x, y, w, h en %) tal como hay que dibujarlo: su
/// centro se mueve con la imagen; ancho y alto se conservan.
({double x, double y, double w, double h}) cajaAVista(({double x, double y, double w, double h}) c) {
  final cx = kMargenVistaX * 100 + (c.x + c.w / 2 - kMargenCoordX * 100) * _escalaX;
  final cy = kMargenVistaY * 100 + (c.y + c.h / 2 - kMargenCoordY * 100) * _escalaY;
  return (x: cx - c.w / 2, y: cy - c.h / 2, w: c.w, h: c.h);
}
