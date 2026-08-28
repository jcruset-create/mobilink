/**
 * Envíos entre plataformas — punto de entrada del módulo.
 *
 * Se integra en el servidor monolítico con tres líneas, igual que Connect Pro
 * y el Integration Hub:
 *
 *   import { createDispatchRouter, initDispatch, startDispatchWorker } from "./dispatch/index.ts";
 *   app.use("/api/dispatch", createDispatchRouter(requireSupervisorRole));
 *   await initDispatch();  // tras initDb();  luego startDispatchWorker()
 */

import { initDispatch } from "./schema.ts";
import { createDispatchRouter } from "./router.ts";
import { reintentarPendientes } from "./servicio.ts";

export { initDispatch, createDispatchRouter };
export * from "./estados.ts";

const CADA_MS = 60_000;
let temporizador: NodeJS.Timeout | null = null;

/**
 * Reintenta los envíos que quedaron en ERROR.
 *
 * Existe porque un fallo de red no puede depender de que alguien se acuerde de
 * volver a pulsar el botón: la asistencia ya está subcontratada en la cabeza
 * de quien la mandó, y el sistema tiene que insistir por su cuenta. La espera
 * entre intentos crece sola, así que un destino caído no recibe una tanda de
 * llamadas cada minuto.
 */
export function startDispatchWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    reintentarPendientes().catch((e) =>
      console.error("[Dispatch] error en el reintento periódico:", e?.message),
    );
  }, CADA_MS);
  // No mantiene vivo el proceso por sí solo: si el servidor se está apagando,
  // que se apague.
  temporizador.unref?.();
  console.log("Envíos externos: worker de reintentos activo (cada 60 s)");
}

export function stopDispatchWorker(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
