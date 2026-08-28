/**
 * Conceptos de la asistencia: qué se montó de verdad (neumáticos, materiales).
 * Diseño en docs/PROMPT_conceptos_asistencia.md.
 *
 * El ciclo es `previsto` → `confirmado` | `no_usado`:
 *
 *   · Lo PREVISTO lo asigna la central cuando el cambio se pacta de antemano
 *     ("vas a montar este neumático"). El taller no elige: confirma.
 *   · CONFIRMAR un neumático exige la foto de montaje en el vehículo. Es la
 *     prueba que sostiene la línea de la factura; sin foto no hay línea. Los
 *     materiales (una ecotasa, una reparación) no la exigen: no hay nada que
 *     fotografiar.
 *   · Lo NO USADO lleva motivo, porque "no se montó" sin más no responde la
 *     pregunta que alguien hará al cuadrar la facturación.
 *
 * Aquí no hay precios A PROPÓSITO. Quien declara dice QUÉ y CUÁNTOS; el
 * precio lo pone el tarifario publicado en el cierre, con la configuración
 * congelada en la orden de salida. Un taller que pudiera declarar su precio
 * estaría escribiendo su propia factura.
 *
 * Todo deja de poder tocarse en cuanto existe la etapa `final`: a partir de
 * ahí el camino es el ajuste manual auditado, como siempre.
 */

import db from "../../db.ts";
import { medidaCanonica } from "../../../shared/medidas.ts";
import { normalizarMarca } from "./tires.ts";
import type { ConceptoServicio } from "./types.ts";

export class ErrorConceptos extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly estado = 400) {
    super(mensaje);
  }
}

export interface Concepto {
  id: number;
  assistanceId: number;
  kind: "TIRE" | "MATERIAL";
  size: string | null;
  brand: string | null;
  position: "STEER" | "DRIVE" | "TRAILER" | "ANY";
  conceptCode: string | null;
  quantity: number;
  status: "previsto" | "confirmado" | "no_usado";
  statusReason: string | null;
  plannedBy: string | null;
  plannedAtMs: number | null;
  confirmedBy: string | null;
  confirmedAtMs: number | null;
  confirmedVia: "lite" | "panel" | null;
  evidenceRef: string | null;
  createdAtMs: number;
}

function fila(r: any): Concepto {
  return {
    id: Number(r.id),
    assistanceId: Number(r.assistanceId),
    kind: r.kind,
    size: r.size ?? null,
    brand: r.brand ?? null,
    position: r.position ?? "ANY",
    conceptCode: r.conceptCode ?? null,
    quantity: Number(r.quantity),
    status: r.status,
    statusReason: r.statusReason ?? null,
    plannedBy: r.plannedBy ?? null,
    plannedAtMs: r.plannedAtMs != null ? Number(r.plannedAtMs) : null,
    confirmedBy: r.confirmedBy ?? null,
    confirmedAtMs: r.confirmedAtMs != null ? Number(r.confirmedAtMs) : null,
    confirmedVia: r.confirmedVia ?? null,
    evidenceRef: r.evidenceRef ?? null,
    createdAtMs: Number(r.createdAtMs),
  };
}

/**
 * La asistencia, verificando la pertenencia al centro cuando se pasa uno.
 * `centro` null = superadmin en listados; para escribir siempre llega centro.
 */
async function asistenciaDe(assistanceId: number, centro: number | null): Promise<{
  id: number; controlCenterId: number; coreAssistanceId: number | null;
}> {
  const r = await db.query(
    `SELECT id, "controlCenterId", "coreAssistanceId" FROM connect_assistances
      WHERE id = $1 AND ($2::int IS NULL OR "controlCenterId" = $2)`,
    [assistanceId, centro],
  );
  if (!r.rows[0]) throw new ErrorConceptos("not_found", "Asistencia no encontrada", 404);
  return {
    id: Number(r.rows[0].id),
    controlCenterId: Number(r.rows[0].controlCenterId),
    coreAssistanceId: r.rows[0].coreAssistanceId != null ? Number(r.rows[0].coreAssistanceId) : null,
  };
}

/**
 * La lista solo se toca mientras no hay cierre. La etapa final es inmutable,
 * y un concepto que aparece después va por ajuste manual auditado: cambiar la
 * lista bajo una tarifa ya cerrada dejaría una factura que no se explica.
 */
