/**
 * Notification Hub de MC Central.
 *
 * **No es un tercer sistema de correo.** El proyecto ya tiene el transporte SMTP
 * en `server/mail.ts` —compartido por el index y por el vigilante del buzón del
 * CheckPoint— y lo que falta no es otro `nodemailer`, sino saber a quién avisar
 * de qué. Eso es lo único que hay aquí: destinatarios, una cola y un worker.
 *
 * La regla que gobierna el fichero, y que es la misma que ya declara
 * `server/mail.ts`: **un aviso que no se puede mandar no debe tumbar la
 * operación que lo generó.** Sin SMTP configurado, los avisos se quedan en
 * PENDIENTE esperando, exactamente como los eventos esperan a que exista
 * Central. No es un error: es una cola sin salida todavía.
 *
 * Y un aviso por incidencia, no por evaluación. Las incidencias ya están
 * deduplicadas por hecho (fase 7), así que un problema que dura tres días
 * genera un correo, no tres. La barrera es un índice único, no un `if`.
 */

import pool from "../../db.ts";
import { getMailTransport } from "../../mail.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Canal = {
  id: string;
  canal: string;
  destino: string;
  ambito: string;
  ambitoId: string | null;
  tipos: string[];
  activo: boolean;
};

export async function listarCanales(empresaId: string): Promise<Canal[]> {
  const { rows } = await pool.query(
    `SELECT id, canal, destino, ambito, ambito_id, tipos, activo
       FROM central_notification_channels
      WHERE empresa_id = $1
      ORDER BY ambito, destino`,
    [empresaId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    canal: r.canal,
    destino: r.destino,
    ambito: r.ambito,
    ambitoId: r.ambito_id ?? null,
    tipos: r.tipos ?? [],
    activo: r.activo,
  }));
}

