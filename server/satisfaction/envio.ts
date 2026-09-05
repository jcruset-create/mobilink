/**
 * El envío real de una encuesta por WhatsApp.
 *
 * La prioridad de todo este fichero, por encima de cualquier otra, es que
 * **nunca salgan dos WhatsApp iniciales por la misma encuesta**. Ni por dos
 * workers a la vez, ni por un reinicio a media faena, ni por un reintento.
 *
 * ── Cómo se garantiza ───────────────────────────────────────────────────────
 *
 * Con la base de datos, no con comprobaciones en memoria. Dos barreras:
 *
 *  1. **El lease.** Reclamar es un `UPDATE` con `FOR UPDATE SKIP LOCKED` en una
 *     transacción cortísima: quien la gana se lleva la fila y el otro ni la ve.
 *     La marca caduca a los diez minutos para que un worker muerto no deje una
 *     encuesta bloqueada para siempre.
 *  2. **El índice único de `survey_deliveries`.** `(instancia, tipo, intento)`.
 *     Antes de llamar a Twilio se inserta la fila del intento; si otro se
 *     adelantó, el INSERT choca y aquí se para. Esta es la barrera de verdad:
 *     el lease es una optimización, el índice es la garantía.
 *
 * ── Y la transacción se cierra ANTES de llamar a Twilio ─────────────────────
 *
 * Nunca se mantiene un `BEGIN … FOR UPDATE` abierto mientras se espera a una
 * API externa. Una llamada lenta bloquearía la fila —y con ella el pool de
 * conexiones— durante segundos. El reparto entre workers sobrevive por estado
 * en la base, no por tener el candado cogido.
 *
 * ── La respuesta que no llega ───────────────────────────────────────────────
 *
 * Si la petición sale y no vuelve nada, NO se sabe si Twilio la aceptó. Eso no
 * es un fallo: es una incógnita, y tratarla como fallo mandaría un segundo
 * mensaje. Se marca `UNKNOWN` y se reconcilia preguntándole a Twilio qué mandó
 * a ese número. Ante la duda, mejor una encuesta sin enviar que un WhatsApp
 * repetido.
 */

import pool from "../db.ts";
import { enmascararTelefono } from "../core/twilio.ts";
import {
  ESPERAS_REINTENTO_MS, ESTADO_TWILIO, LEASE_ENVIO_MS, MARGEN_RECORDATORIO_MS,
  MAX_INTENTOS_ENVIO, transicionEntregaValida,
  type EstadoEntrega, type RolDestinatario, type TipoMensaje,
} from "./dominio.ts";
import { adaptadorTwilio, type Adaptador } from "./adaptadorWhatsApp.ts";
import { configEfectiva } from "./config.ts";
import { emitirToken, tokenDe } from "./servicio.ts";
import { urlDeCallback, urlDeValoracion } from "./urlPublica.ts";

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export type Reclamada = {
  id: number;
  sourceSystem: string;
  tenantId: string | null;
  assistanceId: string;
  recipientRole: RolDestinatario;
  recipientPhone: string | null;
  expiresAtMs: number;
  sendAttempts: number;
  clienteFacturacionId: number | null;
  matricula: string | null;
};

export type ResultadoIntento =
  | { estado: "enviado"; instanceId: number; sid: string }
  | { estado: "bloqueado"; instanceId: number; motivo: string }
  | { estado: "reintentar"; instanceId: number; enMs: number; motivo: string }
  | { estado: "fallido"; instanceId: number; motivo: string }
  | { estado: "ambiguo"; instanceId: number }
  | { estado: "descartado"; instanceId: number; motivo: string };

/* ── Reclamación ─────────────────────────────────────────────────────────── */

/*
 * El cliente y la matrícula salen en la MISMA consulta que reclama.
 *
 * Se necesitan para la configuración efectiva y para el texto del mensaje, y
 * pedirlos después sería una consulta por encuesta: con veinticinco por pasada,
 * veinticinco viajes de más para dos columnas.
 */
const CAMPOS = `i.id, i."sourceSystem", i."tenantId", i."assistanceId", i."recipientRole",
                i."recipientPhone", i."expiresAtMs", i."sendAttempts",
                a."clienteFacturacionId", a.plate AS matricula`;

const DESDE = `FROM survey_instances i
               LEFT JOIN roadside_assistances a
                      ON i."sourceSystem" = 'assist' AND a.id = i."assistanceId"::integer`;

