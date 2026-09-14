/**
 * Lo que la bandeja calcula para pintarse: pestañas, resumen de actuaciones y
 * antigüedad.
 *
 * Vive aquí, en funciones puras, y no dentro del `.tsx`, porque en este
 * proyecto **no hay pruebas de componentes**: lo que no se saca del componente
 * no se puede probar. Todo lo que tiene una regla —qué pestaña está activa, qué
 * actuaciones se enseñan y cuántas quedan, cómo se lee una antigüedad— está en
 * este fichero y tiene su `.test.ts` al lado.
 */

import type { Actuacion, Contadores, FilaBandeja } from "../types";

export type ClavePestana =
  | "pendientes"
  | "urgentes"
  | "reclamados"
  | "en_proceso"
  | "revisar"
  | "resueltos"
  | "todos";

export type Pestana = {
  clave: ClavePestana;
  etiqueta: string;
  /** Cuántos hay. `undefined` mientras no haya llegado el bootstrap. */
  cuenta?: number;
  /** Se pinta en rojo cuando hay algo que mirar. */
  alerta?: boolean;
};

const ETIQUETAS: Record<ClavePestana, string> = {
  pendientes: "Pendientes",
  urgentes: "Urgentes",
  reclamados: "Reclamados",
  en_proceso: "En proceso",
  revisar: "Revisar",
  resueltos: "Resueltos",
  todos: "Todos",
};

/** El orden es el de la cabecera, y no es alfabético: es el de la urgencia. */
const ORDEN: ClavePestana[] = [
  "pendientes",
  "urgentes",
  "reclamados",
  "en_proceso",
  "revisar",
  "resueltos",
];

export function pestanas(contadores: Contadores | null): Pestana[] {
  return ORDEN.map((clave) => ({
    clave,
    etiqueta: ETIQUETAS[clave],
    cuenta: contadores ? contadores[clave] : undefined,
    // «Urgentes» y «Revisar» sólo destacan cuando tienen algo dentro: una
    // pestaña siempre en rojo deja de significar nada en dos días.
    alerta: (clave === "urgentes" || clave === "revisar") && Boolean(contadores?.[clave]),
  }));
}

/**
 * Las actuaciones que se enseñan en la fila y cuántas quedan fuera.
 *
 * Las descartadas no cuentan: son historia, y ocuparían el sitio de las que
 * todavía hay que hacer.
 */
export function resumenActuaciones(
  actuaciones: readonly Actuacion[],
  maximo = 2
): { visibles: Actuacion[]; restantes: number } {
  const vivas = actuaciones.filter((a) => a.estado !== "DESCARTADA");
  return {
    visibles: vivas.slice(0, maximo),
    restantes: Math.max(0, vivas.length - maximo),
  };
}

/**
 * ¿Traen lo mismo los dos juegos de contadores?
 *
 * Existe para cortar un bucle de renderizado que no se ve venir: la bandeja
 * actualiza los contadores del contexto al terminar de listar, y si eso cambia
 * el estado **siempre**, el contexto se recrea, `cargar` se recrea, el efecto
 * vuelve a disparar y se lista otra vez. Una petición cada 250 ms con la
 * pantalla pintándose perfectamente.
 */
export function mismosContadores(a: Contadores | null, b: Contadores | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (Object.keys(b) as (keyof Contadores)[]).every((k) => a[k] === b[k]);
}

/** «12 días», «hoy», «1 día». En la columna de antigüedad. */
export function textoAntiguedad(dias: number): string {
  if (!Number.isFinite(dias) || dias <= 0) return "hoy";
  return dias === 1 ? "1 día" : `${dias} días`;
}

/**
 * El texto corto de una actuación: `GRABAR 2028359553`.
 *
 * El indicador adicional («T2») va detrás y entre paréntesis: no se sabe qué
 * significa, así que se enseña sin interpretarlo pero sin esconderlo.
 */
export function textoActuacion(a: Actuacion): string {
  const partes: string[] = [a.tipoAccion];
  if (a.albaranSolicitado) partes.push(a.albaranSolicitado);
  const base = partes.join(" ");
  return a.indicadorAdicional ? `${base} (${a.indicadorAdicional})` : base;
}

/**
 * ¿Hay algo en esta fila que merezca un aviso?
 *
 * Es lo que decide si la fila lleva marca. Se mira en un sitio para que la
 * tabla y el detalle no puedan decir cosas distintas del mismo expediente.
 */
export function avisosDeFila(f: FilaBandeja): string[] {
  const avisos: string[] = [];
  if (f.urgente) avisos.push("Urgente");
  if (f.numeroReclamaciones > 0) {
    avisos.push(
      f.numeroReclamaciones === 1 ? "1 reclamación" : `${f.numeroReclamaciones} reclamaciones`
    );
  }
  if (f.tareaVencida) avisos.push("Tarea vencida");
  if (f.requiereRevision) avisos.push("Requiere revisión");
  return avisos;
}
