/**
 * El worker de Satisfaction.
 *
 * Dos tareas en esta fase, y ninguna manda nada todavía:
 *
 *  1. **Encolar lo maduro** — las encuestas cuya espera ya venció pasan de
 *     `CREATED` a `QUEUED`.
 *  2. **Caducar** — las que se pasaron de fecha sin contestar pasan a
 *     `EXPIRED`.
 *
 * ── Por qué `QUEUED` y no `SENT` ────────────────────────────────────────────
 *
 * Porque nadie ha mandado nada. Marcar `SENT` sin haber llamado a Twilio haría
 * que las métricas de entrega contaran envíos que no existen, y que el día que
 * el envío real llegue nadie sepa cuáles se mandaron de verdad. `QUEUED`
 * describe exactamente lo que hay: está lista y esperando a que alguien la
 * mande. Tampoco se crea ninguna fila de entrega — una entrega es un intento
 * real, y todavía no hay ninguno.
 *
 * El token tampoco se emite aquí. Se emite justo antes de construir el
 * mensaje, en 1G: en la base solo queda su hash, así que el valor en claro hay
 * que usarlo en el momento o se pierde.
 */

import pool from "../db.ts";

/** Cada cinco minutos. Los retrasos se miden en minutos u horas, no en latidos. */
const CADA_MS = 5 * 60_000;

let temporizador: NodeJS.Timeout | null = null;

export type CicloSatisfaction = { encoladas: number; caducadas: number };

/**
 * Pasa a `QUEUED` las encuestas cuya espera ha vencido.
 *
 * `FOR UPDATE SKIP LOCKED` como en el outbox de TyreControl: si dos procesos
 * corren a la vez, el segundo no espera a que el primero suelte las filas —se
 * lleva las siguientes. Sin él, dos instancias del servidor harían el trabajo
 * en serie y una de las dos se quedaría bloqueada.
 *
 * Una caducada NO se encola aunque le toque enviar: se comprueba aquí y no solo
 * en el paso de caducar, porque entre los dos pasos hay un hueco y en ese hueco
 * podría colarse a la cola algo que ya no vale.
 */
export async function encolarMaduras(limite = 200, ahoraMs = Date.now()): Promise<number> {
  const r = await pool.query(
    `UPDATE survey_instances SET status = 'QUEUED', "queuedAtMs" = COALESCE("queuedAtMs", $1)
      WHERE id IN (
        SELECT id FROM survey_instances
         WHERE status = 'CREATED'
           AND "sendAfterMs" <= $1
           AND "expiresAtMs" > $1
         ORDER BY "sendAfterMs"
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [ahoraMs, limite],
  );
  return r.rowCount ?? 0;
}

/**
 * Caduca lo que se pasó de fecha sin contestar.
 *
 * Se caducan `CREATED`, `QUEUED` y `FAILED`: las tres son encuestas vivas que
 * ya no sirven. `SENT`, `DELIVERED` y `STARTED` también podrían caducar, pero
 * en esta fase no existen todavía —nadie manda nada— así que se dejan fuera
 * hasta que haya envío real y se pueda decidir con casos delante.
 *
 * NO se tocan `COMPLETED` ni `CANCELLED`. La primera porque ya tiene respuesta
 * y caducarla dejaría una respuesta colgando de una encuesta que dice no
 * haberse contestado; la segunda porque ya está cerrada a propósito.
 */
export async function caducarVencidas(limite = 500, ahoraMs = Date.now()): Promise<number> {
  const r = await pool.query(
    `UPDATE survey_instances SET status = 'EXPIRED'
      WHERE id IN (
        SELECT id FROM survey_instances
         WHERE status IN ('CREATED','QUEUED','FAILED')
           AND "expiresAtMs" <= $1
         ORDER BY "expiresAtMs"
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [ahoraMs, limite],
  );
  return r.rowCount ?? 0;
}

/**
 * Una pasada. Primero caducar y luego encolar, en ese orden a propósito: al
 * revés, algo que caduca dentro de un segundo entraría en la cola para salir
 * de ella acto seguido.
 */
export async function cicloSatisfaction(ahoraMs = Date.now()): Promise<CicloSatisfaction> {
  const caducadas = await caducarVencidas(500, ahoraMs);
  const encoladas = await encolarMaduras(200, ahoraMs);
  if (caducadas || encoladas) {
    console.log(`[Satisfaction] worker: ${encoladas} encolada(s), ${caducadas} caducada(s)`);
  }
  return { encoladas, caducadas };
}

/**
 * Arranca el worker. Idempotente: llamarlo dos veces no crea dos temporizadores.
 *
 * `unref()` para que no impida al proceso terminar, igual que el de correo.
 */
export function startSatisfactionWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    cicloSatisfaction().catch((e) =>
      console.error("[Satisfaction] worker:", e?.message));
  }, CADA_MS);
  temporizador.unref?.();
  console.log("Satisfaction: worker activo (cada 5 min)");
}

export function stopSatisfactionWorker(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
