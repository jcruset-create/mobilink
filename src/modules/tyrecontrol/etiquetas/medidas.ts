/**
 * Las medidas de la etiqueta de neumático, en MILÍMETROS.
 *
 * ── Por qué todo vive aquí y en milímetros ──────────────────────────────────
 *
 * Porque esto se imprime y se pega en una goma. Un píxel no tiene tamaño
 * físico: depende del DPI, del zoom del navegador y del driver. Un milímetro
 * sí, y es lo único que se puede comprobar con una regla.
 *
 * Y vive en UN sitio porque los tres bloques salen del MISMO cálculo.
 * Diseñarlos a mano por separado es como se acaba con el de abajo saliéndose
 * de su troquelado: los tres parecían iguales en pantalla.
 *
 * ── De dónde salen estos números ────────────────────────────────────────────
 *
 * Del PDF de fabricación de la etiqueta (`etiqueta_144x90_groga.pdf`), leídos
 * de sus vectores, no de una foto ni de un escaneo: página de 90 × 144 mm y
 * dos troquelados de 65 × 25 mm exactos, a 12,5 mm del borde izquierdo y a
 * 66,98 y 94,98 mm del borde superior.
 *
 * Si algún día cambia la etiqueta, se cambian ESTOS números y nada más: todo
 * lo demás se recalcula. Para eso está este módulo.
 */

/** Una caja en milímetros, con el origen en la esquina superior izquierda. */
export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export const ETIQUETA = {
  /** La etiqueta entera. */
  ancho: 90.0,
  alto: 144.0,

  /**
   * Las dos SUBETIQUETAS troqueladas de abajo.
   *
   * Son los límites reales, sacados del PDF de fabricación: no se aproximan ni
   * se redondean a algo cómodo, porque lo que se sale del troquelado se pierde
   * al arrancar la pegatina.
   */
  huecos: [
    { x: 12.5, y: 66.98, ancho: 65.0, alto: 25.0 },
    { x: 12.5, y: 94.98, ancho: 65.0, alto: 25.0 },
  ] as Caja[],

  /**
   * La zona de arriba, la que se queda pegada a la rueda.
   *
   * Aquí no hay troquelado que respetar, así que se aprovecha: es la que se
   * lee de lejos y en mala postura, agachado junto a una rueda. Llega hasta
   * 3 mm por encima del primer troquelado.
   */
  zonaSuperior: { x: 7.5, y: 8.0, ancho: 75.0, alto: 56.0 } as Caja,

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
   * No es un consejo: si el cálculo no llega, el compositor FALLA. Más vale no
   * imprimir que imprimir 200 etiquetas que no se pueden escanear.
   */
  qrMinimo: 12.0,
} as const;

/**
 * Lo que hay que dibujar dentro de una caja, ya resuelto en mm.
 *
 * No hay rótulo: en la etiqueta no se imprime «Nº SERIE» ni nada parecido.
 * Quien la mira ya sabe lo que es, y esas letras le quitaban sitio al dato.
 */
export interface BloqueEtiqueta {
  /** La caja de la que se partió, para poder situarla en la etiqueta. */
  caja: Caja;
  /** Dónde va el número, y con qué tamaño de letra. */
  numero: Caja & { tamano: number; centrado: boolean };
  /** El QR, siempre cuadrado. */
  qr: Caja;
}

/**
 * Cuánto ancho ocupa un dígito respecto al tamaño de letra.
 *
 * En Courier —la que se usa en pantalla y en el PDF— el avance de cada
 * carácter es exactamente 0,6 em. Se deja 0,62 de colchón: redondeos del
 * navegador y del driver, y que nadie quiere descubrir que falta medio
 * milímetro con el rollo ya impreso.
 *
 * Si se cambia la fuente hay que revisar este número o el cálculo miente: fue
 * lo que pasó con `monospace` a secas, que en Windows es Consolas (0,55 em) y
 * en Linux DejaVu (0,60 em).
 */
const ANCHO_DIGITO = 0.62;