/**
 * Se lleva hasta `tope` encuestas listas para mandar y las marca como suyas.
 *
 * Transacción corta y nada más: dentro de ella no se habla con nadie de fuera.
 *
 * Los filtros dicen exactamente qué es «lista»: encolada, sin reclamar por otro
 * hace poco, con su espera de reintento cumplida y todavía viva. La caducidad
 * entra aquí y se vuelve a mirar antes de enviar, porque entre las dos cosas
 * pasa tiempo.
 */
export async function reclamarParaEnvio(
  ahoraMs = Date.now(), tope = 25,
): Promise<Reclamada[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const sel = await c.query(
      `SELECT ${CAMPOS}
         ${DESDE}
        WHERE i.status = 'QUEUED'
          AND i."expiresAtMs" > $1
          AND (i."nextAttemptAtMs" IS NULL OR i."nextAttemptAtMs" <= $1)
          AND (i."sendClaimedAtMs" IS NULL OR i."sendClaimedAtMs" < $2)
          /*
           * Y nada que ya tenga un mensaje inicial en vuelo o del que no se
           * sepa si salió. El índice de entregas impediría mandarlo igualmente,
           * pero reclamarlo una y otra vez sería trabajo para nada y, sobre
           * todo, escondería que lo que hace falta ahí es reconciliar.
           */
          AND NOT EXISTS (
            SELECT 1 FROM survey_deliveries d
             WHERE d."surveyInstanceId" = i.id
               AND d."messageType" = 'INITIAL'
               AND d.status IN ('SENDING','SENT','DELIVERED','READ','UNKNOWN')
          )
        ORDER BY i."sendAfterMs"
        -- «OF i»: se bloquea la encuesta, no la asistencia. Sin esto Postgres
        -- rechaza la consulta —no se puede bloquear el lado nulable de un LEFT
        -- JOIN— y además no hay motivo para tocar «roadside_assistances».
        FOR UPDATE OF i SKIP LOCKED
        LIMIT $3`,
      [ahoraMs, ahoraMs - LEASE_ENVIO_MS, tope],
    );
    const ids = sel.rows.map((r) => Number(r.id));
    if (ids.length) {
      await c.query(
        `UPDATE survey_instances SET "sendClaimedAtMs" = $2 WHERE id = ANY($1)`,
        [ids, ahoraMs],
      );
    }
    await c.query("COMMIT");
    return sel.rows.map(aReclamada);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function aReclamada(f: Record<string, unknown>): Reclamada {
  return {
    id: Number(f.id),
    sourceSystem: String(f.sourceSystem),
    tenantId: f.tenantId == null ? null : String(f.tenantId),
    assistanceId: String(f.assistanceId),
    recipientRole: String(f.recipientRole) as RolDestinatario,
    recipientPhone: f.recipientPhone == null ? null : String(f.recipientPhone),
    expiresAtMs: Number(f.expiresAtMs),
    sendAttempts: Number(f.sendAttempts ?? 0),
    clienteFacturacionId: f.clienteFacturacionId == null ? null : Number(f.clienteFacturacionId),
    matricula: f.matricula == null ? null : String(f.matricula),
  };
}

/**
 * Lo único que se le cuenta al destinatario sobre el servicio.
 *
 * Al conductor, la matrícula: es lo que reconoce. Al cliente, la referencia,
 * que es la matrícula o —si no la hubiera— el número del servicio. Ni nombres,
 * ni direcciones, ni importes: lo que viaja en un WhatsApp acaba en la copia de
 * seguridad del móvil de alguien.
 */
export function referenciaDe(a: Reclamada): { matricula: string; referencia: string } {
  const matricula = String(a.matricula ?? "").trim();
  return { matricula, referencia: matricula || `#${a.assistanceId}` };
}

/* ── Bloqueos por configuración ──────────────────────────────────────────── */

/**
 * Deja constancia de que falta algo de fuera, SIN crear una entrega.
 *
 * Es la política del §5 del encargo: una plantilla sin configurar no es un
 * intento fallido, es un intento que no se ha hecho. Si cada pasada del worker
 * escribiera una fila `SKIPPED`, en una semana habría dos mil filas contando lo
 * mismo. Se guarda una vez en la propia encuesta, se actualiza la hora y la
 * encuesta se queda en `QUEUED`: el día que se configure la plantilla, sale
 * sola en la siguiente pasada sin tocar nada.
 */
async function anotarBloqueo(instanceId: number, motivo: string, ahoraMs: number): Promise<void> {
  await pool.query(
    `UPDATE survey_instances
        SET "blockedReason" = $2, "blockedAtMs" = $3, "sendClaimedAtMs" = NULL,
            "nextAttemptAtMs" = $4
      WHERE id = $1`,
    // Se reintenta en una hora, no en cinco minutos: lo que falta lo tiene que
    // configurar una persona, y no va a aparecer solo.
    [instanceId, motivo, ahoraMs, ahoraMs + 3_600_000],
  );
}

async function limpiarBloqueo(instanceId: number): Promise<void> {
  await pool.query(
    `UPDATE survey_instances SET "blockedReason" = NULL, "blockedAtMs" = NULL WHERE id = $1`,
    [instanceId],
  );
}

/* ── Entregas ────────────────────────────────────────────────────────────── */

/**
 * Reserva la fila del intento. Devuelve `null` si ya hay uno en vuelo.
 *
 * Ésta es LA barrera contra el duplicado, y la sostiene la base: el índice
 * parcial `idx_survey_deliveries_en_vuelo` no deja que exista un segundo
 * mensaje del mismo tipo mientras el primero esté enviándose, ya haya salido, o
 * no se sepa si salió.
 *
 * Se atrapa la violación de unicidad (23505) en vez de usar `ON CONFLICT`
 * porque son DOS índices los que pueden saltar —el de (encuesta, tipo, intento)
 * y el de «en vuelo»— y `ON CONFLICT` obliga a nombrar uno solo. Chocar con
 * cualquiera de los dos significa lo mismo: aquí no se manda nada.
 */
export async function reservarIntento(p: {
  instanceId: number; tipo: TipoMensaje; intento: number;
  telefono: string; ahoraMs: number;
}): Promise<number | null> {
  try {
    const r = await pool.query(
      `INSERT INTO survey_deliveries
         ("surveyInstanceId", channel, recipient, "messageType", attempt, status, "createdAtMs")
       VALUES ($1,'WHATSAPP',$2,$3,$4,'SENDING',$5)
       RETURNING id`,
      [p.instanceId, p.telefono, p.tipo, p.intento, p.ahoraMs],
    );
    return Number(r.rows[0].id);
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "23505") return null;
    throw e;
  }
}

