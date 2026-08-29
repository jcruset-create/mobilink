/**
 * Enviar correo del expediente, enganchar las respuestas y llevar la cuenta de
 * los recordatorios.
 *
 * Tres reglas:
 *
 * 1. **Todo lo que se manda queda en el hilo**, con su Message-ID. Sin
 *    guardarlo, una respuesta con el asunto reescrito no se puede enganchar.
 * 2. **Lo que no se reconoce no se pierde**: se guarda sin asistencia y va a
 *    una bandeja de sin clasificar. Descartar un correo que no cuadra es cómo
 *    se pierde el albarán que alguien mandó bien.
 * 3. **Un recordatorio no se repite.** La cuenta está en la base con un UNIQUE,
 *    no en una comprobación previa: dos pasadas del worker a la vez pasarían
 *    las dos por un «¿ya se mandó?».
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { getMailTransport } from "../mail.ts";
import { registrarEvento } from "../eventlog/servicio.ts";
import { registrarDocumento } from "../documentos/servicio.ts";
import { tipoDesdeKindAssist } from "../documentos/tipos.ts";
import {
  MAX_RECORDATORIOS,
  construirMensaje,
  esMotivo,
  esperaHastaSiguienteMs,
  tocaRecordar,
  type DatosCorreo,
  type Motivo,
} from "./plantillas.ts";
import {
  asuntoBase,
  extraerExpediente,
  normalizarDireccion,
  normalizarMessageId,
  referenciasDeCabecera,
} from "./referencia.ts";

export type Sistema = "assist" | "central";

export class ErrorCorreo extends Error {
  codigo: string;
  estado: number;
  constructor(codigo: string, mensaje: string, estado = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

/* ── Salida ──────────────────────────────────────────────────────────────── */

export type PeticionEnvio = {
  system: Sistema;
  tenantId?: string | number | null;
  assistanceId: string | number;
  correlationId?: string | null;
  motivo: Motivo;
  para: string;
  datos: DatosCorreo;
};

/**
 * Manda un correo del expediente y lo deja en el hilo.
 *
 * El mensaje se guarda SIEMPRE, salga o no. Un correo que no se pudo mandar
 * porque el SMTP estaba caído tiene que verse en el expediente: si no se
 * guarda, nadie sabe que el taller nunca recibió la petición y el albarán se
 * espera eternamente.
 */
export async function enviarCorreo(p: PeticionEnvio) {
  if (!esMotivo(p.motivo)) throw new ErrorCorreo("motivo_invalido", "Motivo desconocido");
  const para = normalizarDireccion(p.para);
  if (!para.includes("@")) throw new ErrorCorreo("destinatario_invalido", "Destinatario no válido");

  const mensaje = construirMensaje(p.motivo, p.datos);
  const now = Date.now();
  // El Message-ID se genera aquí para poder guardarlo aunque el envío falle.
  const messageId = `<${crypto.randomUUID()}@mobilink-assist>`;

  let estado = "enviado";
  let error: string | null = null;

  const transporte = getMailTransport();
  if (!transporte) {
    estado = "fallido";
    error = "No hay SMTP configurado en el servidor";
  } else {
    try {
      await transporte.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: para,
        subject: mensaje.asunto,
        text: mensaje.texto,
        messageId,
      });
    } catch (e: any) {
      estado = "fallido";
      error = String(e?.message ?? e).slice(0, 500);
      console.error("[Correo] no se pudo enviar:", error);
    }
  }

  const r = await db.query(
    `INSERT INTO assistance_messages
       (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", direccion, motivo,
        "fromAddr", "toAddr", asunto, cuerpo, "messageId", estado, error,
        "occurredAtMs", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,'saliente',$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     RETURNING *`,
    [
      crypto.randomUUID(), p.system,
      p.tenantId == null ? null : String(p.tenantId), String(p.assistanceId),
      p.correlationId ?? null, p.motivo,
      process.env.SMTP_FROM || process.env.SMTP_USER || null, para,
      mensaje.asunto, mensaje.texto, normalizarMessageId(messageId), estado, error, now,
    ],
  );

  await registrarEvento({
    system: p.system, tenantId: p.tenantId, assistanceId: p.assistanceId,
    correlationId: p.correlationId ?? null,
    eventType: p.motivo === "solicitud_aceptacion" ? "INFORMATION_REQUESTED" : "DOCUMENT_UPLOADED",
    actorType: "system", occurredAtMs: now,
    payload: { canal: "email", motivo: p.motivo, para, estado },
    dedupeKey: `correo-${r.rows[0].uuid}`,
  });

  return { uuid: r.rows[0].uuid, estado, error, asunto: mensaje.asunto };
}

