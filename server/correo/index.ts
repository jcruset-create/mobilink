/**
 * Correo del expediente — punto de entrada del módulo.
 *
 * Se integra igual que los demás: init del esquema, router y un worker.
 */

import type { Express, RequestHandler } from "express";

import db from "../db.ts";
import { initCorreo } from "./schema.ts";
import { createCorreoRouter } from "./router.ts";
import {
  enviarRecordatoriosPendientes,
  programarRecordatorio,
  resolverRecordatoriosPorDocumentos,
  type Sistema,
} from "./servicio.ts";
import { situacionAdministrativa } from "../documentos/servicio.ts";

export { initCorreo, createCorreoRouter };
export * from "./servicio.ts";

export function mountCorreo(app: Express, guardaAssist: RequestHandler): void {
  app.use("/api/correo", createCorreoRouter("assist", guardaAssist));
}

/**
 * Al terminar un servicio: mirar qué documentación falta y programar que se
 * pida.
 *
 * Se llama desde el cambio de estado. No manda nada todavía —de eso se encarga
 * el worker— y es idempotente: llamarlo diez veces deja una fila por motivo.
 *
 * El destinatario sale del taller subcontratado si lo hay, y si no del
 * solicitante. Sin dirección se programa igual: la bandeja de excepciones tiene
 * que poder enseñar «falta el albarán y no sabemos a quién pedírselo», que es
 * un problema real y distinto de «no falta nada».
 */
export async function revisarDocumentacionAlFinalizar(
  system: Sistema,
  assistanceId: string | number,
  tenantId?: string | number | null,
): Promise<string[]> {
  const s = await situacionAdministrativa(system, assistanceId);
  if (s.faltan.length === 0) {
    await resolverRecordatoriosPorDocumentos(system, assistanceId);
    return [];
  }

  const destinatario = await destinatarioDe(system, assistanceId);
  for (const tipo of s.faltan) {
    if (tipo !== "albaran" && tipo !== "factura") continue;
    await programarRecordatorio(system, assistanceId, tipo, destinatario, tenantId);
  }
  return s.faltan;
}

/** A quién se le pide la documentación. */
async function destinatarioDe(system: Sistema, assistanceId: string | number): Promise<string | null> {
  if (system !== "assist") return null;
  const r = await db.query(
    `SELECT COALESCE(w."assistanceEmail", w.email, w."adminEmail") AS "correoTaller",
            a."solicitanteEmpresa"
       FROM roadside_assistances a
       LEFT JOIN connect_workshops w ON w.id = a."proveedorTallerId"
      WHERE a.id = $1`,
    [Number(assistanceId)],
  );
  return r.rows[0]?.correoTaller ?? null;
}

const CADA_MS = 15 * 60_000;
let temporizador: NodeJS.Timeout | null = null;

/**
 * Worker de recordatorios.
 *
 * Cada cuarto de hora, no cada minuto: los recordatorios se miden en días y
 * mirar más a menudo no adelanta ninguno.
 */
export function startCorreoWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    enviarRecordatoriosPendientes().catch((e) =>
      console.error("[Correo] error en los recordatorios:", e?.message),
    );
  }, CADA_MS);
  temporizador.unref?.();
  console.log("Correo del expediente: worker de recordatorios activo (cada 15 min)");
}

export function stopCorreoWorker(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
