/**
 * Margen del plano del vehículo.
 *
 * Las coordenadas calibradas de cada posición (tc_posiciones_vehiculo.pos_x/y/w/h,
 * en % de 0 a 100) NO son porcentajes de la imagen del chasis: son porcentajes
 * del PLANO, que es la imagen más un margen a cada lado. La imagen se dibuja
 * más pequeña, centrada dentro del plano, y así los recuadros de las ruedas
 * exteriores caben AL LADO de la rueda en vez de salirse por el borde de la
 * foto.
 *
 * Panel, tablet (tyrecontrol_app/lib/widgets/plano_margen.dart) y el PDF del
 * parte usan los mismos números: si cambian aquí tienen que cambiar allí, o
 * las cruces del papel y las tarjetas de la tablet dejarán de caer sobre la
 * rueda que calibró el panel.
 */
export const MARGEN_PLANO_X = 0.12; // a cada lado, fracción del ancho del plano
export const MARGEN_PLANO_Y = 0.04; // arriba y abajo, fracción del alto del plano

/** Aspecto (ancho/alto) del plano a partir del de la imagen. */
export function aspectoPlano(aspectoImagen: number): number {
  return aspectoImagen * (1 - 2 * MARGEN_PLANO_Y) / (1 - 2 * MARGEN_PLANO_X);
}

/**
 * Rectángulo de la imagen dentro de un plano de `ancho` × `alto`, con el
 * origen en la esquina superior izquierda del plano.
 */
export function rectImagenEnPlano(ancho: number, alto: number) {
  return {
    x: ancho * MARGEN_PLANO_X,
    y: alto * MARGEN_PLANO_Y,
    ancho: ancho * (1 - 2 * MARGEN_PLANO_X),
    alto: alto * (1 - 2 * MARGEN_PLANO_Y),
  };
}
