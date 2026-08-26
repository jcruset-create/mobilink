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

import { createHash } from "node:crypto";
import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorCaja } from "./repository.ts";
import { guardarDocumento, leerDocumento, rutaDocumento, urlFirmada } from "./storage.ts";
import type { Contexto } from "./service.ts";

/** Lo que acepta el escáner del mostrador, y poco más. */
const MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TAMANO_MAXIMO = 15 * 1024 * 1024;

export type DocumentoOperacion = {
  id: number;
  /** null = documento de la jornada entera, no de una operación suelta. */
  operationId: number | null;
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

/** Formato y tamaño. Lo comparten los justificantes de operación y de jornada. */
function exigirFicheroValido(fichero: { mimetype: string; buffer: Buffer }): void {
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
}

/**
 * Huella del fichero tal y como se subió.
 *
 * Es lo que permite comprobar más tarde que la factura que respalda una salida
 * de caja sigue siendo la misma. Se calcula sobre el buffer recibido, antes de
 * guardarlo: si se calculara leyendo del bucket, se estaría certificando lo que
 * hay allí, que es justo lo que se quiere poder comprobar.
 */
function huella(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function adjuntarDocumento(
  ctx: Contexto,
  operationId: number,
  fichero: { originalname: string; mimetype: string; buffer: Buffer },
  /** Documento al que sustituye. El escaneo salió torcido y se repite. */
  reemplazaA?: number
): Promise<DocumentoOperacion> {
  exigirFicheroValido(fichero);

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
  const sha = huella(fichero.buffer);

  /*
   * La versión sale del documento al que sustituye. Si no sustituye a nadie es
   * la primera, aunque la operación ya tenga otros justificantes: dos facturas
   * distintas del mismo pago no son dos versiones de nada.
   */
  let version = 1;
  if (reemplazaA != null) {
    const { rows: previo } = await pool.query(
      `SELECT id, version FROM cash_operation_documents
        WHERE id = $1 AND empresa_id = $2 AND operation_id = $3`,
      [reemplazaA, ctx.empresaId, operationId]
    );
    if (previo.length === 0) {
      throw new ErrorCaja(
        "DOCUMENTO_NO_ENCONTRADO",
        "El justificante al que quieres sustituir no es de esta operación.",
        404
      );
    }
    version = Number(previo[0].version) + 1;
  }

  const guardado = await guardarDocumento(ruta, fichero.buffer, fichero.mimetype);

  const { rows } = await pool.query(
    `INSERT INTO cash_operation_documents
       (empresa_id, operation_id, session_id, nombre, mime, tamano_bytes, ruta,
        sha256, version, reemplaza_a, subido_por, subido_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$10,$11,$12,$8,$9)
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
      sha,
      version,
      reemplazaA ?? null,
    ]
  );

  /*
   * El anterior se marca sustituido, no se borra ni se anula: anular es lo que
   * se hace cuando un justificante no debía estar; sustituir es que el mismo
   * papel se ha vuelto a escanear mejor. Distinguirlo importa el día que
   * alguien pregunte por qué hay dos.
   */
  if (reemplazaA != null) {
    await pool.query(
      `UPDATE cash_operation_documents SET sustituido = true WHERE id = $1`,
      [reemplazaA]
    );
  }

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
      sha256: sha,
      version,
      reemplazaA: reemplazaA ?? null,
    },
    ip: ctx.ip,
  });

  return aDocumento(rows[0], await urlFirmada(ruta));
}

/**
 * Adjunta un documento a la JORNADA entera, sin operación.
 *
 * Es el taco de facturas escaneado de una vez, o el resguardo que devuelve el
 * banco: papeles del día que no son de ningún cobro concreto. Se admiten
 * varios, porque en el mostrador no sale todo en un solo PDF.
 */
export async function adjuntarDocumentoDeJornada(
  ctx: Contexto,
  sessionId: number,
  fichero: { originalname: string; mimetype: string; buffer: Buffer }
): Promise<DocumentoOperacion> {
  exigirFicheroValido(fichero);

  const { rows: sesiones } = await pool.query(
    `SELECT id, fecha FROM cash_sessions WHERE id = $1 AND empresa_id = $2`,
    [sessionId, ctx.empresaId]
  );
  if (sesiones.length === 0) {
    throw new ErrorCaja("JORNADA_NO_ENCONTRADA", "La jornada no existe.", 404);
  }

  const ahora = Date.now();
  const ruta = rutaDocumento(
    ctx.empresaId,
    sessionId,
    null,
    extensionDe(fichero.mimetype, fichero.originalname),
    ahora
  );

  // Primero el fichero: si esto falla, no queda una fila apuntando a nada.
  const guardado = await guardarDocumento(ruta, fichero.buffer, fichero.mimetype);

  const { rows } = await pool.query(
    `INSERT INTO cash_operation_documents
       (empresa_id, operation_id, session_id, nombre, mime, tamano_bytes, ruta,
        subido_por, subido_at_ms)
     VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      ctx.empresaId,
      sessionId,
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
    accion: "cash.document.attach_session",
    entidad: "cash_operation_documents",
    entidadId: String(rows[0].id),
    detalle: {
      jornada: sesiones[0].fecha,
      nombre: fichero.originalname,
      tamanoBytes: guardado.tamanoBytes,
    },
    ip: ctx.ip,
  });

  return aDocumento(rows[0], await urlFirmada(ruta));
}

/** Los que cuelgan de la jornada entera, con enlaces recién firmados. */
export async function documentosSueltosDeJornada(
  empresaId: string,
  sessionId: number
): Promise<DocumentoOperacion[]> {
  const { rows } = await pool.query(
    `SELECT * FROM cash_operation_documents
      WHERE empresa_id = $1 AND session_id = $2 AND operation_id IS NULL AND NOT anulado
      ORDER BY id`,
    [empresaId, sessionId]
  );
  return Promise.all(rows.map(async (r) => aDocumento(r, await urlFirmada(r.ruta))));
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
    /*
     * LEFT JOIN, no JOIN: los documentos de la jornada entera no tienen
     * operación, y con un JOIN a secas desaparecían del informe justo los que
     * más falta hacen —el taco de facturas del día.
     */
    `SELECT d.*, o.numero AS operacion_numero, o.tipo AS operacion_tipo
       FROM cash_operation_documents d
       LEFT JOIN cash_operations o ON o.id = d.operation_id
      WHERE d.session_id = $1 AND NOT d.anulado
      ORDER BY o.id NULLS LAST, d.id`,
    [sessionId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    ...aDocumento(r),
    ruta: r.ruta,
    operacionNumero: r.operacion_numero ?? "Jornada",
    operacionTipo: r.operacion_tipo ?? "SESSION_DOCUMENT",
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


// ── Verificación de integridad ─────────────────────────────────────────────

export type Verificacion = {
  documentoId: number;
  estado: "OK" | "ALTERADO" | "SIN_HUELLA" | "NO_ENCONTRADO";
  mensaje: string;
};

/**
 * ¿Sigue siendo el mismo fichero que se subió?
 *
 * Se relee del bucket y se compara con la huella guardada. Es la única razón de
 * ser del SHA-256: una factura que respalda una salida de caja no puede cambiar
 * sin que quede constancia, y sin comprobarlo la huella sería un adorno.
 *
 * `SIN_HUELLA` es un estado propio y no un fallo: los justificantes anteriores
 * a esta fase no la tienen, y decir «no se puede comprobar» es exacto. Decir
 * «correcto» sería mentir, y decir «alterado» sería alarmar sin motivo.
 */
export async function verificarDocumento(
  ctx: Contexto,
  documentoId: number
): Promise<Verificacion> {
  const { rows } = await pool.query(
    `SELECT id, ruta, sha256 FROM cash_operation_documents
      WHERE id = $1 AND empresa_id = $2`,
    [documentoId, ctx.empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("DOCUMENTO_NO_ENCONTRADO", "El justificante no existe.", 404);
  }

  const doc = rows[0];
  if (!doc.sha256) {
    return {
      documentoId,
      estado: "SIN_HUELLA",
      mensaje: "Se adjuntó antes de que se guardaran huellas, así que no se puede comprobar.",
    };
  }

  const contenido = await leerDocumento(doc.ruta);
  if (!contenido) {
    return {
      documentoId,
      estado: "NO_ENCONTRADO",
      mensaje: "El fichero ya no está en el almacenamiento.",
    };
  }

  const actual = huella(contenido);
  return actual === doc.sha256
    ? { documentoId, estado: "OK", mensaje: "El fichero es el mismo que se adjuntó." }
    : {
        documentoId,
        estado: "ALTERADO",
        mensaje: "El fichero del almacenamiento NO coincide con el que se adjuntó.",
      };
}

/** Verifica de golpe los justificantes de una jornada. */
export async function verificarJornada(
  ctx: Contexto,
  sessionId: number
): Promise<Verificacion[]> {
  const { rows } = await pool.query(
    `SELECT id FROM cash_operation_documents
      WHERE session_id = $1 AND empresa_id = $2 AND NOT anulado
      ORDER BY id`,
    [sessionId, ctx.empresaId]
  );

  const salida: Verificacion[] = [];
  for (const r of rows) salida.push(await verificarDocumento(ctx, r.id));
  return salida;
}

/**
 * ¿Este fichero ya estaba subido?
 *
 * Mismo contenido byte a byte dentro de la misma empresa. No bloquea el alta
 * —a veces el mismo resguardo respalda de verdad dos cosas— pero permite
 * avisar, que es lo que evita que el mismo taco de facturas acabe adjuntado
 * cinco veces porque nadie recordaba si lo había hecho ya.
 */
export async function duplicadosDe(
  empresaId: string,
  buffer: Buffer
): Promise<{ id: number; nombre: string; sessionId: number }[]> {
  const { rows } = await pool.query(
    `SELECT id, nombre, session_id FROM cash_operation_documents
      WHERE empresa_id = $1 AND sha256 = $2 AND NOT anulado
      ORDER BY id`,
    [empresaId, huella(buffer)]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({ id: r.id, nombre: r.nombre, sessionId: r.session_id }));
}
