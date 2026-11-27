/**
 * El fondo de la foto del empleado: todas con el mismo, el de la empresa.
 *
 * ## Qué se hace y qué NO
 *
 * Se RECORTA a la persona —un modelo dice, píxel a píxel, qué es persona y qué
 * es fondo— y se pega tal cual sobre la imagen del fondo. La cara y la ropa
 * que salen son los píxeles de la foto que se hizo: no se redibuja nada.
 *
 * Lo que no se hace es pedirle a una IA generativa que «cambie el fondo»: esa
 * vuelve a pintar la foto entera y puede retocar la cara. En la foto de una
 * ficha, eso no.
 *
 * ## Aquí no hay modelo
 *
 * Este fichero es puro salvo por `sharp`: quien dice dónde está la persona es
 * una función que llega de fuera (`Silueta`). En producción es el modelo de
 * `fotoSilueta.ts`; en las pruebas, una cualquiera.
 *
 * ## Cuando no se fía
 *
 * Si la silueta no tiene pinta de persona (casi nada, casi todo, o no cubre la
 * cara que se había localizado), no se toca la foto. Una foto con su fondo de
 * siempre es mejor que una con media cara borrada.
 */

import sharp from "sharp";

import type { Caja } from "./fotoNormalizar.ts";

/** El lado, en píxeles, de lo que mira el modelo. */
export const LADO_SILUETA = 256;

/**
 * Dónde está la persona.
 *
 * @param rgb  la foto en crudo, `LADO_SILUETA` × `LADO_SILUETA`, 3 canales
 * @returns    cuánto es persona cada píxel, de 0 (fondo) a 255 (persona), en
 *             el mismo tamaño; `null` si no se puede saber
 */
export type Silueta = (rgb: Buffer) => Promise<Uint8Array | null>;

export type FondoDeFoto = {
  silueta: Silueta;
  /** La imagen del fondo ya cuadrada y al tamaño pedido. */
  imagen: (lado: number) => Promise<Buffer>;
};

/** Menos que esto de persona: ahí no hay nadie. Más: no se ha distinguido el fondo. */
const COBERTURA_MINIMA = 0.08;
const COBERTURA_MAXIMA = 0.97;
/** La cara que se localizó tiene que caer dentro de la silueta. */
const CARA_CUBIERTA = 0.6;

/**
 * Qué parte de un recuadro (en proporciones) es persona, de 0 a 1.
 *
 * Se cuentan píxeles que son persona, no la media: en una foto sin nadie el
 * modelo da a todo un «puede que un poco» que, promediado, parecería una
 * persona pequeña.
 */
function cobertura(alfa: Uint8Array, zona: Caja = { x: 0, y: 0, w: 1, h: 1 }): number {
  const L = LADO_SILUETA;
  const x0 = Math.max(0, Math.floor(zona.x * L));
  const y0 = Math.max(0, Math.floor(zona.y * L));
  const x1 = Math.min(L, Math.ceil((zona.x + zona.w) * L));
  const y1 = Math.min(L, Math.ceil((zona.y + zona.h) * L));
  let suma = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (alfa[y * L + x] > 128) suma += 1;
      n += 1;
    }
  }
  return n === 0 ? 0 : suma / n;
}

/** ¿Parece la silueta de una persona? */
export function siluetaCreible(alfa: Uint8Array, cara?: Caja | null): boolean {
  if (alfa.length !== LADO_SILUETA * LADO_SILUETA) return false;
  const total = cobertura(alfa);
  if (total < COBERTURA_MINIMA || total > COBERTURA_MAXIMA) return false;
  if (cara) {
    // El centro de la cabeza, sin los bordes: ahí tiene que haber persona.
    const centro = { x: cara.x + cara.w * 0.25, y: cara.y + cara.h * 0.25, w: cara.w * 0.5, h: cara.h * 0.5 };
    if (cobertura(alfa, centro) < CARA_CUBIERTA) return false;
  }
  return true;
}

/** ¿Toca la persona el borde de arriba de la foto? Entonces tiene el pelo cortado. */
export function tocaArriba(alfa: Uint8Array): boolean {
  let dentro = 0;
  for (let x = 0; x < LADO_SILUETA * 2; x++) if (alfa[x] > 128) dentro += 1;
  return dentro > LADO_SILUETA * 2 * 0.02;
}

/** Lo cerca del fondo que la silueta puede ser medio transparente (en píxeles de la silueta). */
const BORDE_SUAVE = 4;

/**
 * Deja la silueta maciza por dentro y suave solo en el borde.
 *
 * El modelo a veces duda en mitad del cuerpo —un trozo de corbata o de camisa
 * que toma por fondo, o que no tiene claro— y por ahí asomaría el mural, como
 * un agujero o como una mancha. En una foto de busto el fondo de verdad
 * siempre llega hasta el borde de arriba o hasta un lado: lo que no llega (un
 * hueco cerrado, o uno que solo toca el borde de abajo, donde está el cuerpo)
 * es persona. Y lo que es persona solo puede ser medio transparente pegado al
 * fondo de verdad, que es donde está el contorno del pelo y de los hombros.
 */
