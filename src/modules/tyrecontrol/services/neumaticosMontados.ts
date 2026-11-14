/**
 * Los neumáticos que un vehículo YA LLEVA PUESTOS.
 *
 * Dos cosas distintas que la gente de patio hace sobre el mismo plano y que
 * aquí no se mezclan, porque escriben cosas distintas en el histórico:
 *
 *  1. **Informar por primera vez** una posición vacía. El camión entra en
 *     TyreControl con sus gomas montadas desde hace meses. Apuntarlas no es
 *     una venta, ni un trabajo de taller, ni una salida de almacén: es
 *     reconocer lo que ya está ahí. Va por `tc_inventario_inicial_posicion`,
 *     que no descuenta stock y marca el origen como `carga_inicial`.
 *
 *  2. **Actualizar** una posición ya informada cuyo registro NO coincide con
 *     la rueda que hay delante. Eso es una corrección del registro, no un
 *     cambio de neumático: va por `tc_corregir_montado`, que no genera coste
 *     ni mano de obra y manda la goma mal fichada a `no_localizado` —no al
 *     almacén, porque que la ficha estuviera mal no significa que la goma
 *     esté en la estantería—.
 *
 * Y una tercera, que es la misma en los dos casos: **la medición**. La
 * profundidad y la presión van siempre a `revisiones_neumaticos_detalle` por
 * la misma puerta que todas las demás.
 *
 * Este módulo es solo la decisión: qué filas hay, si están bien rellenadas y
 * qué llamada le toca a cada una. No habla con la base ni con React, para
 * poder probarlo.
 */

import type { MontajeActual, Neumatico, PosicionVehiculo } from "../types";

// Los mismos límites que valida la función de la base. Repetirlos aquí no es
// duplicar la regla: es poder decírselo al usuario antes de ir y volver, con
// el cursor todavía en el campo. La base sigue siendo la que manda.
export const PROFUNDIDAD_MAX_MM = 30;
export const PRESION_MAX_BAR = 15;

/** Una posición del plano, con lo que hay registrado en ella. */
export interface FilaMontada {
  posicionId: string;
  codigo: string;
  orden: number;
  /** null cuando la posición está libre: no hay nada que corregir todavía. */
  montajeId: string | null;
  neumatico: Neumatico | null;
}

/** Lo que el usuario escribe en una fila. Todo texto: sale de inputs. */
export interface BorradorFila {
  /** Posición libre: referencia de catálogo de la goma que lleva puesta. */
  referenciaId: string;
  profundidadMm: string;
  presionBar: string;
  numeroSerie: string;
  dot: string;
  observaciones: string;
  /** Posición informada: ¿la rueda que hay es la que dice Mobilink? */
  coincide: boolean;
  /** Si no coincide: la goma de verdad ¿tiene ficha o hay que crearla? */
  correccion: "ficha" | "nueva";
  neumaticoCorrectoId: string;
  marca: string;
  modelo: string;
  medida: string;
  motivo: string;
}

export function borradorVacio(): BorradorFila {
  return {
    referenciaId: "", profundidadMm: "", presionBar: "", numeroSerie: "", dot: "",
    observaciones: "", coincide: true, correccion: "ficha", neumaticoCorrectoId: "",
    marca: "", modelo: "", medida: "", motivo: "",
  };
}

/**
 * Qué llamada le toca a una fila.
 *
 * `nada` es un resultado de primera clase y no un hueco: una fila que el
 * usuario no ha tocado no se envía. Repasar un plano de doce ruedas para
 * cambiar una no puede reescribir las otras once.
 */
export type Accion = "nada" | "informar" | "corregir" | "corregir_nueva" | "medir";

