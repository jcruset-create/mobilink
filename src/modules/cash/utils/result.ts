/**
 * Guardas de tipo para los resultados de la API.
 *
 * El panel compila sin `strictNullChecks` (ver `tsconfig.app.json`), y sin esa
 * bandera TypeScript no estrecha uniones discriminadas: después de un
 * `if (r.ok)` sigue creyendo que `r` puede ser la otra rama. Un predicado de
 * tipo sí funciona con cualquier configuración, así que se usan estas dos en
 * lugar de relajar los tipos o de tocar la configuración de todo el panel.
 *
 * Equivalen a `server/cash/domain/result.ts`, a propósito: mismo problema y
 * misma solución a los dos lados.
 */

export type Exito<R extends { ok: boolean }> = Extract<R, { ok: true }>;
export type Fallo<R extends { ok: boolean }> = Extract<R, { ok: false }>;

export function esExito<R extends { ok: boolean }>(r: R): r is Exito<R> {
  return r.ok === true;
}

export function esFallo<R extends { ok: boolean }>(r: R): r is Fallo<R> {
  return r.ok === false;
}