export async function guardarCanal(
  ctx: { empresaId: string },
  e: {
    destino: string;
    ambito?: string;
    ambitoId?: string | null;
    tipos?: string[];
    activo?: boolean;
  }
): Promise<Canal> {
  const destino = (e.destino ?? "").trim();
  if (!destino.includes("@")) {
    throw new Error("Hace falta un correo válido para poder avisar.");
  }

  const ahora = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO central_notification_channels
       (empresa_id, canal, destino, ambito, ambito_id, tipos, activo, creado_en_ms, actualizado_en_ms)
     VALUES ($1,'EMAIL',$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (empresa_id, canal, lower(destino), ambito, COALESCE(ambito_id, ''))
       DO UPDATE SET tipos = EXCLUDED.tipos, activo = EXCLUDED.activo,
                     actualizado_en_ms = EXCLUDED.actualizado_en_ms
     RETURNING id, canal, destino, ambito, ambito_id, tipos, activo`,
    [
      ctx.empresaId,
      destino,
      e.ambito ?? "EMPRESA",
      e.ambitoId ?? null,
      e.tipos ?? [],
      e.activo ?? true,
      ahora,
    ]
  );

  const r = rows[0];
  return {
    id: r.id,
    canal: r.canal,
    destino: r.destino,
    ambito: r.ambito,
    ambitoId: r.ambito_id ?? null,
    tipos: r.tipos ?? [],
    activo: r.activo,
  };
}

/** Los canales que alcanzan a una incidencia concreta. */
async function canalesPara(
  empresaId: string,
  incidencia: { tipo: string; registerId: number | null; centroId: string | null }
): Promise<Canal[]> {
  const canales = await listarCanales(empresaId);
  return canales.filter((c) => {
    if (!c.activo) return false;
    // `tipos` vacío = todos. Es el caso normal al empezar, y obligar a
    // enumerarlos solo conseguiría que alguien olvidara uno.
    if (c.tipos.length > 0 && !c.tipos.includes(incidencia.tipo)) return false;

    switch (c.ambito) {
      case "EMPRESA":
        return true;
      case "CENTRO":
        return !!incidencia.centroId && incidencia.centroId === c.ambitoId;
      case "CAJA":
        return String(incidencia.registerId) === String(c.ambitoId);
      default:
        // La zona necesitaría resolver el centro de la caja; hoy no se ofrece
        // en la pantalla, así que no se inventa un comportamiento para ella.
        return false;
    }
  });
}

/**
 * Encola los avisos de una incidencia recién abierta.
 *
 * Se llama SOLO cuando la incidencia es nueva, no en cada evaluación. Y no
 * revienta nunca hacia fuera: si algo falla aquí, la incidencia ya está
 * registrada y eso es lo que no se puede perder.
 */
export async function avisarDeIncidencia(
  empresaId: string,
  incidencia: {
    id: string;
    tipo: string;
    registerId: number | null;
    centroId: string | null;
    caja: string | null;
    valor: number;
    umbral: number;
  }
): Promise<number> {
  try {
    const canales = await canalesPara(empresaId, incidencia);
    if (canales.length === 0) return 0;

    const { asunto, cuerpo } = redactar(incidencia);
    const ahora = Date.now();

    for (const c of canales) {
      await pool.query(
        `INSERT INTO central_notifications
           (empresa_id, incident_id, channel_id, canal, destino, asunto, cuerpo, creado_en_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (incident_id, canal, lower(destino)) DO NOTHING`,
        [empresaId, Number(incidencia.id), c.id, c.canal, c.destino, asunto, cuerpo, ahora]
      );
    }
    return canales.length;
  } catch (e) {
    console.error("[MC Central] no se han podido encolar los avisos:", e);
    return 0;
  }
}

const ETIQUETA: Record<string, string> = {
  DESCUADRE: "Descuadre de arqueo",
  TRANSITO_DIAS: "Dinero fuera del cajón",
  SIN_CERRAR_DIAS: "Caja sin cerrar",
  PENDIENTE_BANCO_DIAS: "Cierres sin llevar al banco",
  CALDERILLA_MINIMA: "Poca calderilla",
};

const EN_EUROS = new Set(["DESCUADRE", "CALDERILLA_MINIMA"]);

/**
 * El texto del aviso.
 *
 * Dice el hecho, la caja y el umbral que se ha pasado, y nada más. Un correo de
 * aviso que hay que leer entero para saber si importa es un correo que se
 * archiva sin abrir: el asunto tiene que bastar.
 */
function redactar(i: {
  tipo: string;
  caja: string | null;
  registerId: number | null;
  valor: number;
  umbral: number;
}): { asunto: string; cuerpo: string } {
  const medida = (v: number) =>
    EN_EUROS.has(i.tipo)
      ? `${(v / 100).toFixed(2).replace(".", ",")} €`
      : `${v} día${v === 1 ? "" : "s"}`;

  const caja = i.caja ?? `caja #${i.registerId}`;
  const que = ETIQUETA[i.tipo] ?? i.tipo;
  const asunto = `[Mobilink] ${que} en ${caja}: ${medida(i.valor)}`;

  const cuerpo = [
    `${que} en ${caja}.`,
    "",
    `Valor: ${medida(i.valor)}`,
    `Umbral configurado: ${medida(i.umbral)}`,
    "",
    "Este aviso lo genera MC Central. Puedes verlo y cerrarlo en la pantalla de Incidencias.",
  ].join("\n");

  return { asunto, cuerpo };
}

// ── Envío ──────────────────────────────────────────────────────────────────

const TANDA = 20;
const MAX_INTENTOS = 5;
const INTERVALO_MS = 5 * 60_000;

function proximoIntentoMs(intentos: number): number {
  return Date.now() + Math.min(60_000 * 2 ** intentos, 3_600_000);
}

/**
 * Manda una tanda. Devuelve cuántos ha tratado.
 *
 * Sin SMTP configurado no toca nada y devuelve 0: los avisos esperan. No se
 * marcan como error, porque no lo es — falta configuración, y marcarlos
 * gastaría los intentos antes de que exista la posibilidad de enviarlos.
 */
export async function enviarPendientes(limite = TANDA): Promise<number> {
  const transporte = getMailTransport();
  if (!transporte) return 0;

  const { rows } = await pool.query(
    `SELECT * FROM central_notifications
      WHERE estado IN ('PENDIENTE','ERROR')
        AND intentos < $2
        AND (proximo_intento_ms IS NULL OR proximo_intento_ms <= $1)
      ORDER BY id
      LIMIT $3`,
    [Date.now(), MAX_INTENTOS, limite]
  );

  let tratados = 0;
  for (const n of rows) {
    const intentos = n.intentos + 1;
    try {
      await transporte.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: n.destino,
        subject: n.asunto,
        text: n.cuerpo,
      });
      await pool.query(
        `UPDATE central_notifications
            SET estado = 'ENVIADO', intentos = $2, enviado_en_ms = $3, last_error = NULL
          WHERE id = $1`,
        [n.id, intentos, Date.now()]
      );
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      await pool.query(
        `UPDATE central_notifications
            SET estado = 'ERROR', intentos = $2, last_error = $3, proximo_intento_ms = $4
          WHERE id = $1`,
        [n.id, intentos, mensaje, proximoIntentoMs(intentos)]
      );
    }
    tratados++;
  }

  return tratados;
}

export async function estadoCola(empresaId: string) {
  const { rows } = await pool.query(
    `SELECT estado, COUNT(*)::int AS total FROM central_notifications
      WHERE empresa_id = $1 GROUP BY estado ORDER BY estado`,
    [empresaId]
  );
  return rows.map((r: any) => ({ estado: r.estado, total: r.total }));
}

let temporizador: NodeJS.Timeout | null = null;

export function startCentralNotificationWorker(): void {
  if (temporizador) return;
  temporizador = setInterval(() => {
    void enviarPendientes();
  }, INTERVALO_MS);
  temporizador.unref?.();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
