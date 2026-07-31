import type { VehiculoInput } from "../types";

/**
 * Mapeo clave del catálogo de la ficha técnica → columna tipada del
 * vehículo. Mismo mapeo que usa el servidor en /documentos/:id/aplicar:
 * nada de texto libre salvo lo que quede fuera del catálogo.
 */
export const COLUMNAS_TEXTO: Record<string, keyof VehiculoInput> = {
  marca: "marca", modelo: "modelo", vin: "bastidor", bastidor: "bastidor",
  tipo: "tipo_ficha", variante: "variante", version: "version",
  denominacion_comercial: "denominacion_comercial", fabricante: "fabricante",
  categoria: "categoria", clasificacion: "clasificacion", carroceria: "carroceria",
  num_homologacion: "num_homologacion", combustible: "combustible", norma_emisiones: "norma_emisiones",
};
export const COLUMNAS_ENTERO: Record<string, keyof VehiculoInput> = {
  num_ejes: "num_ejes", num_ruedas: "num_ruedas", ejes_motrices: "ejes_motrices", num_cilindros: "num_cilindros",
};
export const COLUMNAS_NUMERICO: Record<string, keyof VehiculoInput> = {
  distancia_ejes: "distancia_ejes", via: "via", mma: "mma", masa_maxima_conjunto: "masa_maxima_conjunto",
  masa_orden_marcha: "masa_orden_marcha", tara: "tara", masa_remolcable: "masa_remolcable",
  longitud: "longitud", anchura: "anchura", altura: "altura", cilindrada: "cilindrada",
  potencia: "potencia", nivel_sonoro: "nivel_sonoro",
};
export const COLUMNAS_FECHA: Record<string, keyof VehiculoInput> = {
  fecha_primera_matriculacion: "fecha_matriculacion", fecha_emision: "fecha_emision",
};

/** Columna del vehículo donde vive el valor de una clave del catálogo (si tiene). */
export function columnaDe(clave: string): keyof VehiculoInput | null {
  return COLUMNAS_TEXTO[clave] ?? COLUMNAS_ENTERO[clave] ?? COLUMNAS_NUMERICO[clave] ?? COLUMNAS_FECHA[clave] ?? null;
}

export function numeroDe(v: string): number | null {
  const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "25/10/2017" o "25-10-2017" → "2017-10-25". null si no se reconoce
 *  (mejor no aplicar la fecha que romper el guardado con un formato inválido). */
export function fechaIso(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
