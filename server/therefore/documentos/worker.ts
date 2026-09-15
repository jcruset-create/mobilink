/**
 * El que va vaciando la cola de análisis.
 *
 * No hay cola genérica en el proyecto y no se estrena una: **la tabla es la
 * cola**, como en `cash/autoscan/worker.ts` y en `cash/erp/worker.ts`. Un
 * temporizador, un lote pequeño y ninguna infraestructura nueva. El día que
 * haga falta algo más serio se cambia aquí, en un solo sitio.
 *
 * ── Por qué el lote es de tres ──────────────────────────────────────────────
 *
 * Porque cada análisis puede acabar en una llamada a la IA, y eso cuesta
 * dinero y tarda. Tres por vuelta y una vuelta cada quince segundos vacían una
 * tanda de correo en minutos sin que nadie note el servidor trabajando.
 *
 * ── Y por qué `procesarPendientes` se exporta ───────────────────────────────
 *
 * Para que las pruebas lo llamen y no tengan que esperar a un temporizador. Una
 * prueba que duerme quince segundos no prueba nada mejor y hace la suite
 * inservible.
 */

import { analizarFila } from "./analisis.ts";
import * as repo from "../repository.ts";

/** Cada cuánto mira si hay trabajo. */
const CADA_MS = 15_000;

/** Cuántos por vuelta. */
const LOTE = 3;

/** Una fila en curso más de esto es de una instancia que se murió. */
const MINUTOS_HUERFANA = 10;

let temporizador: NodeJS.Timeout | null = null;
let enCurso = false;

/**
 * Analiza hasta `lote` pendientes y devuelve cuántos ha hecho.
 *
 * Nunca lanza: un documento roto no puede parar la cola de los demás, y un
 * worker que muere con la primera excepción deja el resto sin analizar sin que
 * nadie se entere.
 */
export async function procesarPendientes(lote = LOTE): Promise<number> {
  let hechos = 0;
  for (let i = 0; i < lote; i++) {
    let fila: repo.AlbaranAnalizado | null = null;
    try {
      fila = await repo.cogerAnalisisPendiente();
    } catch (e) {
      console.error("[Therefore] no se ha podido coger trabajo de la cola:", (e as Error).message);
      break;
    }
    if (!fila) break;
    await analizarFila(fila);
    hechos++;
  }
  return hechos;
}

async function vuelta(): Promise<void> {
  // Sin solapes: una vuelta lenta no puede arrancar la siguiente encima.
  if (enCurso) return;
  enCurso = true;
  try {
    await repo.reencolarHuerfanos(MINUTOS_HUERFANA);
    await procesarPendientes();
  } catch (e) {
    console.error("[Therefore] worker:", (e as Error).message);
  } finally {
    enCurso = false;
  }
}

export function startThereforeWorkers(): void {
  if (temporizador) return;
  temporizador = setInterval(() => void vuelta(), CADA_MS);
  // `unref` para que el temporizador no impida al proceso terminar: es lo que
  // permite que las pruebas y los scripts salgan solos.
  temporizador.unref?.();
}

export function stopThereforeWorkers(): void {
  if (!temporizador) return;
  clearInterval(temporizador);
  temporizador = null;
}
