/**
 * La medida de neumático que escribe el informe del tacógrafo, normalizada.
 *
 * ── El problema, con números ────────────────────────────────────────────────
 *
 * En las 1.744 intervenciones del centro la MISMA medida aparece escrita de
 * catorce maneras distintas:
 *
 *   295/80R22.5   295/80 R22.5   295/80R22,5   295/80/R22.5   295.80R22.5
 *   295-80R22.5   295 80R22.5    295.80 R22.5  295/80-22.5    29580R22.5
 *   295/80/R22,5  295/80 R 22.5  295/80 R22,5  295/80 22.5
 *
 * En total, 48 representaciones para 20 medidas. Sin normalizar, cruzar con el
 * catálogo de TyreControl —que escribe `295/80R22.5` y solo eso— daría casi
 * mil falsos negativos.
 *
 * ── La forma canónica ───────────────────────────────────────────────────────
 *
 * `ANCHO/PERFIL R LLANTA` más el marcado si lo trae: `295/80R22.5`,
 * `225/75R16C`. Es la que ya usa `tc_cat_medidas_neumatico`.
 *
 * ── La «C», que es la decisión que importa ──────────────────────────────────
 *
 * La C de `225/75R16C` es el marcado de carga reforzada de un neumático
 * comercial: forma parte de la designación y NO es ruido, así que se conserva
 * tal cual viene.
 *
 * Pero el catálogo de TyreControl no la escribe, y eso tenía consecuencias
 * medibles: de las 55 discrepancias que salían al cruzar, 36 eran solo la C. Y
 * los 11 vehículos que parecían cambiar de medida a lo largo de cinco años
 * eran los 11 la misma medida escrita unas veces con C y otras sin ella: con
 * la C tratada como equivalente no hay ni un solo cambio real de medida en el
 * histórico.
 *
 * De ahí las dos funciones. `normalizar` conserva la C —es el dato—, y
 * `comparar` la ignora, distinguiendo «coincide» de «coincide salvo el
 * marcado» para que la diferencia se vea en pantalla en vez de desaparecer.
 *
 * ── Esto NO sustituye al normalizador del proyecto ──────────────────────────
 *
 * TyreControl ya tiene el suyo, y manda él: `tc_medida_normalizada()` en la
 * base, con un disparador que lo aplica a todo lo que entra en
 * `tc_cat_medidas_neumatico`, y su gemelo en JavaScript, `medidaCanonica` de
 * `shared/medidas.ts`.
 *
 * Lo de aquí es otra cosa y hace falta igual: aquél FORMATEA una medida bien
 * escrita —espacios, comas, la R suelta— y éste tiene que LEER lo que escribe
 * a mano un técnico en la extranet: `29580R22.5`, `295.80R22.5`, `295-80R22.5`,
 * `275\70 R 22.5`. Esas `medidaCanonica` no las toca, así que entrarían al
 * catálogo como medidas nuevas y acabaríamos con cinco filas para la misma
 * rueda.
 *
 * Lo que sí se respeta es que la forma de salida sea EXACTAMENTE la que
 * produciría el disparador: si no, al dar de alta una medida la base la
 * reescribiría y chocaría contra el `unique` de `valor`. Hay una prueba que
 * lo comprueba sobre las 48 representaciones.
 *
 * Y la comparación se apoya en `baseMedida`, la del proyecto, en vez de
 * repetir el criterio: dos ideas distintas de «es la misma medida» es como se
 * acaba encontrando una rueda por una pantalla y no por otra.
 */

import { baseMedida } from "../../../shared/medidas.ts";

/** Lo que se puede decir de dos medidas al compararlas. */
export type Comparacion = "igual" | "solo_marcado" | "distinta" | "desconocida";

/**
 * La medida en forma canónica, o `null` si no se reconoce.
 *
 * Devolver `null` es una respuesta, no un fallo: significa «esto no lo sé
 * leer», y quien llama decide si lo guarda en crudo y pide validación. Lo que
 * no se hace nunca es adivinar.
 */
export function normalizar(bruto: string | null | undefined): string | null {
  if (bruto == null) return null;
  let s = String(bruto).toUpperCase().trim();
  if (!s) return null;

  s = s.replace(/,/g, ".");    // 22,5 → 22.5
  s = s.replace(/\\/g, "/");   // 275\70 → 275/70  (sí, viene así una vez)
  s = s.replace(/\s+/g, "");   // los espacios no significan nada aquí

  // El primer separador puede ser /, . o - o no estar; el segundo, / o - o
  // nada; la R puede ir pegada, suelta o faltar. La llanta admite un decimal.
  const m = s.match(/^(\d{3})[./-]?(\d{2})[/-]?R?[/-]?(\d{2}(?:\.\d)?)([A-Z]{0,2})$/);
  if (!m) return null;

  const [, ancho, perfil, llanta, marcado] = m;
  return `${ancho}/${perfil}R${llanta}${marcado ?? ""}`;
}

/**
 * La medida sin su marcado: `225/75R16C` → `225/75R16`.
 *
 * Es `baseMedida` del proyecto, que ya se queda con ancho/perfil/llanta y deja
 * fuera lo que venga detrás —el marcado, el índice de carga, el código de
 * velocidad—. No se reimplementa aquí.
 */
export function sinMarcado(medida: string | null | undefined): string | null {
  if (!medida) return null;
  return baseMedida(medida) || null;
}

/** El marcado, si lo lleva: `225/75R16C` → `C`. */
export function marcado(medida: string | null | undefined): string | null {
  const m = String(medida ?? "").match(/R\d{2}(?:\.\d)?([A-Z]+)$/);
  return m ? m[1] : null;
}

/**
 * ¿Son la misma medida?
 *
 * `solo_marcado` es la respuesta importante: dice «sí, pero no está escrito
 * igual». Tratarlo como `igual` escondería una diferencia real del dato;
 * tratarlo como `distinta` llenaría la pantalla de 36 discrepancias que no lo
 * son.
 */
export function comparar(
  a: string | null | undefined,
  b: string | null | undefined,
): Comparacion {
  if (!a || !b) return "desconocida";
  if (a === b) return "igual";
  const sa = sinMarcado(a);
  const sb = sinMarcado(b);
  if (sa && sb && sa === sb) return "solo_marcado";
  return "distinta";
}
