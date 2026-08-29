/**
 * Lectura y escritura de acuerdos comerciales y presupuestos.
 *
 * Misma regla que en la cartera de empresas: **el id nunca viaja solo**. Toda
 * consulta lleva el centro en el WHERE, así que un acuerdo de otra plataforma
 * no se devuelve aunque se pida por su id exacto. No hay un `WHERE id = $1`
 * suelto en el módulo, y ésa es la única forma de que cambiar un número en la
 * URL no sirva de nada.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import {
  type Acuerdo, type Cobertura, type Evaluacion, type Peticion,
  evaluar, leerCobertura, leerHorario,
} from "./dominio.ts";

export class ErrorAcuerdo extends Error {
  constructor(public estado: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

function jsonSeguro(v: unknown, porDefecto: unknown): any {
  if (v == null) return porDefecto;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return porDefecto; }
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fila de base → acuerdo de dominio. */
export function aAcuerdo(f: any): Acuerdo {
  return {
    id: Number(f.id),
    controlCenterId: Number(f.controlCenterId),
    providerCompanyId: Number(f.providerCompanyId),
    status: String(f.status ?? "active"),
    serviciosCubiertos: (() => {
      const s = jsonSeguro(f.serviceTypes, []);
      return Array.isArray(s) ? s.map((x: unknown) => String(x)) : [];
    })(),
    cobertura: leerCobertura(f.coverage),
    horario: leerHorario(f.schedule),
    economico: {
      moneda: String(f.currency ?? "EUR"),
      limiteSinPresupuesto: num(f.quoteThreshold),
      limiteMaximo: num(f.maxAmount),
      presupuestoObligatorio: f.quoteRequired === true,
    },
    condiciones: {
      documentacionExigida: (() => {
        const d = jsonSeguro(f.requiredDocuments, []);
        return Array.isArray(d) ? d.map((x: unknown) => String(x)) : [];
      })(),
      cancelacionSinCosteMin: num(f.cancelFreeMin),
      cancelacionCoste: num(f.cancelFee),
      cancelacionEnPorcentaje: f.cancelFeeIsPercent === true,
    },
    slaAcceptMin: num(f.slaAcceptMin),
    slaArrivalMin: num(f.slaArrivalMin),
    maxConcurrent: num(f.maxConcurrent),
    preferred: f.preferred === true,
    excluded: f.excluded === true,
    validFromMs: num(f.validFromMs),
    validToMs: num(f.validToMs),
  };
}

/*
 * Sin JOIN a `external_destinations`: el nombre del destino es un adorno de la
 * pantalla, y colgar de él la consulta ataría los acuerdos al módulo de
 * envíos. Un despliegue donde el esquema de envíos aún no ha corrido dejaría
 * la cartera de acuerdos entera sin poder abrirse por un rótulo.
 */
const SELECT_ACUERDO = `
  SELECT a.*, pc.name AS "companyName", pc."taxId" AS "companyTaxId"
    FROM connect_provider_authorizations a
    JOIN connect_provider_companies pc ON pc.id = a."providerCompanyId"`;

/** Nombres de los destinos, si el módulo de envíos existe en esta base. */
async function nombresDeDestino(ids: number[]): Promise<Map<number, string>> {
  const limpios = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (limpios.length === 0) return new Map();
  try {
    const r = await db.query(
      `SELECT id, name FROM external_destinations WHERE id = ANY($1::int[])`, [limpios]);
    return new Map(r.rows.map((f: any) => [Number(f.id), String(f.name)]));
  } catch {
    return new Map();
  }
}

/** Todos los acuerdos de un centro. `null` solo lo usa el superadministrador. */
export async function listarAcuerdos(centro: number | null): Promise<any[]> {
  const r = centro == null
    ? await db.query(`${SELECT_ACUERDO} ORDER BY a."controlCenterId", pc.name`)
    : await db.query(`${SELECT_ACUERDO} WHERE a."controlCenterId" = $1 ORDER BY pc.name`, [centro]);
  const nombres = await nombresDeDestino(r.rows.map((f: any) => Number(f.destinationId)));
  return r.rows.map((f) => ({
    ...aAcuerdo(f), empresa: f.companyName, cif: f.companyTaxId,
    destinationId: f.destinationId == null ? null : Number(f.destinationId),
    destino: nombres.get(Number(f.destinationId)) ?? null,
  }));
}

