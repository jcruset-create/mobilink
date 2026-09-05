/**
 * Punto de entrada de Mobilink Cash.
 *
 * Misma forma que `server/integration-hub/index.ts`: init del esquema, montaje
 * del router y arranque del worker, para que `server/index.ts` solo tenga que
 * llamar a tres funciones y no conozca las interioridades del módulo.
 */

import type { Express } from "express";
import { initCash } from "./schema.ts";
import { createAutoScanMachineRouter, createCashRouter } from "./router.ts";
import { registrarVerificador, verificadorSupabase } from "./reauth.ts";
import { startCashErpWorker, stopCashErpWorker } from "./erp/worker.ts";
import { startCashEventWorker } from "./events/worker.ts";
import { arrancarWorkerAutoScan, pararWorkerAutoScan } from "./autoscan/worker.ts";
import { registrarComprobadorDeLicencia } from "./autoscan/devices.ts";
import { licenciaActiva } from "../core/auth.ts";

export {
  initCash,
  startCashErpWorker,
  stopCashErpWorker,
  startCashEventWorker,
  arrancarWorkerAutoScan,
  pararWorkerAutoScan,
};

export function mountCash(app: Express): void {
  // El verificador real solo se registra al montar de verdad: las pruebas
  // enchufan el suyo y no necesitan Supabase.
  registrarVerificador(verificadorSupabase());
  /*
   * Quien decide si una empresa puede usar el módulo por la vía de máquina. Es
   * la MISMA respuesta que da `requireModule("cash")` a las personas: un
   * escáner no puede seguir subiendo facturas de una empresa que no ha
   * renovado.
   */
  registrarComprobadorDeLicencia((empresaId) => licenciaActiva(empresaId, "cash"));

  /*
   * El de máquina ANTES que el de personas, y sobre el mismo prefijo.
   *
   * `createCashRouter` aplica `authenticate` a todo lo suyo, así que un escáner
   * —que no tiene sesión de Supabase— se comía un 401 antes de que nadie
   * mirara su credencial. Express prueba los routers en orden: aquí caen las
   * tres rutas de AutoScan y todo lo demás sigue hasta el de siempre.
   */
  app.use("/api/cash", createAutoScanMachineRouter());
  app.use("/api/cash", createCashRouter());
  /*
   * El que analiza lo que va dejando AutoScan. Se arranca al montar y no en el
   * arranque del servidor porque sin la API montada no hay quien deje nada.
   */
  arrancarWorkerAutoScan();
  console.log("Mobilink Cash: API montada en /api/cash");
}
