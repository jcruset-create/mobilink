/**
 * La foto de un empleado, normalizada: todas iguales.
 *
 * Llegue como llegue —vertical, apaisada, de lejos, girada, de 12 megapíxeles—
 * sale un JPEG cuadrado de 600 px con la cabeza centrada y del mismo tamaño
 * que en las demás. Es lo que permite ponerlas en una lista, en una ficha o en
 * la tele del taller sin que una parezca un carnet y la otra una foto de boda.
 *
 * ## Cómo
 *
 * 1. Se pone derecha (orientación EXIF) y se baja de tamaño.
 * 2. Alguien dice dónde está la cabeza: `localizar`, que en producción es la
 *    IA (`fotoEmpleado.ts`) y en las pruebas una función cualquiera. Aquí no
 *    se sabe nada de IA: este fichero es puro salvo por `sharp`.
 * 3. Se recorta un cuadrado alrededor, con la cabeza ocupando siempre la
 *    misma parte, y se guarda sin metadatos. Un móvil apunta en la foto dónde
 *    se hizo (GPS) y con qué; eso no tiene por qué acabar en una ficha.
 *
 * ## Qué se rechaza y qué solo se avisa
 *
 * Se RECHAZA lo que no tiene arreglo: que no haya ninguna cara o que haya más
 * de una. Hay que repetirla.
 *
 * Lo dudoso —gafas de sol, poca luz, muy lejos— se guarda y se AVISA. La
 * foto es obligatoria para terminar el alta, y un modelo que se pone
 * exigente no puede dejar a un trabajador sin poder mandarla; quien revisa
 * el alta ve la foto en la ficha y puede pedir otra.
 *
 * Si nadie sabe decir dónde está la cabeza (sin IA, o falla), se recorta al
 * centro: peor encuadre, pero hay foto.
 *
 * ## El fondo
 *
 * Si se pasa un `fondo`, a la persona se la recorta y se la pega sobre él
 * (`fotoFondo.ts`): todas las fotos con el mismo fondo, el de la empresa. Si
 * el recorte no es de fiar, o falla, la foto se queda con su fondo: nunca se
 * deja a nadie sin foto por esto.
 */

import sharp from "sharp";

import { ponerFondo, type FondoDeFoto } from "./fotoFondo.ts";

/** Lado, en píxeles, de todas las fotos. */
export const LADO_FOTO = 600;

/** La parte del alto de la foto que ocupa la cabeza (de la coronilla a la barbilla). */
const CABEZA_EN_FOTO = 0.5;
/** Dónde queda el centro de la cabeza, de arriba abajo: algo por encima del medio, para que quepan los hombros. */
const CENTRO_CABEZA = 0.44;

/** Por debajo de esto el recorte sale borroso al ampliarlo a 600. */
const LADO_MINIMO_RECORTE = 240;

/** Un recuadro en proporciones de la foto: de 0 a 1. */
export type Caja = { x: number; y: number; w: number; h: number };

/** Lo que dice quien mira la foto. */
export type Mirada = {
  /** Cuántas caras de persona se ven. */
  caras: number;
  /** El recuadro de la CABEZA de la persona, si hay una. */
  cara: Caja | null;
  /** La cara se ve entera, enfocada, con luz y sin nada que la tape. */
  seVeBien: boolean;
  /** Si no se ve bien, por qué, en una frase para la persona. */
  motivo: string;
};

export type Localizador = (jpeg: Buffer) => Promise<Mirada | null>;

export type Recorte = { left: number; top: number; size: number };

