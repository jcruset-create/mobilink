/**
 * Registrar documentos, decidir quién los ve y recalcular el estado del
 * expediente.
 *
 * La regla que atraviesa el fichero: **la visibilidad se aplica en la
 * consulta**, no al pintar. `listarDocumentos` recibe quién pregunta y no
 * devuelve lo que esa persona no puede ver. Filtrar en la pantalla dejaría los
 * datos viajando en la respuesta, donde cualquiera los lee.
 */

import crypto from "node:crypto";

import db from "../db.ts";
import { registrarEvento } from "../eventlog/servicio.ts";
import {
  documentosExigidos,
  esTipoDocumento,
  esVisibilidad,
  estadoAdministrativo,
  puedeVer,
  visibilidadPorDefecto,
  type EstadoAdmin,
  type TipoDocumento,
  type Visibilidad,
} from "./tipos.ts";

export class ErrorDocumento extends Error {
  codigo: string;
  estado: number;
  constructor(codigo: string, mensaje: string, estado = 422) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

export type Sistema = "assist" | "central";
export type Quien = "propio" | "contraparte" | "cliente";

export type AltaDocumento = {
  system: Sistema;
  tenantId?: string | number | null;
  assistanceId: string | number;
  correlationId?: string | null;
  tipo: TipoDocumento;
  origen?: "propio" | "proveedor" | "contraparte";
  /** Si no se indica, se decide por tipo y origen. */
  visibilidad?: Visibilidad;
  url?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  providerCompanyId?: number | null;
  workshopId?: number | null;
  dispatchId?: number | null;
  documentDate?: number | null;
  documentNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
  uploadedBy?: string | null;
  notes?: string | null;
  legacyFileId?: number | null;
};

/**
 * Da de alta un documento y recalcula el estado administrativo.
 *
 * El evento del diario se anota aquí y no en cada sitio que sube ficheros: así
 * un albarán que entra por correo, por la app o por la API deja la misma línea
 * en la timeline.
 */
export async function registrarDocumento(d: AltaDocumento) {
  if (!esTipoDocumento(d.tipo)) {
    throw new ErrorDocumento("tipo_invalido", `Tipo de documento desconocido: ${d.tipo}`);
  }
  const origen = d.origen ?? "propio";
  const visibilidad = esVisibilidad(d.visibilidad)
    ? d.visibilidad
    : visibilidadPorDefecto(d.tipo, origen);

  const now = Date.now();
  const r = await db.query(
    `INSERT INTO assistance_documents
       (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", tipo, origen,
        visibilidad, url, "fileName", "mimeType", "sizeBytes", "providerCompanyId",
        "workshopId", "dispatchId", "documentDate", "documentNumber", amount, currency,
        "uploadedBy", notes, "legacyFileId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
     RETURNING *`,
    [
      crypto.randomUUID(), d.system,
      d.tenantId == null ? null : String(d.tenantId), String(d.assistanceId),
      d.correlationId ?? null, d.tipo, origen, visibilidad,
      d.url ?? null, d.fileName ?? null, d.mimeType ?? null, d.sizeBytes ?? null,
      d.providerCompanyId ?? null, d.workshopId ?? null, d.dispatchId ?? null,
      d.documentDate ?? null, d.documentNumber ?? null, d.amount ?? null, d.currency ?? null,
      d.uploadedBy ?? null, d.notes ?? null, d.legacyFileId ?? null, now,
    ],
  );

  /*
   * Un albarán y una factura no son «un documento más»: son los hechos que
   * desbloquean el expediente, y en la timeline tienen que verse como tales.
   */
  const tipoEvento =
    d.tipo === "albaran" ? "DELIVERY_NOTE_RECEIVED"
    : d.tipo === "factura" && origen === "proveedor" ? "SUPPLIER_INVOICE_RECEIVED"
    : "DOCUMENT_UPLOADED";

  await registrarEvento({
    system: d.system,
    tenantId: d.tenantId,
    assistanceId: d.assistanceId,
    correlationId: d.correlationId ?? null,
    eventType: tipoEvento,
    actorType: d.uploadedBy ? "user" : "system",
    actorName: d.uploadedBy ?? null,
    occurredAtMs: now,
    payload: {
      tipo: d.tipo,
      numero: d.documentNumber ?? null,
      fichero: d.fileName ?? null,
      visibilidad,
    },
    dedupeKey: `doc-${r.rows[0].uuid}`,
  });

  await recalcularEstadoAdmin(d.system, d.assistanceId);
  return aApi(r.rows[0]);
}

/* ── Lectura con la política aplicada ────────────────────────────────────── */

function aApi(r: any) {
  return {
    id: Number(r.id),
    uuid: r.uuid,
    tipo: r.tipo as TipoDocumento,
    origen: r.origen,
    visibilidad: r.visibilidad as Visibilidad,
    url: r.url ?? null,
    fileName: r.fileName ?? null,
    mimeType: r.mimeType ?? null,
    documentNumber: r.documentNumber ?? null,
    documentDate: r.documentDate != null ? Number(r.documentDate) : null,
    amount: r.amount != null ? Number(r.amount) : null,
    currency: r.currency ?? null,
    uploadedBy: r.uploadedBy ?? null,
    createdAtMs: Number(r.createdAtMs),
  };
}

/**
 * Documentos de una asistencia, filtrados por quién pregunta.
 *
 * El filtro va en el `WHERE`, no en un `.filter()` posterior: así lo que no se
 * puede ver ni siquiera sale de la base. Un documento interno no viaja en la
 * respuesta ni aunque el frontend lo pidiera.
 *
 * Importante para la contraparte: se busca por `correlationId`, no por
 * `assistanceId`. Central pregunta por SU expediente y hay que devolverle los
 * documentos compartidos del otro lado de la cadena, que están guardados con el
 * id local del otro sistema.
 */
export async function listarDocumentos(
  system: Sistema,
  assistanceId: string | number,
  quien: Quien = "propio",
  correlationId?: string | null,
) {
  const params: unknown[] = [system, String(assistanceId)];
  let where = `("sourceSystem" = $1 AND "assistanceId" = $2)`;

  if (quien !== "propio" && correlationId) {
    params.push(correlationId);
    where = `(${where} OR "correlationId" = $${params.length})`;
  }

  if (quien === "contraparte") where += ` AND visibilidad IN ('compartido','cliente')`;
  else if (quien === "cliente") where += ` AND visibilidad = 'cliente'`;

  const r = await db.query(
    `SELECT * FROM assistance_documents WHERE ${where} ORDER BY id`,
    params,
  );
  // Segunda comprobación en memoria: la consulta ya filtra, pero un valor raro
  // en la columna no puede colarse por una comparación de SQL que no lo cubra.
  return r.rows.filter((x: any) => puedeVer(x.visibilidad, quien)).map(aApi);
}

/** Un documento concreto, o null si quien pregunta no puede verlo. */
export async function cargarDocumento(uuid: string, quien: Quien = "propio") {
  const r = await db.query(`SELECT * FROM assistance_documents WHERE uuid = $1`, [uuid]);
  const d = r.rows[0];
  if (!d || !puedeVer(d.visibilidad, quien)) return null;
  return aApi(d);
}

/**
 * Cambia la visibilidad de un documento.
 *
 * Existe porque la regla por defecto no puede acertar siempre: a veces hay que
 * mandarle al cliente una foto que nació compartida, y a veces hay que retirar
 * algo que se compartió por error. Queda anotado en el diario.
 */
export async function cambiarVisibilidad(
  uuid: string,
  visibilidad: Visibilidad,
  porQuien?: string | null,
) {
  if (!esVisibilidad(visibilidad)) {
    throw new ErrorDocumento("visibilidad_invalida", "Visibilidad desconocida");
  }
  const r = await db.query(
    `UPDATE assistance_documents SET visibilidad = $2, "updatedAtMs" = $3
      WHERE uuid = $1 RETURNING *`,
    [uuid, visibilidad, Date.now()],
  );
  const d = r.rows[0];
  if (!d) throw new ErrorDocumento("not_found", "Documento no encontrado", 404);

  await registrarEvento({
    system: d.sourceSystem, tenantId: d.tenantId, assistanceId: d.assistanceId,
    correlationId: d.correlationId, eventType: "DOCUMENT_UPLOADED",
    actorType: "user", actorName: porQuien ?? null,
    payload: { accion: "visibilidad", tipo: d.tipo, visibilidad },
  });
  return aApi(d);
}

/* ── Estado administrativo ───────────────────────────────────────────────── */

const TABLA: Record<Sistema, { nombre: string; finalizada: string; subcontratada: string }> = {
  assist: {
    nombre: "roadside_assistances",
    finalizada: `status = 'finalizada'`,
    // Subcontratada si tiene despacho externo o taller de proveedor asignado.
    subcontratada: `("despachoExternoId" IS NOT NULL OR "proveedorTallerId" IS NOT NULL)`,
  },
  central: {
    nombre: "connect_assistances",
    finalizada: `status IN ('finished','returning_to_workshop','at_workshop')`,
    subcontratada: `("providerCompanyId" IS NOT NULL OR "workshopId" IS NOT NULL)`,
  },
};

/**
 * Recalcula y guarda el estado administrativo de una asistencia.
 *
 * Se llama en cada hecho que puede moverlo: subir un documento, validar el
 * coste, marcar como facturada, terminar el servicio. Guardarlo es una caché
 * para poder filtrar; la verdad es la función pura que lo deduce.
 */
export async function recalcularEstadoAdmin(
  system: Sistema,
  assistanceId: string | number,
): Promise<EstadoAdmin | null> {
  const t = TABLA[system];
  if (!t) return null;

  const a = await db.query(
    `SELECT ${t.finalizada} AS finalizada,
            ${t.subcontratada} AS subcontratada,
            "costeValidadoAtMs", "facturadaAtMs"
       FROM ${t.nombre} WHERE id = $1`,
    [Number(assistanceId)],
  );
  const fila = a.rows[0];
  if (!fila) return null;

  const docs = await db.query(
    `SELECT DISTINCT tipo FROM assistance_documents
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2`,
    [system, String(assistanceId)],
  );

  const subcontratada = Boolean(fila.subcontratada);
  const estado = estadoAdministrativo({
    servicioFinalizado: Boolean(fila.finalizada),
    tiposPresentes: docs.rows.map((d: any) => d.tipo),
    documentosExigidos: documentosExigidos(subcontratada),
    costeValidado: fila.costeValidadoAtMs != null,
    facturada: fila.facturadaAtMs != null,
    subcontratada,
  });

  await db.query(
    `UPDATE ${t.nombre} SET "estadoAdmin" = $2 WHERE id = $1`,
    [Number(assistanceId), estado],
  );
  return estado;
}

/** Valida el coste: es una decisión, y se guarda con su fecha y su autor. */
export async function validarCoste(
  system: Sistema,
  assistanceId: string | number,
  porQuien: string | null,
) {
  const t = TABLA[system];
  if (!t) throw new ErrorDocumento("sistema_invalido", "Sistema desconocido");
  const now = Date.now();
  const r = await db.query(
    `UPDATE ${t.nombre}
        SET "costeValidadoAtMs" = COALESCE("costeValidadoAtMs", $2), "costeValidadoPor" = $3
      WHERE id = $1 RETURNING id`,
    [Number(assistanceId), now, porQuien],
  );
  if (!r.rows[0]) throw new ErrorDocumento("not_found", "Asistencia no encontrada", 404);

  await registrarEvento({
    system, assistanceId, eventType: "COST_CONFIRMED",
    actorType: "user", actorName: porQuien, occurredAtMs: now,
    dedupeKey: `coste-validado-${system}-${assistanceId}`,
  });
  const estado = await recalcularEstadoAdmin(system, assistanceId);

  // Si con esto ya se puede facturar, la timeline lo dice.
  if (estado === "LISTA_PARA_FACTURAR") {
    await registrarEvento({
      system, assistanceId, eventType: "READY_TO_BILL",
      actorType: "system", occurredAtMs: now,
      dedupeKey: `lista-facturar-${system}-${assistanceId}`,
    });
  }
  return estado;
}

/** Marca como facturada al cliente. */
export async function marcarFacturada(
  system: Sistema,
  assistanceId: string | number,
  porQuien: string | null,
  referencia?: string | null,
) {
  const t = TABLA[system];
  if (!t) throw new ErrorDocumento("sistema_invalido", "Sistema desconocido");
  const now = Date.now();
  const r = await db.query(
    `UPDATE ${t.nombre} SET "facturadaAtMs" = COALESCE("facturadaAtMs", $2)
      WHERE id = $1 RETURNING id`,
    [Number(assistanceId), now],
  );
  if (!r.rows[0]) throw new ErrorDocumento("not_found", "Asistencia no encontrada", 404);

  await registrarEvento({
    system, assistanceId, eventType: "CUSTOMER_INVOICED",
    actorType: "user", actorName: porQuien, occurredAtMs: now,
    payload: { referencia: referencia ?? null },
    dedupeKey: `facturada-${system}-${assistanceId}`,
  });
  return recalcularEstadoAdmin(system, assistanceId);
}

/**
 * Qué le falta a una asistencia, para la ficha y para la bandeja.
 */
export async function situacionAdministrativa(system: Sistema, assistanceId: string | number) {
  const estado = await recalcularEstadoAdmin(system, assistanceId);
  const docs = await listarDocumentos(system, assistanceId, "propio");
  const t = TABLA[system];
  const a = await db.query(
    `SELECT ${t.subcontratada} AS subcontratada FROM ${t.nombre} WHERE id = $1`,
    [Number(assistanceId)],
  );
  const exigidos = documentosExigidos(Boolean(a.rows[0]?.subcontratada));
  const presentes = new Set(docs.map((d) => d.tipo));
  return {
    estado,
    faltan: exigidos.filter((x) => !presentes.has(x)),
    documentos: docs,
  };
}
