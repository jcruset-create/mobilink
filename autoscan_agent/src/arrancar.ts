/**
 * El punto de entrada, y nada más.
 *
 * Existe separado de `main.ts` para que ese fichero pueda importarse desde las
 * pruebas sin que arranque un agente de verdad: un módulo que hace cosas al
 * importarse es imposible de probar por partes.
 *
 * Lo lanza la tarea programada que registra el instalador:
 *   node --experimental-strip-types src/arrancar.ts
 */

import { principal } from "./main.ts";

principal().catch((e: unknown) => {
  /*
   * Si el arranque falla, se dice y se sale con error, para que el programador
   * de tareas lo cuente como fallo y lo reintente. Callar aquí dejaría el
   * agente muerto y la bandeja en gris sin explicación.
   */
  process.stderr.write(`[agente] no ha podido arrancar: ${String(e)}\n`);
  process.exit(1);
});
