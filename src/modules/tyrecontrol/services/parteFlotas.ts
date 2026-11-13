/**
 * El parte de papel «PROGRAMA MANTENIMIENTO INTEGRAL FLOTAS».
 *
 * Es el impreso de Truck Service Confort Auto / Grupo Soledad con el que Plana
 * hace las revisiones a mano: una hoja por vehículo, filas POS 1..8 + R, y al
 * pie seis croquis de ejes con su casilla para marcar cuál es.
 *
 * Aquí vive lo único que no es transcribir: QUÉ RUEDA del vehículo es la fila
 * número 4 del papel. El modelo que lee el PDF copia números; decidir a qué
 * neumático corresponden es una decisión que se puede equivocar en silencio, y
 * por eso está aquí, en código puro y con pruebas, y no dentro del prompt.
 *
 * ── Por qué NO sirve `numeracionDelProveedor` ──────────────────────────────
 *
 * Ese es el otro impreso, el de Comercial Sea, y numera distinto de dos
 * maneras. Reutilizarlo habría parecido lo correcto y habría movido medidas de
 * rueda sin dar un solo error:
 *
 *   · Aquél numera con CUADRÍCULA: cada eje trasero se lleva cuatro huecos los
 *     ocupe o no, así que en un autocar de ocho ruedas la última es la 10. Este
 *     impreso numera CONSECUTIVO —su croquis C2-4-2 está impreso «1 2 / 3 4 5 6
 *     / 7 8»— y además la tabla solo tiene ocho filas, así que una rueda 10 no
 *     cabría.
 *
 *   · Aquél ordena cada eje trasero por geometría: exterior izquierda, interior
 *     izquierda, interior derecha, exterior derecha. Éste pone el INTERIOR
 *     primero en las dos parejas.
 *
 * ── El orden, confirmado por quien rellena el papel ────────────────────────
 *
 * Dentro de cada eje: primero el par izquierdo y luego el derecho; dentro de
 * cada par, primero el interior y después el exterior.
 *
 *     POS 1 → E1_IZQ        POS 5 → E2_DER_INT
 *     POS 2 → E1_DER        POS 6 → E2_DER_EXT
 *     POS 3 → E2_IZQ_INT    POS 7 → E3_IZQ
 *     POS 4 → E2_IZQ_EXT    POS 8 → E3_DER
 *
 * ── Y esto NO es el `orden_visual` de Mobilink ─────────────────────────────
 *
 * Que es la trampa de todo esto. El `orden_visual` de la base es geométrico
 * —ext, int, int, ext— así que en el par IZQUIERDO los dos van cruzados:
 *
 *     POS 3 = E2_IZQ_INT, que tiene orden_visual 4
 *     POS 4 = E2_IZQ_EXT, que tiene orden_visual 3
 *
 * y en el derecho coinciden. Usar `orden_visual` directamente, que es lo que
 * uno haría sin mirar, habría intercambiado las profundidades de los dos
 * gemelos izquierdos en los 586 autobuses de la flota, sin un solo error en
 * pantalla y sin forma de notarlo después.
 */

/** Lo que hace falta saber de una posición para numerarla como el papel. */
export interface PosicionDelParte {
  id: string;
  codigo_posicion: string;
  eje?: number | null;
  /** `izq` o `der`. */
  lado?: string | null;
  /** `int`, `ext`, o null/vacío en un eje de rueda simple. */
  interior_exterior?: string | null;
}

/** Las filas que tiene el impreso, sin contar la de recambio. */
export const FILAS_DEL_IMPRESO = 8;

/**
 * Las ruedas del vehículo, numeradas como las numera este papel.
 *
 * Devuelve `null` cuando el plano no se puede numerar con seguridad, y eso es
 * una respuesta, no un fallo: más vale que la pantalla diga «este vehículo no
 * lo sé numerar, hazlo a mano» que colocar ocho profundidades casi bien.
 *
 * Se devuelve null si falta el eje o el lado de alguna posición, si un eje
 * tiene gemelos a medias —uno con interior/exterior y otro sin— o si hay más
 * ruedas que filas en el impreso.
 */
