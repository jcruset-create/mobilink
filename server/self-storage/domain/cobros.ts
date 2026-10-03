/**
 * Qué hacer con un cobro según sea el PRIMERO de un contrato o una mensualidad
 * de un cliente que ya está dentro. Puro.
 *
 *   Primer cobro
 *     · tarjeta/SEPA cobrado            → activar
 *     · SEPA en `processing`            → esperar, salvo política
 *                                          `allow_while_processing`
 *     · fallido                         → el contrato sigue pendiente de pago
 *
 *   Mensualidad de un contrato activo
 *     · `processing` (SEPA)             → NADA: no es un impago
 *     · fallido / devuelto              → abrir impago
 *     · cobrado                         → cerrar el impago de esa factura
 */

import type { FirstSepaPolicy, PaymentMethod, PaymentStatus } from "../../../src/modules/self-storage/types/enums.ts";

export type DecisionPrimerCobro = "activar" | "esperar" | "fallido";

export function decidirPrimerCobro(metodo: PaymentMethod, estado: PaymentStatus, politica: FirstSepaPolicy): DecisionPrimerCobro {
  if (estado === "succeeded") return "activar";
  if (estado === "failed") return "fallido";
  if (estado === "processing" && metodo === "sepa" && politica === "allow_while_processing") return "activar";
  return "esperar";
}

export type DecisionMensualidad = "nada" | "abrir_impago" | "cerrar_impago";

export function decidirMensualidad(estado: PaymentStatus): DecisionMensualidad {
  if (estado === "failed") return "abrir_impago";
  if (estado === "succeeded") return "cerrar_impago";
  return "nada"; // pending / processing: todavía no ha pasado nada malo
}
