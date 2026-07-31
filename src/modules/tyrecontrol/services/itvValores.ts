/**
 * Reglas de valor de la ficha técnica ITV.
 *
 * Un código de la ficha solo se guarda si trae un dato de verdad: los
 * documentos vienen llenos de guiones y de códigos sin rellenar, y esos
 * NO deben ocupar una fila ni aparecer en la ficha del vehículo.
 *
 * El cero SÍ es un dato (0 plazas de pie, 0 g/km de CO2).
 */

/** Marcadores que un documento usa para decir "aquí no hay nada". */
export const MARCADORES_VACIOS = ["-", "--", "---", "N/A", "NA", "NO CONSTA", "SIN DATOS", "NULL"];

export function hasRealValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const limpio = value.trim();
    if (limpio === "") return false;
    // Una tira de guiones ("------") es la forma habitual de dejar en
    // blanco una casilla impresa.
    if (/^-+$/.test(limpio)) return false;
    return !MARCADORES_VACIOS.includes(limpio.toUpperCase());
  }
  if (Array.isArray(value)) return value.some(hasRealValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasRealValue);
  return true;
}

export type TipoDatoItv =
  | "text" | "integer" | "decimal" | "date" | "boolean" | "json" | "text_array" | "decimal_array";

export interface ValorNormalizado {
  texto: string | null;
  numero: number | null;
  fecha: string | null;      // ISO aaaa-mm-dd
  booleano: boolean | null;
  json: unknown | null;
}

const VACIO: ValorNormalizado = { texto: null, numero: null, fecha: null, booleano: null, json: null };

/**
 * "18.000 kg" → 18000 · "46,8" → 46.8 · "12.419 cm³" → 12419.
 *
 * En documentos españoles el punto es separador de miles y la coma es
 * el decimal, así que "18.000" son dieciocho mil y no dieciocho.
 */
export function numeroEspanol(v: string): number | null {
  const s = String(v).trim().replace(/\s/g, "");
  const m = s.match(/-?[\d.,]+/);
  if (!m) return null;
  let n = m[0];
  const coma = n.lastIndexOf(",");
  if (coma >= 0) {
    // Con coma: los puntos son miles y la coma el decimal.
    n = n.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(n)) {
    // Sin coma pero con puntos cada tres cifras: miles ("18.000").
    n = n.replace(/\./g, "");
  }
  const num = Number(n);
  return Number.isFinite(num) ? num : null;
}

/** "09/02/2017" → "2017-02-09". null si no se reconoce. */
export function fechaIsoItv(v: string): string | null {
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * "8000 / 13000 / / " → { eje_1: 8000, eje_2: 13000, unidad: "kg" }
 * Los tramos vacíos no se guardan: un eje sin dato no es un eje con cero.
 */
export function partesPorEje(v: string, unidad?: string | null): Record<string, unknown> | null {
  const tramos = String(v).split("/").map((t) => t.trim());
  const out: Record<string, unknown> = {};
  let algo = false;
  tramos.forEach((t, i) => {
    if (!hasRealValue(t)) return;
    const n = numeroEspanol(t);
    out[`eje_${i + 1}`] = n ?? t;
    algo = true;
  });
  if (!algo) return null;
  if (unidad) out.unidad = unidad;
  return out;
}

/**
 * Deja el valor listo para guardar según el tipo del maestro. Devuelve
 * todo a null cuando el valor no es un dato real: quien llama debe
 * comprobar `hasRealValue(bruto)` antes de crear la fila.
 */
export function normalizarValor(bruto: string, tipo: TipoDatoItv, unidad?: string | null): ValorNormalizado {
  if (!hasRealValue(bruto)) return { ...VACIO };
  const texto = String(bruto).trim();

  switch (tipo) {
    case "integer": {
      const n = numeroEspanol(texto);
      return { ...VACIO, texto, numero: n == null ? null : Math.round(n) };
    }
    case "decimal": {
      return { ...VACIO, texto, numero: numeroEspanol(texto) };
    }
    case "date": {
      return { ...VACIO, texto, fecha: fechaIsoItv(texto) };
    }
    case "boolean": {
      const t = texto.toUpperCase();
      const si = ["SI", "SÍ", "S", "TRUE", "1", "X"].includes(t);
      const no = ["NO", "N", "FALSE", "0"].includes(t);
      return { ...VACIO, texto, booleano: si ? true : no ? false : null };
    }
    case "json": {
      return { ...VACIO, texto, json: partesPorEje(texto, unidad) };
    }
    case "text_array":
    case "decimal_array": {
      const partes = texto.split("/").map((t) => t.trim()).filter(hasRealValue);
      const valores = tipo === "decimal_array" ? partes.map((p) => numeroEspanol(p) ?? p) : partes;
      return { ...VACIO, texto, json: valores.length ? valores : null };
    }
    default:
      return { ...VACIO, texto };
  }
}

/** Umbrales de confianza del extractor (los del pliego del módulo). */
export const CONFIANZA_ALTA = 0.9;
export const CONFIANZA_MINIMA = 0.7;

export type NivelConfianza = "alta" | "media" | "baja";

export function nivelConfianza(c?: number | null): NivelConfianza {
  if (c == null) return "media";
  if (c >= CONFIANZA_ALTA) return "alta";
  if (c >= CONFIANZA_MINIMA) return "media";
  return "baja";
}

/** Solo se marca solo lo que viene con confianza alta. */
export function seleccionarPorDefecto(c?: number | null): boolean {
  return nivelConfianza(c) === "alta";
}

/** Compara lo que hay con lo que llega, para la pantalla de revisión. */
export function hayCambio(actual: string | null | undefined, nuevo: string | null | undefined): boolean {
  const a = (actual ?? "").trim().toUpperCase();
  const b = (nuevo ?? "").trim().toUpperCase();
  return a !== b;
}
