/**
 * «♻ Sustituir» dentro del plan de trabajo: varias ruedas a la vez.
 *
 * Parte pura (sin base ni red), con pruebas. La pantalla apunta, por cada
 * rueda que sale, a dónde va la vieja y qué se monta; nada se guarda hasta
 * «Aplicar plan».
 */

import { baseMedida } from "./medidas";

/** A dónde va la goma que sale. Son estados de tc_neumaticos. */
export type DestinoSustitucion = "almacen" | "pendiente_reciclaje" | "reparacion";

export const DESTINOS_SUSTITUCION: Record<DestinoSustitucion, { label: string; icono: string }> = {
  pendiente_reciclaje: { label: "Papelera (reciclaje)", icono: "🗑" },
  almacen: { label: "Almacén de usados", icono: "📦" },
  reparacion: { label: "Reparación / reescultura", icono: "🔧" },
};

/** Lo que se monta en su sitio. */
export type MontarEnSustitucion =
  | { tipo: "nuevo"; productoId: string; nombre: string }
  | { tipo: "catalogo"; referenciaId: string; nombre: string }
  | { tipo: "usado"; neumaticoId: string; nombre: string; mm: number | null };

export interface SustitucionPlan {
  destino: DestinoSustitucion;
  montar: MontarEnSustitucion | null;
}

/** Se queda a este margen del mínimo o menos: a la papelera. */
export const MARGEN_PAPELERA_MM = 1;
/** Mínimo si la goma no tiene ninguno conocido (llanta ni empresa). */
export const MINIMO_SIN_DATO_MM = 3;

/**
 * Qué se propone hacer con la que sale. Sin mm no se sabe: al almacén, que es
 * lo que no se puede deshacer mal (de ahí se puede mandar a reciclaje).
 */
export function sugerirDestino(mm: number | null | undefined, minimo: number | null | undefined): DestinoSustitucion {
  if (mm == null || !Number.isFinite(mm)) return "almacen";
  const umbral = (minimo ?? MINIMO_SIN_DATO_MM) + MARGEN_PAPELERA_MM;
  return mm <= umbral ? "pendiente_reciclaje" : "almacen";
}

/** Por qué se propone, en palabras. */
export function motivoSugerencia(mm: number | null | undefined, minimo: number | null | undefined): string {
  if (mm == null || !Number.isFinite(mm)) return "Sin mm medidos: al almacén, desde allí se puede reciclar.";
  const min = minimo ?? MINIMO_SIN_DATO_MM;
  return sugerirDestino(mm, minimo) === "pendiente_reciclaje"
    ? `Cerca del mínimo (${fmtMm(min)} mm): papelera.`
    : `Le quedan mm (mínimo ${fmtMm(min)} mm): almacén.`;
}

export const fmtMm = (n: number) => (Math.round(n * 10) / 10).toLocaleString("es-ES");

/** Unidades nuevas de un producto que quedarán tras el plan. */
export function nuevasQueQuedan(stock: number, plan: Record<string, SustitucionPlan>, productoId: string): number {
  const usadas = Object.values(plan).filter((s) => s.montar?.tipo === "nuevo" && s.montar.productoId === productoId).length;
  return stock - usadas;
}

/** En qué rueda del plan está ya cogida esta usada (salvo `excepto`). */
export function usadaCogidaPor(plan: Record<string, SustitucionPlan>, neumaticoId: string, excepto?: string): string | null {
  for (const [mid, s] of Object.entries(plan)) {
    if (mid !== excepto && s.montar?.tipo === "usado" && s.montar.neumaticoId === neumaticoId) return mid;
  }
  return null;
}

/** Misma medida, sin fijarse en índices de carga ni velocidad. */
export function mismaMedidaBase(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && baseMedida(a) === baseMedida(b);
}

/**
 * Asigna lo elegido. Una nueva o de catálogo puede ir a todas a la vez; una
 * usada es una goma concreta, así que va solo a una rueda y se la quita a la
 * que la tuviera.
 */
export function asignarMontar(
  plan: Record<string, SustitucionPlan>,
  destinos: string[],
  montar: MontarEnSustitucion,
): Record<string, SustitucionPlan> {
  const next = { ...plan };
  const objetivo = montar.tipo === "usado" ? destinos.slice(0, 1) : destinos;
  if (montar.tipo === "usado") {
    const otra = usadaCogidaPor(next, montar.neumaticoId, objetivo[0]);
    if (otra) next[otra] = { ...next[otra], montar: null };
  }
  for (const mid of objetivo) if (next[mid]) next[mid] = { ...next[mid], montar };
  return next;
}

/** La siguiente rueda sin nada que montar, empezando por la de después de `desde`. */
export function siguienteSinMontar(orden: string[], plan: Record<string, SustitucionPlan>, desde?: string | null): string | null {
  const i = desde ? orden.indexOf(desde) : -1;
  const rotado = [...orden.slice(i + 1), ...orden.slice(0, i + 1)];
  return rotado.find((mid) => plan[mid] && !plan[mid].montar) ?? null;
}

/** Ruedas del plan a las que aún les falta qué montar. */
export function faltanPorElegir(plan: Record<string, SustitucionPlan>): string[] {
  return Object.entries(plan).filter(([, s]) => !s.montar).map(([mid]) => mid);
}

/** Texto corto para el chip del plan. */
export function textoChip(codigo: string, s: SustitucionPlan): string {
  const que = !s.montar ? "falta elegir" : s.montar.tipo === "usado"
    ? `usada ${s.montar.nombre}${s.montar.mm != null ? ` (${fmtMm(s.montar.mm)} mm)` : ""}`
    : `nueva ${s.montar.nombre}`;
  return `♻ ${codigo} → ${que} · vieja a ${DESTINOS_SUSTITUCION[s.destino].label.toLowerCase()}`;
}