/**
 * Un acuerdo concreto.
 *
 * Devuelve `null` tanto si no existe como si es de otra plataforma, y quien
 * llama contesta 404 en los dos casos. Distinguirlos diría a quien va probando
 * ids cuáles existen, que es justo lo que no debe poder averiguar.
 */
export async function cargarAcuerdo(id: number, centro: number | null): Promise<any | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = centro == null
    ? await db.query(`${SELECT_ACUERDO} WHERE a.id = $1`, [id])
    : await db.query(`${SELECT_ACUERDO} WHERE a.id = $1 AND a."controlCenterId" = $2`, [id, centro]);
  const f = r.rows[0];
  if (!f) return null;
  const nombres = await nombresDeDestino([Number(f.destinationId)]);
  return {
    ...aAcuerdo(f), empresa: f.companyName, cif: f.companyTaxId,
    destinationId: f.destinationId == null ? null : Number(f.destinationId),
    destino: nombres.get(Number(f.destinationId)) ?? null,
  };
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

/** Solo estos campos se pueden tocar desde la API. Lista blanca a propósito. */
const EDITABLES: Record<string, string> = {
  status: "status",
  serviceTypes: "serviceTypes",
  coverage: "coverage",
  schedule: "schedule",
  currency: "currency",
  quoteThreshold: "quoteThreshold",
  maxAmount: "maxAmount",
  quoteRequired: "quoteRequired",
  requiredDocuments: "requiredDocuments",
  cancelFreeMin: "cancelFreeMin",
  cancelFee: "cancelFee",
  cancelFeeIsPercent: "cancelFeeIsPercent",
  billingConfig: "billingConfig",
  slaAcceptMin: "slaAcceptMin",
  slaArrivalMin: "slaArrivalMin",
  maxConcurrent: "maxConcurrent",
  preferred: "preferred",
  excluded: "excluded",
  validFromMs: "validFromMs",
  validToMs: "validToMs",
  destinationId: "destinationId",
  notes: "notes",
};

const JSON_COLUMNAS = new Set(["serviceTypes", "coverage", "schedule", "requiredDocuments", "billingConfig"]);

export function validarCondicionesAcuerdo(cuerpo: Record<string, unknown>): string | null {
  const desde = num(cuerpo.validFromMs);
  const hasta = num(cuerpo.validToMs);
  if (desde != null && hasta != null && hasta < desde) {
    return "La vigencia termina antes de empezar";
  }
  for (const campo of ["quoteThreshold", "maxAmount", "cancelFee"]) {
    const v = num(cuerpo[campo]);
    if (v != null && v < 0) return `El importe de ${campo} no puede ser negativo`;
  }
  const tope = num(cuerpo.maxAmount);
  const umbral = num(cuerpo.quoteThreshold);
  if (tope != null && umbral != null && umbral > tope) {
    return "El umbral de presupuesto supera el tope del acuerdo: nunca se alcanzaría";
  }
  if (cuerpo.cancelFeeIsPercent === true) {
    const p = num(cuerpo.cancelFee);
    if (p != null && p > 100) return "Un porcentaje de cancelación no puede pasar de 100";
  }
  return null;
}

export async function actualizarAcuerdo(
  id: number, centro: number | null, cuerpo: Record<string, unknown>, usuarioId: number | null,
): Promise<any> {
  const actual = await cargarAcuerdo(id, centro);
  if (!actual) throw new ErrorAcuerdo(404, "not_found", "Acuerdo no encontrado");

  const mal = validarCondicionesAcuerdo(cuerpo);
  if (mal) throw new ErrorAcuerdo(422, "invalid_terms", mal);

  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const [clave, columna] of Object.entries(EDITABLES)) {
    if (!(clave in cuerpo)) continue;
    let v = cuerpo[clave];
    if (JSON_COLUMNAS.has(columna)) v = JSON.stringify(v ?? (columna === "coverage" || columna === "schedule" || columna === "billingConfig" ? {} : []));
    valores.push(v === "" ? null : v);
    sets.push(`"${columna}" = $${valores.length}`);
  }
  if (sets.length === 0) throw new ErrorAcuerdo(422, "nothing_to_update", "No hay nada que cambiar");

  valores.push(Date.now());
  sets.push(`"updatedAtMs" = $${valores.length}`);
  valores.push(usuarioId);
  sets.push(`"updatedByUserId" = $${valores.length}`);

  /*
   * El centro vuelve al WHERE aunque ya se haya comprobado al cargar: entre
   * las dos consultas cabe una condición de carrera, y el coste de repetirlo
   * es cero.
   */
  valores.push(id);
  const iId = valores.length;
  let filtroCentro = "";
  if (centro != null) {
    valores.push(centro);
    filtroCentro = ` AND "controlCenterId" = $${valores.length}`;
  }

  await db.query(
    `UPDATE connect_provider_authorizations SET ${sets.join(", ")}
      WHERE id = $${iId}${filtroCentro}`,
    valores,
  );
  return (await cargarAcuerdo(id, centro))!;
}

