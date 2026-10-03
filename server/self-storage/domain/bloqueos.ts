/**
 * Bloqueos por motivo. Puro.
 *
 * Puede haber varios a la vez (impago + seguridad). Un pago levanta SÓLO los
 * de motivo `payment`; `security`, `incident` y `manual` sólo los levanta una
 * persona. El contrato vuelve a `active` únicamente si no queda NINGUNO.
 */

import type { BlockReason } from "../../../src/modules/self-storage/types/enums.ts";

export type Bloqueo = { id: string; reason: BlockReason; liftedAt: Date | null };

const activos = (b: Bloqueo[]) => b.filter((x) => !x.liftedAt);

/** Los que levanta un cobro. */
export function levantablesPorPago(bloqueos: Bloqueo[]): Bloqueo[] {
  return activos(bloqueos).filter((b) => b.reason === "payment");
}

/** ¿Queda algo que impida el acceso tras levantar `levantados`? */
export function quedanBloqueos(bloqueos: Bloqueo[], levantados: string[] = []): Bloqueo[] {
  return activos(bloqueos).filter((b) => !levantados.includes(b.id));
}

/** Motivos que una persona puede levantar a mano según su rol. */
export function levantablesPorPersona(reason: BlockReason, esAdmin: boolean): boolean {
  if (reason === "terminated") return false; // un contrato finalizado no se «desbloquea»
  if (reason === "security") return esAdmin;
  return true;
}
