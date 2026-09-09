/**
 * Cola de sincronización con TyreControl.
 *
 * ── Por qué una cola y no una llamada ───────────────────────────────────────
 *
 * El técnico cierra la asistencia y se va. Si el cierre esperase a TyreControl,
 * un corte de red dejaría al técnico mirando una rueda que no gira. Así que el
 * cierre solo ENCOLA, y quien habla con TC es el worker, después.
 *
 * Se reutiliza `integration_operations` del Integration Hub —con sus estados,
 * su contador de intentos y su registro— en vez de estrenar otra cola.
 *
 * ── Idempotencia ───────────────────────────────────────────────────────────
 *
 * La correlación se construye del hecho: `assist:1234:tc:repair:E2_IZQ_EXT`.
 * Antes de encolar se mira si ya existe una operación viva con esa correlación,
 * y si está COMPLETED no se vuelve a encolar nunca. Es la primera barrera, y
 * tiene que estar aquí porque TyreControl no tiene ninguna.
 */

import db from "../db.ts";
import {
  appendLog, createOperation, updateOperationStatus,
} from "../integration-hub/infrastructure/repositories.ts";
import { ejecutarReparacion, situacionDePosicion, type PlanReparacion } from "./reparacionServicio.ts";
import { empresaEnAlcance, sincronizacionReparacionActiva } from "./reparacion.ts";

const TIPO = "TC_TYRE_REPAIR";
const TENANT = "assist";

/** `assist:1234:tc:repair:E2_IZQ_EXT`. Distingue cada rueda de la asistencia. */
export function correlacionReparacion(assistanceId: number | string, refRueda: string): string {
  return `assist:${assistanceId}:tc:repair:${refRueda}`;
}

/** Estados en los que una operación sigue viva: no se encola otra igual. */
const VIVAS = ["RECEIVED", "VALIDATING", "PROCESSING", "RETRY_PENDING", "MANUAL_REVIEW"];

export async function operacionExistente(correlationId: string) {
  const r = await db.query(
    `SELECT * FROM integration_operations
      WHERE tenant_id = $1 AND operation_type = $2 AND correlation_id = $3
      ORDER BY id DESC LIMIT 1`,
    [TENANT, TIPO, correlationId],
  );
  return r.rows[0] ?? null;
}

export type ResultadoEncolado =
  | { encolada: true; operationId: number; correlationId: string }
  | { encolada: false; motivo: string; correlationId: string };

/**
 * Mete una reparación en la cola.
 *
 * No ejecuta nada. Devuelve por qué no se encoló cuando no se encola, que es
 * información para la oficina y no un fallo.
 */
export async function encolarReparacion(p: {
  assistanceId: number;
  plan: PlanReparacion;
  refRueda: string;
}): Promise<ResultadoEncolado> {
  const correlationId = correlacionReparacion(p.assistanceId, p.refRueda);

  const ya = await operacionExistente(correlationId);
  if (ya) {
    if (ya.status === "COMPLETED") {
      return { encolada: false, correlationId, motivo: "Ya se sincronizó con TyreControl." };
    }
    if (VIVAS.includes(ya.status)) {
      return { encolada: false, correlationId, motivo: `Ya hay una sincronización en curso (${ya.status}).` };
    }
    /*
     * FAILED es terminal a propósito: un fallo permanente no se reintenta solo.
     * Alguien tiene que mirarlo y pulsar reintentar, porque si falló por un
     * motivo real, repetirlo automáticamente solo llena el registro.
     */
    return { encolada: false, correlationId, motivo: "Falló antes; hay que reintentarla a mano." };
  }

  const op = await createOperation({
    tenantId: TENANT,
    connectorKey: "tyrecontrol",
    operationType: TIPO as any,
    sourceSystem: "assist",
    targetSystem: "tyrecontrol",
    correlationId,
    workOrderId: String(p.assistanceId),
    requestPayload: p.plan,
  });

  await appendLog({
    tenantId: TENANT, operationId: op.id, correlationId,
    level: "info", message: `Reparación encolada para la asistencia ${p.assistanceId}`,
  }).catch(() => {});

  return { encolada: true, operationId: Number(op.id), correlationId };
}

/* ── Procesado ───────────────────────────────────────────────────────────── */

/**
 * Toma UNA operación pendiente y la marca como en curso, de forma atómica.
 *
 * El `UPDATE ... RETURNING` con el estado en el WHERE es lo que impide que dos
 * workers cojan la misma: el segundo no encuentra ninguna fila. Es el mismo
 * patrón que ya usa `IntegrationWorker`.
 */
