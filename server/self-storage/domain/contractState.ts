/**
 * Estados del contrato y transiciones permitidas.
 *
 *   draft → pending_signature → pending_payment → active ⇄ suspended
 *     │            │                  │             │          │
 *     └────────────┴──────────────────┴→ cancelled  └──────────┴→ terminated
 *
 * Puro: el servicio lee el contrato con FOR UPDATE, pregunta aquí y aplica.
 * Una transición que no está en la tabla es un 409, no un salto silencioso.
 */

import { ErrorSelfStorage } from "../errors.ts";
import type { ContractStatus } from "../../../src/modules/self-storage/types/enums.ts";

export type AccionContrato = "issue" | "sign" | "activate" | "suspend" | "reactivate" | "terminate" | "cancel";

const TRANSICIONES: Record<AccionContrato, { desde: readonly ContractStatus[]; hacia: ContractStatus }> = {
  issue: { desde: ["draft"], hacia: "pending_signature" },
  sign: { desde: ["pending_signature"], hacia: "pending_payment" },
  activate: { desde: ["pending_payment"], hacia: "active" },
  suspend: { desde: ["active"], hacia: "suspended" },
  reactivate: { desde: ["suspended"], hacia: "active" },
  terminate: { desde: ["active", "suspended"], hacia: "terminated" },
  // Cancelar es para lo que NO ha llegado a activarse; lo activo se finaliza.
  cancel: { desde: ["draft", "pending_signature", "pending_payment"], hacia: "cancelled" },
};

const NOMBRE: Record<AccionContrato, string> = {
  issue: "emitir para firma",
  sign: "firmar",
  activate: "activar",
  suspend: "suspender",
  reactivate: "reactivar",
  terminate: "finalizar",
  cancel: "cancelar",
};

export function transicion(actual: ContractStatus, accion: AccionContrato): ContractStatus {
  const t = TRANSICIONES[accion];
  if (!t.desde.includes(actual)) {
    throw new ErrorSelfStorage(
      "TRANSICION_CONTRATO_NO_PERMITIDA",
      `No se puede ${NOMBRE[accion]} un contrato en estado «${actual}».`,
      409,
      { actual, accion }
    );
  }
  return t.hacia;
}

export function accionesPosibles(actual: ContractStatus): AccionContrato[] {
  return (Object.keys(TRANSICIONES) as AccionContrato[]).filter((a) => TRANSICIONES[a].desde.includes(actual));
}

/** Sólo un borrador se edita: lo emitido se cambia con un anexo. */
export function exigirEditable(actual: ContractStatus): void {
  if (actual !== "draft") {
    throw new ErrorSelfStorage("CONTRATO_NO_EDITABLE", "Sólo se puede editar un contrato en borrador.", 409);
  }
}
