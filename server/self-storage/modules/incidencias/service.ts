/**
 * Incidencias de Self Storage: la ÚNICA entidad de incidencias del módulo.
 *
 * Sencilla a propósito (tipo, prioridad, estado, descripción, resolución y
 * fechas). Se abren desde una llamada, desde el panel o, más adelante, desde
 * el sistema o el portal (`source`). La fase 4 la amplía sin sustituirla.
 *
 * Las de acceso, seguridad, acceso no autorizado, emergencia y fallo grave de
 * instalaciones son SIEMPRE urgentes (lo impone el dominio y, por si acaso,
 * la base con un CHECK).
 */

import type { z } from "zod";
import { enTx, pool } from "../../shared/db.ts";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { prioridadIncidencia } from "../../domain/callcenter.ts";
import { evento } from "../callcenter/service.ts";
import type { filtroIncidencias, incidenciaAlta, incidenciaCambio } from "../../schemas.ts";
import { URGENT_INCIDENT_TYPES, type IncidentType } from "../../../../src/modules/self-storage/types/enums.ts";

const SELECT_INCIDENCIA = `
  SELECT n.id, n.center_id AS "centerId", ce.name AS "centerName", n.customer_id AS "customerId",
         CASE WHEN cu.customer_type = 'company' THEN cu.company_name ELSE btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')) END AS "customerName",
         n.contract_id AS "contractId", k.contract_number AS "contractNumber", n.call_id AS "callId",
         n.incident_type AS "incidentType", n.priority, n.status, n.source, n.title, n.description, n.resolution,
         n.opened_by AS "openedBy", ob.nombre AS "openedByName", n.assigned_to AS "assignedTo", au.nombre AS "assignedToName",
         n.created_at AS "createdAt", n.updated_at AS "updatedAt", n.resolved_at AS "resolvedAt", n.closed_at AS "closedAt"
    FROM self_storage_incidents n
    JOIN self_storage_centers ce ON ce.id = n.center_id
    LEFT JOIN self_storage_customers cu ON cu.id = n.customer_id
    LEFT JOIN self_storage_contracts k ON k.id = n.contract_id
    LEFT JOIN app_usuarios ob ON ob.id = n.opened_by
    LEFT JOIN app_usuarios au ON au.id = n.assigned_to`;

export async function obtenerIncidencia(empresaId: string, id: string) {
  const { rows } = await pool.query(`${SELECT_INCIDENCIA} WHERE n.empresa_id = $1 AND n.id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("La incidencia");
  return rows[0];
}

export async function listarIncidencias(empresaId: string, f: z.infer<typeof filtroIncidencias>) {
  const vals: unknown[] = [empresaId];
  const cond = ["n.empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("?", `$${vals.length}`));
  };
  if (f.centerId) add("n.center_id = ?", f.centerId);
  if (f.customerId) add("n.customer_id = ?", f.customerId);
  if (f.callId) add("n.call_id = ?", f.callId);
  if (f.status) add("n.status = ?", f.status);
  if (f.open) cond.push("n.status IN ('open','in_progress')");
  if (f.priority) add("n.priority = ?", f.priority);
  if (f.incidentType) add("n.incident_type = ?", f.incidentType);
  const where = cond.join(" AND ");
  const [{ rows }, { rows: t }] = await Promise.all([
    pool.query(
      `${SELECT_INCIDENCIA} WHERE ${where}
        ORDER BY (n.status IN ('open','in_progress')) DESC, CASE n.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, n.created_at DESC
        LIMIT ${f.limit} OFFSET ${f.offset}`,
      vals
    ),
    pool.query(`SELECT count(*)::int AS n FROM self_storage_incidents n WHERE ${where}`, vals),
  ]);
  return { total: t[0].n as number, items: rows };
}

export async function crearIncidencia(actor: Actor, d: z.infer<typeof incidenciaAlta>, origen: "panel" | "call" | "system" = "panel") {
  const id = await enTx(async (c) => {
    const prioridad = prioridadIncidencia(d.incidentType as IncidentType, d.priority);
    let customerId = d.customerId ?? null;
    let contractId = d.contractId ?? null;
    let source = origen;
    // Desde una llamada: misma empresa; cliente y contrato salen de ella si no se dan.
    if (d.callId) {
      const { rows } = await c.query(`SELECT customer_id, contract_id FROM self_storage_calls WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, d.callId]);
      if (!rows.length) throw noExiste("La llamada");
      customerId = customerId ?? rows[0].customer_id;
      contractId = contractId ?? rows[0].contract_id;
      source = "call";
    }
    if (contractId) {
      const { rows } = await c.query(`SELECT customer_id, center_id FROM self_storage_contracts WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, contractId]);
      if (!rows.length) throw noExiste("El contrato");
      if (customerId && rows[0].customer_id !== customerId) throw new ErrorSelfStorage("CONTRATO_DE_OTRO_CLIENTE", "El contrato no es de ese cliente.", 422);
      if (rows[0].center_id !== d.centerId) throw new ErrorSelfStorage("CONTRATO_DE_OTRO_CENTRO", "El contrato es de otro centro.", 422);
      customerId = rows[0].customer_id;
    }
    const { rows } = await c.query(
      `INSERT INTO self_storage_incidents (empresa_id, center_id, customer_id, contract_id, call_id, incident_type, priority, source, title, description, opened_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [actor.empresaId, d.centerId, customerId, contractId, d.callId ?? null, d.incidentType, prioridad, source, d.title, d.description ?? null, actor.userId || null]
    );
    const nueva = rows[0].id as string;
    await auditar(c, actor, {
      action: "incident.created",
      entityType: "incident",
      entityId: nueva,
      after: { incidentType: d.incidentType, priority: prioridad, centerId: d.centerId, customerId, contractId, callId: d.callId ?? null, source },
    });
    if (d.callId) {
      // Una incidencia urgente sube la prioridad de la llamada.
      if (prioridad !== "normal") {
        await c.query(
          `UPDATE self_storage_calls
              SET priority = CASE WHEN priority = 'urgent' OR $2 = 'urgent' THEN 'urgent' WHEN priority = 'high' OR $2 = 'high' THEN 'high' ELSE 'normal' END
            WHERE id = $1`,
          [d.callId, prioridad]
        );
      }
      await evento(c, actor, d.callId, "incident_created", { incidentId: nueva, incidentType: d.incidentType, priority: prioridad });
    }
    return nueva;
  });
  return obtenerIncidencia(actor.empresaId, id);
}

