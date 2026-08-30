/**
 * Reparación de neumático: qué se puede sincronizar y por qué camino.
 *
 * ── El hallazgo que gobierna este fichero ───────────────────────────────────
 *
 * `tc_registrar_reparacion` y `tc_reparar_neumatico` RECHAZAN un neumático
 * montado: «El neumático está montado; desmóntalo primero». Y en una asistencia
 * en carretera lo normal es justo eso — se repara el pinchazo con la rueda
 * puesta.
 *
 * Así que hay DOS caminos, y el estado real del neumático decide cuál:
 *
 *   · **Montado** → reparación EN SITIO. Es el camino de la APK de TyreControl:
 *     se abre una incidencia con su problema y se resuelve con
 *     `tc_resolver_incidencia_parcial`, que deja la traza en
 *     `operaciones_neumaticos` con `estado_anterior = estado_nuevo = montado`.
 *   · **No montado** → `tc_registrar_reparacion`, que además acepta coste y
 *     proveedor.
 *
 * Elegir el camino equivocado no da un resultado peor: da una excepción. Por
 * eso se decide leyendo el estado, no adivinando.
 *
 * ── Por qué no basta con buscar «repar» en un texto ─────────────────────────
 *
 * El trabajo de una asistencia es texto libre. «No se pudo reparar, se sustituye
 * la rueda» contiene «repar» y es exactamente lo contrario. Un RPC que toca
 * datos no puede dispararse por una coincidencia de letras, así que hace falta
 * una marca explícita.
 */

/** Tipos de reparación de TyreControl (`tc_cat_tipos_reparacion`). */
export const TIPOS_REPARACION = [
  "pinchazo", "valvula", "presion", "equilibrado", "llanta", "interior", "objeto", "otra",
] as const;
export type TipoReparacion = (typeof TIPOS_REPARACION)[number];

/** Resultados de TyreControl (`tc_cat_resultados_reparacion`). */
export const RESULTADOS_REPARACION = [
  "reparado", "provisional", "seguimiento", "no_reparable", "proveedor", "sustituido",
] as const;
export type ResultadoReparacion = (typeof RESULTADOS_REPARACION)[number];

/**
 * Qué acción de `tc_resolver_incidencia_parcial` corresponde a cada tipo.
 *
 * La lista de acciones que dejan traza en `operaciones_neumaticos` está fijada
 * DENTRO del RPC; si se manda una que no está en ella, la incidencia se cierra
 * pero no queda operación, que es peor que no hacer nada porque parece que
 * funcionó. Solo se admiten las que sí la dejan.
 */
const ACCION_EN_SITIO: Partial<Record<TipoReparacion, string>> = {
  pinchazo: "reparar_pinchazo",
  presion: "corregir_presion",
  valvula: "cambiar_valvula",
  equilibrado: "equilibrar",
};

/** El problema de la incidencia que se abre, por tipo de reparación. */
const PROBLEMA_EN_SITIO: Partial<Record<TipoReparacion, string>> = {
  pinchazo: "pinchazo",
  presion: "presion_baja",
  valvula: "valvula_danada",
  equilibrado: "necesita_equilibrado",
};

export function esTipoReparacion(v: unknown): v is TipoReparacion {
  return typeof v === "string" && (TIPOS_REPARACION as readonly string[]).includes(v);
}

export function esResultadoReparacion(v: unknown): v is ResultadoReparacion {
  return typeof v === "string" && (RESULTADOS_REPARACION as readonly string[]).includes(v);
}

/** ¿Se puede hacer este tipo con la rueda puesta? */
export function admiteEnSitio(tipo: TipoReparacion): boolean {
  return ACCION_EN_SITIO[tipo] != null;
}

export function accionEnSitio(tipo: TipoReparacion): string | null {
  return ACCION_EN_SITIO[tipo] ?? null;
}

export function problemaEnSitio(tipo: TipoReparacion): string | null {
  return PROBLEMA_EN_SITIO[tipo] ?? null;
}

/* ── Aptitud ─────────────────────────────────────────────────────────────── */

export type MotivoNoApta =
  | "sin_marca"            // nadie ha dicho que sea una reparación
  | "operacion_no_soportada"
  | "sin_matricula"
  | "sin_vehiculo_tc"
  | "sin_mapping"          // la empresa no está declarada: no se escribe
  | "empresa_no_por_mapping"
  | "sin_posicion"
  | "tipo_invalido"
  | "no_finalizada"
  | "fuera_de_alcance";    // no está en la lista de despliegue

