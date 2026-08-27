/**
 * Miniaturas de las imágenes de los botones de cobro.
 *
 * La imagen que sube el usuario es la que tenga a mano: una foto, una captura,
 * el logotipo del banco a tamaño cartel. El botón la enseña a 32 píxeles de
 * alto, así que guardar el original solo sirve para que la pantalla de cobros
 * cargue lenta. Se reduce aquí, en el servidor, y se guarda ya en tamaño de
 * botón: el usuario no tiene que saber nada de píxeles.
 *
 * 240 px de alto son más del triple del alto del botón (72 px): nítido en una
 * pantalla retina, donde ese botón son 144 px reales, y aun así un fichero de
 * unas decenas de KB haga lo que haga el usuario con la cámara.
 */

import sharp from "sharp";
import { ErrorCaja } from "./errors.ts";

const ALTO_MAXIMO = 240;

/*
 * El logotipo del banco se imprime, y el papel tiene mucha más resolución que
 * una pantalla: a 480 px de alto sobre los 38 puntos que ocupa en la cabecera
 * salen más de 900 puntos por pulgada, de sobra para cualquier impresora.
 */
const ALTO_LOGO = 480;

export async function miniaturaBoton(original: Buffer): Promise<Buffer> {
  try {
    return await sharp(original)
      .resize({ height: ALTO_MAXIMO, withoutEnlargement: true })
      .png({ palette: true, colors: 128, effort: 7 })
      .toBuffer();
  } catch {
    // sharp no ha sabido leerla: no era una imagen de verdad, viniera con el
    // content-type que viniera.
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "El fichero no se ha podido leer como imagen. Prueba con un PNG o un JPG.",
      400
    );
  }
}

/**
 * El logotipo de un banco, tal cual pero a tamaño razonable.
 *
 * Es distinto de un botón de cobro en dos cosas. La primera, que sale IMPRESO
 * en la cabecera del resguardo, ancho y con letra fina: la paleta de 128
 * colores del botón se le come los bordes y sale sucio. La segunda, que casi
 * siempre viene en PNG con transparencia, hecho para fondo oscuro, y esa
 * transparencia hay que conservarla o la cabecera azul se queda con un
 * recuadro blanco alrededor.
 *
 * Además se recortan los márgenes vacíos que traiga el fichero: son los que
 * hacen que el logotipo salga pequeño en un hueco grande.
 */
export async function miniaturaLogo(original: Buffer): Promise<Buffer> {
  try {
    let imagen = sharp(original).ensureAlpha();
    try {
      // El recorte falla si la imagen es de un solo color: entonces se deja.
      imagen = sharp(await imagen.trim({ threshold: 5 }).toBuffer());
    } catch {
      imagen = sharp(original).ensureAlpha();
    }
    return await imagen
      .resize({ height: ALTO_LOGO, withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 7 })
      .toBuffer();
  } catch {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "El fichero no se ha podido leer como imagen. Prueba con un PNG o un JPG.",
      400
    );
  }
}

/**
 * Miniatura de un billete o una moneda, con el fondo recortado.
 *
 * Las fotos que se encuentran de billetes y monedas vienen casi siempre en JPG
 * sobre fondo blanco, y el JPG no tiene canal de transparencia: ese blanco va
 * dentro de la imagen. Puesto sobre el fondo oscuro de la pantalla, cada moneda
 * sale metida en su recuadro claro.
 *
 * Aquí se quita. No con un «borra todo lo blanco», que agujerearía los blancos
 * de dentro de un billete de 5 €, sino con un relleno desde los bordes: solo
 * desaparece el fondo que está pegado al marco y conectado con él. Lo que quede
 * rodeado por la moneda se queda.
 */
export async function miniaturaFicha(original: Buffer): Promise<Buffer> {
  let imagen;
  try {
    imagen = sharp(original).resize({ height: ALTO_MAXIMO, withoutEnlargement: true });
    const { data, info } = await imagen.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    recortarFondo(data, info.width, info.height);
    return await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9, effort: 7 })
      .toBuffer();
  } catch (e) {
    if (e instanceof ErrorCaja) throw e;
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "El fichero no se ha podido leer como imagen. Prueba con un PNG o un JPG.",
      400
    );
  }
}

/**
 * Hasta dónde se parece un píxel al fondo. Por debajo de `IGUAL` es fondo y se
 * borra entero; entre `IGUAL` y `PARECIDO` se difumina, que es lo que evita el
 * borde dentado de recortar con un sí o un no.
 */
const IGUAL = 30;
const PARECIDO = 80;

/** Distancia entre dos colores, en la línea recta de siempre. */
function distancia(data: Buffer, i: number, r: number, g: number, b: number): number {
  const dr = data[i] - r;
  const dg = data[i + 1] - g;
  const db = data[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Borra el fondo conectado con el marco de la imagen, en el sitio.
 *
 * El color de fondo se deduce del propio marco. Si el marco no es de un color
 * parejo —una foto de una moneda encima de una mesa— no se toca nada: es
 * preferible dejar la foto como está que comerse media moneda.
 */
function recortarFondo(data: Buffer, ancho: number, alto: number): void {
  // Si ya viene con transparencia, el que la hizo sabía lo que quería.
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return;
  }

  const marco: number[] = [];
  for (let x = 0; x < ancho; x++) {
    marco.push((0 * ancho + x) * 4, ((alto - 1) * ancho + x) * 4);
  }
  for (let y = 0; y < alto; y++) {
    marco.push((y * ancho) * 4, (y * ancho + ancho - 1) * 4);
  }
  if (marco.length === 0) return;

  let r = 0;
  let g = 0;
  let b = 0;
  for (const i of marco) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  r = Math.round(r / marco.length);
  g = Math.round(g / marco.length);
  b = Math.round(b / marco.length);

  // Marco de más de un color: no hay un fondo que quitar.
  const dispares = marco.filter((i) => distancia(data, i, r, g, b) > PARECIDO).length;
  if (dispares > marco.length * 0.1) return;

  /*
   * Relleno desde el marco hacia dentro. La pila es de índices de píxel, no de
   * objetos {x,y}: son cientos de miles de posiciones y crear un objeto por
   * cada una es lo que convierte esto en lento.
   */
  const visitado = new Uint8Array(ancho * alto);
  const pila: number[] = [];

  const encolar = (p: number) => {
    if (visitado[p]) return;
    if (distancia(data, p * 4, r, g, b) > PARECIDO) return;
    visitado[p] = 1;
    pila.push(p);
  };

  for (const i of marco) encolar(i / 4);

  while (pila.length > 0) {
    const p = pila.pop()!;
    const d = distancia(data, p * 4, r, g, b);
    // Fondo puro fuera; el filo de la moneda se queda a medias, que es lo que
    // le quita la sierra al contorno.
    data[p * 4 + 3] = d <= IGUAL ? 0 : Math.round(255 * ((d - IGUAL) / (PARECIDO - IGUAL)));

    const x = p % ancho;
    const y = (p - x) / ancho;
    if (x > 0) encolar(p - 1);
    if (x < ancho - 1) encolar(p + 1);
    if (y > 0) encolar(p - ancho);
    if (y < alto - 1) encolar(p + ancho);
  }
}
