/**
 * Trabajos programados de Self Storage.
 *
 * Las tareas críticas no dependen de que alguien tenga el panel abierto: las
 * ejecuta el servidor cada pocos minutos. Producción irá en un servicio de
 * Render que no se duerme (decisión confirmada); en el plan gratuito, al
 * despertar se ponen al día solas porque cada trabajo procesa todo lo vencido.
 *
 * Cada trabajo coge un cerrojo consultivo propio con pg_try_advisory_lock: si
 * otra instancia ya lo está ejecutando, ésta se lo salta (no espera). Todos son
 * idempotentes: ejecutarlos dos veces no duplica facturas, avisos ni bloqueos.
 *
 * SELF_STORAGE_JOBS=0 los desactiva (pruebas, entornos de desarrollo).
 */

import { pool } from "../shared/db.ts";
import { facturarPeriodosManuales } from "../modules/facturas/service.ts";
import { ejecutarImpagos, marcarVencidas } from "../modules/impagos/service.ts";
import { enviarPendientes } from "../modules/notificaciones/service.ts";

export const TRABAJOS = ["facturacion", "vencimientos", "impagos", "notificaciones", "stripe_reintentos", "accesos"] as const;
export type Trabajo = (typeof TRABAJOS)[number];

const CERROJOS: Record<Trabajo, number> = {
  facturacion: 727_002_001,
  vencimientos: 727_002_002,
  impagos: 727_002_003,
  notificaciones: 727_002_004,
  stripe_reintentos: 727_002_005,
  accesos: 727_002_006,
};

async function cuerpo(t: Trabajo): Promise<unknown> {
  switch (t) {
    case "facturacion":
      return facturarPeriodosManuales();
    case "vencimientos":
      return { vencidas: await marcarVencidas() };
    case "impagos":
      return ejecutarImpagos();
    case "notificaciones":
      return enviarPendientes();
    case "accesos": {
      const { trabajoAccesos } = await import("../modules/accesos/sincronizacion.ts");
      return trabajoAccesos();
    }
    case "stripe_reintentos": {
      const { reintentarFallidos } = await import("../integrations/stripe/webhook.ts");
      return { reprocesados: await reintentarFallidos() };
    }
  }
}

export async function ejecutarTrabajo(t: Trabajo): Promise<{ trabajo: Trabajo; ejecutado: boolean; resultado?: unknown }> {
  const c = await pool.connect();
  let cogido = false;
  try {
    const { rows } = await c.query("SELECT pg_try_advisory_lock($1) AS ok", [CERROJOS[t]]);
    cogido = Boolean(rows[0]?.ok);
    if (!cogido) return { trabajo: t, ejecutado: false };
    return { trabajo: t, ejecutado: true, resultado: await cuerpo(t) };
  } finally {
    if (cogido) await c.query("SELECT pg_advisory_unlock($1)", [CERROJOS[t]]).catch(() => {});
    c.release();
  }
}

let temporizador: NodeJS.Timeout | null = null;

export function startSelfStorageJobs(intervaloMs = 5 * 60_000): void {
  if (process.env.SELF_STORAGE_JOBS === "0" || temporizador) return;
  const vuelta = async () => {
    // En este orden: lo que se factura hoy, lo que vence, el impago que avanza
    // y, al final, los avisos que todo lo anterior haya dejado en la bandeja.
    // `accesos` después de `impagos`: una suspensión de hoy llega al dispositivo en la misma vuelta.
    for (const t of ["facturacion", "vencimientos", "impagos", "accesos", "stripe_reintentos", "notificaciones"] as Trabajo[]) {
      try {
        await ejecutarTrabajo(t);
      } catch (e) {
        console.error(`[Self Storage] el trabajo ${t} falló:`, e);
      }
    }
  };
  temporizador = setInterval(() => void vuelta(), intervaloMs);
  temporizador.unref?.();
  setTimeout(() => void vuelta(), 30_000).unref?.();
  console.log("Self Storage: trabajos programados en marcha");
}

export function stopSelfStorageJobs(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