export async function actualizarIncidencia(actor: Actor, id: string, d: z.infer<typeof incidenciaCambio>) {
  await enTx(async (c) => {
    const { rows } = await c.query(`SELECT * FROM self_storage_incidents WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, id]);
    if (!rows.length) throw noExiste("La incidencia");
    const n = rows[0];
    if (d.priority && d.priority !== "urgent" && URGENT_INCIDENT_TYPES.includes(n.incident_type)) {
      throw new ErrorSelfStorage("INCIDENCIA_URGENTE", "Las incidencias de acceso, seguridad y emergencia son siempre urgentes.", 422);
    }
    if (d.status === "resolved" && !(d.resolution ?? n.resolution)) {
      throw new ErrorSelfStorage("FALTA_RESOLUCION", "Indica cómo se ha resuelto.", 422);
    }
    if (d.assignedTo) {
      // Sólo personal con acceso a Self Storage (identidad interna de Mobilink).
      const { rows: u } = await c.query(`SELECT 1 FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'self-storage'`, [d.assignedTo]);
      if (!u.length) throw new ErrorSelfStorage("USUARIO_NO_VALIDO", "Esa persona no tiene acceso a Self Storage.", 422);
    }
    const antes = { status: n.status, priority: n.priority, resolution: n.resolution, description: n.description, assignedTo: n.assigned_to };
    const despues = {
      status: d.status ?? n.status,
      priority: d.priority ?? n.priority,
      resolution: d.resolution !== undefined ? d.resolution : n.resolution,
      description: d.description !== undefined ? d.description : n.description,
      assignedTo: d.assignedTo !== undefined ? d.assignedTo : n.assigned_to,
    };
    const dif = diferencias(antes, despues);
    if (!dif) return;
    await c.query(
      `UPDATE self_storage_incidents
          SET status = $2, priority = $3, resolution = $4, description = $5, assigned_to = $6,
              resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN coalesce(resolved_at, now()) WHEN $2 IN ('open','in_progress') THEN NULL ELSE resolved_at END,
              closed_at = CASE WHEN $2 IN ('closed','cancelled') THEN coalesce(closed_at, now()) ELSE NULL END
        WHERE id = $1`,
      [id, despues.status, despues.priority, despues.resolution, despues.description, despues.assignedTo]
    );
    await auditar(c, actor, { action: "incident.updated", entityType: "incident", entityId: id, ...dif });
  });
  return obtenerIncidencia(actor.empresaId, id);
}
