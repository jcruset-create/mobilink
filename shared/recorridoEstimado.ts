/**
 * Textos de los recorridos ESTIMADOS de la reconstrucción histórica.
 *
 * Aquí NO se decide nada: si un intervalo entra en las medias y por qué no lo
 * dice la base (vista `tc_reconstruccion_intervalos`, funciones
 * `tc_imp_intervalo_en_medias` y `tc_imp_intervalo_motivos`). Esto solo pone
 * palabras a lo que la base ya ha clasificado, porque dos implementaciones de
 * la misma regla acaban divergiendo.
 */

/** Clasificación automática de los kilómetros de un intervalo. */
export type KmEstado = "utilizables" | "anomalos" | "ausentes" | "incompatibles" | "sin_cierre";
/** Decisión humana, separada de la clasificación. */
export type UsoEstadistico = "pendiente" | "aceptado" | "rechazado";

/** Qué dice cada clasificación, en una línea. */
export const TEXTO_KM_ESTADO: Record<KmEstado, string> = {
  utilizables: "recorrido calculable y plausible",
  anomalos: "recorrido calculable, pero el ritmo diario no es plausible",
  ausentes: "faltan kilómetros en algún extremo",
  incompatibles: "el kilometraje decrece: no da un recorrido válido",
  sin_cierre: "el intervalo no está cerrado",
};

/** Por qué un intervalo NO entra en las medias. Un intervalo puede tener
 *  VARIOS de estos motivos a la vez. */
export const ETIQUETA_MOTIVO: Record<string, string> = {
  sin_cierre: "sin cerrar",
  km_ausentes: "sin kilómetros",
  km_incompatibles: "kilometraje incompatible",
  km_anomalos_pendientes: "ritmo anómalo pendiente de validar",
  km_anomalos_rechazados: "ritmo anómalo rechazado",
  rechazado_a_mano: "rechazado a mano",
  continuidad_pendiente: "continuidad pendiente",
};

export function etiquetaMotivo(codigo: string): string {
  return ETIQUETA_MOTIVO[codigo] ?? codigo;
}

/** Los motivos de exclusión en un texto corto, en el orden que llegan. */
export function textoMotivos(motivos: string[] | null | undefined): string {
  if (!motivos || motivos.length === 0) return "";
  return motivos.map(etiquetaMotivo).join(" · ");
}

const NUM = new Intl.NumberFormat("es-ES");
export function numero(valor: number | null | undefined): string {
  return valor == null ? "—" : NUM.format(Math.round(valor * 100) / 100);
}

/** El ritmo calculado frente al límite aplicado. Con cero días no hay
 *  división: se compara el recorrido con el límite de un día, y se dice. */
export function textoRitmo(iv: {
  ritmo_km_dia: number | null; limite_km_dia: number | null; dias_intervalo: number | null;
}): string {
  if (iv.ritmo_km_dia == null) return "";
  const limite = iv.limite_km_dia == null ? "" : ` · límite ${numero(iv.limite_km_dia)} km/día`;
  if (iv.dias_intervalo === 0) {
    return `${numero(iv.ritmo_km_dia)} km el mismo día (no se divide entre cero: se compara con el límite de un día)${limite}`;
  }
  return `${numero(iv.ritmo_km_dia)} km/día en ${iv.dias_intervalo} día(s)${limite}`;
}

/** Qué poner en la columna «recorrido». Los valores originales no se pierden
 *  en ningún caso: cuando no hay recorrido, se enseñan los dos kilometrajes. */
export function textoRecorrido(iv: {
  km_estado: KmEstado; recorrido_km: number | null; km_montaje: number | null; km_desmontaje: number | null;
  uso_estadistico?: UsoEstadistico;
}): { texto: string; aviso: boolean } {
  switch (iv.km_estado) {
    case "utilizables":
      return { texto: `${numero(iv.recorrido_km)} km (estimado)`, aviso: false };
    case "anomalos":
      return {
        texto: `${numero(iv.recorrido_km)} km (estimado, ${
          iv.uso_estadistico === "aceptado" ? "aceptado a mano"
          : iv.uso_estadistico === "rechazado" ? "rechazado a mano"
          : "pendiente de validar"})`,
        aviso: iv.uso_estadistico !== "aceptado",
      };
    case "incompatibles":
      return { texto: `incompatible (${numero(iv.km_montaje)} → ${numero(iv.km_desmontaje)})`, aviso: true };
    case "ausentes":
      return { texto: "ausentes", aviso: false };
    default:
      return { texto: "—", aviso: false };
  }
}

/** La decisión humana, con quién y cuándo si la hay. */
export function textoDecision(iv: {
  uso_estadistico: UsoEstadistico; revisado_at: string | null; revisado_motivo: string | null;
}): string {
  if (iv.uso_estadistico === "pendiente") return "pendiente";
  const cuando = iv.revisado_at ? ` el ${iv.revisado_at.slice(0, 10)}` : "";
  return `${iv.uso_estadistico}${cuando}${iv.revisado_motivo ? `: ${iv.revisado_motivo}` : ""}`;
}

export interface CoberturaMinima {
  incluidos: { n: number; identificadas: number; ocupaciones: number };
  poblacion: { intervalos: number };
  excluidos: { n: number; motivos: { motivo: string; n: number }[] };
}

/** La frase que tiene que acompañar a CUALQUIER media de recorrido estimado.
 *  Dice sobre cuántos intervalos sale, cuántos quedan fuera y por qué, y
 *  separa unidades identificadas de ocupaciones de posición. */
export function textoCobertura(c: CoberturaMinima): string {
  const fuera = c.excluidos.motivos.length
    ? ` Fuera ${c.excluidos.n}: ${c.excluidos.motivos.map((m) => `${etiquetaMotivo(m.motivo)} ${m.n}`).join(", ")} (un intervalo puede tener varios motivos, así que no suman).`
    : c.excluidos.n > 0 ? ` Fuera ${c.excluidos.n}.` : "";
  return `Sobre ${c.incluidos.n} de ${c.poblacion.intervalos} intervalos reconstruidos`
    + ` (gomas identificadas: ${c.incluidos.identificadas} · ocupaciones de posición: ${c.incluidos.ocupaciones}).`
    + fuera;
}
