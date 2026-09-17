/**
 * Punto de entrada del módulo OR Manuales.
 *
 * Misma forma que `server/recepciones/index.ts`: init del esquema, montaje del
 * router y arranque de su vigilancia, para que `server/index.ts` sólo tenga
 * que llamar a tres funciones.
 *
 * ── Qué es este módulo ──────────────────────────────────────────────────────
 *
 * El control del PAPEL. Cuando no hay sistema delante —una avería en ruta, un
 * corte de red, un cliente a pie de calle— el taller escribe la orden de
 * reparación en un bloc. Cada bloc trae 25 OR consecutivas y cada OR ocupa una
 * hoja.
 *
 * Este módulo sabe qué blocs existen, quién se llevó cada uno, cuándo volvió,
 * qué hojas se han escaneado y —lo que de verdad importa— **cuáles faltan**.
 * El escaneo se separa por páginas, se lee el número de cada hoja, se busca su
 * bloc y se archiva sola; la persona sólo interviene en las excepciones.
 *
 * NO gestiona reparaciones ni factura nada: una OR de aquí es una hoja de
 * papel con un número. Enlazarla con la reparación real es una ampliación
 * prevista, no algo que este módulo haga hoy.
 */

import type { Express } from "express";
import { initOrManuales } from "./schema.ts";
import { createOrManualesRouter } from "./router.ts";
import { startOrManualesWorker, stopOrManualesWorker } from "./procesamiento.ts";

export { initOrManuales, startOrManualesWorker, stopOrManualesWorker };

export function mountOrManuales(app: Express): void {
  app.use("/api/or-manuales", createOrManualesRouter());
  console.log("Módulo OR Manuales: API montada en /api/or-manuales");
}
