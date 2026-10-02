/**
 * Estados del trastero y quién puede moverlos.
 *
 * Dos orígenes, y la distinción es la regla más importante del fichero:
 *
 *   · `manual`  — una persona en el panel. Sólo puede poner o quitar
 *                 `maintenance` y `blocked`, y volver a `available`.
 *   · `sistema` — reservas y contratos (fases 2 y 4). Son los ÚNICOS que
 *                 ponen `reserved` y `occupied`.
 *
 * Así el estado del trastero no puede contradecir a sus reservas y contratos:
 * nadie marca a mano «alquilado» un box sin contrato, ni «disponible» uno que
 * tiene un contrato vivo. Puro, sin base de datos: el servicio le pasa lo que
 * ha leído con el trastero bloqueado (FOR UPDATE) y aplica lo que diga.
 */

import { ErrorSelfStorage } from "../errors.ts";
import type { UnitStatus } from "../../../src/modules/self-storage/types/enums.ts";

export type OrigenCambio = "manual" | "sistema";

export type ContextoCambio = {
  origen: OrigenCambio;
  /** Motivo; obligatorio para `maintenance` y `blocked`. */
  motivo?: string | null;
  /** ¿Tiene el trastero un contrato vivo (pendiente, activo o suspendido)? */
  tieneContratoVivo: boolean;
  /** ¿Tiene una reserva activa y sin caducar? */
  tieneReservaActiva: boolean;
};

/** Transiciones permitidas por origen: de → [a]. */
const MANUAL: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ["maintenance", "blocked"],
  maintenance: ["available", "blocked"],
  blocked: ["available", "maintenance"],
  reserved: [],
  occupied: [],
};

const SISTEMA: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ["reserved", "occupied"],
  reserved: ["available", "occupied"],
  occupied: ["available"],
  maintenance: [],
  blocked: [],
};

export function transicionesPermitidas(actual: UnitStatus, origen: OrigenCambio): readonly UnitStatus[] {
  return (origen === "manual" ? MANUAL : SISTEMA)[actual];
}

/**
 * Valida el cambio. Devuelve el motivo normalizado que hay que guardar (o
 * null). Lanza `ErrorSelfStorage` 409/422 con un código estable si no vale.
 */
export function validarCambioEstado(actual: UnitStatus, nuevo: UnitStatus, ctx: ContextoCambio): string | null {
  if (actual === nuevo) {
    throw new ErrorSelfStorage("ESTADO_SIN_CAMBIO", "El trastero ya está en ese estado.", 409);
  }

  if (ctx.origen === "manual" && (nuevo === "reserved" || nuevo === "occupied")) {
    throw new ErrorSelfStorage(
      "ESTADO_SOLO_SISTEMA",
      "«Reservado» y «Alquilado» los pone el sistema al reservar o contratar; no se marcan a mano.",
      409
    );
  }

  if (!transicionesPermitidas(actual, ctx.origen).includes(nuevo)) {
    throw new ErrorSelfStorage(
      "TRANSICION_NO_PERMITIDA",
      `No se puede pasar un trastero de «${actual}» a «${nuevo}».`,
      409,
      { actual, nuevo, origen: ctx.origen }
    );
  }

  // Un box con contrato vivo o reserva activa no se puede retirar ni liberar a
  // mano: primero hay que resolver el contrato o la reserva.
  if (ctx.origen === "manual" && (ctx.tieneContratoVivo || ctx.tieneReservaActiva)) {
    throw new ErrorSelfStorage(
      "TRASTERO_COMPROMETIDO",
      ctx.tieneContratoVivo
        ? "El trastero tiene un contrato vivo. Finaliza o cambia el contrato antes."
        : "El trastero tiene una reserva activa. Cancélala o espera a que caduque.",
      409
    );
  }

  if (ctx.origen === "sistema" && nuevo === "available" && ctx.tieneContratoVivo) {
    throw new ErrorSelfStorage("TRASTERO_COMPROMETIDO", "No se libera un trastero con contrato vivo.", 409);
  }

  if (nuevo === "maintenance" || nuevo === "blocked") {
    const motivo = (ctx.motivo ?? "").trim();
    if (!motivo) {
      throw new ErrorSelfStorage("MOTIVO_OBLIGATORIO", "Indica el motivo del mantenimiento o del bloqueo.", 422);
    }
    return motivo.slice(0, 500);
  }
  return null;
}

/** ¿Se puede ofrecer en la web pública? Sólo los disponibles y visibles. */
export function disponibleParaAlquilar(estado: UnitStatus, publicVisible: boolean): boolean {
  return estado === "available" && publicVisible;
}
