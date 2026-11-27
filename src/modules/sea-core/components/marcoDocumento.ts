/**
 * La geometría del marco para fotografiar el DNI y el carnet.
 *
 * Los dos tienen el tamaño de una tarjeta de crédito (ISO/IEC 7810 ID-1:
 * 85,60 × 53,98 mm). El marco tiene esa forma, y de la foto se guarda solo lo
 * que cae dentro —con un poco de margen— a un tamaño fijo: así todas salen
 * iguales, sea cual sea el móvil.
 *
 * El margen está a propósito: el servidor endereza después cada foto buscando
 * las cuatro esquinas del documento con la IA, y si el recorte las corta no
 * tiene dónde mirar.
 *
 * Aquí no hay navegador: solo cuentas, para poder probarlas.
 */

/** Ancho entre alto de una tarjeta ID-1. */
export const PROPORCION_TARJETA = 85.6 / 53.98;

/** Lo que se guarda, en píxeles: todas las fotos de documentos, iguales. */
export const ANCHO_GUARDADO = 1600;
export const ALTO_GUARDADO = Math.round(ANCHO_GUARDADO / PROPORCION_TARJETA);

/** Lo que se deja alrededor del marco, en proporción de su ancho. */
export const MARGEN = 0.06;

export type Rect = { x: number; y: number; ancho: number; alto: number };

/**
 * Dónde va el marco en la pantalla: centrado, lo más ancho que quepa dejando
 * aire a los lados, y con la forma de la tarjeta.
 */
export function marcoEnPantalla(anchoPantalla: number, altoPantalla: number): Rect {
  const ancho = Math.min(anchoPantalla * 0.86, altoPantalla * 0.55 * PROPORCION_TARJETA);
  const alto = ancho / PROPORCION_TARJETA;
  return { x: (anchoPantalla - ancho) / 2, y: (altoPantalla - alto) / 2, ancho, alto };
}

/**
 * El trozo de la imagen de la cámara que corresponde al marco de la pantalla.
 *
 * El vídeo se pinta con `object-fit: cover`: se escala hasta llenar la
 * pantalla y lo que sobra se corta por los lados (o por arriba y abajo). Hay
 * que deshacer eso para saber qué píxeles de la cámara hay debajo del marco.
 * Se le añade `MARGEN` alrededor, sin salirse de la imagen.
 */
export function recorteDeCamara(
  video: { ancho: number; alto: number },
  pantalla: { ancho: number; alto: number },
  marco: Rect,
  margen = MARGEN
): Rect {
  const escala = Math.max(pantalla.ancho / video.ancho, pantalla.alto / video.alto);
  const desplX = (video.ancho * escala - pantalla.ancho) / 2;
  const desplY = (video.alto * escala - pantalla.alto) / 2;

  const extra = marco.ancho * margen;
  const x0 = (marco.x - extra + desplX) / escala;
  const y0 = (marco.y - extra + desplY) / escala;
  const x1 = (marco.x + marco.ancho + extra + desplX) / escala;
  const y1 = (marco.y + marco.alto + extra + desplY) / escala;

  const x = Math.max(0, Math.round(x0));
  const y = Math.max(0, Math.round(y0));
  return {
    x,
    y,
    ancho: Math.min(video.ancho, Math.round(x1)) - x,
    alto: Math.min(video.alto, Math.round(y1)) - y,
  };
}
