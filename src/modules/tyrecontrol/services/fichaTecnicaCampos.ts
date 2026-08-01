import type { VehiculoInput } from "../types";

/**
 * Los datos de la ficha técnica viven en tc_vehiculo_atributos_tecnicos, no
 * en columnas del vehículo. Aquí solo quedan los cuatro campos que SÍ son
 * columna porque son la identidad operativa del vehículo y los usan listas,
 * montajes, informes y la APK: marca, modelo, bastidor y fecha de
 * matriculación. Mismo mapeo que usa el servidor en /documentos/:id/aplicar.
 */
export const COLUMNAS_TEXTO: Record<string, keyof VehiculoInput> = {
  marca: "marca", modelo: "modelo", vin: "bastidor", bastidor: "bastidor",
};
export const COLUMNAS_ENTERO: Record<string, keyof VehiculoInput> = {};
export const COLUMNAS_NUMERICO: Record<string, keyof VehiculoInput> = {};
export const COLUMNAS_FECHA: Record<string, keyof VehiculoInput> = {
  fecha_primera_matriculacion: "fecha_matriculacion",
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
