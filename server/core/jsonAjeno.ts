/**
 * El JSON que devuelve una API de fuera.
 *
 * `Response.json()` devuelve `unknown`, y hace bien: nadie puede prometer qué
 * trae una respuesta ajena. Pero el código que la usa —Webfleet, Google
 * Routes, Google Geocoding— lleva años leyendo `data.errorCode`, `data.routes`
 * o `data.results` directamente, y hasta ahora nadie se enteraba porque
 * `server/index.ts` no pasaba por el typecheck.
 *
 * Esta función no inventa una forma que no sabemos: dice explícitamente que lo
 * que viene de fuera no está validado, y lo dice UNA vez y con su motivo en
 * lugar de trece `as any` sueltos por el fichero, que es lo que acabaría
 * pasando.
 *
 * Lo que NO es: una excusa para no comprobar. Quien lea un campo de aquí sigue
 * teniendo que mirar si existe —`data?.errorCode`, `?.[0]`— exactamente igual
 * que antes. Lo único que cambia es que el compilador ya no da un error que
 * no lleva a ninguna parte.
 */
export async function jsonAjeno(respuesta: Response): Promise<any> {
  return respuesta.json();
}
