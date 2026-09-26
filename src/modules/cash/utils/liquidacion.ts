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

/** Nombre en castellano de cada tipo de establecimiento, para el botón. */
const NOMBRE_ESTABLECIMIENTO: Record<string, string> = {
  RESTAURANTE: "bar o restaurante",
  PEAJE: "peaje",
  GASOLINERA: "gasolinera",
  PARKING: "parking",
  HOTEL: "hotel",
  TRANSPORTE: "transporte",
  TAXI: "taxi",
  SUPERMERCADO: "supermercado",
  TALLER: "taller",
};

export type ReglaParaRecordar = {
  campo: "TIPO_ESTABLECIMIENTO" | "NIF_EMISOR";
  patron: string;
  /** «los tickets de peaje», «los tickets de BAR LA SERRANITA». */
  que: string;
};

/**
 * Aprender de lo que una persona decide: si la lectura no supo qué concepto
 * era y alguien lo ha elegido a mano, se ofrece guardarlo como regla para que
 * el próximo ticket igual salga solo.
 *
 * Se ofrece por TIPO de establecimiento cuando la lectura lo sabe —«todos los
 * peajes son Peajes» sirve para cualquier autopista—, y si no, por el NIF del
 * emisor, que es lo único que identifica sin ambigüedad a un establecimiento.
 * Por nombre no: «Bar» casaría con cualquier bar.
 *
 * Nunca cuando una regla ya reconoció el ticket: si propuso otro concepto,
 * cambiar esa regla es cosa de Configuración, donde se ve a qué más afecta.
 */
export function reglaParaRecordar(
  lectura: { tipoEstablecimiento: string; conceptoPropuesto: { conceptoId: number | null } } | null,
  conceptoElegido: number | null,
  emisor: { nombre: string; nif: string | null }
): ReglaParaRecordar | null {
  if (!lectura || conceptoElegido == null) return null;
  if (lectura.conceptoPropuesto.conceptoId != null) return null;
  const tipo = lectura.tipoEstablecimiento;
  if (NOMBRE_ESTABLECIMIENTO[tipo]) {
    return { campo: "TIPO_ESTABLECIMIENTO", patron: tipo, que: `los tickets de ${NOMBRE_ESTABLECIMIENTO[tipo]}` };
  }
  const nif = (emisor.nif ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (nif.length >= 5) {
    return { campo: "NIF_EMISOR", patron: nif, que: `los tickets de ${emisor.nombre.trim() || nif}` };
  }
  return null;
}
