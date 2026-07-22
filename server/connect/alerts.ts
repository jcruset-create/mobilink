/**
 * Connect Pro — alertas internas del centro de control.
 * Se generan automáticamente (fallo de asignación, oferta expirada,
 * SLA, incidencia crítica, webhook muerto) y alimentan la campana del
 * backoffice vía SSE.
 */

import db from "../db.ts";
import { publish } from "./bus.ts";

export async function createAlert(opts: {
  type: string;
  severity?: "info" | "warning" | "critical";
  title: string;
  body?: string;
  assistanceId?: number | null;
  workshopId?: number | null;
  incidentId?: number | null;
}): Promise<void> {
  try {
    const r = await db.query(
      `INSERT INTO connect_alerts (type, severity, title, body, "assistanceId", "workshopId", "incidentId", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        opts.type, opts.severity ?? "warning", opts.title, opts.body ?? null,
        opts.assistanceId ?? null, opts.workshopId ?? null, opts.incidentId ?? null, Date.now(),
      ],
    );
    publish({ kind: "alert", alertId: r.rows[0].id, type: opts.type, severity: opts.severity ?? "warning", title: opts.title });
  } catch (err: any) {
    console.error("[Connect] createAlert:", err?.message);
  }
}