export function numeracionDelParteFlotas(
  posiciones: PosicionDelParte[],
): Map<number, PosicionDelParte> | null {
  if (posiciones.length === 0) return null;
  if (posiciones.length > FILAS_DEL_IMPRESO) return null;
  if (posiciones.some((p) => p.eje == null || !ladoDe(p))) return null;

  const porEje = new Map<number, PosicionDelParte[]>();
  for (const p of posiciones) {
    const e = p.eje as number;
    porEje.set(e, [...(porEje.get(e) ?? []), p]);
  }

  const mapa = new Map<number, PosicionDelParte>();
  let n = 0;

  for (const eje of [...porEje.keys()].sort((a, b) => a - b)) {
    const ruedas = porEje.get(eje) as PosicionDelParte[];
    const gemelas = ruedas.filter((r) => dentroFuera(r) !== null).length;
    // O todas gemelas o ninguna. Un eje con una sola rueda marcada
    // «interior» es un plano a medio rellenar, y adivinarlo sería inventar.
    if (gemelas !== 0 && gemelas !== ruedas.length) return null;
    if (gemelas === 0 && ruedas.length !== 2) return null;
    if (gemelas !== 0 && ruedas.length !== 4) return null;

    for (const rueda of [...ruedas].sort(comparar)) mapa.set(++n, rueda);
  }

  return mapa;
}

/** `izq` / `der`, normalizado. Cadena vacía si no se sabe. */
function ladoDe(p: PosicionDelParte): string {
  const l = (p.lado ?? "").trim().toLowerCase();
  return l === "izq" || l === "der" ? l : "";
}

/** `int` / `ext`, o `null` en una rueda simple. */
function dentroFuera(p: PosicionDelParte): string | null {
  const v = (p.interior_exterior ?? "").trim().toLowerCase();
  return v === "int" || v === "ext" ? v : null;
}

/** Izquierda antes que derecha; dentro de cada par, interior antes que exterior. */
function comparar(a: PosicionDelParte, b: PosicionDelParte): number {
  if (ladoDe(a) !== ladoDe(b)) return ladoDe(a) === "izq" ? -1 : 1;
  const da = dentroFuera(a);
  const db = dentroFuera(b);
  if (da === db) return 0;
  return da === "int" ? -1 : 1;
}

/**
 * El croquis del impreso que le corresponde a este vehículo.
 *
 * Se calcula desde el plano que ya tiene Mobilink, que es el dato fiable, y
 * sirve para CONTRASTAR con la casilla marcada a mano: en 8 de los 14 partes
 * de la muestra la X está puesta fuera de su recuadro —encima del grupo, entre
 * dos, o al margen— así que lo que diga el modelo sobre esa marca vale menos
 * que lo que dice la ficha del vehículo.
 *
 * `C` y `R` son las dos familias del impreso: la C lleva recambio dibujado y
 * la R no. Como del plano no se deduce si el vehículo lleva recambio, se
 * devuelve solo la parte de los ejes («2-4», «2-4-2») y la comparación se hace
 * sobre eso.
 */
export function ejesDelPlano(posiciones: PosicionDelParte[]): string | null {
  const numerada = numeracionDelParteFlotas(posiciones);
  if (!numerada) return null;

  const porEje = new Map<number, number>();
  for (const p of posiciones) {
    const e = p.eje as number;
    porEje.set(e, (porEje.get(e) ?? 0) + 1);
  }
  return [...porEje.keys()].sort((a, b) => a - b).map((e) => porEje.get(e)).join("-");
}

/**
 * ¿Lo que dice la casilla marcada cuadra con el vehículo?
 *
 * Devuelve el aviso a enseñar, o `null` si cuadra o si no hay con qué comparar.
 * NO bloquea: manda el plano del vehículo, y la marca del papel solo sirve
 * para avisar de que quizá la hoja es de otro camión.
 */
export function discrepanciaDeCroquis(
  posiciones: PosicionDelParte[],
  croquisLeido: string | null | undefined,
): string | null {
  const leido = (croquisLeido ?? "").trim().toUpperCase();
  if (!leido) return null;
  const esperado = ejesDelPlano(posiciones);
  if (!esperado) return null;

  // «C2-4» y «R2-2» traen delante la familia; se compara solo la parte de ejes.
  const ejesLeidos = leido.replace(/^[CR]/, "");
  if (ejesLeidos === esperado) return null;
  return `El papel marca ${leido} y este vehículo tiene ejes de ${esperado.replace(/-/g, "+")} ruedas.`
    + " Comprueba que la hoja es de este vehículo.";
}

// ── Lo que el modelo transcribe, puesto en limpio ───────────────────────────

/** Una fila de la tabla, tal cual está escrita en el papel. */
export interface FilaLeidaFlotas {
  pos: number | null;
  medida: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  fecha_dot: string | null;
  profundidad_mm: number | null;
}

/** Las columnas donde el papel usa comillas de «ídem». */
const HEREDABLES = ["medida", "marca", "modelo"] as const;

