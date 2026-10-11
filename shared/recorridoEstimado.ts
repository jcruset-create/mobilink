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
  mismo_dia_orden_desconocido: "mismo día, orden y duración desconocidos",
  rechazado_a_mano: "rechazado a mano",
  continuidad_pendiente: "continuidad pendiente",
  continuidad_rechazada: "continuidad rechazada",
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

/** El ritmo calculado frente al límite aplicado.
 *
 *  Con montaje y desmontaje el MISMO día no hay ritmo que enseñar: no se sabe
 *  en qué orden se hicieron los trabajos ni cuánto tiempo pasó, así que no se
 *  publica ningún «km/día» que nadie ha observado. Se dice la limitación. */
export function textoRitmo(iv: {
  ritmo_km_dia: number | null; limite_km_dia: number | null; dias_intervalo: number | null;
  orden_desconocido?: boolean;
}): string {
  const limite = iv.limite_km_dia == null ? "" : ` · límite ${numero(iv.limite_km_dia)} km/día`;
  if (iv.dias_intervalo === 0) {
    return `mismo día: no se conoce el orden de los trabajos ni la duración, así que no hay ritmo diario${limite}`;
  }
  if (iv.ritmo_km_dia == null) return "";
  return `${numero(iv.ritmo_km_dia)} km/día en ${iv.dias_intervalo} día(s)${limite}`;
}

/** Qué poner en la columna «recorrido». Los valores originales no se pierden
 *  en ningún caso: cuando no hay recorrido, se enseñan los dos kilometrajes. */
export function textoRecorrido(iv: {
  km_estado: KmEstado; recorrido_km: number | null; km_montaje: number | null; km_desmontaje: number | null;
  uso_estadistico?: UsoEstadistico; orden_desconocido?: boolean;
}): { texto: string; aviso: boolean } {
  // El mismo día con recorrido positivo tiene su propia etiqueta: el dato
  // existe, pero no se puede usar hasta revisar el orden de los trabajos.
  if (iv.orden_desconocido && iv.km_estado === "utilizables") {
    return {
      texto: `${numero(iv.recorrido_km)} km el mismo día (${
        iv.uso_estadistico === "aceptado" ? "aceptado a mano"
        : iv.uso_estadistico === "rechazado" ? "rechazado a mano"
        : "orden sin revisar"})`,
      aviso: iv.uso_estadistico !== "aceptado",
    };
  }
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

/** La decisión humana sobre los KILÓMETROS, con quién y cuándo si la hay. */
export function textoDecision(iv: {
  uso_estadistico: UsoEstadistico; revisado_at: string | null; revisado_motivo: string | null;
}): string {
  if (iv.uso_estadistico === "pendiente") return "km: pendiente";
  const cuando = iv.revisado_at ? ` el ${iv.revisado_at.slice(0, 10)}` : "";
  return `km: ${iv.uso_estadistico}${cuando}${iv.revisado_motivo ? `: ${iv.revisado_motivo}` : ""}`;
}

/** La decisión humana sobre la CONTINUIDAD. Es otra: aceptar un kilometraje
 *  no dice nada sobre si faltó un montaje por medio. */
export function textoDecisionContinuidad(iv: {
  continuidad_decision: "pendiente" | "aceptada" | "rechazada";
  continuidad_revisada_at: string | null; continuidad_motivo_revision: string | null;
}): string {
  if (iv.continuidad_decision === "pendiente") return "continuidad: pendiente";
  const cuando = iv.continuidad_revisada_at ? ` el ${iv.continuidad_revisada_at.slice(0, 10)}` : "";
  return `continuidad: ${iv.continuidad_decision}${cuando}`
    + (iv.continuidad_motivo_revision ? `: ${iv.continuidad_motivo_revision}` : "");
}

export interface CoberturaMinima {
  incluidos: { n: number; respaldada: number; reconstruida: number; sin_ficha: number };
  poblacion: { intervalos: number };
  embudo?: { con_recorrido_aritmetico: number; elegibles_tras_filtros: number };
  excluidos: { n: number; motivos: { motivo: string; n: number }[] };
}

/** La frase que tiene que acompañar a CUALQUIER media de recorrido estimado.
 *  Dice sobre cuántos intervalos sale, cuántos quedan fuera y por qué, y
 *  separa unidades identificadas de ocupaciones de posición. */
export function textoCobertura(c: CoberturaMinima): string {
  const fuera = c.excluidos.motivos.length
    ? ` Fuera ${c.excluidos.n}: ${c.excluidos.motivos.map((m) => `${etiquetaMotivo(m.motivo)} ${m.n}`).join(", ")} (un intervalo puede tener varios motivos, así que no suman).`
    : c.excluidos.n > 0 ? ` Fuera ${c.excluidos.n}.` : "";
  const embudo = c.embudo && c.embudo.con_recorrido_aritmetico !== c.incluidos.n
    ? ` De los ${c.embudo.con_recorrido_aritmetico} con recorrido calculable, ${c.incluidos.n} pasan todos los filtros.`
    : "";
  return `Sobre ${c.incluidos.n} de ${c.poblacion.intervalos} intervalos reconstruidos`
    + ` (identidad respaldada: ${c.incluidos.respaldada} · ficha reconstruida: ${c.incluidos.reconstruida}`
    + ` · sin ficha: ${c.incluidos.sin_ficha}).`
    + embudo + fuera;
}