export function taparHuecos(alfa: Uint8Array): Uint8Array {
  const L = LADO_SILUETA;
  const esFondo = (i: number) => alfa[i] < 128;
  // El fondo de verdad: el que se alcanza desde arriba o desde los lados.
  const alcanzado = new Uint8Array(L * L);
  const pila: number[] = [];
  const sembrar = (i: number) => {
    if (!alcanzado[i] && esFondo(i)) {
      alcanzado[i] = 1;
      pila.push(i);
    }
  };
  for (let x = 0; x < L; x++) sembrar(x);
  for (let y = 0; y < L; y++) {
    sembrar(y * L);
    sembrar(y * L + L - 1);
  }
  while (pila.length > 0) {
    const i = pila.pop()!;
    const x = i % L;
    if (x > 0) sembrar(i - 1);
    if (x < L - 1) sembrar(i + 1);
    if (i >= L) sembrar(i - L);
    if (i < L * (L - 1)) sembrar(i + L);
  }

  // Qué queda cerca de ese fondo (en horizontal y luego en vertical).
  const enFila = new Uint8Array(L * L);
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      for (let d = -BORDE_SUAVE; d <= BORDE_SUAVE && !enFila[y * L + x]; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < L && alcanzado[y * L + xx]) enFila[y * L + x] = 1;
      }
    }
  }
  const maciza = Uint8Array.from(alfa);
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      const i = y * L + x;
      if (alcanzado[i]) continue;
      let cerca = false;
      for (let d = -BORDE_SUAVE; d <= BORDE_SUAVE && !cerca; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < L && enFila[yy * L + x]) cerca = true;
      }
      // Lejos del fondo, o un hueco: persona del todo.
      if (!cerca || esFondo(i)) maciza[i] = 255;
    }
  }
  return maciza;
}

/**
 * Pega a la persona de un cuadro sobre el fondo.
 *
 * @param cuadro  la foto ya cuadrada (el recorte de la normalización)
 * @param cara    dónde está la cabeza dentro del cuadro, si se sabe
 * @param bajar   píxeles (sobre `lado`) que conviene bajar a la persona para
 *                que la cabeza quede a su altura de siempre. Pasa cuando en la
 *                foto original sale pegada al borde de arriba: ahora que hay
 *                fondo con el que rellenar, se puede. Solo se baja si no tiene
 *                la cabeza cortada; una cabeza cortada, bajada, enseña el corte.
 * @returns       el JPEG con el fondo puesto, o `null` si la silueta no es de fiar
 */
export async function ponerFondo(
  cuadro: Buffer,
  fondo: FondoDeFoto,
  opciones: { lado: number; cara?: Caja | null; bajar?: number }
): Promise<Buffer | null> {
  const lado = opciones.lado;
  const rgb = await sharp(cuadro).resize(lado, lado, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const paraMirar = await sharp(rgb, { raw: { width: lado, height: lado, channels: 3 } })
    .resize(LADO_SILUETA, LADO_SILUETA, { fit: "fill" })
    .raw()
    .toBuffer();

  const vista = await fondo.silueta(paraMirar);
  if (!vista || !siluetaCreible(vista, opciones.cara)) return null;
  const alfa = taparHuecos(vista);

  // La silueta sale a 256: se amplía al tamaño de la foto y se le afila el
  // borde, que si no queda un halo del fondo viejo alrededor del pelo.
  const mascara = await sharp(Buffer.from(alfa), { raw: { width: LADO_SILUETA, height: LADO_SILUETA, channels: 1 } })
    .resize(lado, lado, { kernel: "cubic", fit: "fill" })
    .blur(0.7)
    .linear(1.5, -64)
    // Un solo canal, pase lo que pase por el camino: con tres, al unirla a la
    // foto como transparencia sale rayada.
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then((m) => {
      if (m.info.channels !== 1) throw new Error("la silueta no ha quedado en un canal");
      return m.data;
    });

  const bajar = Math.max(0, Math.min(Math.round(opciones.bajar ?? 0), lado - 1));
  const dy = bajar > 0 && !tocaArriba(alfa) ? bajar : 0;

  const persona = await sharp(rgb, { raw: { width: lado, height: lado, channels: 3 } })
    .joinChannel(mascara, { raw: { width: lado, height: lado, channels: 1 } })
    // Al bajarla, lo que sobra por abajo se queda fuera.
    .extract({ left: 0, top: 0, width: lado, height: lado - dy })
    .png()
    .toBuffer();

  return sharp(await fondo.imagen(lado))
    .resize(lado, lado, { fit: "cover" })
    .composite([{ input: persona, left: 0, top: dy }])
    // Sin `withMetadata`: ni EXIF ni GPS, como el resto de la normalización.
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}
