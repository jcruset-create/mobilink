/**
 * De qué IP se fía el limitador de la miniweb pública.
 *
 * En su propio fichero, sin tocar la base ni Express más allá del tipo: así se
 * puede probar sin levantar PostgreSQL, que para una función que solo mira
 * cabeceras es lo razonable.
 */

import type { Request } from "express";

/**
 * De dónde viene esta petición, para poder frenarla.
 *
 * ── Por qué la ÚLTIMA de X-Forwarded-For y no la primera ────────────────────
 *
 * `X-Forwarded-For` se lee de izquierda a derecha: la primera es la que dijo el
 * cliente y las siguientes las van añadiendo los proxies. Cogiendo la primera
 * —que es lo que se hacía— cualquiera podía mandar la cabecera que quisiera y
 * estrenar cupo en cada petición: el límite por IP no frenaba absolutamente
 * nada.
 *
 * La última la escribe el proxy que tenemos delante, con la dirección de quien
 * de verdad abrió la conexión hasta él. Eso no se puede falsificar desde fuera.
 *
 * Se hace aquí y no con `trust proxy` en toda la aplicación: activarlo cambia
 * `req.ip` en las casi diecinueve mil líneas de `index.ts` a la vez, y esto es
 * un freno de dos rutas públicas, no una reforma de la confianza en la red.
 *
 * Sigue siendo best-effort —quien tenga muchas IP puede repartirse— y por eso
 * el límite que de verdad acota es el de POR ENCUESTA, cuya clave es el hash
 * del token y no depende de la red.
 */
export function ipDe(req: Request): string {
  const cabecera = req.headers["x-forwarded-for"];
  const bruto = Array.isArray(cabecera) ? cabecera.join(",") : String(cabecera ?? "");
  const saltos = bruto.split(",").map((s) => s.trim()).filter(Boolean);
  return saltos[saltos.length - 1] || req.ip || "desconocida";
}
