/**
 * Las consultas de facturación. Lo que agrupa y formatea está en `billing.ts`,
 * que no toca la base y se puede probar sin ella.
 *
 * El criterio que manda aquí: **una asistencia terminada sin tarifa de cierre
 * no desaparece**. Sale en `pendientesDeCierre()`, que es la lista que hay que
 * mirar antes de facturar un mes. Un `INNER JOIN` con la tabla de tarifas
 * habría dejado esos servicios fuera del listado sin decir nada, y nadie echa
 * de menos una fila que nunca ha visto.
 */

import db from "../../db.ts";
import type { FilaFacturable, LadoFacturacion } from "./billing.ts";

export interface Periodo {
  controlCenterId: number | null;
  desdeMs: number;
  hastaMs: number;
  /** Por defecto se excluye lo que ya salió hacia el ERP. */
  incluirExportadas?: boolean;
}

/**
 * Líneas facturables del periodo.
 *
 * La fecha por la que se filtra es la de la ORDEN DE SALIDA, no la de creación
 * ni la del cierre: es el instante contractual, el mismo que fijó el forfait.
 * Un servicio pedido el 31 y cerrado el 2 se factura en el mes en que se pidió,
 * que es como lo va a reclamar el cliente.
 */
export async function lineasFacturables(p: Periodo, lado: LadoFacturacion): Promise<FilaFacturable[]> {
  const r = await db.query(
    `SELECT ca.id AS "assistanceId", ca."expedientNumber", ca."externalReference",
            ca."serviceType", ca.vehicle, ca."serviceOrderedAtMs", ca."updatedAtMs" AS "finishedAtMs",
            p.currency, ca."clientId",
            COALESCE(c.name, ca."clientName") AS "clientName",
            w."providerCompanyId", COALESCE(pc.name, w.name) AS "providerName",
            l."lineNumber", l.kind, l."conceptCode", l.description, l.quantity, l.unit,
            l."saleUnitPrice", l."saleTotal", l."purchaseUnitPrice", l."purchaseTotal",
            m."exportedAtMs"
       FROM connect_assistance_pricings p
       JOIN connect_assistance_price_lines l ON l."pricingId" = p.id
       JOIN connect_assistances ca ON ca.id = p."assistanceId"
       LEFT JOIN connect_clients c ON c.id = ca."clientId"
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
       LEFT JOIN connect_billing_marks m
              ON m."assistanceId" = ca.id AND m.side = $4
      WHERE p.stage = 'final'
        AND COALESCE(ca."serviceOrderedAtMs", ca."createdAtMs") BETWEEN $1 AND $2
        AND ($3::int IS NULL OR p."controlCenterId" = $3)
        AND ($5 OR m.id IS NULL)
      ORDER BY ca.id, l."lineNumber"`,
    [p.desdeMs, p.hastaMs, p.controlCenterId, lado, !!p.incluirExportadas],
  );

  return r.rows.map((x: any) => ({
    ...x,
    plate: matricula(x.vehicle),
    serviceOrderedAtMs: x.serviceOrderedAtMs == null ? null : Number(x.serviceOrderedAtMs),
    finishedAtMs: x.finishedAtMs == null ? null : Number(x.finishedAtMs),
    exportedAtMs: x.exportedAtMs == null ? null : Number(x.exportedAtMs),
    currency: x.currency ?? "EUR",
  })) as FilaFacturable[];
}

function matricula(vehicle: unknown): string | null {
  if (vehicle == null) return null;
  try {
    const v = typeof vehicle === "string" ? JSON.parse(vehicle) : (vehicle as any);
    return v?.plate ?? null;
  } catch { return null; }
}

/**
 * Servicios terminados en el periodo que NO tienen tarifa de cierre.
 *
 * Es la lista que impide facturar de menos sin enterarse. Cada fila de aquí es
 * un servicio prestado del que no se va a emitir factura mientras siga en esta
 * lista.
 */
export async function pendientesDeCierre(p: Periodo): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT ca.id, ca."expedientNumber", ca.status, ca."serviceType",
            COALESCE(c.name, ca."clientName") AS "clientName",
            COALESCE(pc.name, w.name) AS "providerName",
            COALESCE(ca."serviceOrderedAtMs", ca."createdAtMs") AS "fechaMs",
            EXISTS (SELECT 1 FROM connect_assistance_pricings x
                     WHERE x."assistanceId" = ca.id AND x.stage = 'locked') AS "tieneBloqueada"
       FROM connect_assistances ca
       LEFT JOIN connect_clients c ON c.id = ca."clientId"
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
      WHERE ca.status IN ('finished', 'cancelled', 'returning_to_workshop', 'at_workshop')
        AND COALESCE(ca."serviceOrderedAtMs", ca."createdAtMs") BETWEEN $1 AND $2
        AND ($3::int IS NULL OR ca."controlCenterId" = $3)
        AND NOT EXISTS (SELECT 1 FROM connect_assistance_pricings x
                         WHERE x."assistanceId" = ca.id AND x.stage = 'final')
      ORDER BY ca.id DESC
      LIMIT 500`,
    [p.desdeMs, p.hastaMs, p.controlCenterId],
  );
  return r.rows.map((x: any) => ({ ...x, fechaMs: Number(x.fechaMs) }));
}

/**
 * Marca lo exportado.
 *
 * `ON CONFLICT DO NOTHING` sobre (asistencia, lado): si dos personas exportan
 * el mismo periodo a la vez, la segunda no vuelve a marcar y la consulta ya no
 * se lo devolverá. Es lo que impide mandar dos veces la misma factura, que es
 * peor que no mandarla: un duplicado hay que abonarlo.
 */
export async function marcarExportadas(
  controlCenterId: number,
  lado: LadoFacturacion,
  asistencias: { id: number; importe: string | null; currency: string }[],
  opciones: { userId?: number | null; referencia?: string | null } = {},
): Promise<number> {
  if (asistencias.length === 0) return 0;
  const ahora = Date.now();
  let marcadas = 0;

  for (const a of asistencias) {
    const r = await db.query(
      `INSERT INTO connect_billing_marks
         ("controlCenterId", "assistanceId", side, "exportedAtMs", "exportedByUserId",
          "externalReference", amount, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("assistanceId", side) DO NOTHING
       RETURNING id`,
      [controlCenterId, a.id, lado, ahora, opciones.userId ?? null,
       opciones.referencia ?? null, a.importe, a.currency],
    );
    if (r.rows[0]) marcadas++;
  }
  return marcadas;
}

/** Deshacer una exportación: el ERP la rechazó o se emitió por error. */
export async function desmarcarExportada(
  controlCenterId: number,
  assistanceId: number,
  lado: LadoFacturacion,
): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM connect_billing_marks
      WHERE "controlCenterId" = $1 AND "assistanceId" = $2 AND side = $3 RETURNING id`,
    [controlCenterId, assistanceId, lado],
  );
  return (r.rowCount ?? 0) > 0;
}
