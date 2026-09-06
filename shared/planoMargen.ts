/**
 * Margen del plano del vehículo.
 *
 * Hay DOS márgenes, y conviene no confundirlos:
 *
 * 1. MARGEN_COORD: el espacio en el que están GUARDADAS las coordenadas de
 *    cada posición (tc_posiciones_vehiculo.pos_x/y/w/h, en % de 0 a 100). Es
 *    la imagen del chasis más un 12 % a cada lado y un 4 % arriba y abajo.
 *    Lo fijó la migración tyrecontrol_plano_con_margen.sql y NO SE CAMBIA:
 *    cambiarlo obligaría a convertir otra vez todas las coordenadas.
 *
 * 2. MARGEN_VISTA: con cuánto aire se DIBUJA la imagen dentro del plano. Se
 *    puede ajustar libremente: los recuadros se recolocan solos con
 *    `coordAVista`, que lleva un punto del espacio guardado al de pantalla
 *    (misma posición relativa a la imagen). Más margen = imagen más pequeña
 *    y más sitio al lado de las ruedas para las etiquetas, que conservan su
 *    tamaño en % del plano.
 *
 * Panel, tablet (tyrecontrol_app/lib/widgets/plano_margen.dart) y el PDF del
 * parte usan los mismos números: si cambian aquí tienen que cambiar allí.
 */
export const MARGEN_COORD_X = 0.12;
export const MARGEN_COORD_Y = 0.04;
export const MARGEN_VISTA_X = 0.22;
export const MARGEN_VISTA_Y = 0.08;

// Compatibilidad con quien importaba los nombres antiguos: son los de vista.
export const MARGEN_PLANO_X = MARGEN_VISTA_X;
export const MARGEN_PLANO_Y = MARGEN_VISTA_Y;

/** Aspecto (ancho/alto) del plano dibujado a partir del de la imagen. */
export function aspectoPlano(aspectoImagen: number): number {
  return aspectoImagen * (1 - 2 * MARGEN_VISTA_Y) / (1 - 2 * MARGEN_VISTA_X);
}

/** Rectángulo de la imagen dentro de un plano dibujado de `ancho` × `alto`. */
export function rectImagenEnPlano(ancho: number, alto: number) {
  return {
    x: ancho * MARGEN_VISTA_X,
    y: alto * MARGEN_VISTA_Y,
    ancho: ancho * (1 - 2 * MARGEN_VISTA_X),
    alto: alto * (1 - 2 * MARGEN_VISTA_Y),
  };
}

const ESCALA_X = (1 - 2 * MARGEN_VISTA_X) / (1 - 2 * MARGEN_COORD_X);
const ESCALA_Y = (1 - 2 * MARGEN_VISTA_Y) / (1 - 2 * MARGEN_COORD_Y);

/** Un punto (en %) del espacio guardado, llevado al plano dibujado. */
export function puntoCoordAVista(x: number, y: number) {
  return {
    x: MARGEN_VISTA_X * 100 + (x - MARGEN_COORD_X * 100) * ESCALA_X,
    y: MARGEN_VISTA_Y * 100 + (y - MARGEN_COORD_Y * 100) * ESCALA_Y,
  };
}

/** El inverso: de un punto del plano dibujado al espacio guardado. */
export function puntoVistaACoord(x: number, y: number) {
  return {
    x: MARGEN_COORD_X * 100 + (x - MARGEN_VISTA_X * 100) / ESCALA_X,
    y: MARGEN_COORD_Y * 100 + (y - MARGEN_VISTA_Y * 100) / ESCALA_Y,
  };
}

export interface Caja { x: number; y: number; w: number; h: number }

/**
 * Un recuadro guardado, tal como hay que dibujarlo: se mueve su CENTRO con la
 * imagen y conserva su ancho y alto en % del plano (la etiqueta no encoge con
 * la foto, que es justo lo que da sitio).
 */
export function coordAVista(c: Caja): Caja {
  const p = puntoCoordAVista(c.x + c.w / 2, c.y + c.h / 2);
  return { x: p.x - c.w / 2, y: p.y - c.h / 2, w: c.w, h: c.h };
}

export function vistaACoord(c: Caja): Caja {
  const p = puntoVistaACoord(c.x + c.w / 2, c.y + c.h / 2);
  return { x: p.x - c.w / 2, y: p.y - c.h / 2, w: c.w, h: c.h };
}
