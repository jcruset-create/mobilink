/**
 * El modelo que dice dónde está la persona en una foto, y la imagen del fondo.
 *
 * ## El modelo
 *
 * «Selfie Multiclass» de MediaPipe (Google), con licencia Apache 2.0: para
 * cada píxel dice si es fondo, pelo, piel, cara, ropa u otra cosa. Aquí solo
 * interesa una cosa: fondo o no. Va dentro del programa
 * (`recursos/selfie_multiclass_256x256.onnx`, ver `recursos/LEEME.md`) y se
 * ejecuta en el propio servidor: la foto no sale a ningún servicio de fuera y
 * no cuesta nada por foto.
 *
 * Se ejecuta con `onnxruntime-web` (WebAssembly), no con la versión nativa: va
 * igual en Render, en la CI y en un Windows, sin binarios por plataforma ni
 * pasos de instalación. Tarda medio segundo por foto, que aquí sobra.
 *
 * Ese medio segundo el servidor no atiende otra cosa (el cálculo va en el
 * mismo hilo). Con las fotos que se suben aquí —una de vez en cuando— no se
 * nota; si algún día fueran muchas seguidas, habría que llevarlo a un hilo
 * aparte.
 *
 * ## Memoria
 *
 * El modelo cargado ocupa unos 230 MB. Se carga la primera vez que hace falta
 * y se suelta si pasa un rato sin usarse: las fotos se suben de tarde en
 * tarde, no tiene sentido tenerlo siempre en memoria.
 */

import { readFileSync } from "node:fs";

import * as ort from "onnxruntime-web";
import sharp from "sharp";

import { LADO_SILUETA, type FondoDeFoto, type Silueta } from "./fotoFondo.ts";

const MODELO = new URL("./recursos/selfie_multiclass_256x256.onnx", import.meta.url);
const FONDO = new URL("./recursos/fondo-foto.jpg", import.meta.url);

/** Clases que da el modelo por píxel; la primera es «fondo». */
const CLASES = 6;

/** Sin usarse este rato, el modelo se suelta. */
const SOLTAR_TRAS_MS = 10 * 60_000;

let sesion: Promise<ort.InferenceSession> | null = null;
let reloj: ReturnType<typeof setTimeout> | null = null;
/** De una en una: es una sola sesión y cada foto la ocupa medio segundo. */
let cola: Promise<unknown> = Promise.resolve();

function abrir(): Promise<ort.InferenceSession> {
  if (!sesion) {
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    sesion = ort.InferenceSession.create(new Uint8Array(readFileSync(MODELO)), { logSeverityLevel: 3 }).catch((e) => {
      // Que un fallo al cargar no deje la sesión rota para siempre.
      sesion = null;
      throw e;
    });
  }
  if (reloj) clearTimeout(reloj);
  reloj = setTimeout(() => void soltarModelo(), SOLTAR_TRAS_MS);
  reloj.unref?.();
  return sesion;
}

/** Suelta el modelo de la memoria. La siguiente foto lo vuelve a cargar. */
export async function soltarModelo(): Promise<void> {
  const abierta = sesion;
  sesion = null;
  if (reloj) clearTimeout(reloj);
  reloj = null;
  if (!abierta) return;
  try {
    // Tras lo que haya en marcha: no se le quita el modelo a una foto a medias.
    await cola.catch(() => {});
    await (await abierta).release();
  } catch {
    // Si no se pudo cargar, no hay nada que soltar.
  }
}

/** Lo que da el modelo (seis números por píxel) → cuánto es persona (0 a 255). */
export function personaDeClases(clases: ArrayLike<number>): Uint8Array {
  const n = LADO_SILUETA * LADO_SILUETA;
  const alfa = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * CLASES;
    let maximo = -Infinity;
    for (let c = 0; c < CLASES; c++) if (clases[i + c] > maximo) maximo = clases[i + c];
    let suma = 0;
    for (let c = 0; c < CLASES; c++) suma += Math.exp(clases[i + c] - maximo);
    const fondo = Math.exp(clases[i] - maximo) / suma;
    alfa[p] = Math.round((1 - fondo) * 255);
  }
  return alfa;
}

export const siluetaConModelo: Silueta = (rgb) => {
  const turno = cola.then(async () => {
    const s = await abrir();
    const entrada = new Float32Array(LADO_SILUETA * LADO_SILUETA * 3);
    for (let i = 0; i < entrada.length; i++) entrada[i] = rgb[i] / 255;
    const salida = await s.run({
      [s.inputNames[0]]: new ort.Tensor("float32", entrada, [1, LADO_SILUETA, LADO_SILUETA, 3]),
    });
    return personaDeClases(salida[s.outputNames[0]].data as Float32Array);
  });
  cola = turno.catch(() => {});
  return turno;
};

/* ── La imagen del fondo ─────────────────────────────────────────────────── */

const fondos = new Map<number, Promise<Buffer>>();

/**
 * El mural de la empresa, al tamaño pedido.
 *
 * Va un poco suavizado, como sale una pared en una foto hecha delante de ella:
 * la persona destaca y el logo se sigue leyendo.
 */
export function imagenDeFondo(lado: number): Promise<Buffer> {
  let listo = fondos.get(lado);
  if (!listo) {
    listo = sharp(readFileSync(FONDO)).resize(lado, lado, { fit: "cover" }).blur(1.6).png().toBuffer();
    listo.catch(() => fondos.delete(lado));
    fondos.set(lado, listo);
  }
  return listo;
}

/** El fondo de verdad: el modelo y el mural. */
export const fondoCorporativo: FondoDeFoto = { silueta: siluetaConModelo, imagen: imagenDeFondo };

/**
 * ¿Se pone el fondo? Sí, salvo que se apague con `CORE_FOTO_FONDO=0`: es el
 * interruptor por si en producción diera guerra, sin tener que desplegar.
 */
export const fondoActivo = (): boolean => process.env.CORE_FOTO_FONDO !== "0";
