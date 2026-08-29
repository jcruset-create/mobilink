/**
 * De dónde sale una asistencia que se va a subcontratar.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * `dispatch/servicio.ts` sabía leer `roadside_assistances` y nada más. Servía
 * mientras solo Assist subcontrataba. Ahora una Central también subcontrata —a
 * otra Central, a un taller, a una plataforma externa— y su asistencia vive en
 * otra tabla, con otros nombres y otro expediente.
 *
 * En vez de llenar el servicio de `if (system === "central")`, cada sistema
 * aporta aquí un adaptador que sabe tres cosas: leer su asistencia, decir su
 * expediente y anotar la referencia que devuelve el destino. El servicio no
 * vuelve a mencionar ninguna tabla.
 *
 * ── Y por qué Central → Central pasa por aquí ───────────────────────────────
 *
 * Los dos tenants viven en la misma aplicación y en la misma base. Sería
 * técnicamente trivial que la Plataforma A escribiera directamente en las
 * asistencias de la B con un INSERT.
 *
 * No se hace, y es la decisión que gobierna todo el módulo. La Plataforma A
 * llama a la API pública de la B **por HTTP, con su credencial**, exactamente
 * igual que si la B estuviera en otra empresa y en otro servidor. Con eso:
 *
 *   · el aislamiento no depende de que nadie se acuerde de filtrar por tenant
 *   · la privacidad económica la garantiza el propio sobre, que no lleva costes
 *   · el día que un tenant se lleve su Central a su servidor, no cambia nada
 *   · la trazabilidad es la misma para todos los caminos
 *
 * Un atajo aquí sería un atajo que habría que deshacer, y mientras tanto una
 * puerta abierta entre dos empresas que no se conocen.
 */

import type { PoolClient } from "pg";

import db from "../db.ts";
import type { AsistenciaAssist } from "./payload.ts";

export type SistemaOrigen = "assist" | "central";

/** Lo que el servicio de envío necesita saber hacer con cualquier origen. */
export type FuenteAsistencia = {
  /** Lee la asistencia en el formato común del sobre. */
  cargar(id: string | number): Promise<(AsistenciaAssist & { expediente: string | null }) | null>;
  /** Guarda el id del despacho en la asistencia, para poder pintarlo sin cruzar tablas. */
  anotarDespacho(id: string | number, dispatchId: number): Promise<void>;
  /** Guarda el expediente que ha devuelto el destino. */
  anotarExpedienteDestino(id: string | number, expediente: string): Promise<void>;
  /**
   * Mueve el estado interno cuando el destino comunica un avance.
   *
   * Se llama DESPUÉS de que el despacho haya cuajado, no dentro de su
   * transacción. El motivo es concreto: en Central esto pasa por
   * `transition()`, que abre su propia transacción para escribir su historial,
   * su diario y su aviso a la vez. Anidar dos transacciones en conexiones
   * distintas es como se producen los interbloqueos.
   */
  aplicarEstado(id: string | number, estado: string, cuandoMs: number): Promise<void>;

  /**
   * La versión que SÍ entra en la transacción del despacho, cuando el sistema
   * puede hacerlo con un simple UPDATE.
   *
   * Existe para no perder la atomicidad donde se puede tener: en Assist, el
   * envío y el estado de la asistencia cuajan juntos o no cuajan. Quien no la
   * implemente cae en `aplicarEstado`, después del COMMIT.
   */
  aplicarEstadoEnTransaccion?(
    cliente: PoolClient, id: string | number, estado: string, cuandoMs: number,
  ): Promise<void>;
  /** Datos de la empresa que encarga el servicio, para que el destino la resuelva. */
  solicitante(id: string | number): Promise<{ nombre: string; cif: string | null; telefono?: string | null }>;
};

/* ── Assist ──────────────────────────────────────────────────────────────── */

