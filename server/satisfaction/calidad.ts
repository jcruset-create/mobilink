/**
 * Lo que la oficina necesita leer: valoraciones de una asistencia y expedientes
 * de calidad.
 *
 * ── Consultas, no objetos ───────────────────────────────────────────────────
 *
 * Aquí no hay lógica de negocio; eso vive en `dominio.ts` y las mutaciones en
 * `calidadServicio.ts`. Esto solo pregunta a la base y devuelve DTO ya
 * masticado, sin filas de tablas: la pantalla no tiene por qué saber que las
 * respuestas están desglosadas por pregunta ni recomponerlas a mano.
 *
 * ── Y en una sola consulta ──────────────────────────────────────────────────
 *
 * La bandeja podría resolverse fácil pidiendo los casos y luego, por cada uno,
 * su cliente, su proveedor, su valoración y su responsable. Eso son cinco
 * consultas por fila: con doscientos casos, mil viajes a la base para pintar
 * una tabla. Va todo en un JOIN, y la valoración —que está en otra tabla y por
 * pregunta— entra por una subconsulta lateral.
 */

import pool from "../db.ts";
import type { EstadoCaso, Prioridad, RolDestinatario } from "./dominio.ts";
import { unirAsistencia } from "./sqlAsistencia.ts";

/* ── Satisfaction de una asistencia ──────────────────────────────────────── */

export type RespuestaEncuesta = {
  overallRating: number | null;
  professionalRating: number | null;
  speedRating: number | null;
  trackingRating: number | null;
  resolution: string | null;
  negativeReasons: string[];
  comment: string | null;
  respondidaEnMs: number | null;
};

export type EncuestaDeAsistencia = {
  recipientRole: RolDestinatario;
  estado: string;
  creadaEnMs: number;
  enviadaEnMs: number | null;
  iniciadaEnMs: number | null;
  caducaEnMs: number;
  respuesta: RespuestaEncuesta | null;
  qualityCaseId: number | null;
};

export type SatisfactionDeAsistencia = {
  assistanceId: number;
  driver: EncuestaDeAsistencia | null;
  customer: EncuestaDeAsistencia | null;
  qualityCases: { id: number; estado: EstadoCaso; prioridad: Prioridad; motivo: string;
                  responsable: string | null; origen: string | null }[];
};

/**
 * Las dos encuestas de una asistencia, con sus respuestas y su caso.
 *
 * Tres consultas fijas —encuestas, respuestas, casos— y no una por encuesta:
 * son dos como mucho, pero el patrón importa porque esto se pinta dentro de
 * una ficha que ya hace varias llamadas.
 *
 * **No devuelve `tokenHash` ni nada del canal.** Al supervisor no le sirven y
 * sacarlos de la base los pone en un JSON que acaba en el navegador.
 */
