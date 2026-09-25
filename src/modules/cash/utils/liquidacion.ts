/**
 * Qué se puede hacer con una liquidación, desde la pantalla.
 *
 * El servidor lo vuelve a comprobar todo —estado y permiso— y es quien manda.
 * Esto solo decide qué botones se pintan, y vive aquí aparte porque en este
 * proyecto no hay pruebas de componentes de React: una decisión metida en el
 * JSX es una decisión sin prueba.
 */

import type { EstadoLiquidacion } from "../types";

export type AccionPantalla =
  | "EDITAR"
  | "PRESENTAR"
  | "APROBAR"
  | "RECHAZAR"
  | "REABRIR"
  | "ANULAR"
  /** Dar por bueno un posible duplicado: es de quien aprueba. */
  | "ACEPTAR_DUPLICADO";

export function accionesDisponibles(
  estado: EstadoLiquidacion,
  permisos: readonly string[],
  /** Lo que el servidor dice que impide presentar. */
  bloqueos: number
): Set<AccionPantalla> {
  const crea = permisos.includes("cash.expense_claim.create");
  const aprueba = permisos.includes("cash.expense_claim.approve");
  const a = new Set<AccionPantalla>();

  if (estado === "BORRADOR" && crea) {
    a.add("EDITAR");
    if (bloqueos === 0) a.add("PRESENTAR");
  }
  if (estado === "BORRADOR" && aprueba) a.add("ACEPTAR_DUPLICADO");
  if (estado === "PRESENTADA" && aprueba) {
    a.add("APROBAR");
    a.add("RECHAZAR");
  }
  // Aprobada y sin pagar todavía se puede rechazar, si aparece un problema.
  if (estado === "APROBADA" && aprueba) a.add("RECHAZAR");
  if (estado === "RECHAZADA" && crea) a.add("REABRIR");
  /*
   * Una pagada no se anula desde aquí: el dinero ya salió, y lo que se deshace
   * es el pago, en la caja. Una anulada ya está.
   */
  if (aprueba && estado !== "PAGADA" && estado !== "ANULADA") a.add("ANULAR");
  return a;
}

/** Color de la píldora de estado. */
export const TONO_ESTADO: Record<EstadoLiquidacion, string> = {
  BORRADOR: "bg-slate-600/40 text-slate-200",
  PRESENTADA: "bg-amber-500/20 text-amber-200",
  APROBADA: "bg-sky-500/20 text-sky-200",
  RECHAZADA: "bg-rose-500/20 text-rose-200",
  PAGADA: "bg-emerald-500/20 text-emerald-200",
  ANULADA: "bg-slate-700/60 text-slate-400 line-through",
};
