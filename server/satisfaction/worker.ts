/**
 * El worker de Satisfaction.
 *
 * Cinco tareas, en este orden y por este motivo:
 *
 *  1. **Caducar** — lo que se pasó de fecha sin contestar pasa a `EXPIRED`.
 *  2. **Reconciliar** — los intentos de los que no se supo la respuesta se
 *     aclaran preguntándole al proveedor, ANTES de que a nadie se le ocurra
 *     reintentarlos.
 *  3. **Encolar** — lo que ya cumplió su espera pasa de `CREATED` a `QUEUED`.
 *  4. **Enviar** — se reclaman encuestas encoladas y se mandan.
 *  5. **Recordar** — un único recordatorio a quien no ha contestado.
 *
 * El orden importa en los dos primeros. Caducar antes de encolar evita meter en
 * la cola algo que sale de ella acto seguido; reconciliar antes de enviar evita
 * que un intento ambiguo se convierta en un segundo WhatsApp.
 *
 * ── Sigue apagado ───────────────────────────────────────────────────────────
 *
 * El worker corre, pero la configuración viene apagada de fábrica: sin
 * `satisfaction.enabled` no se crea ninguna encuesta y no hay nada que mandar.
 * Encenderlo es una decisión, no un despliegue.
 */

import pool from "../db.ts";
import { enviarInicial, reclamarParaEnvio } from "./envio.ts";
import { enviarRecordatorio, pendientesDeRecordatorio } from "./recordatorio.ts";
import { reconciliarAmbiguos } from "./reconciliacion.ts";

/** Cada cinco minutos. Los retrasos se miden en minutos u horas, no en latidos. */
const CADA_MS = 5 * 60_000;

let temporizador: NodeJS.Timeout | null = null;

export type CicloSatisfaction = {
  encoladas: number; caducadas: number;
  enviadas: number; bloqueadas: number; reintentos: number;
  recordatorios: number; reconciliadas: number;
};

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
 * Desde 1G se caducan también `SENT`, `DELIVERED` y `STARTED`: ahora sí
 * existen, y una encuesta enviada hace tres semanas que nadie abrió está tan
 * vencida como una que no llegó a mandarse. Que el WhatsApp saliera no la hace
 * eterna; el enlace deja de valer igual.
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
         WHERE status IN ('CREATED','QUEUED','FAILED','SENT','DELIVERED','STARTED')
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

  /*
   * Reconciliar va ANTES de enviar, y ése es el punto entero: un intento del
   * que no se supo la respuesta tiene que aclararse mirando qué mandó el
   * proveedor, no reintentándose a ciegas.
   */
  let reconciliadas = 0;
  try {
    reconciliadas = (await reconciliarAmbiguos(undefined, ahoraMs)).length;
  } catch (e: unknown) {
    console.error("[Satisfaction] reconciliación:", (e as Error)?.message);
  }

  const encoladas = await encolarMaduras(200, ahoraMs);

  let enviadas = 0, bloqueadas = 0, reintentos = 0;
  try {
    for (const a of await reclamarParaEnvio(ahoraMs)) {
      /*
       * Una encuesta que falla no puede llevarse por delante a las demás: cada
       * una va en su propio try. Con un `Promise.all` un rechazo dejaría a las
       * siguientes con el lease puesto durante diez minutos.
       */
      try {
        const r = await enviarInicial(a, undefined, ahoraMs);
        if (r.estado === "enviado") enviadas++;
        else if (r.estado === "bloqueado") bloqueadas++;
        else if (r.estado === "reintentar") reintentos++;
      } catch (e: unknown) {
        console.error(`[Satisfaction] envío de la encuesta#${a.id}:`, (e as Error)?.message);
      }
    }
  } catch (e: unknown) {
    console.error("[Satisfaction] reclamación de envíos:", (e as Error)?.message);
  }

  let recordatorios = 0;
  try {
    for (const a of await pendientesDeRecordatorio(ahoraMs)) {
      try {
        if ((await enviarRecordatorio(a, undefined, ahoraMs)).estado === "enviado") recordatorios++;
      } catch (e: unknown) {
        console.error(`[Satisfaction] recordatorio de la encuesta#${a.id}:`,
          (e as Error)?.message);
      }
    }
  } catch (e: unknown) {
    console.error("[Satisfaction] pendientes de recordatorio:", (e as Error)?.message);
  }

  if (caducadas || encoladas || enviadas || bloqueadas || reintentos || recordatorios
      || reconciliadas) {
    console.log(`[Satisfaction] worker: ${encoladas} encolada(s), ${enviadas} enviada(s), ` +
      `${recordatorios} recordatorio(s), ${reintentos} reintento(s), ` +
      `${bloqueadas} bloqueada(s), ${reconciliadas} reconciliada(s), ` +
      `${caducadas} caducada(s)`);
  }
  return { encoladas, caducadas, enviadas, bloqueadas, reintentos, recordatorios, reconciliadas };
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
