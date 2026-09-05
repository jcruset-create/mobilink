/**
 * La lógica del formulario de valoración, sin React.
 *
 * Vive aparte porque es lo único con reglas de verdad —qué paso toca, cuándo
 * aparece la pregunta de los motivos, cuándo se puede enviar— y el repositorio
 * no tiene jsdom ni testing-library, así que un componente no se puede probar.
 * Extraído, sí.
 */

export type TipoPregunta = "rating" | "enum" | "multi" | "text";

export type Pregunta = {
  code: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  min?: number;
  max?: number;
  valores?: string[];
  maxLongitud?: number;
  visibleSi?: "valoracion_baja_o_no_resuelto";
};

export type Valores = Record<string, number | string | string[] | undefined>;

export const UMBRAL_BAJA = 2;

/**
 * ¿Toca enseñar esta pregunta?
 *
 * `negative_reasons` solo aparece si la cosa fue mal. Preguntarle qué falló a
 * quien acaba de poner un cinco es raro y alarga el formulario para nada.
 */
export function esVisible(p: Pregunta, valores: Valores): boolean {
  if (p.visibleSi !== "valoracion_baja_o_no_resuelto") return true;
  const general = valores.overall_rating;
  const resolucion = valores.resolution;
  return (typeof general === "number" && general <= UMBRAL_BAJA) || resolucion === "NO";
}

/**
 * Los pasos que hay que recorrer ahora mismo.
 *
 * Se recalcula con cada respuesta porque la lista cambia: poner un 1 hace
 * aparecer los motivos, subir a 4 los quita.
 */
export function pasosVisibles(preguntas: Pregunta[], valores: Valores): Pregunta[] {
  return preguntas.filter((p) => esVisible(p, valores));
}

/**
 * Lo que se manda al servidor.
 *
 * **Solo lo visible.** Si alguien puso un 1, marcó «tardaron mucho» y después
 * subió la nota a 4, los motivos dejan de aplicar y no se envían — pero
 * tampoco se borran de la pantalla, por si vuelve a bajarla. Es la decisión de
 * 1B: la visibilidad es de la interfaz, y el estado local del usuario no se
 * toca a sus espaldas.
 */
export function respuestasAEnviar(
  preguntas: Pregunta[], valores: Valores,
): { code: string; value: unknown }[] {
  return pasosVisibles(preguntas, valores)
    .map((p) => ({ code: p.code, value: valores[p.code] }))
    .filter((r) => r.value != null && r.value !== "" &&
                   !(Array.isArray(r.value) && r.value.length === 0));
}

/** ¿Está contestada? Una múltiple vacía cuenta como sin contestar. */
export function contestada(p: Pregunta, valores: Valores): boolean {
  const v = valores[p.code];
  if (v == null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Las obligatorias visibles que faltan. Vacío significa que se puede enviar. */
export function faltantes(preguntas: Pregunta[], valores: Valores): string[] {
  return pasosVisibles(preguntas, valores)
    .filter((p) => p.obligatoria && !contestada(p, valores))
    .map((p) => p.code);
}

export function puedeEnviarse(preguntas: Pregunta[], valores: Valores): boolean {
  return faltantes(preguntas, valores).length === 0;
}

/**
 * El siguiente paso al que ir desde `indice`.
 *
 * Devuelve `null` cuando ya no queda ninguno: entonces toca la pantalla de
 * confirmación.
 */
export function siguientePaso(
  preguntas: Pregunta[], valores: Valores, indice: number,
): number | null {
  const visibles = pasosVisibles(preguntas, valores);
  return indice + 1 < visibles.length ? indice + 1 : null;
}

/** Las etiquetas de la valoración general. Las otras van solo con estrellas. */
export const ETIQUETA_ESTRELLA: Record<number, string> = {
  1: "Muy mala", 2: "Mala", 3: "Correcta", 4: "Muy buena", 5: "Excelente",
};

/** El enunciado de cada pregunta, por código. */
export const ENUNCIADO: Record<string, string> = {
  overall_rating: "¿Cómo valorarías la asistencia recibida?",
  professional_rating: "¿Cómo valorarías al profesional que te atendió?",
  speed_rating: "¿Cómo valorarías la rapidez de gestión?",
  tracking_rating: "¿Cómo valorarías la información y el seguimiento?",
  resolution: "¿Quedó solucionado el motivo de la asistencia?",
  negative_reasons: "¿Qué es lo que no fue bien?",
  comment: "¿Quieres contarnos algo más?",
};

export const ETIQUETA_VALOR: Record<string, string> = {
  YES: "Sí, completamente",
  PARTIAL: "Parcialmente",
  NO: "No",
  LONG_WAIT: "Demasiado tiempo de espera",
  POOR_COMMUNICATION: "Mala comunicación o información",
  POOR_TREATMENT: "El trato recibido",
  NOT_RESOLVED: "El problema no se solucionó",
  SERVICE_PROBLEM: "Hubo un problema durante el servicio",
  VEHICLE_DAMAGE: "Daños en el vehículo",
  OTHER: "Otro motivo",
};