export function cajaValida(c: Caja | null | undefined): c is Caja {
  if (!c) return false;
  const n = [c.x, c.y, c.w, c.h];
  if (!n.every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  return c.w > 0.02 && c.h > 0.02 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1.001 && c.y + c.h <= 1.001;
}

/** El cuadrado más grande que cabe, al centro. Para cuando no se sabe dónde está la cara. */
export function recorteCentral(ancho: number, alto: number): Recorte {
  const size = Math.min(ancho, alto);
  return { left: Math.floor((ancho - size) / 2), top: Math.floor((alto - size) / 2), size };
}

/**
 * El cuadrado alrededor de la cabeza: siempre con la misma proporción.
 *
 * Si la persona está tan cerca del borde que el cuadrado ideal se sale, se
 * arrima hacia dentro; y si ni así cabe (la cabeza llena la foto), se usa el
 * cuadrado más grande posible. Mejor una cabeza algo grande que una franja
 * negra.
 */
export function recorteDeCara(cara: Caja, ancho: number, alto: number): Recorte {
  const cabezaPx = cara.h * alto;
  const size = Math.max(1, Math.min(Math.round(cabezaPx / CABEZA_EN_FOTO), ancho, alto));
  const cx = (cara.x + cara.w / 2) * ancho;
  const cy = (cara.y + cara.h / 2) * alto;
  const dentro = (v: number, max: number) => Math.max(0, Math.min(Math.round(v), max));
  return {
    left: dentro(cx - size / 2, ancho - size),
    top: dentro(cy - size * CENTRO_CABEZA, alto - size),
    size,
  };
}

export type Juicio = {
  /** No vale: hay que repetirla. */
  rechazo: string | null;
  /** Vale, pero conviene repetirla. */
  aviso: string | null;
  cara: Caja | null;
};

/** De lo que se ha visto en la foto a qué se hace con ella. */
export function juzgar(mirada: Mirada | null): Juicio {
  // Nadie ha podido mirar: ni se rechaza ni se avisa, se recorta al centro.
  if (!mirada) return { rechazo: null, aviso: null, cara: null };
  if (mirada.caras <= 0) {
    return { rechazo: "No se ve ninguna cara en la foto. Hazla de frente, con la cara dentro del óvalo.", aviso: null, cara: null };
  }
  if (mirada.caras > 1) {
    return { rechazo: "Sale más de una persona. En la foto tienes que salir solo tú.", aviso: null, cara: null };
  }
  const cara = cajaValida(mirada.cara) ? mirada.cara : null;
  const aviso = mirada.seVeBien
    ? null
    : `${(mirada.motivo || "No se te ve bien la cara.").trim().replace(/\.*$/, "")}. Si puedes, repítela.`;
  return { rechazo: null, aviso, cara };
}

/**
 * Qué ha pasado con el fondo:
 *  · `puesto`     — lleva el fondo de la empresa.
 *  · `no_pedido`  — no se pidió cambiarlo.
 *  · `no_fiable`  — no se ha distinguido bien a la persona: se deja como estaba.
 *  · `fallo`      — no se ha podido ni intentar (el modelo no carga…): se deja
 *                   como estaba, y se puede volver a intentar más adelante.
 */
export type EstadoFondo = "puesto" | "no_pedido" | "no_fiable" | "fallo";

export type FotoNormalizada =
  | { ok: true; jpeg: Buffer; aviso: string | null; conCara: boolean; fondo: EstadoFondo }
  | { ok: false; motivo: string };

/** Lo más que se baja a una persona para ponerle la cabeza a su altura. */
const BAJAR_COMO_MUCHO = 0.25;

/**
 * Cuánto hay que bajar a la persona, en proporción del lado, para que la
 * cabeza quede a su altura de siempre.
 *
 * Si en la foto original sale pegada al borde de arriba, el cuadrado ideal se
 * saldría por arriba y `recorteDeCara` lo arrima hacia dentro: la cabeza queda
 * más alta que en las demás. Con fondo eso tiene arreglo —se la baja y el
 * hueco se rellena con fondo—; sin fondo no, que quedaría una franja negra.
 */
export function bajarParaCentrar(cara: Caja, alto: number, recorte: Recorte): number {
  const ideal = (cara.y + cara.h / 2) * alto - recorte.size * CENTRO_CABEZA;
  const falta = (recorte.top - ideal) / recorte.size;
  return Math.max(0, Math.min(falta, BAJAR_COMO_MUCHO));
}

/**
 * @param forzar  aceptarla aunque no se vea una sola cara (lo decide un
 *                administrador desde la ficha, nunca el formulario público)
 * @param fondo   con qué cambiarle el fondo; sin él, se queda con el suyo
 */
export async function normalizarFoto(
  original: Buffer,
  localizar: Localizador | null,
  opciones: { forzar?: boolean; fondo?: FondoDeFoto | null } = {}
): Promise<FotoNormalizada> {
  let derecha: Buffer;
  let ancho: number;
  let alto: number;
  try {
    // `rotate()` sin ángulo aplica la orientación EXIF: a partir de aquí la
    // foto está como se ve, y lo que diga `localizar` vale sobre ella.
    const r = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    derecha = r.data;
    ancho = r.info.width;
    alto = r.info.height;
  } catch {
    return { ok: false, motivo: "No se ha podido leer la foto. Prueba a hacerla otra vez." };
  }
  if (Math.min(ancho, alto) < LADO_MINIMO_RECORTE) {
    return { ok: false, motivo: "La foto es demasiado pequeña. Hazla con la cámara del móvil." };
  }

  let mirada: Mirada | null = null;
  if (localizar) {
    try {
      const paraMirar = await sharp(derecha).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      mirada = await localizar(paraMirar);
    } catch {
      // Sin mirada: se sigue con el recorte al centro.
      mirada = null;
    }
  }

  const juicio = juzgar(mirada);
  if (juicio.rechazo && !opciones.forzar) return { ok: false, motivo: juicio.rechazo };

  const recorte = juicio.cara ? recorteDeCara(juicio.cara, ancho, alto) : recorteCentral(ancho, alto);
  let aviso = juicio.rechazo ? null : juicio.aviso;
  if (juicio.cara && recorte.size < LADO_MINIMO_RECORTE && !aviso) {
    aviso = "Sales muy lejos y la foto queda poco nítida. Si puedes, repítela más de cerca.";
  }

  const cuadro = sharp(derecha).extract({ left: recorte.left, top: recorte.top, width: recorte.size, height: recorte.size });

  let fondo: EstadoFondo = "no_pedido";
  if (opciones.fondo) {
    try {
      // La cabeza, en proporciones del cuadro en vez de las de la foto entera.
      const cara = juicio.cara && {
        x: (juicio.cara.x * ancho - recorte.left) / recorte.size,
        y: (juicio.cara.y * alto - recorte.top) / recorte.size,
        w: (juicio.cara.w * ancho) / recorte.size,
        h: (juicio.cara.h * alto) / recorte.size,
      };
      const conFondo = await ponerFondo(await cuadro.clone().png().toBuffer(), opciones.fondo, {
        lado: LADO_FOTO,
        cara,
        bajar: juicio.cara ? bajarParaCentrar(juicio.cara, alto, recorte) * LADO_FOTO : 0,
      });
      if (conFondo) return { ok: true, jpeg: conFondo, aviso, conCara: juicio.cara !== null, fondo: "puesto" };
      fondo = "no_fiable";
    } catch (e) {
      console.error("[Core foto] no se ha podido cambiar el fondo:", e instanceof Error ? e.message : e);
      fondo = "fallo";
    }
  }

  // Sin `withMetadata`, sharp no copia nada del original: ni EXIF ni GPS.
  const jpeg = await cuadro.resize(LADO_FOTO, LADO_FOTO).jpeg({ quality: 86, mozjpeg: true }).toBuffer();

  return { ok: true, jpeg, aviso, conCara: juicio.cara !== null, fondo };
}