export async function reclamarSiguiente(): Promise<any | null> {
  const r = await db.query(
    `UPDATE integration_operations SET status = 'PROCESSING', updated_at_ms = $1
      WHERE id = (
        SELECT id FROM integration_operations
         WHERE tenant_id = $2 AND operation_type = $3
           AND status IN ('RECEIVED','RETRY_PENDING')
         ORDER BY id LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [Date.now(), TENANT, TIPO],
  );
  return r.rows[0] ?? null;
}

/** Anota en la asistencia cómo quedó, para que la oficina lo vea. */
async function anotarEnAsistencia(
  assistanceId: number, estado: string, motivo: string | null,
  operacionTcId?: string | null, incidenciaId?: string | null,
) {
  await db.query(
    `UPDATE roadside_assistances
        SET "tcSyncEstado" = $2, "tcSyncMotivo" = $3, "tcSyncAtMs" = $4,
            "tcOperacionTcId" = COALESCE($5, "tcOperacionTcId"),
            "tcIncidenciaId" = COALESCE($6, "tcIncidenciaId")
      WHERE id = $1`,
    [assistanceId, estado, motivo, Date.now(), operacionTcId ?? null, incidenciaId ?? null],
  ).catch((e) => console.error("[TyreControl] no se pudo anotar el estado:", e?.message));
}

/**
 * Procesa una operación reclamada.
 *
 * Vuelve a leer TyreControl aunque ya se hubiera leído al encolar: entre una
 * cosa y otra pueden haber pasado horas, y el estado de la rueda es justo lo
 * que puede haber cambiado.
 */
export async function procesar(op: any): Promise<string> {
  const assistanceId = Number(op.work_order_id);
  const plan: PlanReparacion = typeof op.request_payload === "string"
    ? JSON.parse(op.request_payload) : op.request_payload;

  const registrar = (mensaje: string, nivel: "info" | "error" = "info") =>
    appendLog({ tenantId: TENANT, operationId: op.id, correlationId: op.correlation_id,
                level: nivel, message: mensaje }).catch(() => {});

  // Las dos llaves y la lista de despliegue se comprueban aquí también: entre
  // encolar y procesar alguien puede haber apagado el interruptor, y entonces
  // no se escribe.
  if (!sincronizacionReparacionActiva()) {
    await updateOperationStatus(op.id, "RETRY_PENDING", {
      errorCode: "tc_write_disabled", errorMessage: "Sincronización desactivada",
    });
    await registrar("Sincronización desactivada: la operación espera");
    return "RETRY_PENDING";
  }
  if (!empresaEnAlcance(plan.tcEmpresaId)) {
    await updateOperationStatus(op.id, "RETRY_PENDING", {
      errorCode: "tc_out_of_scope", errorMessage: "Empresa fuera del despliegue",
    });
    return "RETRY_PENDING";
  }

  // Se relee la situación y se recuerda la incidencia de un intento anterior:
  // es la referencia con la que se puede saber si aquello llegó a ejecutarse.
  const previa = await db.query(
    `SELECT "tcIncidenciaId" FROM roadside_assistances WHERE id = $1`, [assistanceId]);
  const r = await ejecutarReparacion({
    ...plan, incidenciaId: previa.rows[0]?.tcIncidenciaId ?? plan.incidenciaId ?? null,
  });

  switch (r.estado) {
    case "COMPLETED":
      await updateOperationStatus(op.id, "COMPLETED", {
        completed: true, responsePayload: { operacionTcId: r.operacionTcId, camino: r.camino },
      });
      await anotarEnAsistencia(assistanceId, "SINCRONIZADA", null, r.operacionTcId, r.incidenciaId);
      await registrar(`Reparación registrada en TyreControl (${r.camino})`);
      return "COMPLETED";

    case "CONFLICT":
      // No es un fallo del canal: la realidad cambió. Reintentar no arregla nada.
      await updateOperationStatus(op.id, "FAILED", {
        errorCode: "tc_conflict", errorMessage: r.motivo,
      });
      await anotarEnAsistencia(assistanceId, "CONFLICTO", r.motivo);
      await registrar(`Conflicto: ${r.motivo}`, "error");
      return "FAILED";

    case "MANUAL_REVIEW":
      await updateOperationStatus(op.id, "MANUAL_REVIEW", {
        errorCode: "tc_unknown_result", errorMessage: r.motivo,
      });
      await anotarEnAsistencia(assistanceId, "REVISION", r.motivo, null, r.incidenciaId);
      await registrar(`Resultado incierto: ${r.motivo}`, "error");
      return "MANUAL_REVIEW";

    case "RETRY":
      await updateOperationStatus(op.id, "RETRY_PENDING", {
        errorCode: r.codigo, errorMessage: r.motivo, incrementRetry: true,
      });
      await anotarEnAsistencia(assistanceId, "PENDIENTE", r.motivo);
      return "RETRY_PENDING";

    default:
      await updateOperationStatus(op.id, "FAILED", {
        errorCode: r.codigo, errorMessage: r.motivo,
      });
      await anotarEnAsistencia(assistanceId, "ERROR", r.motivo);
      await registrar(`Falló: ${r.motivo}`, "error");
      return "FAILED";
  }
}

/**
 * Reintento a mano, para lo que quedó en FAILED o en revisión.
 *
 * Vuelve a pasar por `procesar`, o sea que **repite el read-before-write**. No
 * reenvía el mismo RPC a ciegas: entre el fallo y el reintento la rueda puede
 * haber cambiado otra vez.
 */
export async function reintentarAMano(correlationId: string): Promise<string> {
  const op = await operacionExistente(correlationId);
  if (!op) throw new Error("No hay ninguna sincronización con esa referencia");
  if (op.status === "COMPLETED") return "COMPLETED";
  await updateOperationStatus(op.id, "PROCESSING", {});
  return procesar({ ...op, status: "PROCESSING" });
}

/** Un ciclo del worker. Devuelve cuántas ha procesado. */
export async function cicloReparaciones(limite = 5): Promise<number> {
  if (!sincronizacionReparacionActiva()) return 0;
  let hechas = 0;
  for (let i = 0; i < limite; i++) {
    const op = await reclamarSiguiente();
    if (!op) break;
    try {
      await procesar(op);
    } catch (e: any) {
      console.error("[TyreControl] worker:", e?.message);
      await updateOperationStatus(op.id, "RETRY_PENDING", {
        errorCode: "tc_error", errorMessage: e?.message, incrementRetry: true,
      }).catch(() => {});
    }
    hechas++;
  }
  return hechas;
}

export { situacionDePosicion };