/* ── Evaluación ──────────────────────────────────────────────────────────── */

export type Candidato = { acuerdo: Acuerdo; empresa: string; evaluacion: Evaluacion };

/**
 * Qué partners de este centro pueden hacerse cargo, y por qué los demás no.
 *
 * Devuelve también los descartados con su motivo: la pregunta que llega a
 * soporte no es «quién puede» sino «por qué no sale nadie», y sin los motivos
 * hay que reproducirlo a mano.
 */
export async function evaluarPartners(centro: number, p: Peticion): Promise<Candidato[]> {
  const r = await db.query(
    `${SELECT_ACUERDO} WHERE a."controlCenterId" = $1`, [centro],
  );
  return r.rows.map((f) => {
    const acuerdo = aAcuerdo(f);
    return { acuerdo, empresa: String(f.companyName ?? ""), evaluacion: evaluar(acuerdo, p) };
  });
}

/* ── Presupuestos ────────────────────────────────────────────────────────── */

export const ESTADOS_PRESUPUESTO = ["REQUESTED", "QUOTED", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
export type EstadoPresupuesto = (typeof ESTADOS_PRESUPUESTO)[number];

/**
 * Qué transiciones valen.
 *
 * Un presupuesto aceptado no vuelve atrás: en cuanto se acepta se encarga el
 * servicio, y «desaceptarlo» dejaría un servicio en marcha sin precio. Para
 * eso está cancelar la asistencia, que sí tiene su coste pactado.
 */
const SIGUIENTES: Record<EstadoPresupuesto, EstadoPresupuesto[]> = {
  REQUESTED: ["QUOTED", "REJECTED", "EXPIRED"],
  QUOTED: ["ACCEPTED", "REJECTED", "EXPIRED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

export function puedePasar(de: unknown, a: unknown): boolean {
  const origen = String(de ?? "") as EstadoPresupuesto;
  if (!(origen in SIGUIENTES)) return false;
  return SIGUIENTES[origen].includes(String(a ?? "") as EstadoPresupuesto);
}

/** Pide presupuesto a un partner. Idempotente por (asistencia, acuerdo). */
export async function pedirPresupuesto(p: {
  centro: number; assistanceId: number; authorizationId: number | null;
  dispatchId?: number | null; correlationId?: string | null;
}): Promise<any> {
  const acuerdo = p.authorizationId == null ? null : await cargarAcuerdo(p.authorizationId, p.centro);
  if (p.authorizationId != null && !acuerdo) {
    throw new ErrorAcuerdo(404, "not_found", "Acuerdo no encontrado");
  }
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO connect_quotes
       (uuid, "controlCenterId", "assistanceId", "authorizationId", "dispatchId",
        "correlationId", status, currency, "requestedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,'REQUESTED',$7,$8,$8,$8)
     ON CONFLICT ("assistanceId", "authorizationId") WHERE "authorizationId" IS NOT NULL
     DO UPDATE SET "updatedAtMs" = EXCLUDED."updatedAtMs"
     RETURNING *`,
    [crypto.randomUUID(), p.centro, p.assistanceId, p.authorizationId,
     p.dispatchId ?? null, p.correlationId ?? null, acuerdo?.economico.moneda ?? "EUR", now],
  );
  return r.rows[0];
}

/**
 * El partner contesta con su precio.
 *
 * Se entra por `correlationId` y no por id de presupuesto: el partner no
 * conoce nuestros ids, y darle uno para que nos lo devuelva sería regalarle
 * una forma de escribir en un presupuesto que no es suyo.
 */
export async function registrarOferta(
  correlationId: string, oferta: { importe?: unknown; moneda?: unknown; impuestos?: unknown;
    concepto?: unknown; etaMin?: unknown; validoHastaMs?: unknown },
): Promise<{ aplicado: boolean; motivo?: string }> {
  const importe = num(oferta.importe);
  if (importe == null || importe < 0) return { aplicado: false, motivo: "Importe no válido" };

  const r = await db.query(
    `SELECT id, status FROM connect_quotes WHERE "correlationId" = $1
      ORDER BY id DESC LIMIT 1`, [correlationId],
  );
  const q = r.rows[0];
  if (!q) return { aplicado: false, motivo: "correlation_id desconocido" };
  if (!puedePasar(q.status, "QUOTED")) {
    return { aplicado: false, motivo: `Un presupuesto en ${q.status} ya no admite oferta` };
  }

  const now = Date.now();
  await db.query(
    `UPDATE connect_quotes
        SET status = 'QUOTED', amount = $2, currency = COALESCE($3, currency),
            taxes = $4, concept = $5, "etaMin" = $6, "validUntilMs" = $7,
            "quotedAtMs" = $8, "updatedAtMs" = $8
      WHERE id = $1`,
    [q.id, importe, oferta.moneda ? String(oferta.moneda) : null, num(oferta.impuestos),
     oferta.concepto ? String(oferta.concepto).slice(0, 500) : null,
     num(oferta.etaMin), num(oferta.validoHastaMs), now],
  );
  return { aplicado: true };
}

/** Aceptar o rechazar una oferta. El centro va en el WHERE, no en la confianza. */
export async function decidirPresupuesto(
  id: number, centro: number | null, aceptar: boolean, usuarioId: number | null, motivo?: string | null,
): Promise<any> {
  const filtro = centro == null ? "" : ` AND "controlCenterId" = $2`;
  const r = await db.query(
    `SELECT * FROM connect_quotes WHERE id = $1${filtro}`,
    centro == null ? [id] : [id, centro],
  );
  const q = r.rows[0];
  if (!q) throw new ErrorAcuerdo(404, "not_found", "Presupuesto no encontrado");

  const destino = aceptar ? "ACCEPTED" : "REJECTED";
  if (!puedePasar(q.status, destino)) {
    throw new ErrorAcuerdo(409, "invalid_transition",
      `Un presupuesto en ${q.status} no se puede ${aceptar ? "aceptar" : "rechazar"}`);
  }
  if (aceptar && q.validUntilMs != null && Number(q.validUntilMs) < Date.now()) {
    throw new ErrorAcuerdo(409, "expired", "La oferta ha caducado: pide una nueva");
  }

  const now = Date.now();
  const u = await db.query(
    `UPDATE connect_quotes
        SET status = $2, "rejectReason" = $3, "decidedAtMs" = $4,
            "decidedByUserId" = $5, "updatedAtMs" = $4
      WHERE id = $1 RETURNING *`,
    [id, destino, aceptar ? null : (motivo ? String(motivo).slice(0, 500) : null), now, usuarioId],
  );
  return u.rows[0];
}

export async function presupuestosDe(assistanceId: number, centro: number | null): Promise<any[]> {
  const filtro = centro == null ? "" : ` AND q."controlCenterId" = $2`;
  const r = await db.query(
    `SELECT q.*, pc.name AS "partnerName"
       FROM connect_quotes q
       LEFT JOIN connect_provider_authorizations a ON a.id = q."authorizationId"
       LEFT JOIN connect_provider_companies pc ON pc.id = a."providerCompanyId"
      WHERE q."assistanceId" = $1${filtro}
      ORDER BY q.id DESC`,
    centro == null ? [assistanceId] : [assistanceId, centro],
  );
  return r.rows;
}

/** Caduca las ofertas pasadas de fecha. Lo llama el worker. */
export async function caducarOfertas(): Promise<number> {
  const r = await db.query(
    `UPDATE connect_quotes SET status = 'EXPIRED', "updatedAtMs" = $1
      WHERE status IN ('REQUESTED','QUOTED')
        AND "validUntilMs" IS NOT NULL AND "validUntilMs" < $1`,
    [Date.now()],
  );
  return r.rowCount ?? 0;
}

export type { Acuerdo, Cobertura, Peticion };
