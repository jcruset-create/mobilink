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
  tipoDesdeKindAssist,
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

/* ── Puente con la galería de Assist ─────────────────────────────────────── */

/**
 * Registra en el catálogo un fichero recién subido a la galería de Assist.
 *
 * ── Por qué existe este puente ──────────────────────────────────────────────
 *
 * `roadside_assistance_files` sigue siendo donde vive el fichero: años de
 * fotos, cuatro sitios que escriben en ella y varias pantallas que la leen.
 * Cambiar todo eso de golpe sería arriesgado sin ganar nada hoy.
 *
 * Lo que faltaba es que el catálogo se enterase. La migración de arranque
 * incorpora lo que ya había, pero una foto subida a las diez de la mañana no
 * tenía tipo ni visibilidad hasta el siguiente reinicio, y mientras tanto no
 * existía para nada de lo nuevo: ni el estado administrativo la contaba, ni
 * se podía compartir con la plataforma que subcontrató el servicio.
 *
 * ── Por qué no lanza nunca ──────────────────────────────────────────────────
 *
 * Guardar la foto es lo que le importa a quien está en la carretera con el
 * móvil en la mano. Si el catálogo falla, la foto ya está guardada y la
 * migración de arranque la recogerá; hacer fallar la subida por esto sería
 * cambiar un problema pequeño por uno grande.
 */
export async function registrarFicheroDeAssist(f: {
  fileId: number | string;
  assistanceId: number | string;
  kind: unknown;
  url: unknown;
  fileName?: unknown;
  createdAtMs?: number | null;
}): Promise<boolean> {
  try {
    const tipo = tipoDesdeKindAssist(f.kind);
    const cuando = Number(f.createdAtMs ?? Date.now());
    await db.query(
      `INSERT INTO assistance_documents
         (uuid, "sourceSystem", "tenantId", "assistanceId", tipo, origen, visibilidad,
          url, "fileName", "legacyFileId", "createdAtMs", "updatedAtMs")
       SELECT gen_random_uuid()::text, 'assist', a."tallerId"::text, $1, $2, 'propio', $3,
              $4, $5, $6, $7, $7
         FROM roadside_assistances a WHERE a.id = $8
       ON CONFLICT DO NOTHING`,
      [
        String(f.assistanceId), tipo, visibilidadPorDefecto(tipo, "propio"),
        String(f.url ?? ""), f.fileName == null ? null : String(f.fileName),
        Number(f.fileId), cuando, Number(f.assistanceId),
      ],
    );
    return true;
  } catch (e) {
    console.error("[Documentos] fichero de Assist no catalogado:", (e as any)?.message);
    return false;
  }
}

/**
 * Quita del catálogo un fichero borrado de la galería.
 *
 * Sin esto, borrar una foto la dejaría viva en el catálogo y seguiría
 * contando para el estado administrativo y para lo que se comparte: se habría
 * borrado de la pantalla y de ningún sitio más.
 */
export async function olvidarFicheroDeAssist(fileId: number | string): Promise<void> {
  try {
    await db.query(`DELETE FROM assistance_documents WHERE "legacyFileId" = $1`, [Number(fileId)]);
  } catch (e) {
    console.error("[Documentos] fichero borrado no retirado del catálogo:", (e as any)?.message);
  }
}

/**
 * ¿De quién es esta asistencia?
 *
 * El filtro correcto para los documentos NO es la columna `tenantId` del
 * propio documento, sino de quién es la asistencia a la que cuelgan. Dos
 * motivos, y los dos importan:
 *
 *   · los documentos importados de la galería antigua pueden tener `tenantId`
 *     a nulo, y filtrar por esa columna los haría desaparecer de golpe;
 *   · un documento que colgara de la asistencia de otro sería visible aunque
 *     su `tenantId` fuera el correcto, que es el caso que hay que cerrar.
 *
 * Devuelve `null` cuando la asistencia no existe o no está adscrita a nadie,
 * y quien llama decide: no adscrita se trata como visible, que es como se ha
 * comportado el panel desde siempre.
 */
export async function tenantDeAsistencia(
  system: Sistema, assistanceId: string | number,
): Promise<string | null> {
  const id = Number(assistanceId);
  if (!Number.isFinite(id)) return null;
  try {
    const r = system === "assist"
      ? await db.query(`SELECT "tallerId"::text AS t FROM roadside_assistances WHERE id = $1`, [id])
      : await db.query(`SELECT "controlCenterId"::text AS t FROM connect_assistances WHERE id = $1`, [id]);
    const t = r.rows[0]?.t;
    return t == null || t === "" ? null : String(t);
  } catch {
    return null;
  }
}

/**
 * ¿Puede esta plataforma tocar esta asistencia?
 *
 * `null` en `tenantId` es el superadministrador, que atraviesa las
 * plataformas igual que en el resto de Central. Una asistencia sin dueño se
 * deja pasar: es como funcionaba antes y bloquearla ahora escondería
 * expedientes antiguos sin avisar.
 */
export async function puedeTocarAsistencia(
  system: Sistema, assistanceId: string | number, tenantId: string | null,
): Promise<boolean> {
  if (tenantId == null) return true;
  const dueno = await tenantDeAsistencia(system, assistanceId);
  return dueno == null || dueno === String(tenantId);
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
  quienTenant: string | null = null,
) {
  if (!esVisibilidad(visibilidad)) {
    throw new ErrorDocumento("visibilidad_invalida", "Visibilidad desconocida");
  }

  /*
   * Se comprueba ANTES de escribir, no después. Un UPDATE ... RETURNING que
   * luego rechaza ya ha cambiado la fila: aunque se contestara 404, el
   * documento de la otra plataforma se habría publicado igual.
   */
  const previo = await db.query(
    `SELECT "sourceSystem", "assistanceId" FROM assistance_documents WHERE uuid = $1`, [uuid]);
  if (previo.rows.length === 0) {
    throw new ErrorDocumento("not_found", "Documento no encontrado", 404);
  }
  const dueno = previo.rows[0];
  if (!(await puedeTocarAsistencia(dueno.sourceSystem as Sistema, dueno.assistanceId, quienTenant))) {
    throw new ErrorDocumento("not_found", "Documento no encontrado", 404);
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