const num = (s: string): number | null => {
  const t = (s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Construye las filas del plano, en el orden en que se ven en la pantalla. */
export function filasDelPlano(posiciones: PosicionVehiculo[], montajes: MontajeActual[]): FilaMontada[] {
  const porPosicion = new Map(montajes.map((m) => [m.posicion_id, m]));
  return [...posiciones]
    .filter((p) => p.activo !== false)
    .sort((a, b) => (a.orden_revision ?? 9999) - (b.orden_revision ?? 9999) || a.orden_visual - b.orden_visual)
    .map((p) => {
      const m = porPosicion.get(p.id);
      return {
        posicionId: p.id,
        codigo: p.nombre ?? p.codigo_posicion,
        orden: p.orden_visual,
        montajeId: m?.id ?? null,
        neumatico: m?.neumatico ?? null,
      };
    });
}

/**
 * Qué hay que hacer con esta fila.
 *
 * El orden importa: una posición libre sin referencia elegida no se informa
 * aunque lleve profundidad, porque sin saber QUÉ goma es no hay nada que
 * montar. Y en una posición ya informada, cambiar el neumático manda sobre
 * medir: la corrección arrastra la medición si la hay.
 */
export function accionDeFila(fila: FilaMontada, b: BorradorFila): Accion {
  if (!fila.montajeId) {
    return b.referenciaId.trim() ? "informar" : "nada";
  }
  if (!b.coincide) {
    return b.correccion === "nueva" ? "corregir_nueva" : "corregir";
  }
  // Coincide la goma: lo único que puede haber cambiado es la medición, y
  // solo si el usuario ha escrito una profundidad. La presión sola no abre
  // una revisión: sin profundidad la base la rechaza, y con razón.
  return b.profundidadMm.trim() ? "medir" : "nada";
}

/**
 * El error que impide guardar esta fila, en cristiano, o null.
 *
 * Se valida solo lo que la fila va a hacer de verdad: pedirle la profundidad
 * a una fila que nadie ha tocado convertiría la pantalla en un muro.
 */
export function validarFila(fila: FilaMontada, b: BorradorFila): string | null {
  const accion = accionDeFila(fila, b);
  if (accion === "nada") return null;

  if (accion === "corregir" && !b.neumaticoCorrectoId.trim()) {
    return "Elige la ficha del neumático que hay de verdad";
  }
  if (accion === "corregir_nueva") {
    if (!b.marca.trim()) return "Falta la marca de la goma que has encontrado";
    if (!b.medida.trim()) return "Falta la medida de la goma que has encontrado";
  }

  // La profundidad es obligatoria al informar: es el dato por el que existe
  // TyreControl. Al corregir no, porque corregir QUÉ goma hay y medirla son
  // dos cosas y no siempre se hacen el mismo día.
  const prof = num(b.profundidadMm);
  if (accion === "informar" || accion === "medir") {
    if (prof === null) return "Falta la profundidad: sin ella la goma no se puede seguir";
  }
  if (prof !== null) {
    if (Number.isNaN(prof)) return "La profundidad no es un número";
    if (prof < 0 || prof > PROFUNDIDAD_MAX_MM) return `Profundidad imposible: ${b.profundidadMm} mm`;
  }

  const pres = num(b.presionBar);
  if (pres !== null) {
    if (Number.isNaN(pres)) return "La presión no es un número";
    // Cero no es «no medida»: cero es rueda desinflada, y mentiría en cada
    // informe que la mire. Lo que no se ha medido se deja en blanco.
    if (pres <= 0 || pres > PRESION_MAX_BAR) return `Presión imposible: ${b.presionBar} bar`;
  }
  return null;
}

/**
 * El `p_datos` de la medición.
 *
 * Lo que está en blanco no viaja: un campo vacío no es un dato, y mandarlo
 * como cadena vacía obligaría a la base a distinguir entre «no lo sé» y «lo
 * he mirado y no hay».
 */
export function datosMedicion(b: BorradorFila): Record<string, string> {
  const datos: Record<string, string> = {};
  const prof = (b.profundidadMm ?? "").trim().replace(",", ".");
  if (prof) datos.profundidad_mm = prof;
  const pres = (b.presionBar ?? "").trim().replace(",", ".");
  if (pres) datos.presion_bar = pres;
  const serie = (b.numeroSerie ?? "").trim();
  if (serie) datos.numero_serie = serie;
  const dot = (b.dot ?? "").trim();
  if (dot) datos.dot = dot;
  const obs = (b.observaciones ?? "").trim();
  if (obs) datos.observaciones = obs;
  return datos;
}

/** Resumen para el pie del modal: lo que se va a escribir, contado. */
export interface Resumen {
  informar: number;
  corregir: number;
  medir: number;
  total: number;
  errores: { codigo: string; error: string }[];
}

export function resumen(filas: FilaMontada[], borradores: Record<string, BorradorFila>): Resumen {
  const r: Resumen = { informar: 0, corregir: 0, medir: 0, total: 0, errores: [] };
  for (const fila of filas) {
    const b = borradores[fila.posicionId] ?? borradorVacio();
    const accion = accionDeFila(fila, b);
    if (accion === "nada") continue;
    const error = validarFila(fila, b);
    if (error) { r.errores.push({ codigo: fila.codigo, error }); continue; }
    if (accion === "informar") r.informar += 1;
    else if (accion === "medir") r.medir += 1;
    else r.corregir += 1;
    r.total += 1;
  }
  return r;
}

/**
 * ¿Se puede cerrar el inventario inicial?
 *
 * La base lo vuelve a comprobar y dice cuáles faltan; esto solo evita ofrecer
 * un botón que se sabe que va a fallar. Se mira el plano DESPUÉS de guardar,
 * no el borrador: lo que cuenta es lo que hay escrito, no lo que se tecleó.
 */
export function planoCompleto(filas: FilaMontada[]): boolean {
  return filas.length > 0 && filas.every((f) => f.montajeId !== null);
}

/** Las posiciones que siguen sin goma, para decir cuáles son y no cuántas. */
export function posicionesSinInformar(filas: FilaMontada[]): string[] {
  return filas.filter((f) => f.montajeId === null).map((f) => f.codigo);
}

/** Cómo se lee un neumático en una línea: número interno primero. */
export function etiquetaNeumatico(n: Neumatico | null): string {
  if (!n) return "—";
  return n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? n.id.slice(0, 8);
}

export function descripcionNeumatico(n: Neumatico | null): string {
  if (!n) return "—";
  return [n.marca, n.modelo, n.medida].filter(Boolean).join(" · ") || "—";
}