/** El hilo de una asistencia. */
export async function hiloDe(system: Sistema, assistanceId: string | number) {
  const r = await db.query(
    `SELECT uuid, direccion, motivo, "fromAddr", "toAddr", asunto, cuerpo,
            adjuntos, estado, error, "occurredAtMs"
       FROM assistance_messages
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2
      ORDER BY "occurredAtMs", id`,
    [system, String(assistanceId)],
  );
  return r.rows.map((m: any) => ({
    uuid: m.uuid,
    direccion: m.direccion,
    motivo: m.motivo ?? null,
    de: m.fromAddr ?? null,
    para: m.toAddr ?? null,
    asunto: m.asunto ?? "",
    resumen: String(m.cuerpo ?? "").slice(0, 300),
    adjuntos: Number(m.adjuntos ?? 0),
    estado: m.estado,
    error: m.error ?? null,
    occurredAtMs: Number(m.occurredAtMs),
  }));
}

/** Los entrantes que no se han podido enganchar a ninguna asistencia. */
export async function sinClasificar(limite = 50) {
  const r = await db.query(
    `SELECT uuid, "fromAddr", asunto, "occurredAtMs", adjuntos
       FROM assistance_messages
      WHERE direccion = 'entrante' AND "assistanceId" IS NULL
      ORDER BY "occurredAtMs" DESC LIMIT $1`,
    [limite],
  );
  return r.rows;
}

/* ── Entrada ─────────────────────────────────────────────────────────────── */

export type CorreoEntrante = {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | string[] | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  text?: string | null;
  fechaMs?: number | null;
  adjuntos?: Array<{ filename?: string | null; contentType?: string | null; url?: string | null }>;
};

/**
 * Busca a qué asistencia pertenece un correo entrante.
 *
 * Por orden: primero la referencia del asunto, que sobrevive a los reenvíos;
 * después las cabeceras, que sobreviven a que reescriban el asunto. Los dos
 * mecanismos hacen falta porque cada uno cubre la mitad de los casos.
 */
export async function localizarAsistencia(
  e: CorreoEntrante,
): Promise<{ system: Sistema; assistanceId: string; tenantId: string | null; correlationId: string | null } | null> {
  const expediente = extraerExpediente(e.subject);
  if (expediente) {
    // Assist numera AST-<id>; el id va dentro de la propia referencia.
    const m = /^AST-(\d+)$/.exec(expediente);
    if (m) {
      const a = await db.query(
        `SELECT id, "tallerId" FROM roadside_assistances WHERE id = $1`, [Number(m[1])]);
      if (a.rows[0]) {
        return {
          system: "assist", assistanceId: String(a.rows[0].id),
          tenantId: a.rows[0].tallerId != null ? String(a.rows[0].tallerId) : null,
          correlationId: null,
        };
      }
    }
    const c = await db.query(
      `SELECT id, "controlCenterId", "correlationId" FROM connect_assistances
        WHERE upper("expedientNumber") = $1`, [expediente]);
    if (c.rows[0]) {
      return {
        system: "central", assistanceId: String(c.rows[0].id),
        tenantId: c.rows[0].controlCenterId != null ? String(c.rows[0].controlCenterId) : null,
        correlationId: c.rows[0].correlationId ?? null,
      };
    }
  }

  // Sin referencia utilizable: se busca por las cabeceras contra lo que salió.
  const refs = referenciasDeCabecera({ inReplyTo: e.inReplyTo, references: e.references });
  if (refs.length > 0) {
    const r = await db.query(
      `SELECT "sourceSystem", "assistanceId", "tenantId", "correlationId"
         FROM assistance_messages
        WHERE direccion = 'saliente' AND "messageId" = ANY($1::text[])
          AND "assistanceId" IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [refs],
    );
    if (r.rows[0]) {
      return {
        system: r.rows[0].sourceSystem as Sistema,
        assistanceId: String(r.rows[0].assistanceId),
        tenantId: r.rows[0].tenantId ?? null,
        correlationId: r.rows[0].correlationId ?? null,
      };
    }
  }
  return null;
}

/**
 * Procesa un correo entrante: lo engancha, guarda sus adjuntos como documentos
 * y da por resuelto el recordatorio que corresponda.
 *
 * Devuelve `duplicado: true` si ese mensaje ya se había procesado. El buzón se
 * lee cada pocos minutos y un reinicio a mitad de tanda haría releer los
 * mismos correos.
 */
export async function procesarEntrante(e: CorreoEntrante) {
  const messageId = normalizarMessageId(e.messageId);
  const now = e.fechaMs ?? Date.now();
  const destino = await localizarAsistencia(e);
  const adjuntos = e.adjuntos ?? [];

  const r = await db.query(
    `INSERT INTO assistance_messages
       (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", direccion,
        "fromAddr", "toAddr", asunto, cuerpo, "messageId", "inReplyTo", referencias,
        adjuntos, estado, "occurredAtMs", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,'entrante',$6,$7,$8,$9,$10,$11,$12,$13,'recibido',$14,$14)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      crypto.randomUUID(), destino?.system ?? "assist", destino?.tenantId ?? null,
      destino?.assistanceId ?? null, destino?.correlationId ?? null,
      normalizarDireccion(e.from), normalizarDireccion(e.to),
      e.subject ?? "", String(e.text ?? "").slice(0, 20_000),
      messageId || null, normalizarMessageId(e.inReplyTo) || null,
      JSON.stringify(referenciasDeCabecera({ inReplyTo: e.inReplyTo, references: e.references })),
      adjuntos.length, now,
    ],
  );
  if (!r.rows[0]) return { duplicado: true, enganchado: false };
  if (!destino) return { duplicado: false, enganchado: false };

  /*
   * Los adjuntos entran como documentos del expediente. El tipo se adivina por
   * el nombre del fichero, y lo que no se reconoce entra como «otro»: nunca se
   * clasifica a ciegas como albarán, porque eso cerraría un expediente con un
   * documento que no es.
   */
  for (const a of adjuntos) {
    if (!a.url) continue;
    await registrarDocumento({
      system: destino.system,
      tenantId: destino.tenantId,
      assistanceId: destino.assistanceId,
      correlationId: destino.correlationId,
      tipo: tipoDesdeNombre(a.filename),
      origen: "proveedor",
      url: a.url,
      fileName: a.filename ?? null,
      mimeType: a.contentType ?? null,
      uploadedBy: normalizarDireccion(e.from),
      notes: "Recibido por correo",
    }).catch((err) => console.error("[Correo] adjunto no registrado:", err?.message));
  }

  await registrarEvento({
    system: destino.system, tenantId: destino.tenantId, assistanceId: destino.assistanceId,
    correlationId: destino.correlationId, eventType: "INFORMATION_REQUESTED",
    actorType: "partner", actorName: normalizarDireccion(e.from), occurredAtMs: now,
    payload: { canal: "email", asunto: asuntoBase(e.subject), adjuntos: adjuntos.length },
    dedupeKey: messageId ? `correo-in-${messageId}` : undefined,
  });

  // Si llegó lo que se estaba pidiendo, se deja de pedir.
  await resolverRecordatoriosPorDocumentos(destino.system, destino.assistanceId);

  return { duplicado: false, enganchado: true, ...destino };
}