async function exigirSinCierre(assistanceId: number): Promise<void> {
  const r = await db.query(
    `SELECT 1 FROM connect_assistance_pricings WHERE "assistanceId" = $1 AND stage = 'final'`,
    [assistanceId],
  );
  if (r.rows[0]) {
    throw new ErrorConceptos(
      "tarifa_cerrada",
      "La tarifa ya está cerrada. Lo que se comunique ahora entra como ajuste manual, no aquí.",
      409,
    );
  }
}

/**
 * La foto tiene que ser de ESTA asistencia. `c<id>` es un fichero de Connect
 * (Lite, WhatsApp); `a<id>` uno del core (el técnico de Mobilink Assist, que
 * llega por el puente de inyección). Aceptar cualquier referencia permitiría
 * confirmar un neumático con la foto de otro servicio, y la foto es
 * precisamente la prueba.
 */
async function exigirEvidencia(
  a: { id: number; coreAssistanceId: number | null },
  ref: string,
): Promise<void> {
  const m = /^([ca])(\d+)$/.exec(ref.trim());
  if (!m) throw new ErrorConceptos("evidencia_invalida", "Referencia de foto no reconocida");
  const [, origen, id] = m;
  const r = origen === "c"
    ? await db.query(
        `SELECT 1 FROM connect_assistance_files
          WHERE id = $1 AND "assistanceId" = $2 AND "deletedAtMs" IS NULL`,
        [Number(id), a.id])
    : await db.query(
        `SELECT 1 FROM roadside_assistance_files WHERE id = $1 AND "assistanceId" = $2`,
        [Number(id), a.coreAssistanceId ?? -1]);
  if (!r.rows[0]) {
    throw new ErrorConceptos("evidencia_invalida", "Esa foto no pertenece a esta asistencia");
  }
}

const POSICIONES = ["STEER", "DRIVE", "TRAILER", "ANY"] as const;

