/**
 * ¿Son el mismo JSON, salvo el orden de las claves?
 *
 * Para no reescribir una fila con lo que ya tiene: guardar la agenda manda
 * TODAS las citas, y reescribirlas todas cada vez que se toca una fueron
 * millones de escrituras en `scheduled_jobs`. Postgres devuelve un `jsonb`
 * con las claves en su orden y el navegador manda las suyas en otro, así que
 * comparar el texto tal cual diría «distinto» siempre.
 *
 * Se compara tras pasar los dos por JSON, que es lo que se guarda: un
 * `undefined` desaparece y una fecha se vuelve texto, igual que en la base.
 */

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

export function mismoJson(a: unknown, b: unknown): boolean {
  const ida = (x: unknown) => JSON.stringify(canonico(JSON.parse(JSON.stringify(x ?? null))));
  return ida(typeof a === "string" ? JSON.parse(a) : a) === ida(typeof b === "string" ? JSON.parse(b) : b);
}
