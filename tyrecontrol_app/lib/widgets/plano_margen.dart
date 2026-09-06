/// Margen del plano del vehículo.
///
/// Las coordenadas calibradas de cada posición (`pos_x/y/w/h`, en % de 0 a
/// 100) son porcentajes del PLANO, que es la imagen del chasis más un margen a
/// cada lado. La imagen se dibuja más pequeña y centrada dentro del plano, y
/// así las tarjetas de las ruedas exteriores caben AL LADO de la rueda.
///
/// Tiene que coincidir con `shared/planoMargen.ts` (panel y PDF del parte).
const double kMargenPlanoX = 0.12; // a cada lado, fracción del ancho del plano
const double kMargenPlanoY = 0.04; // arriba y abajo, fracción del alto del plano

/// Aspecto (ancho/alto) del plano a partir del de la imagen.
double aspectoPlano(double aspectoImagen) =>
    aspectoImagen * (1 - 2 * kMargenPlanoY) / (1 - 2 * kMargenPlanoX);

/// Rectángulo de la imagen dentro de un plano de [ancho] × [alto], con el
/// origen en la esquina superior izquierda del plano.
({double x, double y, double w, double h}) rectImagenEnPlano(double ancho, double alto) => (
      x: ancho * kMargenPlanoX,
      y: alto * kMargenPlanoY,
      w: ancho * (1 - 2 * kMargenPlanoX),
      h: alto * (1 - 2 * kMargenPlanoY),
    );
