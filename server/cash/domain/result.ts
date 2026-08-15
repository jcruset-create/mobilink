/**
 * Guardas de tipo para los resultados del motor.
 *
 * Todo el dominio devuelve uniones discriminadas por `ok`, que es la forma
 * honesta de decir "esto puede salir mal y aquí tienes por qué" sin lanzar
 * excepciones para casos de negocio corrientes (un cambio imposible NO es una
 * avería del programa).
 *
 * El problema es que `tsconfig.server.json` compila sin `strictNullChecks`
 * —decisión del proyecto, que está limpiando `server/` por partes— y sin esa
 * bandera TypeScript no estrecha uniones discriminadas: después de un
 * `if (r.ok) return;` sigue creyendo que `r` puede ser la rama buena.
 *
 * Un predicado de tipo (`x is Y`) sí funciona con cualquier configuración. Así
 * que en vez de relajar los tipos del módulo o de tocar la configuración de
 * todo el servidor, el dominio expone estas dos guardas. Se usan igual en el
 * servicio que en las pruebas, y el día que `server/` compile en modo estricto
 * seguirán siendo correctas.
 */

export type Resultado<T> = ({ ok: true } & T) | ({ ok: false } & Record<string, unknown>);

/** Rama de éxito de cualquier resultado del motor. */
export type Exito<R extends { ok: boolean }> = Extract<R, { ok: true }>;

/** Rama de fallo de cualquier resultado del motor. */
export type Fallo<R extends { ok: boolean }> = Extract<R, { ok: false }>;

export function esExito<R extends { ok: boolean }>(r: R): r is Exito<R> {
  return r.ok === true;
}

export function esFallo<R extends { ok: boolean }>(r: R): r is Fallo<R> {
  return r.ok === false;
}