/** Mueve una entrega, respetando las transiciones. */
export async function cambiarEstadoEntrega(p: {
  deliveryId: number;
  hasta: EstadoEntrega;
  sid?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  ahoraMs: number;
}): Promise<boolean> {
  const actual = await pool.query(
    `SELECT status FROM survey_deliveries WHERE id = $1`, [p.deliveryId]);
  const desde = String(actual.rows[0]?.status ?? "") as EstadoEntrega;
  if (!desde || !transicionEntregaValida(desde, p.hasta)) return false;

  const marca = p.hasta === "SENT" ? '"sentAtMs"'
    : p.hasta === "DELIVERED" || p.hasta === "READ" ? '"deliveredAtMs"'
    : p.hasta === "FAILED" ? '"failedAtMs"'
    : p.hasta === "UNKNOWN" ? '"unknownAtMs"'
    : null;

  const args: unknown[] = [
    p.deliveryId, p.hasta, p.sid ?? null, p.errorCode ?? null, p.errorMessage ?? null,
  ];
  // `SKIPPED` no tiene fecha propia: no pasó nada que fechar. Por eso el
  // parámetro solo se añade cuando hay columna que rellenar.
  if (marca) args.push(p.ahoraMs);

  await pool.query(
    `UPDATE survey_deliveries
        SET status = $2,
            "providerMessageId" = COALESCE($3, "providerMessageId"),
            "errorCode" = COALESCE($4, "errorCode"),
            "errorMessage" = COALESCE($5, "errorMessage")
            ${marca ? `, ${marca} = COALESCE(${marca}, $6)` : ""}
      WHERE id = $1`,
    args,
  );
  return true;
}

/* ── El intento ──────────────────────────────────────────────────────────── */

/**
 * Manda —o no— UNA encuesta ya reclamada.
 *
 * El orden de las comprobaciones no es casual: primero lo que hace inútil el
 * envío (respondida, caducada, cancelada), después lo que lo hace imposible
 * (configuración), y solo entonces se reserva el intento y se llama a Twilio.
 */
