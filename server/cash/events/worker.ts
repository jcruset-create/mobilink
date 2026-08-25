/**
 * Worker de eventos hacia MC Central.
 *
 * Vacía `cash_event_outbox`. Mismo patrón que el worker de la ERP —tanda
 * pequeña, espera creciente y `FOR UPDATE SKIP LOCKED` para que dos instancias
 * de Render no se peleen por la misma fila— y la misma regla que gobierna
 * aquél, que aquí importa todavía más:
 *
 * **Un fallo de Central nunca deshace un movimiento de efectivo.** El dinero ya
 * entró o salió del cajón; lo único pendiente es contarlo. Si Central está
 * caída, el evento espera en la cola. No hay ningún camino de código que
 * revierta una operación de caja por un error de entrega.
 *
 * Son dos ficheros y no uno compartido a propósito, de momento: comparten la
 * forma pero no lo que hacen —uno traduce a documentos de una ERP y el otro
 * entrega hechos— y con solo dos casos, extraer la abstracción cuesta más
 * claridad de la que ahorra. Si aparece un tercero, se extrae.
 */

import pool from "../../db.ts";
import {
  ErrorTransportePermanente,
  transporteActivo,
  type EventoParaEnviar,
} from "./transport.ts";

const INTERVALO_MS = 30_000;
const TANDA = 20;
const MAX_INTENTOS = 8;

/** Espera creciente: 30 s, 1 min, 2 min… hasta una hora. */
function proximoIntentoMs(intentos: number): number {
  return Date.now() + Math.min(30_000 * 2 ** intentos, 3_600_000);
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function aEvento(f: any): EventoParaEnviar {
  return {
    eventId: f.event_id,
    empresaId: f.empresa_id,
    centroId: f.centro_id ?? null,
    registerId: f.register_id ?? null,
    sessionId: f.session_id ?? null,
    aggregateType: f.aggregate_type ?? null,
    aggregateId: f.aggregate_id == null ? null : Number(f.aggregate_id),
    aggregateVersion: f.aggregate_version == null ? null : Number(f.aggregate_version),
    tipo: f.tipo,
    ocurridoEnMs: Number(f.ocurrido_en_ms),
    actorUserId: f.actor_user_id ?? null,
    datos: f.datos ?? {},
  };
}

/**
 * Procesa una tanda. Devuelve cuántos eventos ha tratado, que es lo que usan
 * las pruebas para saber que el ciclo hizo algo.
 *
 * Sin transporte registrado no toca nada y devuelve 0: los eventos se quedan
 * en PENDING esperando a que exista Central.
 */
export async function procesarEventos(limite = TANDA): Promise<number> {
  const transporte = transporteActivo();
  if (!transporte) return 0;

  const client = await pool.connect();
  let tratados = 0;

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT * FROM cash_event_outbox
        WHERE estado IN ('PENDING','RETRY_PENDING')
          AND (proximo_intento_ms IS NULL OR proximo_intento_ms <= $1)
        ORDER BY id
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [Date.now(), limite]
    );

    for (const fila of rows) {
      const intentos = fila.intentos + 1;
      try {
        await transporte.enviar(aEvento(fila));
        await marcar(client, fila.id, "SENT", intentos, null);
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : String(e);
        // Un rechazo permanente no gasta ocho intentos: a la cola muerta.
        const agotado = e instanceof ErrorTransportePermanente || intentos >= MAX_INTENTOS;
        await marcar(client, fila.id, agotado ? "ERROR" : "RETRY_PENDING", intentos, mensaje);
      }
      tratados++;
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[Mobilink Cash] error procesando eventos:", e);
  } finally {
    client.release();
  }

  return tratados;
}

async function marcar(
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  client: any,
  id: string,
  estado: "SENT" | "ERROR" | "RETRY_PENDING",
  intentos: number,
  error: string | null
): Promise<void> {
  await client.query(
    `UPDATE cash_event_outbox
        SET estado = $2, intentos = $3, last_error = $4,
            proximo_intento_ms = $5, processed_at_ms = $6
      WHERE id = $1`,
    [
      id,
      estado,
      intentos,
      error,
      estado === "RETRY_PENDING" ? proximoIntentoMs(intentos) : null,
      Date.now(),
    ]
  );
}

/**
 * Devuelve a la cola los eventos muertos de una empresa.
 *
 * `intentos = 0` a propósito: si alguien relanza es porque ha arreglado algo al
 * otro lado, y arrancar con la espera de una hora del último intento haría
 * pensar que sigue roto.
 */
export async function reintentarEventos(empresaId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE cash_event_outbox
        SET estado = 'RETRY_PENDING', intentos = 0, proximo_intento_ms = $2, last_error = NULL
      WHERE empresa_id = $1 AND estado = 'ERROR'`,
    [empresaId, Date.now()]
  );
  return rowCount ?? 0;
}

/** Cola muerta y resumen de la cola, para la pantalla de integración. */
export async function estadoCola(empresaId: string): Promise<{
  resumen: { estado: string; total: number }[];
  muertos: {
    id: string;
    eventId: string;
    tipo: string;
    ocurridoEnMs: number;
    intentos: number;
    lastError: string | null;
  }[];
}> {
  const [resumen, muertos] = await Promise.all([
    pool.query(
      `SELECT estado, COUNT(*)::int AS total FROM cash_event_outbox
        WHERE empresa_id = $1 GROUP BY estado ORDER BY estado`,
      [empresaId]
    ),
    pool.query(
      `SELECT id, event_id, tipo, ocurrido_en_ms, intentos, last_error
         FROM cash_event_outbox
        WHERE empresa_id = $1 AND estado = 'ERROR'
        ORDER BY id DESC LIMIT 100`,
      [empresaId]
    ),
  ]);

  return {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    resumen: resumen.rows.map((r: any) => ({ estado: r.estado, total: r.total })),
    muertos: muertos.rows.map((r: any) => ({
      id: String(r.id),
      eventId: r.event_id,
      tipo: r.tipo,
      ocurridoEnMs: Number(r.ocurrido_en_ms),
      intentos: r.intentos,
      lastError: r.last_error,
    })),
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}

let temporizador: NodeJS.Timeout | null = null;

export function startCashEventWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void procesarEventos();
  }, INTERVALO_MS);
  // No retiene el proceso: si no queda nada más vivo, el servidor puede salir.
  temporizador.unref?.();
}