export async function obtenerSatisfactionDeAsistencia(
  assistanceId: number, tenantId: string | number | null,
): Promise<SatisfactionDeAsistencia> {
  const vacio: SatisfactionDeAsistencia = {
    assistanceId, driver: null, customer: null, qualityCases: [],
  };

  // El taller se comprueba contra la ASISTENCIA, no contra la encuesta: es
  // donde vive la propiedad del dato, y así una encuesta huérfana no se cuela.
  const dueño = await pool.query(
    `SELECT "tallerId" FROM roadside_assistances WHERE id = $1`, [assistanceId]);
  if (!dueño.rows.length) return vacio;
  const taller = dueño.rows[0].tallerId;
  if (tenantId != null && taller != null && String(taller) !== String(tenantId)) return vacio;

  const instancias = await pool.query(
    `SELECT id, "recipientRole", status, "createdAtMs", "sentAtMs", "queuedAtMs",
            "startedAtMs", "expiresAtMs"
       FROM survey_instances
      WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1`,
    [String(assistanceId)],
  );
  if (!instancias.rows.length) return vacio;

  const ids = instancias.rows.map((f) => Number(f.id));

  // Todas las respuestas de las dos encuestas de una vez.
  const respuestas = await pool.query(
    `SELECT r."surveyInstanceId", r."completedAtMs", a."questionCode", a.value, a."scaleValue"
       FROM survey_responses r
       JOIN survey_answers a ON a."surveyResponseId" = r.id
      WHERE r."surveyInstanceId" = ANY($1)`,
    [ids],
  );

  const casos = await pool.query(
    `SELECT id, "surveyInstanceId", status, priority, reason, "assigneeUserId",
            "originRecipientRole"
       FROM quality_cases
      WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1`,
    [String(assistanceId)],
  );

  const porInstancia = new Map<number, RespuestaEncuesta>();
  for (const f of respuestas.rows) {
    const id = Number(f.surveyInstanceId);
    const actual = porInstancia.get(id) ?? {
      overallRating: null, professionalRating: null, speedRating: null,
      trackingRating: null, resolution: null, negativeReasons: [], comment: null,
      respondidaEnMs: Number(f.completedAtMs),
    };
    const codigo = String(f.questionCode);
    const escala = f.scaleValue == null ? null : Number(f.scaleValue);
    if (codigo === "overall_rating") actual.overallRating = escala;
    else if (codigo === "professional_rating") actual.professionalRating = escala;
    else if (codigo === "speed_rating") actual.speedRating = escala;
    else if (codigo === "tracking_rating") actual.trackingRating = escala;
    else if (codigo === "resolution") actual.resolution = f.value == null ? null : String(f.value);
    else if (codigo === "comment") actual.comment = f.value == null ? null : String(f.value);
    else if (codigo === "negative_reasons") {
      try { actual.negativeReasons = JSON.parse(String(f.value ?? "[]")); } catch { /* deja [] */ }
    }
    porInstancia.set(id, actual);
  }

  const casoPorInstancia = new Map<number, number>();
  for (const c of casos.rows) {
    if (c.surveyInstanceId != null) casoPorInstancia.set(Number(c.surveyInstanceId), Number(c.id));
  }

  const construir = (f: Record<string, unknown>): EncuestaDeAsistencia => ({
    recipientRole: String(f.recipientRole) as RolDestinatario,
    estado: String(f.status),
    creadaEnMs: Number(f.createdAtMs),
    // «Enviada» es cuando salió de verdad; mientras no haya envío real, esto es
    // null y la pantalla lo dice sin fingir.
    enviadaEnMs: f.sentAtMs == null ? null : Number(f.sentAtMs),
    iniciadaEnMs: f.startedAtMs == null ? null : Number(f.startedAtMs),
    caducaEnMs: Number(f.expiresAtMs),
    respuesta: porInstancia.get(Number(f.id)) ?? null,
    qualityCaseId: casoPorInstancia.get(Number(f.id)) ?? null,
  });

  const de = (rol: RolDestinatario) => {
    const f = instancias.rows.find((x) => String(x.recipientRole) === rol);
    return f ? construir(f) : null;
  };

  return {
    assistanceId,
    driver: de("DRIVER"),
    customer: de("CUSTOMER"),
    qualityCases: casos.rows.map((c) => ({
      id: Number(c.id),
      estado: String(c.status) as EstadoCaso,
      prioridad: String(c.priority) as Prioridad,
      motivo: String(c.reason),
      responsable: c.assigneeUserId == null ? null : String(c.assigneeUserId),
      origen: c.originRecipientRole == null ? null : String(c.originRecipientRole),
    })),
  };
}

/* ── Bandeja ─────────────────────────────────────────────────────────────── */

export type FiltrosBandeja = {
  desdeMs?: number | null;
  hastaMs?: number | null;
  clienteId?: number | null;
  proveedorTallerId?: number | null;
  recipientRole?: string | null;
  motivo?: string | null;
  prioridad?: string | null;
  estado?: string | null;
  responsable?: string | null;
  /** `true` deja solo lo que sigue abierto. Es el filtro que más se usa. */
  soloAbiertos?: boolean;
  pagina?: number;
  porPagina?: number;
};

export type FilaBandeja = {
  id: number;
  assistanceId: number;
  creadoEnMs: number;
  clienteNombre: string | null;
  proveedorNombre: string | null;
  matricula: string | null;
  originRecipientRole: string | null;
  valoracion: number | null;
  motivo: string;
  prioridad: Prioridad;
  estado: EstadoCaso;
  responsable: string | null;
};

export type Bandeja = {
  data: FilaBandeja[];
  total: number;
  pagina: number;
  porPagina: number;
  contadores: { abiertos: number; criticos: number; sinResponsable: number };
};

/** Los estados que cuentan como «todavía hay que hacer algo». */
const ABIERTOS = ["NEW", "IN_REVIEW", "PENDING_PROVIDER", "PENDING_CUSTOMER"];

const MAX_POR_PAGINA = 100;

/**
 * La bandeja, filtrada y paginada.
 *
 * ── El orden ────────────────────────────────────────────────────────────────
 *
 * Primero lo crítico, luego lo abierto, luego lo reciente. Es el orden en que
 * un supervisor quiere encontrarse el trabajo: unos daños en un vehículo de
 * hace tres días importan más que una valoración baja de esta mañana.
 *
 * ── Y una sola consulta ─────────────────────────────────────────────────────
 *
 * Cliente, proveedor y matrícula salen por JOIN; la valoración general, por una
 * subconsulta lateral sobre la respuesta de la encuesta que originó el caso.
 * Sin eso serían cuatro consultas por fila.
 */