/** El tipo de documento a partir del nombre del fichero adjunto. */
function tipoDesdeNombre(nombre: string | null | undefined) {
  const n = String(nombre ?? "").toLowerCase();
  if (/albar|delivery|nota.?entrega/.test(n)) return "albaran" as const;
  if (/factur|invoice/.test(n)) return "factura" as const;
  if (/presupuest|quote/.test(n)) return "presupuesto" as const;
  if (/parte|informe|report/.test(n)) return "parte" as const;
  if (/\.(jpe?g|png|heic|webp)$/.test(n)) return "fotografia" as const;
  // Lo que no se reconoce NO se clasifica a ciegas: un PDF cualquiera dado por
  // albarán cerraría el expediente con el documento equivocado.
  return tipoDesdeKindAssist("otro");
}

/* ── Recordatorios ───────────────────────────────────────────────────────── */

/**
 * Programa un recordatorio si no existe ya.
 *
 * Idempotente por el UNIQUE de la tabla: llamarlo cien veces deja una fila.
 */
export async function programarRecordatorio(
  system: Sistema,
  assistanceId: string | number,
  motivo: "albaran" | "factura",
  destinatario: string | null,
  tenantId?: string | number | null,
) {
  const now = Date.now();
  await db.query(
    `INSERT INTO assistance_reminders
       ("sourceSystem", "tenantId", "assistanceId", motivo, "proximoEnvioMs",
        destinatario, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT ("sourceSystem", "assistanceId", motivo) DO UPDATE
       SET destinatario = COALESCE(EXCLUDED.destinatario, assistance_reminders.destinatario),
           "updatedAtMs" = EXCLUDED."updatedAtMs"`,
    [system, tenantId == null ? null : String(tenantId), String(assistanceId), motivo,
     now, destinatario, now],
  );
}

/**
 * Da por resueltos los recordatorios cuyo documento ya ha llegado.
 *
 * Se llama al recibir un correo con adjuntos y al subir un documento a mano:
 * el sistema no puede seguir pidiendo un albarán que ya tiene, que es el fallo
 * que más molesta a un taller.
 */