function interior(caja: Caja): { ancho: number; alto: number } {
  const m = ETIQUETA.seguridad;
  const ancho = caja.ancho - 2 * m;
  const alto = caja.alto - 2 * m;
  if (ancho <= 0 || alto <= 0) {
    throw new Error(`Caja demasiado pequeña para la etiqueta: ${caja.ancho}×${caja.alto} mm`);
  }
  return { ancho, alto };
}

function comprobarQr(lado: number, caja: Caja): void {
  if (lado < ETIQUETA.qrMinimo) {
    throw new Error(
      `El QR saldría de ${lado.toFixed(1)} mm y el mínimo escaneable es ` +
      `${ETIQUETA.qrMinimo} mm. Caja de ${caja.ancho}×${caja.alto} mm.`,
    );
  }
}

/**
 * Número a la izquierda y QR a la DERECHA, para las subetiquetas.
 *
 * En una caja de 65 × 25 mm el alto es lo escaso: puestos uno encima de otro,
 * ni el número ni el QR tendrían tamaño. En fila, el número dispone del largo
 * de la caja, que es donde trece dígitos se leen grandes.
 */
export function componerFila(caja: Caja, digitos = 13): BloqueEtiqueta {
  const m = ETIQUETA.seguridad;
  const { ancho, alto } = interior(caja);

  // El QR es cuadrado y su lado lo manda el ALTO. Se limita también a un
  // tercio del ancho para no comerse el sitio del número.
  const lado = Math.min(alto, ancho / 3);
  comprobarQr(lado, caja);

  const anchoTexto = ancho - lado - ETIQUETA.separacion;
  if (anchoTexto <= 0) throw new Error("No queda sitio para el número junto al QR");

  return {
    caja,
    numero: {
      x: caja.x + m, y: caja.y + m,
      ancho: anchoTexto, alto,
      // Manda lo que primero se agote: el alto de la franja o el ancho para N
      // dígitos.
      tamano: Math.min(alto * 0.8, anchoTexto / (digitos * ANCHO_DIGITO)),
      centrado: false,
    },
    qr: {
      // Pegado al borde derecho interior y centrado en vertical.
      x: caja.x + caja.ancho - m - lado,
      y: caja.y + (caja.alto - lado) / 2,
      ancho: lado, alto: lado,
    },
  };
}

/**
 * Número ARRIBA y QR DEBAJO, los dos lo más grandes que quepan.
 *
 * Es la zona que se queda en la rueda, y no tiene troquelado que la estreche,
 * así que aquí el reparto es al revés que en las subetiquetas: en columna, el
 * número ocupa los 75 mm de ancho y al QR le queda todo el alto restante.
 *
 * El número se queda con la franja que necesita para llenar el ancho —no más—
 * y TODO lo que sobra es para el QR: entre un número aún más grande y un QR
 * que se lee a la primera con el móvil sucio, manda el QR.
 */
export function componerColumna(caja: Caja, digitos = 13): BloqueEtiqueta {
  const m = ETIQUETA.seguridad;
  const { ancho, alto } = interior(caja);

  // El número, tan grande como permita el ancho para N dígitos.
  const tamano = ancho / (digitos * ANCHO_DIGITO);
  const franja = tamano * 1.25; // algo de aire por encima y por debajo

  const lado = Math.min(ancho, alto - franja - ETIQUETA.separacion);
  comprobarQr(lado, caja);

  return {
    caja,
    numero: {
      x: caja.x + m, y: caja.y + m,
      ancho, alto: franja, tamano, centrado: true,
    },
    qr: {
      // Centrado en horizontal, justo debajo del número.
      x: caja.x + (caja.ancho - lado) / 2,
      y: caja.y + m + franja + ETIQUETA.separacion,
      ancho: lado, alto: lado,
    },
  };
}

/**
 * Los TRES bloques de la etiqueta: la zona de arriba y las dos subetiquetas.
 *
 * Salen del mismo módulo a propósito, así no puede pasar que uno se diseñe «a
 * ojo» y acabe saliéndose de su hueco.
 */
export function bloquesDeEtiqueta(digitos = 13): BloqueEtiqueta[] {
  return [
    componerColumna(ETIQUETA.zonaSuperior, digitos),
    ...ETIQUETA.huecos.map((c) => componerFila(c, digitos)),
  ];
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