const assist: FuenteAsistencia = {
  async cargar(id) {
    const r = await db.query(
      `SELECT id, plate, "vehicleDescription", address, latitude, longitude, "googleMapsUrl",
              "customerName", "customerPhone", "conductorNombre",
              "solicitanteEmpresa", "solicitanteNombre", "solicitanteTelefono",
              "solicitanteAutorizacion", "descripcionAveria", "trabajosARealizar",
              priority, status, notes, "createdAtMs"
         FROM roadside_assistances WHERE id = $1`,
      [Number(id)],
    );
    const a = r.rows[0];
    if (!a) return null;
    return {
      ...a,
      id: Number(a.id),
      latitude: a.latitude == null ? null : Number(a.latitude),
      longitude: a.longitude == null ? null : Number(a.longitude),
      // Assist no numera expedientes propios todavía: se manda su id con
      // prefijo, que es estable y sirve para hablar por teléfono.
      expediente: `AST-${a.id}`,
    };
  },

  async anotarDespacho(id, dispatchId) {
    await db.query(
      `UPDATE roadside_assistances SET "despachoExternoId" = $2 WHERE id = $1`,
      [Number(id), dispatchId],
    );
  },

  async anotarExpedienteDestino(id, expediente) {
    await db.query(
      `UPDATE roadside_assistances SET "expedienteDestino" = $2 WHERE id = $1`,
      [Number(id), expediente],
    );
  },

  async aplicarEstado(id, estado, cuandoMs) {
    await assist.aplicarEstadoEnTransaccion!(db as any, id, estado, cuandoMs);
  },

  async aplicarEstadoEnTransaccion(cliente, id, estado, cuandoMs) {
    /*
     * No se pisa una asistencia ya cerrada. Un webhook que llega tarde no puede
     * reabrir algo que en Assist ya se dio por finalizado o cancelado.
     */
    await cliente.query(
      `UPDATE roadside_assistances SET status = $2, "updatedAtMs" = $3
        WHERE id = $1 AND status NOT IN ('finalizada','cancelada')`,
      [Number(id), estado, cuandoMs],
    );
  },

  async solicitante(id) {
    const r = await db.query(
      `SELECT "solicitanteEmpresa", "customerName", "solicitanteTelefono"
         FROM roadside_assistances WHERE id = $1`,
      [Number(id)],
    );
    const a = r.rows[0] ?? {};
    return {
      nombre: a.solicitanteEmpresa || a.customerName || "Cliente de Assist",
      cif: null,
      telefono: a.solicitanteTelefono ?? null,
    };
  },
};

/* ── Central ─────────────────────────────────────────────────────────────── */

/**
 * Traducción de los estados del cable a los de Central.
 *
 * Es distinta de la de Assist a propósito: son dos sistemas con dos
 * vocabularios, y ése es el motivo de que exista la capa de traducción. Aquí
 * `en_camino` se llama `en_route`.
 */
const A_CENTRAL: Record<string, string> = {
  asignada: "assigned",
  en_camino: "en_route",
  en_curso: "in_progress",
  finalizada: "finished",
  cancelada: "cancelled",
};

