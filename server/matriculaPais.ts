/**
 * El país de una matrícula leído de la foto: la letra de la banda azul de las
 * placas de la UE («E», «F», «NL»…).
 *
 * La IA que ya lee la matrícula lee también esa letra. Aquí solo se decide si
 * lo que devuelve vale y si se puede guardar: el país es el de la matrícula
 * del vehículo, así que solo se guarda cuando la matrícula leída es esa, y
 * nunca encima de uno que ya estaba (puesto a mano por la oficina o leído
 * antes). Solo decide cómo se dibuja la placa (src/modules/matriculaEs.ts).
 */

/** Las letras de país de la banda azul de la UE. Las mismas que el panel. */
export const CODIGOS_PAIS_UE = new Set([
  "E", "P", "F", "I", "D", "NL", "B", "L", "PL", "RO", "BG", "CZ", "SK", "H", "A", "SLO", "HR", "LT", "LV",
  "EST", "IRL", "DK", "S", "FIN", "GR", "CY", "M",
]);

/** Lo que devolvió la IA, si es una letra de país de la UE; si no, null. */
export function paisLeidoValido(v: unknown): string | null {
  const t = String(v ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return CODIGOS_PAIS_UE.has(t) ? t : null;
}

/**
 * El país leído, solo si la matrícula leída es la del vehículo. Si la foto
 * era de otro (el remolque, el de al lado), su país no es el de este.
 */
export function paisParaGuardar(
  leido: unknown,
  matriculaLeida: string | null | undefined,
  matriculaDelVehiculo: string | null | undefined,
  normalizar: (v: unknown) => string,
): string | null {
  const pais = paisLeidoValido(leido);
  if (!pais || !matriculaLeida || !matriculaDelVehiculo) return null;
  return normalizar(matriculaLeida) === normalizar(matriculaDelVehiculo) ? pais : null;
}

/** El texto que se añade a la petición a la IA, igual en todas las lecturas. */
export const INSTRUCCION_PAIS =
  "Si la placa lleva la banda azul de la Unión Europea, en «pais» pon la letra o letras del país " +
  "que aparecen debajo de las estrellas (E, F, I, D, P, NL, B, PL, RO…). Si no la lleva o no se lee, null. " +
  "No lo deduzcas por el formato: solo lo que se ve escrito en la banda.";
