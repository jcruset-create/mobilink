/**
 * El número de cita que viene en un WhatsApp.
 *
 * Quien manda la asistencia por WhatsApp suele dar un número de cita o de
 * autorización —«Cita 694163»— y ése es el número que después pide la
 * aseguradora o el gestor de flota para pagar el servicio. Hasta ahora se
 * quedaba enterrado en las observaciones y había que copiarlo a mano al campo
 * «Autorización o cita», con lo que a veces no se copiaba.
 *
 * ── Por qué una regla y no solo la IA ────────────────────────────────────
 *
 * La extracción del WhatsApp la hace un modelo, y para un dato que luego
 * decide si se cobra el servicio conviene algo que dé siempre la misma
 * respuesta al mismo texto. Esto es determinista y se puede probar; el modelo
 * sigue mirando también, para las maneras de escribirlo que aquí no estén.
 *
 * Sin dependencias a propósito: `server/index.ts` importa medio mundo, y esta
 * regla tiene que poder probarse sin levantar nada.
 */

/**
 * Las formas de nombrarlo que se han visto. El orden importa: gana la primera
 * que encaje, y van de la más explícita a la más suelta.
 *
 * `[:\-.]?` y `n[ºo°]?` cubren «cita: 694163», «cita nº 694163», «Nº de cita
 * 694163» y «cita 694163» sin multiplicar patrones.
 */
const PATRONES: RegExp[] = [
  /\bn[ºo°]?\.?\s*de\s+cita\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
  /\bcita\s*n[ºo°]?\.?\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
  /\bcita\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
  /\bn[ºo°]?\.?\s*de\s+autorizaci[oó]n\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
  /\bautorizaci[oó]n\s*n[ºo°]?\.?\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
  /\bautorizaci[oó]n\s*[:\-.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,})/i,
];

/**
 * Palabras que pueden ir detrás de «cita» sin ser un número de cita.
 *
 * «cita previa», «cita para el martes». Sin esto, «cita previa a las 9» daría
 * «previa» como número de autorización, y un dato inventado en ese campo es
 * peor que el campo vacío: alguien lo daría por bueno al facturar.
 */
const NO_ES_NUMERO = new Set([
  "previa", "prevista", "para", "con", "en", "el", "la", "los", "las",
  "de", "del", "a", "al", "es", "sera", "será", "programada", "confirmada",
  "pendiente", "sin", "no", "hoy", "manana", "mañana", "ayer",
]);

/** Quita la puntuación de cierre que arrastra el final de una frase. */
function limpiar(v: string): string {
  return v.replace(/[.,;:)\]]+$/, "").trim();
}

/**
 * Devuelve el número de cita o autorización, o `null` si no lo hay.
 *
 * Exige al menos tres caracteres y que lleve algún dígito: un número de cita
 * sin cifras no existe, y esa condición es la que descarta de una vez todas
 * las palabras sueltas que no estén en la lista de arriba.
 */
export function numeroDeCita(texto: unknown): string | null {
  const t = String(texto ?? "");
  if (!t.trim()) return null;

  for (const patron of PATRONES) {
    const m = patron.exec(t);
    if (!m) continue;
    const bruto = limpiar(m[1] ?? "");
    if (bruto.length < 3) continue;
    if (NO_ES_NUMERO.has(bruto.toLowerCase())) continue;
    if (!/\d/.test(bruto)) continue;
    return bruto;
  }
  return null;
}