const central: FuenteAsistencia = {
  async cargar(id) {
    const r = await db.query(
      `SELECT a.id, a.address, a.latitude, a.longitude, a."customerName", a."customerPhone",
              a.description, a.priority, a.status, a."createdAtMs", a."expedientNumber",
              a.vehicle, a.requester, a."clientName"
         FROM connect_assistances a WHERE a.id = $1`,
      [Number(id)],
    );
    const a = r.rows[0];
    if (!a) return null;

    let vehiculo: any = {};
    try { vehiculo = JSON.parse(a.vehicle || "{}"); } catch { vehiculo = {}; }
    let solicitante: any = {};
    try { solicitante = JSON.parse(a.requester || "{}"); } catch { solicitante = {}; }

    return {
      id: Number(a.id),
      expediente: a.expedientNumber ?? `AS-${a.id}`,
      plate: vehiculo.plate ?? null,
      vehicleDescription: vehiculo.description ?? null,
      vehicleMake: vehiculo.make ?? null,
      vehicleModel: vehiculo.model ?? null,
      vehicleType: vehiculo.type ?? null,
      address: a.address ?? null,
      latitude: a.latitude == null ? null : Number(a.latitude),
      longitude: a.longitude == null ? null : Number(a.longitude),
      googleMapsUrl: null,
      customerName: a.customerName ?? null,
      customerPhone: a.customerPhone ?? null,
      conductorNombre: null,
      solicitanteEmpresa: a.clientName ?? solicitante.company ?? null,
      solicitanteNombre: solicitante.contact_name ?? null,
      solicitanteTelefono: solicitante.contact_phone ?? null,
      solicitanteAutorizacion: null,
      descripcionAveria: a.description ?? null,
      trabajosARealizar: null,
      priority: a.priority ?? null,
      status: a.status ?? null,
      createdAtMs: a.createdAtMs == null ? null : Number(a.createdAtMs),
      /*
       * Las notas internas de Central NO se leen aquí. En Assist son
       * observaciones que a veces conviene mandar; en Central pueden llevar el
       * margen y las condiciones con el taller, así que no existe ni la opción
       * de incluirlas.
       */
      notes: null,
    };
  },

  async anotarDespacho(id, dispatchId) {
    await db.query(
      `UPDATE connect_assistances SET "despachoExternoId" = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [Number(id), dispatchId, Date.now()],
    );
  },

  async anotarExpedienteDestino(id, expediente) {
    await db.query(
      `UPDATE connect_assistances SET "expedienteDestino" = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [Number(id), expediente, Date.now()],
    );
  },

  async aplicarEstado(id, estado, cuandoMs) {
    const equivalente = A_CENTRAL[estado];
    if (!equivalente) return;
    /*
     * Se usa `transition()` y no un UPDATE directo: es lo que valida la
     * transición, escribe el historial, anota el diario y encola el aviso a
     * quien esté escuchando, todo en la misma transacción. Saltárselo dejaría
     * a la Central de destino sin la mitad de su trazabilidad.
     *
     * Si la transición no está permitida no se fuerza: el destino habrá
     * avanzado por un camino que aquí no corresponde, y forzarlo dejaría la
     * asistencia en un estado imposible.
     */
    const { transition, InvalidTransitionError } = await import("../connect/service.ts");
    try {
      await transition(Number(id), equivalente as any, "api", "Comunicado por la plataforma destino");
    } catch (e) {
      if (e instanceof InvalidTransitionError) {
        console.warn(`[Dispatch] Central ${id}: transición no permitida a ${equivalente}`);
        return;
      }
      throw e;
    }
    void cuandoMs;
  },

  async solicitante(id) {
    /*
     * En Central el solicitante es la EMPRESA de la cartera, que es la que hay
     * que identificar en el destino para que resuelva a quién factura. Se
     * manda su CIF, no su id: el id de la Plataforma A no significa nada en la
     * B, y mandarlo invitaría a acoplarlas.
     */
    const r = await db.query(
      `SELECT COALESCE(pc.name, a."clientName") AS nombre, pc."taxId" AS cif,
              pc."contactPhone" AS telefono
         FROM connect_assistances a
         LEFT JOIN connect_provider_companies pc ON pc.id = a."requesterCompanyId"
        WHERE a.id = $1`,
      [Number(id)],
    );
    const a = r.rows[0] ?? {};
    return {
      nombre: a.nombre || "Central",
      cif: a.cif ?? null,
      telefono: a.telefono ?? null,
    };
  },
};

const FUENTES: Record<SistemaOrigen, FuenteAsistencia> = { assist, central };

export function fuenteDe(system: SistemaOrigen): FuenteAsistencia {
  const f = FUENTES[system];
  if (!f) throw new Error(`Sistema de origen desconocido: ${system}`);
  return f;
}

export function esSistemaOrigen(v: unknown): v is SistemaOrigen {
  return v === "assist" || v === "central";
}