export const EXPLICACION: Record<MotivoNoApta, string> = {
  sin_marca: "La asistencia no está marcada como reparación de neumático.",
  operacion_no_soportada: "Esa operación todavía no se sincroniza con TyreControl.",
  sin_matricula: "La asistencia no tiene matrícula.",
  sin_vehiculo_tc: "El vehículo no está en TyreControl.",
  sin_mapping: "El cliente no tiene empresa de TyreControl asignada.",
  empresa_no_por_mapping:
    "La empresa se dedujo porque la matrícula era única, no por una correspondencia declarada. " +
    "Para escribir hace falta asignar la empresa en la ficha del cliente.",
  sin_posicion: "No se sabe qué rueda se reparó.",
  tipo_invalido: "El tipo de reparación no es uno de los que admite TyreControl.",
  no_finalizada: "La asistencia todavía no está finalizada.",
  fuera_de_alcance: "Esta empresa todavía no está en el despliegue de TyreControl.",
};

/**
 * La operación marcada en Assist. Hoy solo hay una soportada; el resto se
 * reconoce para poder decir «todavía no» en vez de callar.
 */
export const OPERACIONES_ASSIST = [
  "reparacion_neumatico",
  "sustitucion_neumatico",
  "montaje_neumatico",
  "desmontaje_neumatico",
] as const;
export type OperacionAssist = (typeof OPERACIONES_ASSIST)[number];

export const SOPORTADAS: OperacionAssist[] = ["reparacion_neumatico"];

export type Aptitud =
  | { apta: true; tipo: TipoReparacion; resultado: ResultadoReparacion }
  | { apta: false; motivo: MotivoNoApta };

/**
 * ¿Es esta asistencia una reparación sincronizable?
 *
 * Solo mira lo que Assist sabe de sí misma. Lo de TyreControl —que el vehículo
 * exista, que la posición siga igual— se comprueba después, leyendo TC.
 */
export function evaluarAptitud(a: {
  status?: unknown;
  tcOperacion?: unknown;
  tcTipoReparacion?: unknown;
  tcResultadoReparacion?: unknown;
  tcPosicionCodigo?: unknown;
  tcNeumaticoId?: unknown;
  plate?: unknown;
}): Aptitud {
  if (String(a.status ?? "") !== "finalizada") return { apta: false, motivo: "no_finalizada" };

  const operacion = String(a.tcOperacion ?? "");
  if (!operacion) return { apta: false, motivo: "sin_marca" };
  if (!SOPORTADAS.includes(operacion as OperacionAssist)) {
    return { apta: false, motivo: "operacion_no_soportada" };
  }

  if (!String(a.plate ?? "").trim()) return { apta: false, motivo: "sin_matricula" };

  const tipo = a.tcTipoReparacion ?? "pinchazo";   // el caso de carretera por defecto
  if (!esTipoReparacion(tipo)) return { apta: false, motivo: "tipo_invalido" };

  const resultado = a.tcResultadoReparacion ?? "reparado";
  if (!esResultadoReparacion(resultado)) return { apta: false, motivo: "tipo_invalido" };

  /*
   * Sin posición no se puede saber qué rueda es, y un neumático explícito es la
   * única alternativa aceptable. Adivinar la rueda es exactamente lo que no
   * puede pasar: se repararía la ficha de otra.
   */
  if (!String(a.tcPosicionCodigo ?? "").trim() && !String(a.tcNeumaticoId ?? "").trim()) {
    return { apta: false, motivo: "sin_posicion" };
  }

  return { apta: true, tipo, resultado };
}

/* ── Despliegue controlado ───────────────────────────────────────────────── */

/**
 * Empresas de TyreControl para las que la escritura está permitida.
 *
 * Lista por entorno, separada por comas. Vacía significa NINGUNA: se empieza
 * por una empresa concreta y se amplía cuando esa funciona, no al revés.
 */
export function empresasPermitidas(): string[] {
  return String(process.env.TYRE_CONTROL_SYNC_COMPANIES ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export function empresaEnAlcance(tcEmpresaId: string | null | undefined): boolean {
  if (!tcEmpresaId) return false;
  const lista = empresasPermitidas();
  if (lista.length === 0) return false;
  if (lista.includes("*")) return true;   // solo cuando alguien lo escriba a propósito
  return lista.includes(String(tcEmpresaId));
}

/** ¿Está encendida la sincronización de reparaciones? Dos llaves, no una. */
export function sincronizacionReparacionActiva(): boolean {
  const general = String(process.env.TYRE_CONTROL_WRITE_ENABLED ?? "").toLowerCase() === "true";
  const reparacion = String(process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED ?? "").toLowerCase() === "true";
  return general && reparacion;
}
