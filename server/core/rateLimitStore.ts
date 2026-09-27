/**
 * Persistencia de los bloqueos del freno de autenticación.
 *
 * Va aparte de `rateLimit.ts` para que ese módulo siga sin tocar la base y se
 * pueda probar sin ella.
 *
 * ── El detalle que manda en el diseño ───────────────────────────────────────
 *
 * La tabla `app_auth_intentos` llega en una migración que **todavía no está
 * aplicada**, y el arreglo del freno tiene que poder desplegarse antes que
 * ninguna migración. Así que esto comprueba una vez si la tabla existe:
 *
 *   · si existe → los bloqueos sobreviven a los reinicios del proceso;
 *   · si no existe → no se conecta nada y el freno funciona solo en memoria.
 *
 * En los dos casos el login queda protegido. Lo único que cambia es si un
 * reinicio regala al atacante un contador a cero.
 */

import db from "../db.ts";
import { configurarPersistencia } from "./rateLimit.ts";

async function tablaDisponible(): Promise<boolean> {
  try {
    const r = await db.query(`SELECT to_regclass('public.app_auth_intentos') AS t`);
    return Boolean(r.rows[0]?.t);
  } catch {
    return false;
  }
}

/**
 * Conecta la persistencia si se puede. Se llama al arrancar y nunca lanza:
 * un problema aquí no puede impedir que el servidor arranque.
 */
export async function conectarPersistenciaLimites(): Promise<void> {
  try {
    if (!(await tablaDisponible())) {
      console.log(
        "[limites] app_auth_intentos no existe todavía: el freno de login funciona en memoria"
      );
      return;
    }

    configurarPersistencia({
      async cargar(clave) {
        const r = await db.query(
          `SELECT bloqueado_hasta_ms, bloqueos FROM app_auth_intentos WHERE clave = $1`,
          [clave]
        );
        const fila = r.rows[0];
        if (!fila) return null;
        return {
          bloqueadoHastaMs: Number(fila.bloqueado_hasta_ms ?? 0),
          bloqueos: Number(fila.bloqueos ?? 0),
        };
      },
      async guardar(clave, estado) {
        await db.query(
          `INSERT INTO app_auth_intentos (clave, bloqueado_hasta_ms, bloqueos, actualizado_en)
             VALUES ($1, $2, $3, now())
           ON CONFLICT (clave) DO UPDATE
             SET bloqueado_hasta_ms = EXCLUDED.bloqueado_hasta_ms,
                 bloqueos           = EXCLUDED.bloqueos,
                 actualizado_en     = now()`,
          [clave, estado.bloqueadoHastaMs, estado.bloqueos]
        );
      },
    });
    console.log("[limites] bloqueos de login persistidos en app_auth_intentos");
  } catch (e) {
    console.warn("[limites] no se ha podido conectar la persistencia:", e);
  }
}