export async function resolverRecordatoriosPorDocumentos(
  system: Sistema,
  assistanceId: string | number,
) {
  const docs = await db.query(
    `SELECT DISTINCT tipo FROM assistance_documents
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2`,
    [system, String(assistanceId)],
  );
  const tipos = new Set(docs.rows.map((d: any) => d.tipo));
  const resueltos = ["albaran", "factura"].filter((t) => tipos.has(t));
  if (resueltos.length === 0) return 0;

  const r = await db.query(
    `UPDATE assistance_reminders SET "resueltoAtMs" = $4, "updatedAtMs" = $4
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2 AND motivo = ANY($3::text[])
        AND "resueltoAtMs" IS NULL`,
    [system, String(assistanceId), resueltos, Date.now()],
  );
  return r.rowCount ?? 0;
}

/**
 * Una pasada del worker: manda los recordatorios cuya espera ha vencido.
 *
 * Devuelve cuántos ha mandado, que es lo que usan las pruebas para saber que
 * el ciclo hizo algo.
 */
export async function enviarRecordatoriosPendientes(limite = 20): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `SELECT * FROM assistance_reminders
      WHERE "resueltoAtMs" IS NULL AND intentos < $2
        AND ("proximoEnvioMs" IS NULL OR "proximoEnvioMs" <= $1)
      ORDER BY "proximoEnvioMs" NULLS FIRST
      LIMIT $3`,
    [now, MAX_RECORDATORIOS, limite],
  );

  let mandados = 0;
  for (const rec of r.rows) {
    const estado = {
      intentos: Number(rec.intentos ?? 0),
      ultimoEnvioMs: rec.ultimoEnvioMs != null ? Number(rec.ultimoEnvioMs) : null,
      resuelto: false,
    };
    if (!tocaRecordar(estado, now).toca) continue;
    if (!rec.destinatario) {
      // Sin destinatario no se puede pedir nada. Se deja anotado para que la
      // bandeja lo enseñe: es un dato que falta, no un fallo del envío.
      await db.query(
        `UPDATE assistance_reminders SET "ultimoError" = $2, "updatedAtMs" = $3 WHERE id = $1`,
        [rec.id, "Sin dirección de correo a la que pedirlo", now]);
      continue;
    }

    const datos = await datosDelExpediente(rec.sourceSystem as Sistema, rec.assistanceId);
    if (!datos) continue;

    const res = await enviarCorreo({
      system: rec.sourceSystem as Sistema,
      tenantId: rec.tenantId,
      assistanceId: rec.assistanceId,
      motivo: rec.motivo === "albaran"
        ? (estado.intentos === 0 ? "solicitud_albaran" : "recordatorio_albaran")
        : (estado.intentos === 0 ? "solicitud_factura" : "recordatorio_factura"),
      para: rec.destinatario,
      datos: { ...datos, intento: estado.intentos + 1 },
    }).catch((e) => ({ estado: "fallido", error: String(e?.message ?? e) } as any));

    const intentos = estado.intentos + 1;
    await db.query(
      `UPDATE assistance_reminders
          SET intentos = $2, "ultimoEnvioMs" = $3,
              "proximoEnvioMs" = $4, "ultimoError" = $5, "updatedAtMs" = $3
        WHERE id = $1`,
      [rec.id, intentos, now, now + esperaHastaSiguienteMs(intentos),
       res?.estado === "fallido" ? (res.error ?? "Error de envío") : null],
    );
    if (res?.estado !== "fallido") mandados++;
  }
  return mandados;
}

async function datosDelExpediente(system: Sistema, assistanceId: string): Promise<DatosCorreo | null> {
  if (system === "assist") {
    const a = await db.query(
      `SELECT id, plate, address, "finishedAtMs", "descripcionAveria"
         FROM roadside_assistances WHERE id = $1`, [Number(assistanceId)]);
    const f = a.rows[0];
    if (!f) return null;
    return {
      expediente: `AST-${f.id}`,
      matricula: f.plate || null,
      direccion: f.address || null,
      fechaServicio: f.finishedAtMs != null ? Number(f.finishedAtMs) : null,
      descripcion: f.descripcionAveria || null,
    };
  }
  const c = await db.query(
    `SELECT id, "expedientNumber", vehicle, address, description
       FROM connect_assistances WHERE id = $1`, [Number(assistanceId)]);
  const f = c.rows[0];
  if (!f) return null;
  let matricula: string | null = null;
  try { matricula = JSON.parse(f.vehicle || "{}").plate ?? null; } catch { matricula = null; }
  return {
    expediente: f.expedientNumber ?? `AS-${f.id}`,
    matricula,
    direccion: f.address || null,
    descripcion: f.description || null,
  };
}
