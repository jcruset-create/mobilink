/**
 * Webhooks de salida.
 *
 * Misma cola y mismos reintentos que los avisos por correo, porque el problema
 * es el mismo: **un destino caído no puede tumbar lo que generó el evento**.
 *
 * Lo que cambia es la firma. Cada envío lleva un HMAC del cuerpo con el secreto
 * del webhook, y con eso quien lo recibe puede comprobar que viene de aquí. Sin
 * firma, cualquiera que averiguara la URL podría inventarse un cierre de caja
 * de 40.000 € y el receptor no tendría forma de distinguirlo.
 *
 * La firma en sí vive en `signature.ts`, sin base de datos, para que se pueda
 * probar sola: es la parte que un integrador implementa del otro lado.
 */

import { randomBytes } from "node:crypto";
import { cabeceraFirma } from "./signature.ts";
import pool from "../../db.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_INTENTOS = 6;
const INTERVALO_MS = 60_000;

export type Webhook = {
  id: string;
  url: string;
  eventos: string[];
  activo: boolean;
};

export async function listarWebhooks(empresaId: string): Promise<Webhook[]> {
  const { rows } = await pool.query(
    `SELECT id, url, eventos, activo FROM central_webhooks
      WHERE empresa_id = $1 ORDER BY creado_en_ms`,
    [empresaId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    url: r.url,
    eventos: r.eventos ?? [],
    activo: r.activo,
  }));
}

/** Crea un webhook y devuelve su secreto una sola vez, como el de un cliente. */
export async function crearWebhook(
  empresaId: string,
  url: string,
  eventos: string[]
): Promise<{ id: string; secreto: string }> {
  if (!/^https:\/\//i.test(url)) {
    // Solo HTTPS: por aquí viajan cierres de caja e incidencias con importes.
    throw new Error("La URL de un webhook tiene que ser https.");
  }
  const secreto = randomBytes(32).toString("base64url");
  const { rows } = await pool.query(
    `INSERT INTO central_webhooks (empresa_id, url, secreto, eventos, creado_en_ms)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [empresaId, url, secreto, eventos, Date.now()]
  );
  return { id: rows[0].id, secreto };
}

/**
 * Encola un evento para los webhooks suscritos.
 *
 * Como en los avisos por correo, `eventos` vacío significa todos, y esto no
 * revienta nunca hacia fuera: lo que generó el evento ya ocurrió y no puede
 * deshacerse porque un webhook esté mal configurado.
 */
export async function encolarEvento(
  empresaId: string,
  evento: string,
  idempotencyKey: string,
  cuerpo: Record<string, unknown>
): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT id, eventos FROM central_webhooks WHERE empresa_id = $1 AND activo`,
      [empresaId]
    );
    const destinos = rows.filter(
      (w: any) => (w.eventos ?? []).length === 0 || (w.eventos ?? []).includes(evento)
    );

    for (const w of destinos) {
      await pool.query(
        `INSERT INTO central_webhook_deliveries
           (webhook_id, empresa_id, evento, idempotency_key, cuerpo, creado_en_ms)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (webhook_id, idempotency_key) DO NOTHING`,
        [w.id, empresaId, evento, idempotencyKey, JSON.stringify(cuerpo), Date.now()]
      );
    }
    return destinos.length;
  } catch (e) {
    console.error("[MC Central] no se han podido encolar los webhooks:", e);
    return 0;
  }
}

function proximoIntentoMs(intentos: number): number {
  return Date.now() + Math.min(60_000 * 2 ** intentos, 3_600_000);
}

/** Manda una tanda. Devuelve cuántos ha tratado. */
export async function enviarPendientes(limite = 20): Promise<number> {
  const { rows } = await pool.query(
    `SELECT d.*, w.url, w.secreto
       FROM central_webhook_deliveries d
       JOIN central_webhooks w ON w.id = d.webhook_id
      WHERE d.estado IN ('PENDIENTE','ERROR')
        AND d.intentos < $2
        AND (d.proximo_intento_ms IS NULL OR d.proximo_intento_ms <= $1)
        AND w.activo
      ORDER BY d.id
      LIMIT $3`,
    [Date.now(), MAX_INTENTOS, limite]
  );

  let tratados = 0;
  for (const d of rows) {
    const intentos = d.intentos + 1;
    const cuerpo = JSON.stringify(d.cuerpo);
    const marca = Date.now();

    try {
      const respuesta = await fetch(d.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": d.idempotency_key,
          "x-mobilink-event": d.evento,
          // Formato `t=<ms>,v1=<hmac>`, como Stripe: quien haya integrado uno
          // de esos ya sabe verificarla sin leer documentación.
          "x-mobilink-signature": cabeceraFirma(d.secreto, marca, cuerpo),
        },
        body: cuerpo,
        signal: AbortSignal.timeout(10_000),
      });

      if (respuesta.ok) {
        await pool.query(
          `UPDATE central_webhook_deliveries
              SET estado = 'ENVIADO', intentos = $2, codigo_http = $3,
                  enviado_en_ms = $4, last_error = NULL
            WHERE id = $1`,
          [d.id, intentos, respuesta.status, Date.now()]
        );
      } else {
        await marcarError(d.id, intentos, `HTTP ${respuesta.status}`, respuesta.status);
      }
    } catch (e) {
      await marcarError(d.id, intentos, e instanceof Error ? e.message : String(e), null);
    }
    tratados++;
  }

  return tratados;
}

async function marcarError(
  id: number,
  intentos: number,
  mensaje: string,
  codigo: number | null
): Promise<void> {
  await pool.query(
    `UPDATE central_webhook_deliveries
        SET estado = 'ERROR', intentos = $2, last_error = $3, codigo_http = $4,
            proximo_intento_ms = $5
      WHERE id = $1`,
    [id, intentos, mensaje.slice(0, 500), codigo, proximoIntentoMs(intentos)]
  );
}

let temporizador: NodeJS.Timeout | null = null;

export function startCentralWebhookWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void enviarPendientes();
  }, INTERVALO_MS);
  temporizador.unref?.();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
