/**
 * Punto de entrada del módulo Recepciones.
 *
 * Misma forma que `server/therefore/index.ts`: init del esquema y montaje del
 * router, para que `server/index.ts` sólo tenga que llamar a dos funciones.
 *
 * ── Qué es este módulo ──────────────────────────────────────────────────────
 *
 * El control de la RECEPCIÓN FÍSICA de mercancía de proveedores: qué se pidió,
 * qué expidió el proveedor, qué llegó al muelle, quién lo contó y cuándo, con
 * qué resultado, y el albarán recepcionado (el original del proveedor más la
 * hoja del sello) que queda como justificante.
 *
 * NO gestiona existencias. No escribe en `movimientos_stock` ni conoce el
 * saldo de nada: la entrada del albarán en GENES la hace una persona después,
 * a mano, con el papel que sale de aquí.
 */

import type { Express } from "express";
import { initRecepciones } from "./schema.ts";
import { createRecepcionesRouter } from "./router.ts";

export { initRecepciones };

export function mountRecepciones(app: Express): void {
  app.use("/api/recepciones", createRecepcionesRouter());
  console.log("Módulo Recepciones: API montada en /api/recepciones");
}