export async function enviarInicial(
  a: Reclamada, adaptador: Adaptador = adaptadorTwilio, ahoraMs = Date.now(),
): Promise<ResultadoIntento> {
  /*
   * Se relee el estado JUSTO antes de nada más. Entre reclamar y llegar aquí
   * el usuario ha podido contestar —pasa en las pruebas manuales—, y mandarle
   * un «valóranos» de algo que acaba de valorar sería absurdo.
   */
  const fresco = await pool.query(
    `SELECT status, "expiresAtMs", "sendAttempts" FROM survey_instances WHERE id = $1`, [a.id]);
  const f = fresco.rows[0];
  if (!f) return { estado: "descartado", instanceId: a.id, motivo: "no_existe" };
  if (f.status !== "QUEUED") {
    await soltarLease(a.id);
    return { estado: "descartado", instanceId: a.id, motivo: `estado_${String(f.status)}` };
  }
  if (Number(f.expiresAtMs) <= ahoraMs) {
    await pool.query(
      `UPDATE survey_instances SET status = 'EXPIRED', "sendClaimedAtMs" = NULL WHERE id = $1
         AND status NOT IN ('COMPLETED','CANCELLED')`, [a.id]);
    return { estado: "descartado", instanceId: a.id, motivo: "caducada" };
  }

  const config = await configEfectiva(a.clienteFacturacionId);
  if (!config.activo) {
    await anotarBloqueo(a.id, "satisfaction_disabled", ahoraMs);
    return { estado: "bloqueado", instanceId: a.id, motivo: "satisfaction_disabled" };
  }

  const telefono = a.recipientPhone ?? "";
  if (!telefono) {
    await anotarBloqueo(a.id, "no_recipient", ahoraMs);
    return { estado: "bloqueado", instanceId: a.id, motivo: "no_recipient" };
  }

  /*
   * El token se emite lo más tarde posible, pero se GUARDA en claro: si el
   * proceso muere aquí mismo, el siguiente intento recupera el mismo token y
   * manda el mismo enlace. Sin eso, la encuesta se quedaba con un enlace que
   * nadie podía reconstruir.
   */
  const emision = await emitirToken(a.id, {
    sourceSystem: a.sourceSystem as never, tenantId: a.tenantId, assistanceId: a.assistanceId,
  }, ahoraMs);
  if (emision.estado === "no_procede") {
    await soltarLease(a.id);
    return { estado: "descartado", instanceId: a.id, motivo: emision.motivo };
  }
  const token = emision.token ?? (await tokenDe(a.id));
  if (!token) {
    // Una encuesta de antes de 1G: tiene hash y no valor. No se puede
    // reconstruir el enlace y rotar dejaría muerto uno que quizá ya viajó.
    await anotarBloqueo(a.id, "token_no_recuperable", ahoraMs);
    return { estado: "bloqueado", instanceId: a.id, motivo: "token_no_recuperable" };
  }

  const url = urlDeValoracion(token);
  if (!url) {
    await anotarBloqueo(a.id, "no_public_base_url", ahoraMs);
    return { estado: "bloqueado", instanceId: a.id, motivo: "no_public_base_url" };
  }

  const ctx = referenciaDe(a);
  const intento = Number(f.sendAttempts ?? 0) + 1;
  const deliveryId = await reservarIntento({
    instanceId: a.id, tipo: "INITIAL", intento, telefono, ahoraMs,
  });
  if (deliveryId == null) {
    // Otro worker se adelantó con este mismo intento. No se manda nada.
    await soltarLease(a.id);
    return { estado: "descartado", instanceId: a.id, motivo: "intento_ya_reservado" };
  }

  await pool.query(
    `UPDATE survey_instances SET "sendAttempts" = $2 WHERE id = $1`, [a.id, intento]);

  console.log(`[Satisfaction] envío ${a.recipientRole} encuesta#${a.id} intento ${intento} ` +
    `→ ${enmascararTelefono(telefono)}`);

  const r = await adaptador.enviar({
    rol: a.recipientRole, tipo: "INITIAL", telefono, url,
    referencia: a.recipientRole === "DRIVER" ? (ctx.matricula || ctx.referencia) : ctx.referencia,
    statusCallback: urlDeCallback(),
  });

  return persistirResultado({ a, deliveryId, intento, r, ahoraMs, tipo: "INITIAL" });
}

