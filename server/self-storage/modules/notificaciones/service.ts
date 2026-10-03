/**
 * Notificaciones: bandeja de salida en la base + envío por el correo común.
 *
 * Se ENCOLAN dentro de la transacción que provoca el aviso (si la operación
 * hace ROLLBACK, el aviso desaparece con ella) y se ENVÍAN después, en el
 * trabajo programado. `dedupe_key` hace que reintentar una operación —un
 * webhook repetido, el motor de impagos pasando dos veces— no mande dos
 * correos.
 */

import type { Ejecutor } from "../../shared/db.ts";
import { pool } from "../../shared/db.ts";
import { componer, type DatosPlantilla, type Plantilla } from "./plantillas.ts";

/** El canal de envío. Por defecto, el SMTP común de Mobilink. */
export interface CanalCorreo {
  disponible(): boolean;
  enviar(para: string, asunto: string, texto: string): Promise<void>;
}

const canalSmtp: CanalCorreo = {
  disponible: () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  async enviar(para, asunto, texto) {
    const { getMailTransport } = await import("../../../mail.ts");
    const t = getMailTransport();
    if (!t) throw new Error("SMTP no configurado");
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: para, subject: asunto, text: texto });
  },
};

let canal: CanalCorreo = canalSmtp;
/** Sólo pruebas. */
export function fijarCanal(c: CanalCorreo | null) {
  canal = c ?? canalSmtp;
}

export type Aviso = {
  empresaId: string;
  plantilla: Plantilla;
  dedupeKey: string;
  datos: DatosPlantilla;
  destinatario: string | null;
  customerId?: string | null;
  contractId?: string | null;
  invoiceId?: string | null;
};

export async function encolar(c: Ejecutor, a: Aviso): Promise<void> {
  const { subject, body } = componer(a.plantilla, a.datos);
  await c.query(
    `INSERT INTO self_storage_notifications
       (empresa_id, customer_id, contract_id, invoice_id, template, recipient, subject, body, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (empresa_id, dedupe_key) DO NOTHING`,
    [a.empresaId, a.customerId ?? null, a.contractId ?? null, a.invoiceId ?? null, a.plantilla, a.destinatario, subject, body, `${a.plantilla}:${a.dedupeKey}`]
  );
}

/** Trabajo programado: manda lo pendiente. Un fallo no para a los demás. */
export async function enviarPendientes(limite = 50): Promise<{ enviados: number; fallidos: number; omitidos: number }> {
  const r = { enviados: 0, fallidos: 0, omitidos: 0 };
  const { rows } = await pool.query(
    `SELECT id, recipient, subject, body, attempts FROM self_storage_notifications
      WHERE status = 'pending' ORDER BY created_at LIMIT $1`,
    [limite]
  );
  for (const n of rows) {
    if (!n.recipient || !canal.disponible()) {
      await pool.query(`UPDATE self_storage_notifications SET status = 'skipped', last_error = $2 WHERE id = $1`, [
        n.id,
        n.recipient ? "SMTP no configurado" : "Sin destinatario",
      ]);
      r.omitidos++;
      continue;
    }
    try {
      await canal.enviar(n.recipient, n.subject, n.body);
      await pool.query(`UPDATE self_storage_notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [n.id]);
      r.enviados++;
    } catch (e) {
      const intentos = Number(n.attempts) + 1;
      await pool.query(`UPDATE self_storage_notifications SET attempts = $2, last_error = $3, status = $4 WHERE id = $1`, [
        n.id,
        intentos,
        String(e instanceof Error ? e.message : e).slice(0, 500),
        intentos >= 5 ? "failed" : "pending",
      ]);
      r.fallidos++;
    }
  }
  return r;
}
