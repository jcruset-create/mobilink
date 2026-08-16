/**
 * Justificantes de una operación de caja.
 *
 * El escáner del mostrador saca un PDF y ese PDF se cuelga del cobro o del
 * pago. Después, el informe de cierre los lleva todos dentro, de modo que el
 * papeleo del día es un único fichero.
 *
 * Dos decisiones que conviene no perder de vista:
 *
 * 1. **La operación nunca depende del fichero.** El cobro se registra primero y
 *    el documento se adjunta después, en otra petición. Si el almacenamiento
 *    falla, el dinero ya está contado y solo queda volver a adjuntar. Al revés
 *    —subir dentro de la transacción del cobro— un fallo de red dejaría sin
 *    registrar un cobro que ya se ha hecho, que es mucho peor.
 *
 * 2. **Un documento no se borra: se anula.** Un escaneo movido deja de salir en
 *    el informe pero se sabe que existió y quién lo quitó. Es la misma regla
 *    que el resto del módulo.
 */

import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorCaja } from "./repository.ts";
import { guardarDocumento, rutaDocumento, urlFirmada } from "./storage.ts";
import type { Contexto } from "./service.ts";

/** Lo que acepta el escáner del mostrador, y poco más. */
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TAMANO_MAXIMO = 15 * 1024 * 1024;

export type DocumentoOperacion = {
  id: number;
  operationId: number;
  sessionId: number;
  nombre: string;
  mime: string;
  tamanoBytes: number;
  anulado: boolean;
  anuladoMotivo: string | null;
  subidoAtMs: number;
  /** Enlace temporal. Caduca: no sirve para guardarlo en ningún sitio. */
  url: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aDocumento(r: any, url: string | null = null): DocumentoOperacion {
  return {
    id: r.id,
    operationId: r.operation_id,
    sessionId: r.session_id,
    nombre: r.nombre,
    mime: r.mime,
    tamanoBytes: Number(r.tamano_bytes),
    anulado: r.anulado,
    anuladoMotivo: r.anulado_motivo,
    subidoAtMs: Number(r.subido_at_ms),
    url,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const extensionDe = (mime: string, nombre: string): string => {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  const suelta = nombre.slice(nombre.lastIndexOf("."));
  return /^\.[a-z0-9]{1,5}$/i.test(suelta) ? suelta.toLowerCase() : ".bin";
};

export async function adjuntarDocumento(
  ctx: Contexto,
  operationId: number,
  fichero: { originalname: string; mimetype: string; buffer: Buffer }
): Promise<DocumentoOperacion> {
  if (!MIMES.has(fichero.mimetype)) {
    throw new ErrorCaja(
      "FORMATO_NO_ADMITIDO",
      "El justificante tiene que ser un PDF (o una imagen JPG o PNG).",
      400
    );
  }
  if (fichero.buffer.length > TAMANO_MAXIMO) {
    throw new ErrorCaja(
      "DOCUMENTO_DEMASIADO_GRANDE",
      "El documento pasa de 15 MB. Escanéalo con menos resolución.",
      400
    );
  }

  const { rows: operaciones } = await pool.query(
    `SELECT id, session_id, empresa_id, numero FROM cash_operations
      WHERE id = $1 AND empresa_id = $2`,
    [operationId, ctx.empresaId]
  );
  if (operaciones.length === 0) {
    throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
  }
  const operacion = operaciones[0];

  const ahora = Date.now();
  const ruta = rutaDocumento(
    ctx.empresaId,
    operacion.session_id,
    operationId,
    extensionDe(fichero.mimetype, fichero.originalname),
    ahora
  );

  // Primero el fichero: si esto falla, no queda una fila apuntando a nada.
  const guardado = await guardarDocumento(ruta, fichero.buffer, fichero.mimetype);

  const { rows } = await pool.query(
    `INSERT INTO cash_operation_documents
       (empresa_id, operation_id, session_id, nombre, mime, tamano_bytes, ruta,
        subido_por, subido_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      ctx.empresaId,
      operationId,
      operacion.session_id,
      fichero.originalname.slice(0, 200),
      fichero.mimetype,
      guardado.tamanoBytes,
      ruta,
      ctx.userId,
      ahora,
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.document.attach",
    entidad: "cash_operation_documents",
    entidadId: String(rows[0].id),
    detalle: {
      operacion: operacion.numero,
      nombre: fichero.originalname,
      tamanoBytes: guardado.tamanoBytes,
    },
    ip: ctx.ip,
  });

  return aDocumento(rows[0], await urlFirmada(ruta));
}

/** Documentos de una operación, con enlaces recién firmados. */
export async function documentosDeOperacion(
  empresaId: string,
  operationId: number,
  incluirAnulados = false
): Promise<DocumentoOperacion[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_operation_documents
      WHERE empresa_id = $1 AND operation_id = $2 ${incluirAnulados ? "" : "AND NOT anulado"}
      ORDER BY id`,
    [empresaId, operationId]
  );
  return Promise.all(rows.map(async (r) => aDocumento(r, await urlFirmada(r.ruta))));
}

/** Cuántos justificantes tiene cada operación de la jornada. */
export async function conteoPorOperacion(sessionId: number): Promise<Map<number, number>> {
  const { rows } = await pool.query(
    `SELECT operation_id, COUNT(*)::int AS n
       FROM cash_operation_documents
      WHERE session_id = $1 AND NOT anulado
      GROUP BY operation_id`,
    [sessionId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new Map(rows.map((r: any) => [r.operation_id, Number(r.n)]));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Todos los de una jornada, en orden de operación. Es lo que lleva el informe. */
export async function documentosDeJornada(sessionId: number): Promise<
  (DocumentoOperacion & { ruta: string; operacionNumero: string; operacionTipo: string })[]
> {
  const { rows } = await pool.query(
    `SELECT d.*, o.numero AS operacion_numero, o.tipo AS operacion_tipo
       FROM cash_operation_documents d
       JOIN cash_operations o ON o.id = d.operation_id
      WHERE d.session_id = $1 AND NOT d.anulado
      ORDER BY o.id, d.id`,
    [sessionId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    ...aDocumento(r),
    ruta: r.ruta,
    operacionNumero: r.operacion_numero,
    operacionTipo: r.operacion_tipo,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function anularDocumento(
  ctx: Contexto,
  documentoId: number,
  motivo: string
): Promise<DocumentoOperacion> {
  if (!String(motivo ?? "").trim()) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir por qué se retira el documento.", 400);
  }

  const { rows } = await pool.query(
    `UPDATE cash_operation_documents
        SET anulado = true, anulado_por = $3, anulado_at_ms = $4, anulado_motivo = $5
      WHERE id = $1 AND empresa_id = $2 AND NOT anulado
      RETURNING *`,
    [documentoId, ctx.empresaId, ctx.userId, Date.now(), motivo.trim()]
  );
  if (rows.length === 0) {
    throw new ErrorCaja(
      "DOCUMENTO_NO_ENCONTRADO",
      "El documento no existe o ya estaba retirado.",
      404
    );
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.document.void",
    entidad: "cash_operation_documents",
    entidadId: String(documentoId),
    detalle: { nombre: rows[0].nombre, motivo },
    ip: ctx.ip,
  });

  return aDocumento(rows[0]);
}