async function soltarLease(instanceId: number): Promise<void> {
  await pool.query(
    `UPDATE survey_instances SET "sendClaimedAtMs" = NULL WHERE id = $1`, [instanceId]);
}

/* ── Persistencia del resultado ──────────────────────────────────────────── */

type Resultado = Awaited<ReturnType<Adaptador["enviar"]>>;

async function persistirResultado(p: {
  a: Reclamada; deliveryId: number; intento: number; r: Resultado;
  ahoraMs: number; tipo: TipoMensaje;
}): Promise<ResultadoIntento> {
  const { a, deliveryId, intento, r, ahoraMs } = p;

  if (r.estado === "sin_configurar") {
    await cambiarEstadoEntrega({
      deliveryId, hasta: "SKIPPED", errorCode: r.motivo, ahoraMs,
    });
    await anotarBloqueo(a.id, r.motivo, ahoraMs);
    console.warn(`[Satisfaction] encuesta#${a.id} sin mandar: ${r.motivo}`);
    return { estado: "bloqueado", instanceId: a.id, motivo: r.motivo };
  }

  if (r.estado === "aceptado") {
    await cambiarEstadoEntrega({ deliveryId, hasta: "SENT", sid: r.sid, ahoraMs });
    if (p.tipo === "INITIAL") await marcarInicialEnviado(a, ahoraMs);
    else await marcarRecordatorioEnviado(a.id, ahoraMs);
    await limpiarBloqueo(a.id);
    console.log(`[Satisfaction] encuesta#${a.id} aceptada por el proveedor (intento ${intento})`);
    return { estado: "enviado", instanceId: a.id, sid: r.sid };
  }

  if (r.estado === "desconocido") {
    /*
     * NO se reintenta solo. La petición salió; puede que el mensaje esté ya en
     * camino. Se deja `UNKNOWN` y que lo resuelva la reconciliación mirando qué
     * mandó el proveedor de verdad. Preferimos una encuesta sin enviar a dos
     * WhatsApp iguales.
     */
    await cambiarEstadoEntrega({
      deliveryId, hasta: "UNKNOWN", errorMessage: r.mensaje, ahoraMs,
    });
    await pool.query(
      `UPDATE survey_instances
          SET "sendClaimedAtMs" = NULL, "blockedReason" = 'reconcile_required',
              "blockedAtMs" = $2, "nextAttemptAtMs" = NULL
        WHERE id = $1`,
      [a.id, ahoraMs],
    );
    console.warn(`[Satisfaction] encuesta#${a.id}: intento ${intento} sin respuesta ` +
      "del proveedor. Queda pendiente de reconciliar; NO se reenvía.");
    return { estado: "ambiguo", instanceId: a.id };
  }

  // Rechazado.
  await cambiarEstadoEntrega({
    deliveryId, hasta: "FAILED", errorCode: r.codigo, errorMessage: r.mensaje, ahoraMs,
  });

  const espera = ESPERAS_REINTENTO_MS[intento - 1];
  const quedanIntentos = intento < MAX_INTENTOS_ENVIO && espera != null;
  const cabeEnPlazo = quedanIntentos && ahoraMs + espera < a.expiresAtMs;

  if (r.permanente || !quedanIntentos || !cabeEnPlazo) {
    /*
     * `FAILED` en la encuesta significa «el sistema no va a conseguir
     * mandarla», no «falló un intento». Por eso solo se llega aquí cuando el
     * error es definitivo, se acabaron los intentos o el siguiente caería
     * después de la caducidad.
     */
    await pool.query(
      `UPDATE survey_instances
          SET status = 'FAILED', "failedAtMs" = $2, "sendClaimedAtMs" = NULL,
              "nextAttemptAtMs" = NULL
        WHERE id = $1 AND status = 'QUEUED'`,
      [a.id, ahoraMs],
    );
    const motivo = r.permanente ? "error_permanente"
      : !quedanIntentos ? "intentos_agotados" : "sin_plazo";
    console.warn(`[Satisfaction] encuesta#${a.id} descartada (${motivo}, código ${r.codigo})`);
    return { estado: "fallido", instanceId: a.id, motivo };
  }

  await pool.query(
    `UPDATE survey_instances
        SET "sendClaimedAtMs" = NULL, "nextAttemptAtMs" = $2 WHERE id = $1`,
    [a.id, ahoraMs + espera],
  );
  return { estado: "reintentar", instanceId: a.id, enMs: espera, motivo: r.codigo };
}

