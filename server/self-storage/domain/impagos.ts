/**
 * Plazos del impago, configurables por empresa/centro. Puro.
 *
 *   día 0  → la factura falla (o vence sin cobrar si es manual): caso abierto
 *   día N1 → primer aviso
 *   día N2 → segundo aviso
 *   día N3 → suspensión del contrato (bloqueo `payment`; físico en la fase 3)
 *
 * Cada acción se hace UNA vez (el caso guarda cuándo se hizo) y el motor puede
 * pasar tantas veces como quiera: es reentrante.
 */

import { ErrorSelfStorage } from "../errors.ts";

export type PoliticaImpago = { firstNoticeDays: number; secondNoticeDays: number; suspendDays: number };

export const POLITICA_IMPAGO_DEFECTO: PoliticaImpago = { firstNoticeDays: 3, secondNoticeDays: 7, suspendDays: 10 };

export function validarPolitica(p: PoliticaImpago): PoliticaImpago {
  if (!(p.firstNoticeDays >= 0 && p.firstNoticeDays <= p.secondNoticeDays && p.secondNoticeDays <= p.suspendDays)) {
    throw new ErrorSelfStorage("POLITICA_IMPAGO_NO_VALIDA", "Los plazos tienen que ir en orden: primer aviso ≤ segundo aviso ≤ suspensión.", 422);
  }
  return p;
}

export type CasoImpago = {
  openedAt: Date;
  firstNoticeAt: Date | null;
  secondNoticeAt: Date | null;
  suspendedAt: Date | null;
};

export type AccionImpago = "first_notice" | "second_notice" | "suspend";

const DIA = 86_400_000;

/** Lo que toca hacer ahora y aún no se ha hecho, en orden. */
export function accionesPendientes(caso: CasoImpago, ahora: Date, p: PoliticaImpago): AccionImpago[] {
  const dias = Math.floor((ahora.getTime() - caso.openedAt.getTime()) / DIA);
  const out: AccionImpago[] = [];
  if (dias >= p.firstNoticeDays && !caso.firstNoticeAt) out.push("first_notice");
  if (dias >= p.secondNoticeDays && !caso.secondNoticeAt) out.push("second_notice");
  if (dias >= p.suspendDays && !caso.suspendedAt) out.push("suspend");
  return out;
}
