/**
 * Las medidas de la etiqueta de neumático, en MILÍMETROS.
 *
 * ── Por qué todo vive aquí y en milímetros ──────────────────────────────────
 *
 * Porque esto se imprime y se pega en una goma. Un píxel no tiene tamaño
 * físico: depende del DPI, del zoom del navegador y del driver. Un milímetro
 * sí, y es lo único que se puede comprobar con una regla.
 *
 * Y vive en UN sitio porque los tres bloques de la etiqueta salen del MISMO
 * cálculo. Diseñarlos a mano por separado es como se acaba con el bloque de
 * abajo saliéndose de su troquelado: los tres parecían iguales en pantalla.
 *
 * ── De dónde salen estos números ────────────────────────────────────────────
 *
 * Medidos sobre el escaneo de la etiqueta real (`20260917_001.pdf`, página de
 * 93,0 × 147,7 mm): la etiqueta amarilla ocupa 90,0 × 143,9 mm y los dos
 * troquelados inferiores son 64,3 × 23,5 mm, a 13 mm del borde izquierdo.
 *
 * Que los dos huecos midieran lo mismo hasta la décima es lo que da confianza
 * en la medición: si fuera ruido del escaneo, no habrían coincidido.
 *
 * PENDIENTE DE CALIBRAR con una regla sobre la etiqueta física. Un escáner
 * puede haber aplicado un ajuste y desde el fichero no hay forma de saberlo.
 * Si la medida real difiere, se cambian estos números y NADA MÁS: el resto se
 * recalcula. Para eso está este módulo.
 */

/** Una caja en milímetros, con el origen en la esquina superior izquierda. */
export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export const ETIQUETA = {
  /** La etiqueta amarilla entera. */
  ancho: 90.0,
  alto: 143.9,

  /**
   * Los dos troquelados inferiores, tal como están en la etiqueta física.
   *
   * Son los límites REALES de los bloques 2 y 3: no se aproximan ni se
   * redondean a algo cómodo, porque lo que se sale de un troquelado se pierde
   * al arrancar la pegatina.
   */
  huecos: [
    { x: 13.0, y: 68.5, ancho: 64.3, alto: 23.5 },
    { x: 12.8, y: 96.3, ancho: 64.4, alto: 23.5 },
  ] as Caja[],

  /**
   * El bloque 1, en la zona central-superior. Aquí no hay troquelado que
   * respetar, así que va más holgado: es el que se lee de lejos.
   */
  bloque1: { x: 13.0, y: 30.0, ancho: 64.0, alto: 30.0 } as Caja,

  /**
   * Margen que se deja al borde de cada caja.
   *
   * Un troquelado nunca cae exacto y una impresora tampoco: 1,5 mm es lo que
   * separa «justo» de «cortado».
   */
  seguridad: 1.5,

  /** Separación entre el número y el QR, para que no se toquen. */
  separacion: 2.0,

  /**
   * Lado mínimo del QR, en mm.
   *
   * Por debajo de esto un móvil no lee trece dígitos con fiabilidad: un QR
   * versión 2 con corrección M son 25 módulos, y a 12 mm cada módulo mide
   * 0,48 mm, que es el suelo práctico de una cámara de tablet a 20 cm.
   *
   * No es un consejo: si el cálculo no llega, `componerBloque` FALLA. Más
   * vale no imprimir que imprimir 200 etiquetas que no se pueden escanear.
   */
  qrMinimo: 12.0,

  /** Altura del rótulo «Nº SERIE» sobre el número. */
  rotulo: 2.4,
} as const;

/** Lo que hay que dibujar dentro de una caja, ya resuelto en mm. */
export interface BloqueEtiqueta {
  /** La caja de la que se partió, para poder situarla en la etiqueta. */
  caja: Caja;
  /** Dónde va el rótulo «Nº SERIE». */
  rotulo: Caja & { tamano: number };
  /** Dónde va el número, y con qué tamaño de letra. */
  numero: Caja & { tamano: number };
  /** El QR, siempre cuadrado y SIEMPRE a la derecha del número. */
  qr: Caja;
}

/**
 * Cuánto ancho ocupa un dígito respecto al tamaño de letra, en una
 * monoespaciada condensada. Medido sobre la que se va a usar; si se cambia la
 * fuente hay que revisar este número o el cálculo miente.
 */