export async function listarCasos(
  tenantId: string | number | null, f: FiltrosBandeja = {},
): Promise<Bandeja> {
  const porPagina = Math.min(Math.max(1, Number(f.porPagina) || 25), MAX_POR_PAGINA);
  const pagina = Math.max(1, Number(f.pagina) || 1);

  const cond: string[] = [`q."sourceSystem" = 'assist'`];
  const args: unknown[] = [];
  const poner = (sql: string, valor: unknown) => { args.push(valor); cond.push(sql.replace("?", `$${args.length}`)); };

  // El tenant NO es opcional en la práctica: si viene, filtra; si no viene —un
  // administrador de plataforma— se ve todo, que es el comportamiento que ya
  // tienen las demás bandejas del panel.
  if (tenantId != null) poner(`q."tenantId" = ?`, String(tenantId));
  if (f.desdeMs) poner(`q."createdAtMs" >= ?`, f.desdeMs);
  if (f.hastaMs) poner(`q."createdAtMs" <= ?`, f.hastaMs);
  if (f.recipientRole) poner(`q."originRecipientRole" = ?`, f.recipientRole);
  if (f.motivo) poner(`q.reason = ?`, f.motivo);
  if (f.prioridad) poner(`q.priority = ?`, f.prioridad);
  if (f.estado) poner(`q.status = ?`, f.estado);
  if (f.responsable) poner(`q."assigneeUserId" = ?`, f.responsable);
  if (f.soloAbiertos) poner(`q.status = ANY(?)`, ABIERTOS);
  if (f.clienteId) poner(`a."clienteFacturacionId" = ?`, f.clienteId);
  if (f.proveedorTallerId) poner(`a."proveedorTallerId" = ?`, f.proveedorTallerId);

  const donde = cond.join(" AND ");

  const DE = `
    FROM quality_cases q
    LEFT JOIN roadside_assistances a ${unirAsistencia("q")}
    LEFT JOIN connect_clients c ON c.id = a."clienteFacturacionId"
    LEFT JOIN connect_workshops w ON w.id = a."proveedorTallerId"
   WHERE ${donde}`;

  const total = await pool.query(`SELECT COUNT(*)::int AS n ${DE}`, args);
  const contadores = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE q.status = ANY($${args.length + 1}))::int AS abiertos,
       COUNT(*) FILTER (WHERE q.priority = 'CRITICAL')::int AS criticos,
       COUNT(*) FILTER (WHERE q."assigneeUserId" IS NULL
                          AND q.status = ANY($${args.length + 1}))::int AS "sinResponsable"
     ${DE}`,
    [...args, ABIERTOS],
  );

  const filas = await pool.query(
    `SELECT q.id, q."assistanceId", q."createdAtMs", q.reason, q.priority, q.status,
            q."assigneeUserId", q."originRecipientRole",
            c.name AS "clienteNombre", w.name AS "proveedorNombre", a.plate,
            (SELECT sa."scaleValue"
               FROM survey_responses sr
               JOIN survey_answers sa ON sa."surveyResponseId" = sr.id
              WHERE sr.id = q."surveyResponseId" AND sa."questionCode" = 'overall_rating'
              LIMIT 1) AS valoracion
     ${DE}
     ORDER BY
       CASE q.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
       CASE WHEN q.status = ANY($${args.length + 1}) THEN 0 ELSE 1 END,
       q."createdAtMs" DESC
     LIMIT $${args.length + 2} OFFSET $${args.length + 3}`,
    [...args, ABIERTOS, porPagina, (pagina - 1) * porPagina],
  );

  return {
    data: filas.rows.map((r) => ({
      id: Number(r.id),
      assistanceId: Number(r.assistanceId),
      creadoEnMs: Number(r.createdAtMs),
      clienteNombre: r.clienteNombre ?? null,
      proveedorNombre: r.proveedorNombre ?? null,
      matricula: r.plate ?? null,
      originRecipientRole: r.originRecipientRole ?? null,
      valoracion: r.valoracion == null ? null : Number(r.valoracion),
      motivo: String(r.reason),
      prioridad: String(r.priority) as Prioridad,
      estado: String(r.status) as EstadoCaso,
      responsable: r.assigneeUserId == null ? null : String(r.assigneeUserId),
    })),
    total: Number(total.rows[0].n),
    pagina,
    porPagina,
    contadores: {
      abiertos: Number(contadores.rows[0].abiertos),
      criticos: Number(contadores.rows[0].criticos),
      sinResponsable: Number(contadores.rows[0].sinResponsable),
    },
  };
}

/* ── Detalle ─────────────────────────────────────────────────────────────── */

export type EventoCaso = {
  eventType: string; actorNombre: string | null; fromValue: string | null;
  toValue: string | null; note: string | null; occurredAtMs: number;
};

export type DetalleCaso = {
  id: number;
  assistanceId: number;
  estado: EstadoCaso;
  prioridad: Prioridad;
  motivo: string;
  responsable: string | null;
  origen: string | null;
  resolution: string | null;
  actionTaken: string | null;
  creadoEnMs: number;
  actualizadoEnMs: number;
  resueltoEnMs: number | null;
  cerradoEnMs: number | null;
  contexto: {
    clienteNombre: string | null; proveedorNombre: string | null;
    matricula: string | null; descripcion: string | null;
    /** Los instantes reales del servicio. Los que falten van a null. */
    tiempos: Record<string, number | null>;
  };
  satisfaction: SatisfactionDeAsistencia;
  cronologia: EventoCaso[];
};

/**
 * Un caso con todo su contexto.
 *
 * **Nunca por id suelto**: el tenant es argumento y filtra en el WHERE, así que
 * un caso de otro taller no se distingue de uno que no existe. Es el mismo
 * patrón que documentos.
 */
export async function detalleCaso(
  casoId: number, tenantId: string | number | null,
): Promise<DetalleCaso | null> {
  const r = await pool.query(
    `SELECT q.*, c.name AS "clienteNombre", w.name AS "proveedorNombre",
            a.plate, a."descripcionAveria",
            a."createdAtMs" AS "solicitadaEnMs", a."assignedAtMs", a."departedAtMs",
            a."arrivedAtPointMs", a."inicioReparacionAtMs", a."finishedAtMs"
       FROM quality_cases q
       LEFT JOIN roadside_assistances a ${unirAsistencia("q")}
       LEFT JOIN connect_clients c ON c.id = a."clienteFacturacionId"
       LEFT JOIN connect_workshops w ON w.id = a."proveedorTallerId"
      WHERE q.id = $1
        AND ($2::text IS NULL OR q."tenantId" = $2)`,
    [casoId, tenantId == null ? null : String(tenantId)],
  );
  const f = r.rows[0];
  if (!f) return null;

  const eventos = await pool.query(
    `SELECT "eventType", "actorName", "fromValue", "toValue", note, "occurredAtMs"
       FROM quality_case_events WHERE "qualityCaseId" = $1
      ORDER BY "occurredAtMs", id`,
    [casoId],
  );

  const num = (v: unknown) => (v == null ? null : Number(v));

  return {
    id: Number(f.id),
    assistanceId: Number(f.assistanceId),
    estado: String(f.status) as EstadoCaso,
    prioridad: String(f.priority) as Prioridad,
    motivo: String(f.reason),
    responsable: f.assigneeUserId == null ? null : String(f.assigneeUserId),
    origen: f.originRecipientRole == null ? null : String(f.originRecipientRole),
    resolution: f.resolution == null ? null : String(f.resolution),
    actionTaken: f.actionTaken == null ? null : String(f.actionTaken),
    creadoEnMs: Number(f.createdAtMs),
    actualizadoEnMs: Number(f.updatedAtMs),
    resueltoEnMs: num(f.resolvedAtMs),
    cerradoEnMs: num(f.closedAtMs),
    contexto: {
      clienteNombre: f.clienteNombre ?? null,
      proveedorNombre: f.proveedorNombre ?? null,
      matricula: f.plate ?? null,
      descripcion: f.descripcionAveria ?? null,
      /*
       * Solo los instantes que existen. Las duraciones las calcula la pantalla
       * a partir de éstos y solo cuando están los dos extremos: inventar un
       * «tiempo hasta llegada» sin hora de llegada sería peor que no darlo.
       */
      tiempos: {
        solicitada: num(f.solicitadaEnMs),
        asignada: num(f.assignedAtMs),
        enCamino: num(f.departedAtMs),
        enPunto: num(f.arrivedAtPointMs),
        reparando: num(f.inicioReparacionAtMs),
        finalizada: num(f.finishedAtMs),
      },
    },
    satisfaction: await obtenerSatisfactionDeAsistencia(Number(f.assistanceId), tenantId),
    cronologia: eventos.rows.map((e) => ({
      eventType: String(e.eventType),
      actorNombre: e.actorName == null ? null : String(e.actorName),
      fromValue: e.fromValue == null ? null : String(e.fromValue),
      toValue: e.toValue == null ? null : String(e.toValue),
      note: e.note == null ? null : String(e.note),
      occurredAtMs: Number(e.occurredAtMs),
    })),
  };
}