/**
 * La encuesta pasa a `SENT` y se congela cuándo tocaría el recordatorio.
 *
 * `SENT` quiere decir **el proveedor aceptó el envío**, ni más ni menos: no
 * dice que el teléfono lo recibiera. Eso es `DELIVERED`, y lo dice el callback.
 *
 * `reminderAfterMs` se calcula aquí con la configuración de HOY y se guarda. Si
 * mañana alguien cambia el retraso, esta encuesta no se mueve de hora.
 */
async function marcarInicialEnviado(a: Reclamada, ahoraMs: number): Promise<void> {
  const config = await configEfectiva(a.clienteFacturacionId);
  const recordatorio = ahoraMs + config.recordatorioHoras * 3_600_000;
  // Solo si el recordatorio caería con margen suficiente antes de caducar; si
  // no, no se programa y no hay nada que decidir después.
  const conMargen = recordatorio + MARGEN_RECORDATORIO_MS <= a.expiresAtMs;

  await pool.query(
    `UPDATE survey_instances
        SET status = 'SENT', "sentAtMs" = COALESCE("sentAtMs", $2),
            "initialSentAtMs" = COALESCE("initialSentAtMs", $2),
            "reminderAfterMs" = COALESCE("reminderAfterMs", $3),
            "sendClaimedAtMs" = NULL, "nextAttemptAtMs" = NULL
      WHERE id = $1 AND status = 'QUEUED'`,
    [a.id, ahoraMs, conMargen ? recordatorio : null],
  );
}

async function marcarRecordatorioEnviado(instanceId: number, ahoraMs: number): Promise<void> {
  await pool.query(
    `UPDATE survey_instances
        SET "reminderSentAtMs" = COALESCE("reminderSentAtMs", $2), "sendClaimedAtMs" = NULL
      WHERE id = $1`,
    [instanceId, ahoraMs],
  );
}

/* ── El callback del proveedor ───────────────────────────────────────────── */

/**
 * Aplica un cambio de estado que viene del proveedor.
 *
 * Idempotente y sin retrocesos: un `sent` que llega tarde no puede rebajar un
 * `delivered`, y repetir el mismo callback no cambia nada. Lo garantiza
 * `transicionEntregaValida`, no el orden de llegada.
 *
 * Y NO toca el estado de la encuesta si ya está más adelante: si alguien abrió
 * el enlace antes de que llegara el aviso de entrega, manda `STARTED`.
 */
export async function aplicarEstadoProveedor(p: {
  sid: string; estadoTwilio: string; errorCode?: string | null; ahoraMs?: number;
}): Promise<{ aplicado: boolean; motivo?: string }> {
  const ahoraMs = p.ahoraMs ?? Date.now();
  const hasta = ESTADO_TWILIO[String(p.estadoTwilio).toLowerCase()];
  if (!hasta) return { aplicado: false, motivo: "estado_desconocido" };

  const r = await pool.query(
    `SELECT id, "surveyInstanceId", "messageType", status
       FROM survey_deliveries WHERE "providerMessageId" = $1`, [p.sid]);
  const d = r.rows[0];
  if (!d) return { aplicado: false, motivo: "sid_desconocido" };

  const movido = await cambiarEstadoEntrega({
    deliveryId: Number(d.id), hasta,
    errorCode: p.errorCode ?? null, ahoraMs,
  });
  if (!movido) return { aplicado: false, motivo: "transicion_invalida" };

  if (hasta === "DELIVERED" || hasta === "READ") {
    /*
     * La encuesta pasa a DELIVERED solo desde SENT. Nunca desde STARTED,
     * COMPLETED, EXPIRED ni CANCELLED: un aviso de entrega que llega después
     * de que alguien haya contestado no puede deshacer la respuesta.
     */
    await pool.query(
      `UPDATE survey_instances
          SET status = 'DELIVERED', "deliveredAtMs" = COALESCE("deliveredAtMs", $2)
        WHERE id = $1 AND status = 'SENT'`,
      [Number(d.surveyInstanceId), ahoraMs],
    );
  }
  return { aplicado: true };
}