const ANCHO_DIGITO = 0.62;

/**
 * Coloca el número y el QR dentro de una caja.
 *
 * El QR va a la DERECHA del número, nunca encima ni debajo: es el encargo, y
 * además es lo que deja al número el ancho largo de la caja, que es donde
 * trece dígitos se leen grandes.
 *
 * Lanza si el QR no llega al mínimo escaneable. Es deliberado: un QR que no
 * se lee convierte toda la etiqueta en papel de adorno, y es mejor enterarse
 * al generar que con el rollo ya impreso.
 */
export function componerBloque(caja: Caja, digitos = 13): BloqueEtiqueta {
  const m = ETIQUETA.seguridad;
  const interiorAncho = caja.ancho - 2 * m;
  const interiorAlto = caja.alto - 2 * m;
  if (interiorAncho <= 0 || interiorAlto <= 0) {
    throw new Error(`Caja demasiado pequeña para la etiqueta: ${caja.ancho}×${caja.alto} mm`);
  }

  // El QR es cuadrado y su lado lo manda el ALTO disponible: es la dimensión
  // escasa en un troquelado de 23,5 mm. Se limita también a un tercio del
  // ancho para no comerse el sitio del número.
  const qrLado = Math.min(interiorAlto, interiorAncho / 3);
  if (qrLado < ETIQUETA.qrMinimo) {
    throw new Error(
      `El QR saldría de ${qrLado.toFixed(1)} mm y el mínimo escaneable es ` +
      `${ETIQUETA.qrMinimo} mm. Caja de ${caja.ancho}×${caja.alto} mm.`,
    );
  }

  const anchoTexto = interiorAncho - qrLado - ETIQUETA.separacion;
  if (anchoTexto <= 0) throw new Error("No queda sitio para el número junto al QR");

  // El rótulo solo se pone si sobra alto: entre rótulo y número, manda el
  // número, que es el dato.
  const cabeRotulo = interiorAlto - ETIQUETA.rotulo >= 4;
  const altoNumero = cabeRotulo ? interiorAlto - ETIQUETA.rotulo : interiorAlto;

  // El tamaño de letra lo limita lo que primero se agote: el alto de la
  // franja o el ancho para N dígitos.
  const tamano = Math.min(altoNumero * 0.8, anchoTexto / (digitos * ANCHO_DIGITO));

  return {
    caja,
    rotulo: {
      x: caja.x + m, y: caja.y + m,
      ancho: anchoTexto, alto: cabeRotulo ? ETIQUETA.rotulo : 0,
      tamano: cabeRotulo ? ETIQUETA.rotulo : 0,
    },
    numero: {
      x: caja.x + m,
      y: caja.y + m + (cabeRotulo ? ETIQUETA.rotulo : 0),
      ancho: anchoTexto, alto: altoNumero, tamano,
    },
    qr: {
      // Pegado al borde derecho interior, y centrado en vertical.
      x: caja.x + caja.ancho - m - qrLado,
      y: caja.y + (caja.alto - qrLado) / 2,
      ancho: qrLado, alto: qrLado,
    },
  };
}

/**
 * Los TRES bloques de la etiqueta, del mismo cálculo.
 *
 * El 1 arriba y los 2 y 3 dentro de sus troquelados. Salen de la misma
 * función a propósito: así no puede pasar que uno se diseñe «a ojo» y acabe
 * saliéndose de su hueco.
 */
export function bloquesDeEtiqueta(digitos = 13): BloqueEtiqueta[] {
  return [ETIQUETA.bloque1, ...ETIQUETA.huecos].map((c) => componerBloque(c, digitos));
}

/** ¿Está esta caja entera dentro de aquella? Con la tolerancia de la décima. */
export function cabeDentro(dentro: Caja, fuera: Caja, tolerancia = 0.05): boolean {
  return (
    dentro.x >= fuera.x - tolerancia &&
    dentro.y >= fuera.y - tolerancia &&
    dentro.x + dentro.ancho <= fuera.x + fuera.ancho + tolerancia &&
    dentro.y + dentro.alto <= fuera.y + fuera.alto + tolerancia
  );
}