function normalizar(entrada: {
  kind: string;
  size?: string | null;
  brand?: string | null;
  position?: string | null;
  conceptCode?: string | null;
  quantity?: number | null;
}): {
  kind: "TIRE" | "MATERIAL"; size: string | null; brand: string | null;
  position: (typeof POSICIONES)[number]; conceptCode: string | null; quantity: number;
} {
  const kind = String(entrada.kind ?? "").toUpperCase();
  if (kind !== "TIRE" && kind !== "MATERIAL") {
    throw new ErrorConceptos("tipo_invalido", "El concepto tiene que ser TIRE o MATERIAL");
  }
  const quantity = Math.trunc(Number(entrada.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
    throw new ErrorConceptos("cantidad_invalida", "La cantidad tiene que estar entre 1 y 99");
  }
  if (kind === "TIRE") {
    const size = medidaCanonica(String(entrada.size ?? ""));
    if (!size) throw new ErrorConceptos("medida_requerida", "Hace falta la medida del neumático");
    const brand = entrada.brand ? normalizarMarca(String(entrada.brand)) : null;
    // La posición importa: hay tarifarios que dan precio por STEER/DRIVE, y
    // un precio de posición concreta no casa con una petición sin posición.
    const posicion = String(entrada.position ?? "ANY").toUpperCase();
    if (!POSICIONES.includes(posicion as any)) {
      throw new ErrorConceptos("posicion_invalida", "La posición tiene que ser STEER, DRIVE, TRAILER o ANY");
    }
    return { kind, size, brand: brand || null, position: posicion as (typeof POSICIONES)[number], conceptCode: null, quantity };
  }
  const conceptCode = String(entrada.conceptCode ?? "").trim().toUpperCase();
  if (!conceptCode) throw new ErrorConceptos("concepto_requerido", "Hace falta el código del material");
  return { kind, size: null, brand: null, position: "ANY", conceptCode, quantity };
}

export async function listarConceptos(
  assistanceId: number,
  centro: number | null,
): Promise<Concepto[]> {
  await asistenciaDe(assistanceId, centro);
  const r = await db.query(
    `SELECT * FROM connect_assistance_concepts
      WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL
      ORDER BY id`,
    [assistanceId],
  );
  return r.rows.map(fila);
}

export interface AltaConcepto {
  kind: string;
  size?: string | null;
  brand?: string | null;
  position?: string | null;
  conceptCode?: string | null;
  quantity?: number | null;
  /** true = se declara y confirma en el mismo acto (caso B2, o panel en
   *  nombre del taller). Exige evidencia si es neumático. */
  confirmar?: boolean;
  evidenceRef?: string | null;
  via?: "lite" | "panel";
  actor: string;
  clientActionId?: string | null;
}

export async function crearConcepto(
  assistanceId: number,
  centro: number | null,
  alta: AltaConcepto,
): Promise<Concepto> {
  const a = await asistenciaDe(assistanceId, centro);
  await exigirSinCierre(assistanceId);
  const n = normalizar(alta);
  const ahora = Date.now();

  // Reenvío de la cola offline de Lite: la misma acción no crea dos apuntes
  if (alta.clientActionId) {
    const previo = await db.query(
      `SELECT * FROM connect_assistance_concepts
        WHERE "assistanceId" = $1 AND "clientActionId" = $2`,
      [assistanceId, alta.clientActionId],
    );
    if (previo.rows[0]) return fila(previo.rows[0]);
  }

  const confirmar = alta.confirmar === true;
  if (confirmar && n.kind === "TIRE") {
    if (!alta.evidenceRef) {
      throw new ErrorConceptos(
        "evidencia_requerida",
        "Para confirmar un neumático hace falta la foto de montaje en el vehículo",
        422,
      );
    }
    await exigirEvidencia(a, alta.evidenceRef);
  }

  const r = await db.query(
    `INSERT INTO connect_assistance_concepts
       ("controlCenterId", "assistanceId", kind, size, brand, position, "conceptCode", quantity,
        status, "plannedBy", "plannedAtMs",
        "confirmedBy", "confirmedAtMs", "confirmedVia", "evidenceRef",
        "clientActionId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
     RETURNING *`,
    [
      a.controlCenterId, assistanceId, n.kind, n.size, n.brand, n.position, n.conceptCode, n.quantity,
      confirmar ? "confirmado" : "previsto",
      confirmar ? null : alta.actor, confirmar ? null : ahora,
      confirmar ? alta.actor : null, confirmar ? ahora : null,
      confirmar ? (alta.via ?? "panel") : null,
      confirmar ? (alta.evidenceRef ?? null) : null,
      alta.clientActionId ?? null, ahora,
    ],
  );
  return fila(r.rows[0]);
}

export async function confirmarConcepto(
  assistanceId: number,
  conceptoId: number,
  centro: number | null,
  datos: { actor: string; via: "lite" | "panel"; evidenceRef?: string | null; clientActionId?: string | null },
): Promise<Concepto> {
  const a = await asistenciaDe(assistanceId, centro);
  await exigirSinCierre(assistanceId);

  const actual = await db.query(
    `SELECT * FROM connect_assistance_concepts
      WHERE id = $1 AND "assistanceId" = $2 AND "deletedAtMs" IS NULL`,
    [conceptoId, assistanceId],
  );
  if (!actual.rows[0]) throw new ErrorConceptos("not_found", "Concepto no encontrado", 404);
  const c = fila(actual.rows[0]);
  // Confirmar dos veces (reenvío offline) no es un error: ya está hecho
  if (c.status === "confirmado") return c;
  if (c.status !== "previsto") {
    throw new ErrorConceptos("estado_invalido", `No se puede confirmar un concepto ${c.status}`, 409);
  }

  if (c.kind === "TIRE") {
    if (!datos.evidenceRef) {
      throw new ErrorConceptos(
        "evidencia_requerida",
        "Para confirmar un neumático hace falta la foto de montaje en el vehículo",
        422,
      );
    }
    await exigirEvidencia(a, datos.evidenceRef);
  }

  const r = await db.query(
    `UPDATE connect_assistance_concepts
        SET status = 'confirmado', "confirmedBy" = $1, "confirmedAtMs" = $2,
            "confirmedVia" = $3, "evidenceRef" = $4, "updatedAtMs" = $2
      WHERE id = $5 RETURNING *`,
    [datos.actor, Date.now(), datos.via, datos.evidenceRef ?? null, conceptoId],
  );
  return fila(r.rows[0]);
}

export async function marcarNoUsado(
  assistanceId: number,
  conceptoId: number,
  centro: number | null,
  datos: { actor: string; motivo: string },
): Promise<Concepto> {
  await asistenciaDe(assistanceId, centro);
  await exigirSinCierre(assistanceId);
  const motivo = String(datos.motivo ?? "").trim();
  if (!motivo) {
    throw new ErrorConceptos(
      "motivo_requerido",
      "Hace falta el motivo: 'no se montó' sin más no responde la pregunta que alguien hará al cuadrar",
      422,
    );
  }
  const r = await db.query(
    `UPDATE connect_assistance_concepts
        SET status = 'no_usado', "statusReason" = $1, "updatedAtMs" = $2
      WHERE id = $3 AND "assistanceId" = $4 AND "deletedAtMs" IS NULL AND status = 'previsto'
      RETURNING *`,
    [`${motivo} (${datos.actor})`, Date.now(), conceptoId, assistanceId],
  );
  if (!r.rows[0]) {
    throw new ErrorConceptos("estado_invalido", "Solo un concepto previsto puede marcarse como no usado", 409);
  }
  return fila(r.rows[0]);
}

export async function corregirCantidad(
  assistanceId: number,
  conceptoId: number,
  centro: number | null,
  cantidad: number,
): Promise<Concepto> {
  await asistenciaDe(assistanceId, centro);
  await exigirSinCierre(assistanceId);
  const q = Math.trunc(Number(cantidad));
  if (!Number.isFinite(q) || q < 1 || q > 99) {
    throw new ErrorConceptos("cantidad_invalida", "La cantidad tiene que estar entre 1 y 99");
  }
  const r = await db.query(
    `UPDATE connect_assistance_concepts SET quantity = $1, "updatedAtMs" = $2
      WHERE id = $3 AND "assistanceId" = $4 AND "deletedAtMs" IS NULL RETURNING *`,
    [q, Date.now(), conceptoId, assistanceId],
  );
  if (!r.rows[0]) throw new ErrorConceptos("not_found", "Concepto no encontrado", 404);
  return fila(r.rows[0]);
}

/** Se retira, no se borra: la lista tiene que poder explicarse después. */
export async function retirarConcepto(
  assistanceId: number,
  conceptoId: number,
  centro: number | null,
): Promise<boolean> {
  await asistenciaDe(assistanceId, centro);
  await exigirSinCierre(assistanceId);
  const r = await db.query(
    `UPDATE connect_assistance_concepts SET "deletedAtMs" = $1, "updatedAtMs" = $1
      WHERE id = $2 AND "assistanceId" = $3 AND "deletedAtMs" IS NULL`,
    [Date.now(), conceptoId, assistanceId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Lo que el cierre necesita saber de la lista:
 *
 *   · `conceptos` — SOLO lo confirmado, en el formato que el motor ya valora
 *     (`ConceptoServicio`). El motor pone el precio de cada lado o lo deja
 *     nulo con su aviso; aquí no se toca dinero.
 *   · `sinResolver` — los previstos que nadie confirmó ni descartó. El cierre
 *     los convierte en aviso y en revisión manual: no se cobran por defecto,
 *     pero tampoco desaparecen en silencio.
 */
export async function conceptosParaCierre(assistanceId: number): Promise<{
  conceptos: ConceptoServicio[];
  sinResolver: { id: number; descripcion: string }[];
}> {
  const r = await db.query(
    `SELECT * FROM connect_assistance_concepts
      WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL
      ORDER BY id`,
    [assistanceId],
  );
  const filas = r.rows.map(fila);

  const conceptos: ConceptoServicio[] = filas
    .filter((c) => c.status === "confirmado")
    .map((c) => c.kind === "TIRE"
      ? {
          tipo: "TIRE" as const,
          cantidad: c.quantity,
          neumatico: { medida: c.size!, marca: c.brand, posicion: c.position },
        }
      : {
          tipo: "MATERIAL" as const,
          extraCode: c.conceptCode,
          cantidad: c.quantity,
        });

  const sinResolver = filas
    .filter((c) => c.status === "previsto")
    .map((c) => ({
      id: c.id,
      descripcion: c.kind === "TIRE"
        ? `${c.size}${c.brand ? ` ${c.brand}` : ""}${c.position !== "ANY" ? ` ${c.position}` : ""} ×${c.quantity}`
        : `${c.conceptCode} ×${c.quantity}`,
    }));

  return { conceptos, sinResolver };
}
