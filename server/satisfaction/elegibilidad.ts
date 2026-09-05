/**
 * ¿A quién se le manda encuesta de esta asistencia? Esta fase solo DECIDE.
 *
 * No crea instancias, no manda nada y no registra entregas. Devuelve una
 * decisión completa y explicada, con todos los motivos por los que algo no
 * sale, no solo el primero: quien mire la ficha en 1F tiene que poder ver
 * «esta asistencia no lleva encuesta porque el cliente no lo permite Y además
 * no tenemos el teléfono del conductor», que son dos problemas distintos y se
 * arreglan por sitios distintos.
 *
 * ── El caso incómodo ────────────────────────────────────────────────────────
 *
 * Cuando el conductor y el cliente resultan ser el mismo número, la decisión
 * NO se toma aquí. Se marca `same_recipient_conflict` y se dejan los dos
 * candidatos. Elegir cuál de las dos encuestas mandar sin haber mirado cuántas
 * asistencias reales están en ese caso sería inventarse una política; y las
 * dos opciones tienen coste: mandar la de conductor pierde la valoración
 * comercial, mandar la de cliente le pregunta a alguien en el arcén por la
 * rapidez de gestión.
 */

import { asistenciaFinalizada } from "../cierre/finalizacion.ts";
import db from "../db.ts";
import {
  combinar, configGlobal, overrideDeCliente, type ConfigSatisfaction,
} from "./config.ts";
import {
  resolverDestinatarioCliente, resolverDestinatarioConductor, type Destinatario,
} from "./destinatarios.ts";
import type { Sistema } from "./dominio.ts";

export type MotivoBloqueo =
  | "assistance_not_found"
  | "other_tenant"
  | "not_finished"
  | "satisfaction_disabled"
  | "driver_survey_disabled"
  | "customer_survey_disabled"
  | "driver_missing_recipient"
  | "customer_missing_recipient"
  | "same_recipient_conflict";

export type Elegibilidad = {
  assistanceId: number;
  sourceSystem: Sistema;
  tenantId: string | null;
  eligibleDriver: boolean;
  eligibleCustomer: boolean;
  driverRecipient: Destinatario;
  customerRecipient: Destinatario;
  /** Los dos existen y son la misma línea. */
  sameRecipient: boolean;
  blockingReasons: MotivoBloqueo[];
  effectiveConfig: ConfigSatisfaction;
};

const NADIE: Destinatario = { hay: false, motivo: "missing_recipient" };

/**
 * Decide, para una asistencia, qué encuestas serían elegibles.
 *
 * El orden importa: primero lo que descarta todo —que exista, que sea del
 * taller, que haya terminado, que el sistema esté encendido— y solo después se
 * miran los teléfonos, que es lo que cuesta dos consultas más.
 */
export async function evaluarElegibilidad(p: {
  assistanceId: number;
  tenantId?: string | number | null;
  sourceSystem?: Sistema;
}): Promise<Elegibilidad> {
  const sourceSystem = p.sourceSystem ?? "assist";
  const tenantId = p.tenantId == null ? null : String(p.tenantId);
  const global = await configGlobal();

  const base: Elegibilidad = {
    assistanceId: p.assistanceId,
    sourceSystem,
    tenantId,
    eligibleDriver: false,
    eligibleCustomer: false,
    driverRecipient: NADIE,
    customerRecipient: NADIE,
    sameRecipient: false,
    blockingReasons: [],
    effectiveConfig: global,
  };

  // 1 · ¿Existe, es de este taller y ha terminado?
  const finalizada = await asistenciaFinalizada(p.assistanceId, tenantId);
  if (finalizada === null) {
    return { ...base, blockingReasons: ["assistance_not_found"] };
  }
  if (!finalizada) {
    return { ...base, blockingReasons: ["not_finished"] };
  }

  // 2 · La configuración que de verdad aplica, con el override del cliente.
  const cliente = await db.query(
    `SELECT "clienteFacturacionId" FROM roadside_assistances WHERE id = $1`,
    [p.assistanceId],
  );
  const clientId = cliente.rows[0]?.clienteFacturacionId ?? null;
  const override = await overrideDeCliente({ sourceSystem, tenantId, clientId });
  const config = combinar(global, override);

  if (!config.activo) {
    return { ...base, effectiveConfig: config, blockingReasons: ["satisfaction_disabled"] };
  }

  const motivos: MotivoBloqueo[] = [];

  // 3 · Los teléfonos. Solo se buscan los de las encuestas que están
  // encendidas: preguntar por un dato que no se va a usar es trabajo perdido.
  const driverRecipient = config.conductor
    ? await resolverDestinatarioConductor(p.assistanceId, tenantId)
    : NADIE;
  const customerRecipient = config.cliente
    ? await resolverDestinatarioCliente(p.assistanceId, tenantId)
    : NADIE;

  if (!config.conductor) motivos.push("driver_survey_disabled");
  else if (!driverRecipient.hay) motivos.push("driver_missing_recipient");

  if (!config.cliente) motivos.push("customer_survey_disabled");
  else if (!customerRecipient.hay) motivos.push("customer_missing_recipient");

  let eligibleDriver = config.conductor && driverRecipient.hay;
  let eligibleCustomer = config.cliente && customerRecipient.hay;

  /*
   * Los dos existen y son la misma línea: no se manda nada todavía. La
   * política definitiva se cierra en 1C.2 con los datos de producción
   * delante, así que aquí se marca el conflicto y se dejan los dos
   * candidatos servidos para que quien decida lo haga con todo a la vista.
   */
  const sameRecipient = driverRecipient.hay && customerRecipient.hay
    && driverRecipient.normalizado === customerRecipient.normalizado;
  if (sameRecipient) {
    motivos.push("same_recipient_conflict");
    eligibleDriver = false;
    eligibleCustomer = false;
  }

  return {
    ...base,
    eligibleDriver, eligibleCustomer,
    driverRecipient, customerRecipient, sameRecipient,
    blockingReasons: motivos,
    effectiveConfig: config,
  };
}