/**
 * ¿Esta celda son comillas de «lo mismo que arriba»?
 *
 * En los 14 partes se usan en las tres primeras columnas, y una comilla
 * manuscrita no siempre sale como comilla: según la letra y el escaneo, un
 * modelo puede leerla como `u`, `n`, `v` o `,`.
 *
 * ── Dónde se pone la raya, y por qué ahí ───────────────────────────────────
 *
 * Se le pide al modelo que las transcriba como `"` (ver las instrucciones del
 * lector), así que esto es la red de seguridad para cuando no lo haga. Y la
 * red se queda CORTA a propósito: equivocarse hacia un lado deja un `4` raro
 * en la casilla, que se ve; equivocarse hacia el otro copia la fila de arriba
 * en silencio y nadie lo nota nunca.
 *
 * Por eso NO cuenta como comilla nada que lleve un dígito ni nada en
 * mayúsculas: `4`, `XL` o `AH51` se quedan como están aunque sean una comilla
 * mal leída. Prefiero una celda visiblemente rara a una medida inventada.
 */
const COMILLAS = /^[\s"'`,´’‘“”]{1,2}$/;
/** Las minúsculas en que suele caer una comilla manuscrita al leerla. */
const COMILLA_MAL_LEIDA = /^[unvwil]{1,2}$/;

export function esIdem(celda: string | null | undefined): boolean {
  const t = (celda ?? "").trim();
  if (!t) return false;
  if (/^(id\.?|idem|ídem)$/i.test(t)) return true;
  return COMILLAS.test(t) || COMILLA_MAL_LEIDA.test(t);
}

/**
 * Rellenar hacia abajo las comillas de «ídem».
 *
 * Se hace aquí y no en el prompt a propósito: pedirle al modelo que «copie el
 * valor de arriba» es pedirle que razone sobre filas que todavía no ha
 * terminado de leer, y cuando se equivoca no se nota. Transcribir la comilla
 * tal cual es verificable; resolverla es una regla de tres líneas.
 *
 * Una comilla en la PRIMERA fila no hereda nada y se queda en null: no hay de
 * dónde copiar, y poner algo sería inventarlo.
 *
 * No toca `numero_serie`, `fecha_dot` ni `profundidad_mm`: ésas no se heredan
 * nunca. Dos ruedas distintas no comparten número de serie, y una profundidad
 * repetida se escribe con su número —en los 14 partes siempre está escrita—.
 */
export function resolverIdem(filas: FilaLeidaFlotas[]): FilaLeidaFlotas[] {
  const ultimo: Record<string, string | null> = {};
  return filas.map((fila) => {
    const salida = { ...fila };
    for (const campo of HEREDABLES) {
      const valor = salida[campo];
      if (esIdem(valor)) {
        salida[campo] = ultimo[campo] ?? null;
      } else if ((valor ?? "").trim()) {
        ultimo[campo] = (valor as string).trim();
        salida[campo] = ultimo[campo];
      }
    }
    return salida;
  });
}

/**
 * ¿Lo que hay en la columna «Nº DE SERIE» es de verdad un número de serie?
 *
 * Hace falta porque en la muestra alguien escribió ahí **«Cambio y alinear»**:
 * la columna más ancha de la hoja se usa como margen para notas. Guardar eso
 * como número de serie de un neumático lo dejaría buscado para siempre por una
 * frase.
 *
 * Un serie no lleva espacios. Lo que los lleve es una nota, y se conserva como
 * tal en vez de tirarse: es algo que alguien quiso decir.
 */
export function pareceNota(texto: string | null | undefined): boolean {
  const t = (texto ?? "").trim();
  return t.length > 0 && /\s/.test(t);
}

/**
 * Las filas que traen algo, ya con las comillas resueltas.
 *
 * El impreso tiene ocho filas y casi nunca van todas: de los 14 partes, seis
 * traen seis filas, seis traen ocho y dos traen cuatro. Una fila vacía no es
 * una rueda sin medir, es una fila que no existe en ese vehículo.
 *
 * Se considera que una fila trae algo si tiene profundidad O identificación.
 * La profundidad sola basta —es el dato que se viene a buscar— y la
 * identificación sola también: una goma reconocida sin medir sigue siendo una
 * goma que el sistema no tenía.
 */
export function filasConDatos(filas: FilaLeidaFlotas[]): FilaLeidaFlotas[] {
  return resolverIdem(filas).filter((f) =>
    f.profundidad_mm != null
    || (f.medida ?? "").trim() !== ""
    || (f.marca ?? "").trim() !== ""
    || (f.modelo ?? "").trim() !== "");
}
