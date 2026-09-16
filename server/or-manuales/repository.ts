/**
 * Acceso a datos del módulo OR Manuales.
 *
 * Todas las consultas llevan `empresa_id` en el WHERE, sin excepción: es una
 * base multiempresa y el aislamiento vive en las consultas, no en el panel.
 * Buscar por id sin acertar la empresa devuelve `null`, que el router traduce
 * a 404 y no a 403: «no existe» y «no es tuyo» contestan igual.
 *
 * Las funciones que escriben aceptan un `Ejecutor` —el pool o un cliente de
 * transacción— para que el servicio pueda meter el bloc, sus 25 OR y el
 * evento del histórico en la MISMA transacción.
 */

import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import pool from "../db.ts";
import type {
  EstadoAviso,
  EstadoBloc,
  EstadoDocumento,
  EstadoOr,
  EstadoProcesamiento,
  MetodoDeteccion,
  TipoAviso,
} from "./domain/estados.ts";

export type Ejecutor = {
  query<T extends QueryResultRow = QueryResultRow>(texto: string, valores?: unknown[]): Promise<QueryResult<T>>;
};

const db = (e?: Ejecutor): Ejecutor => e ?? (pool as unknown as Ejecutor);

/** Abre una transacción, la cierra bien y devuelve lo que salga. */
export async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const r = await fn(cliente);
    await cliente.query("COMMIT");
    return r;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export type Bloc = {
  id: string;
  numeroBloc: string;
  orInicial: number;
  orFinal: number;
  cantidadOr: number;
  responsableId: string | null;
  responsableNombre: string | null;
  fechaCreacion: string;
  fechaEntrega: string | null;
  fechaDevolucion: string | null;
  estado: EstadoBloc;
  observaciones: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type FilaBloc = Bloc & {
  archivadas: number;
  pendientes: number;
  enRevision: number;
};

export type Or = {
  id: string;
  blocId: string;
  numeroOr: number;
  estado: EstadoOr;
  documentoPrincipalId: string | null;
  fechaEscaneo: string | null;
};

export type Documento = {
  id: string;
  orId: string | null;
  blocId: string | null;
  procesamientoId: string | null;
  nombreArchivo: string;
  nombreOriginal: string;
  paginaOrigen: number | null;
  storageKey: string;
  tipoArchivo: string;
  tamanoBytes: number;
  hashArchivo: string;
  ocrNumeroDetectado: number | null;
  ocrConfianza: number | null;
  ocrMetodo: MetodoDeteccion | null;
  ocrTexto: string | null;
  estadoProcesamiento: EstadoDocumento;
  errorMensaje: string | null;
  sustituyeA: string | null;
  usuarioCarga: string | null;
  usuarioCargaNombre: string | null;
  fechaCarga: string;
  /** Sólo en las consultas que lo cruzan. */
  numeroOr?: number | null;
  numeroBloc?: string | null;
};

export type Entrega = {
  id: string;
  blocId: string;
  responsableId: string | null;
  responsableNombre: string | null;
  fechaEntrega: string;
  fechaDevolucion: string | null;
  observaciones: string | null;
  observacionesDevolucion: string | null;
  usuarioRegistroNombre: string | null;
  createdAt: string;
};

export type Procesamiento = {
  id: string;
  archivoOriginal: string;
  storageKeyOriginal: string | null;
  paginas: number;
  paginasProcesadas: number;
  documentosDetectados: number;
  documentosCorrectos: number;
  documentosRevision: number;
  noIdentificados: number;
  duplicados: number;
  errores: number;
  usuarioNombre: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  estado: EstadoProcesamiento;
  etapa: string | null;
  errorMensaje: string | null;
};

export type Aviso = {
  id: string;
  blocId: string | null;
  orId: string | null;
  tipo: TipoAviso;
  mensaje: string;
  responsableId: string | null;
  responsableNombre: string | null;
  canal: string;
  estado: EstadoAviso;
  fechaCreacion: string;
  fechaNotificacion: string | null;
  fechaResolucion: string | null;
  numeroBloc?: string | null;
};

export type Evento = {
  id: string;
  blocId: string | null;
  orId: string | null;
  documentoId: string | null;
  accion: string;
  detalle: unknown;
  usuarioNombre: string | null;
  createdAt: string;
};

/* ── Proyecciones ────────────────────────────────────────────────────────── */

/*
 * Las columnas DATE se piden como TEXTO, y no es un capricho.
 *
 * El controlador de PostgreSQL devuelve una DATE como un objeto `Date` de
 * JavaScript puesto a medianoche LOCAL. Eso rompía dos cosas: el tipo de aquí
 * dice `string` y no lo era —comparar dos fechas reventaba—, y convertirla
 * después con `toISOString()` resta las horas del huso, así que en un servidor
 * al este de Greenwich un bloc entregado el día 1 se guardaba como del día 31.
 *
 * `::text` sobre una DATE da exactamente `AAAA-MM-DD`, sin husos de por medio.
 * Las marcas de tiempo (`created_at`…) se quedan como están: viajan al panel
 * en JSON, que ya las serializa en ISO.
 */
const COLUMNAS_BLOC = `
  id, numero_bloc AS "numeroBloc", or_inicial AS "orInicial", or_final AS "orFinal",
  cantidad_or AS "cantidadOr", responsable_id AS "responsableId", responsable_nombre AS "responsableNombre",
  fecha_creacion::text AS "fechaCreacion", fecha_entrega::text AS "fechaEntrega",
  fecha_devolucion::text AS "fechaDevolucion",
  estado, observaciones, created_at AS "createdAt", updated_at AS "updatedAt", closed_at AS "closedAt"
`;

/** Las mismas, para las consultas que hacen JOIN y necesitan el alias. */
const COLUMNAS_BLOC_B = `
  b.id, b.numero_bloc AS "numeroBloc", b.or_inicial AS "orInicial", b.or_final AS "orFinal",
  b.cantidad_or AS "cantidadOr", b.responsable_id AS "responsableId", b.responsable_nombre AS "responsableNombre",
  b.fecha_creacion::text AS "fechaCreacion", b.fecha_entrega::text AS "fechaEntrega",
  b.fecha_devolucion::text AS "fechaDevolucion",
  b.estado, b.observaciones, b.created_at AS "createdAt", b.updated_at AS "updatedAt", b.closed_at AS "closedAt"
`;

const COLUMNAS_DOCUMENTO = `
  d.id, d.or_id AS "orId", d.bloc_id AS "blocId", d.procesamiento_id AS "procesamientoId",
  d.nombre_archivo AS "nombreArchivo", d.nombre_original AS "nombreOriginal", d.pagina_origen AS "paginaOrigen",
  d.storage_key AS "storageKey", d.tipo_archivo AS "tipoArchivo", d.tamano_bytes AS "tamanoBytes",
  d.hash_archivo AS "hashArchivo", d.ocr_numero_detectado AS "ocrNumeroDetectado",
  d.ocr_confianza AS "ocrConfianza", d.ocr_metodo AS "ocrMetodo", d.ocr_texto AS "ocrTexto",
  d.estado_procesamiento AS "estadoProcesamiento", d.error_mensaje AS "errorMensaje",
  d.sustituye_a AS "sustituyeA", d.usuario_carga AS "usuarioCarga",
  d.usuario_carga_nombre AS "usuarioCargaNombre", d.fecha_carga AS "fechaCarga"
`;

const COLUMNAS_ENTREGA = `
  id, bloc_id AS "blocId", responsable_id AS "responsableId", responsable_nombre AS "responsableNombre",
  fecha_entrega::text AS "fechaEntrega", fecha_devolucion::text AS "fechaDevolucion", observaciones,
  observaciones_devolucion AS "observacionesDevolucion", usuario_registro_nombre AS "usuarioRegistroNombre",
  created_at AS "createdAt"
`;

const COLUMNAS_PROCESO = `
  id, archivo_original AS "archivoOriginal", storage_key_original AS "storageKeyOriginal",
  paginas, paginas_procesadas AS "paginasProcesadas", documentos_detectados AS "documentosDetectados",
  documentos_correctos AS "documentosCorrectos", documentos_revision AS "documentosRevision",
  no_identificados AS "noIdentificados", duplicados, errores, usuario_nombre AS "usuarioNombre",
  fecha_inicio AS "fechaInicio", fecha_fin AS "fechaFin", estado, etapa, error_mensaje AS "errorMensaje"
`;

/* ── Blocs ───────────────────────────────────────────────────────────────── */

export type FiltroBlocs = {
  estado?: string;
  responsableId?: string;
  texto?: string;
  desde?: string;
  hasta?: string;
  /** Sólo los que tienen OR sin archivar. */
  incompletos?: boolean;
  /** Sólo los cerrados (histórico). */
  cerrados?: boolean;
  /** Sólo los que tienen documentos pendientes de revisar. */
  conRevisiones?: boolean;
};

/**
 * La lista de blocs con su recuento ya hecho.
 *
 * El recuento sale de un `LEFT JOIN LATERAL` sobre `orm_or` y no de contadores
 * guardados en el bloc: son 25 filas por bloc, la base los agrega sin
 * despeinarse, y así no hay ningún número que pueda quedarse desincronizado.
 */
export async function listarBlocs(empresaId: string, f: FiltroBlocs = {}, e?: Ejecutor): Promise<FilaBloc[]> {
  const cond: string[] = ["b.empresa_id = $1"];
  const valores: unknown[] = [empresaId];
  const add = (sql: string, valor: unknown) => {
    valores.push(valor);
    cond.push(sql.replace("$?", `$${valores.length}`));
  };

  if (f.estado) add("b.estado = $?", f.estado);
  if (f.responsableId) add("b.responsable_id = $?", f.responsableId);
  if (f.desde) add("b.fecha_entrega >= $?", f.desde);
  if (f.hasta) add("b.fecha_entrega <= $?", f.hasta);
  if (f.cerrados) cond.push("b.estado = 'CERRADO'");
  if (f.incompletos) cond.push("c.pendientes > 0");
  if (f.conRevisiones) cond.push("c.en_revision > 0");

  /*
   * La búsqueda general del encargo: escribir «1043» tiene que encontrar el
   * bloc que contiene esa OR, no sólo los blocs que se llaman «1043». Por eso
   * el número se compara además contra el RANGO.
   */
  if (f.texto) {
    valores.push(`%${f.texto}%`);
    const like = `$${valores.length}`;
    const n = Number(f.texto);
    if (Number.isFinite(n) && Number.isInteger(n)) {
      valores.push(n);
      const num = `$${valores.length}`;
      cond.push(`(b.numero_bloc ILIKE ${like} OR b.responsable_nombre ILIKE ${like} OR (${num} BETWEEN b.or_inicial AND b.or_final))`);
    } else {
      cond.push(`(b.numero_bloc ILIKE ${like} OR b.responsable_nombre ILIKE ${like} OR b.observaciones ILIKE ${like})`);
    }
  }

  const { rows } = await db(e).query<FilaBloc>(
    `SELECT ${COLUMNAS_BLOC_B},
            COALESCE(c.archivadas, 0)::int AS "archivadas",
            COALESCE(c.pendientes, 0)::int AS "pendientes",
            COALESCE(c.en_revision, 0)::int AS "enRevision"
       FROM orm_blocs b
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE o.estado NOT IN ('PENDIENTE','ERROR')) AS archivadas,
                COUNT(*) FILTER (WHERE o.estado IN ('PENDIENTE','ERROR'))     AS pendientes,
                COUNT(*) FILTER (WHERE o.estado IN ('REVISAR','DUPLICADA'))   AS en_revision
           FROM orm_or o WHERE o.bloc_id = b.id
       ) c ON TRUE
      WHERE ${cond.join(" AND ")}
      ORDER BY b.or_inicial DESC
      LIMIT 500`,
    valores
  );
  return rows;
}

export async function blocPorId(empresaId: string, id: string, e?: Ejecutor): Promise<Bloc | null> {
  const { rows } = await db(e).query<Bloc>(
    `SELECT ${COLUMNAS_BLOC} FROM orm_blocs WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

/** El bloc con cerrojo, para que dos cierres a la vez no se pisen. */
export async function blocParaActualizar(empresaId: string, id: string, e: Ejecutor): Promise<Bloc | null> {
  const { rows } = await e.query<Bloc>(
    `SELECT ${COLUMNAS_BLOC} FROM orm_blocs WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

/** El bloc cuyo rango contiene ese número. Es la «localización del bloc». */
export async function blocDeNumero(empresaId: string, numeroOr: number, e?: Ejecutor): Promise<Bloc | null> {
  const { rows } = await db(e).query<Bloc>(
    `SELECT ${COLUMNAS_BLOC} FROM orm_blocs
      WHERE empresa_id = $1 AND $2 BETWEEN or_inicial AND or_final`,
    [empresaId, numeroOr]
  );
  return rows[0] ?? null;
}

/** Los blocs cuyo rango se pisa con el que se quiere crear. */
export async function blocsQueSolapan(
  empresaId: string,
  orInicial: number,
  orFinal: number,
  e?: Ejecutor
): Promise<Bloc[]> {
  const { rows } = await db(e).query<Bloc>(
    `SELECT ${COLUMNAS_BLOC} FROM orm_blocs
      WHERE empresa_id = $1 AND or_inicial <= $3 AND or_final >= $2
      ORDER BY or_inicial`,
    [empresaId, orInicial, orFinal]
  );
  return rows;
}

export async function ultimoNumeroBloc(empresaId: string, e?: Ejecutor): Promise<string | null> {
  const { rows } = await db(e).query<{ numero_bloc: string }>(
    `SELECT numero_bloc FROM orm_blocs WHERE empresa_id = $1 ORDER BY or_inicial DESC LIMIT 1`,
    [empresaId]
  );
  return rows[0]?.numero_bloc ?? null;
}

/** La OR más alta dada de alta: lo que se propone como inicio del bloc siguiente. */
export async function ultimaOrFinal(empresaId: string, e?: Ejecutor): Promise<number | null> {
  const { rows } = await db(e).query<{ max: number | null }>(
    `SELECT MAX(or_final) AS max FROM orm_blocs WHERE empresa_id = $1`,
    [empresaId]
  );
  return rows[0]?.max ?? null;
}

export async function insertarBloc(
  datos: {
    empresaId: string;
    numeroBloc: string;
    orInicial: number;
    orFinal: number;
    cantidadOr: number;
    responsableId: string | null;
    responsableNombre: string | null;
    observaciones: string | null;
    createdBy: string | null;
  },
  e: Ejecutor
): Promise<Bloc> {
  const { rows } = await e.query<Bloc>(
    `INSERT INTO orm_blocs
       (empresa_id, numero_bloc, or_inicial, or_final, cantidad_or, responsable_id, responsable_nombre, observaciones, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${COLUMNAS_BLOC}`,
    [
      datos.empresaId,
      datos.numeroBloc,
      datos.orInicial,
      datos.orFinal,
      datos.cantidadOr,
      datos.responsableId,
      datos.responsableNombre,
      datos.observaciones,
      datos.createdBy,
    ]
  );
  return rows[0];
}

export async function actualizarBloc(
  empresaId: string,
  id: string,
  cambios: Partial<{
    estado: EstadoBloc;
    responsableId: string | null;
    responsableNombre: string | null;
    fechaEntrega: string | null;
    fechaDevolucion: string | null;
    observaciones: string | null;
    closedAt: string | null;
    closedBy: string | null;
  }>,
  e?: Ejecutor
): Promise<Bloc | null> {
  const mapa: Record<string, string> = {
    estado: "estado",
    responsableId: "responsable_id",
    responsableNombre: "responsable_nombre",
    fechaEntrega: "fecha_entrega",
    fechaDevolucion: "fecha_devolucion",
    observaciones: "observaciones",
    closedAt: "closed_at",
    closedBy: "closed_by",
  };
  const sets: string[] = ["updated_at = now()"];
  const valores: unknown[] = [empresaId, id];
  for (const [clave, columna] of Object.entries(mapa)) {
    if (!(clave in cambios)) continue;
    valores.push((cambios as Record<string, unknown>)[clave]);
    sets.push(`${columna} = $${valores.length}`);
  }
  const { rows } = await db(e).query<Bloc>(
    `UPDATE orm_blocs SET ${sets.join(", ")} WHERE empresa_id = $1 AND id = $2 RETURNING ${COLUMNAS_BLOC}`,
    valores
  );
  return rows[0] ?? null;
}

/* ── Las OR ──────────────────────────────────────────────────────────────── */

/**
 * Crea de golpe las 25 filas del bloc.
 *
 * Un solo INSERT con `generate_series` en vez de 25 idas y vueltas: es la
 * misma transacción que crea el bloc, y partirla en 25 sentencias sólo daría
 * 25 oportunidades de que algo se quede a medias.
 */
export async function generarOrs(
  empresaId: string,
  blocId: string,
  orInicial: number,
  orFinal: number,
  e: Ejecutor
): Promise<number> {
  const { rowCount } = await e.query(
    `INSERT INTO orm_or (empresa_id, bloc_id, numero_or)
     SELECT $1, $2, n FROM generate_series($3::int, $4::int) AS n`,
    [empresaId, blocId, orInicial, orFinal]
  );
  return rowCount ?? 0;
}

export async function listarOrsDeBloc(empresaId: string, blocId: string, e?: Ejecutor): Promise<Or[]> {
  const { rows } = await db(e).query<Or>(
    `SELECT id, bloc_id AS "blocId", numero_or AS "numeroOr", estado,
            documento_principal_id AS "documentoPrincipalId", fecha_escaneo AS "fechaEscaneo"
       FROM orm_or WHERE empresa_id = $1 AND bloc_id = $2 ORDER BY numero_or`,
    [empresaId, blocId]
  );
  return rows;
}

export async function orPorNumero(empresaId: string, numeroOr: number, e?: Ejecutor): Promise<Or | null> {
  const { rows } = await db(e).query<Or>(
    `SELECT id, bloc_id AS "blocId", numero_or AS "numeroOr", estado,
            documento_principal_id AS "documentoPrincipalId", fecha_escaneo AS "fechaEscaneo"
       FROM orm_or WHERE empresa_id = $1 AND numero_or = $2`,
    [empresaId, numeroOr]
  );
  return rows[0] ?? null;
}

/** La OR con cerrojo: dos páginas de la misma OR no pueden archivarse a la vez. */
export async function orParaActualizar(empresaId: string, numeroOr: number, e: Ejecutor): Promise<Or | null> {
  const { rows } = await e.query<Or>(
    `SELECT id, bloc_id AS "blocId", numero_or AS "numeroOr", estado,
            documento_principal_id AS "documentoPrincipalId", fecha_escaneo AS "fechaEscaneo"
       FROM orm_or WHERE empresa_id = $1 AND numero_or = $2 FOR UPDATE`,
    [empresaId, numeroOr]
  );
  return rows[0] ?? null;
}

export async function orPorId(empresaId: string, id: string, e?: Ejecutor): Promise<Or | null> {
  const { rows } = await db(e).query<Or>(
    `SELECT id, bloc_id AS "blocId", numero_or AS "numeroOr", estado,
            documento_principal_id AS "documentoPrincipalId", fecha_escaneo AS "fechaEscaneo"
       FROM orm_or WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function actualizarOr(
  empresaId: string,
  id: string,
  cambios: { estado?: EstadoOr; documentoPrincipalId?: string | null; fechaEscaneo?: string | null },
  e?: Ejecutor
): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  const valores: unknown[] = [empresaId, id];
  if (cambios.estado !== undefined) {
    valores.push(cambios.estado);
    sets.push(`estado = $${valores.length}`);
  }
  if (cambios.documentoPrincipalId !== undefined) {
    valores.push(cambios.documentoPrincipalId);
    sets.push(`documento_principal_id = $${valores.length}`);
  }
  if (cambios.fechaEscaneo !== undefined) {
    valores.push(cambios.fechaEscaneo);
    sets.push(`fecha_escaneo = $${valores.length}`);
  }
  await db(e).query(`UPDATE orm_or SET ${sets.join(", ")} WHERE empresa_id = $1 AND id = $2`, valores);
}

/* ── Documentos ──────────────────────────────────────────────────────────── */

export async function insertarDocumento(
  d: {
    empresaId: string;
    orId: string | null;
    blocId: string | null;
    procesamientoId: string | null;
    nombreArchivo: string;
    nombreOriginal: string;
    paginaOrigen: number | null;
    storageKey: string;
    tipoArchivo: string;
    tamanoBytes: number;
    hashArchivo: string;
    ocrNumeroDetectado: number | null;
    ocrConfianza: number | null;
    ocrMetodo: string | null;
    ocrTexto: string | null;
    estadoProcesamiento: EstadoDocumento;
    errorMensaje?: string | null;
    sustituyeA?: string | null;
    usuarioCarga: string | null;
    usuarioCargaNombre: string | null;
  },
  e?: Ejecutor
): Promise<Documento> {
  const { rows } = await db(e).query<Documento>(
    `INSERT INTO orm_documentos
       (empresa_id, or_id, bloc_id, procesamiento_id, nombre_archivo, nombre_original, pagina_origen,
        storage_key, tipo_archivo, tamano_bytes, hash_archivo, ocr_numero_detectado, ocr_confianza,
        ocr_metodo, ocr_texto, estado_procesamiento, error_mensaje, sustituye_a, usuario_carga, usuario_carga_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING ${COLUMNAS_DOCUMENTO.replace(/d\./g, "")}`,
    [
      d.empresaId, d.orId, d.blocId, d.procesamientoId, d.nombreArchivo, d.nombreOriginal, d.paginaOrigen,
      d.storageKey, d.tipoArchivo, d.tamanoBytes, d.hashArchivo, d.ocrNumeroDetectado, d.ocrConfianza,
      d.ocrMetodo, d.ocrTexto, d.estadoProcesamiento, d.errorMensaje ?? null, d.sustituyeA ?? null,
      d.usuarioCarga, d.usuarioCargaNombre,
    ]
  );
  return rows[0];
}

export async function documentoPorId(empresaId: string, id: string, e?: Ejecutor): Promise<Documento | null> {
  const { rows } = await db(e).query<Documento>(
    `SELECT ${COLUMNAS_DOCUMENTO}, o.numero_or AS "numeroOr", b.numero_bloc AS "numeroBloc"
       FROM orm_documentos d
       LEFT JOIN orm_or o ON o.id = d.or_id
       LEFT JOIN orm_blocs b ON b.id = d.bloc_id
      WHERE d.empresa_id = $1 AND d.id = $2`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function documentosDeOr(empresaId: string, orId: string, e?: Ejecutor): Promise<Documento[]> {
  const { rows } = await db(e).query<Documento>(
    `SELECT ${COLUMNAS_DOCUMENTO} FROM orm_documentos d
      WHERE d.empresa_id = $1 AND d.or_id = $2 AND d.estado_procesamiento <> 'ELIMINADO'
      ORDER BY d.fecha_carga DESC`,
    [empresaId, orId]
  );
  return rows;
}

/** Los que esperan a una persona: sin identificar, en revisión, duplicados o con error. */
export async function listarPendientes(empresaId: string, e?: Ejecutor): Promise<Documento[]> {
  const { rows } = await db(e).query<Documento>(
    `SELECT ${COLUMNAS_DOCUMENTO}, o.numero_or AS "numeroOr", b.numero_bloc AS "numeroBloc"
       FROM orm_documentos d
       LEFT JOIN orm_or o ON o.id = d.or_id
       LEFT JOIN orm_blocs b ON b.id = d.bloc_id
      WHERE d.empresa_id = $1
        AND d.estado_procesamiento IN ('PENDIENTE','REVISION','NO_IDENTIFICADO','DUPLICADO','ERROR')
      ORDER BY d.fecha_carga DESC
      LIMIT 500`,
    [empresaId]
  );
  return rows;
}

export async function actualizarDocumento(
  empresaId: string,
  id: string,
  cambios: Partial<{
    orId: string | null;
    blocId: string | null;
    nombreArchivo: string;
    estadoProcesamiento: EstadoDocumento;
    ocrNumeroDetectado: number | null;
    ocrConfianza: number | null;
    ocrMetodo: string | null;
    ocrTexto: string | null;
    errorMensaje: string | null;
    sustituyeA: string | null;
  }>,
  e?: Ejecutor
): Promise<Documento | null> {
  const mapa: Record<string, string> = {
    orId: "or_id",
    blocId: "bloc_id",
    nombreArchivo: "nombre_archivo",
    estadoProcesamiento: "estado_procesamiento",
    ocrNumeroDetectado: "ocr_numero_detectado",
    ocrConfianza: "ocr_confianza",
    ocrMetodo: "ocr_metodo",
    ocrTexto: "ocr_texto",
    errorMensaje: "error_mensaje",
    sustituyeA: "sustituye_a",
  };
  const sets = ["updated_at = now()"];
  const valores: unknown[] = [empresaId, id];
  for (const [clave, columna] of Object.entries(mapa)) {
    if (!(clave in cambios)) continue;
    valores.push((cambios as Record<string, unknown>)[clave]);
    sets.push(`${columna} = $${valores.length}`);
  }
  const { rows } = await db(e).query<Documento>(
    `UPDATE orm_documentos SET ${sets.join(", ")} WHERE empresa_id = $1 AND id = $2
     RETURNING ${COLUMNAS_DOCUMENTO.replace(/d\./g, "")}`,
    valores
  );
  return rows[0] ?? null;
}

/**
 * ¿Ya hay un documento con este contenido exacto?
 *
 * Por hash y no por nombre: el escáner llama «escan0001.pdf» a la hoja de cada
 * mañana, así que el nombre no distingue nada. Un hash repetido es la misma
 * hoja subida dos veces.
 */
export async function documentoConHash(empresaId: string, hash: string, e?: Ejecutor): Promise<Documento | null> {
  const { rows } = await db(e).query<Documento>(
    `SELECT ${COLUMNAS_DOCUMENTO}, o.numero_or AS "numeroOr", b.numero_bloc AS "numeroBloc"
       FROM orm_documentos d
       LEFT JOIN orm_or o ON o.id = d.or_id
       LEFT JOIN orm_blocs b ON b.id = d.bloc_id
      WHERE d.empresa_id = $1 AND d.hash_archivo = $2 AND d.estado_procesamiento <> 'ELIMINADO'
      ORDER BY d.fecha_carga LIMIT 1`,
    [empresaId, hash]
  );
  return rows[0] ?? null;
}

/* ── Entregas ────────────────────────────────────────────────────────────── */

export async function insertarEntrega(
  d: {
    empresaId: string;
    blocId: string;
    responsableId: string | null;
    responsableNombre: string | null;
    fechaEntrega: string;
    observaciones: string | null;
    usuarioRegistro: string | null;
    usuarioRegistroNombre: string | null;
  },
  e?: Ejecutor
): Promise<Entrega> {
  const { rows } = await db(e).query<Entrega>(
    `INSERT INTO orm_entregas
       (empresa_id, bloc_id, responsable_id, responsable_nombre, fecha_entrega, observaciones, usuario_registro, usuario_registro_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${COLUMNAS_ENTREGA}`,
    [d.empresaId, d.blocId, d.responsableId, d.responsableNombre, d.fechaEntrega, d.observaciones, d.usuarioRegistro, d.usuarioRegistroNombre]
  );
  return rows[0];
}

export async function entregaAbierta(empresaId: string, blocId: string, e?: Ejecutor): Promise<Entrega | null> {
  const { rows } = await db(e).query<Entrega>(
    `SELECT ${COLUMNAS_ENTREGA} FROM orm_entregas
      WHERE empresa_id = $1 AND bloc_id = $2 AND fecha_devolucion IS NULL`,
    [empresaId, blocId]
  );
  return rows[0] ?? null;
}

export async function cerrarEntrega(
  empresaId: string,
  entregaId: string,
  fechaDevolucion: string,
  observaciones: string | null,
  e?: Ejecutor
): Promise<void> {
  await db(e).query(
    `UPDATE orm_entregas SET fecha_devolucion = $3, observaciones_devolucion = $4, updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, entregaId, fechaDevolucion, observaciones]
  );
}

export async function listarEntregas(empresaId: string, blocId: string, e?: Ejecutor): Promise<Entrega[]> {
  const { rows } = await db(e).query<Entrega>(
    `SELECT ${COLUMNAS_ENTREGA} FROM orm_entregas
      WHERE empresa_id = $1 AND bloc_id = $2 ORDER BY fecha_entrega DESC, created_at DESC`,
    [empresaId, blocId]
  );
  return rows;
}

/* ── Procesamientos ──────────────────────────────────────────────────────── */

export async function insertarProcesamiento(
  d: {
    empresaId: string;
    archivoOriginal: string;
    storageKeyOriginal: string | null;
    hashOriginal: string | null;
    mime: string;
    paginas: number;
    usuarioId: string | null;
    usuarioNombre: string | null;
  },
  e?: Ejecutor
): Promise<Procesamiento> {
  const { rows } = await db(e).query<Procesamiento>(
    `INSERT INTO orm_procesamientos
       (empresa_id, archivo_original, storage_key_original, hash_original, mime, paginas, usuario_id, usuario_nombre, etapa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'En cola')
     RETURNING ${COLUMNAS_PROCESO}`,
    [d.empresaId, d.archivoOriginal, d.storageKeyOriginal, d.hashOriginal, d.mime, d.paginas, d.usuarioId, d.usuarioNombre]
  );
  return rows[0];
}

export async function actualizarProcesamiento(
  empresaId: string,
  id: string,
  cambios: Partial<{
    estado: EstadoProcesamiento;
    etapa: string | null;
    paginas: number;
    paginasProcesadas: number;
    documentosDetectados: number;
    documentosCorrectos: number;
    documentosRevision: number;
    noIdentificados: number;
    duplicados: number;
    errores: number;
    fechaFin: string | null;
    errorMensaje: string | null;
  }>,
  e?: Ejecutor
): Promise<Procesamiento | null> {
  const mapa: Record<string, string> = {
    estado: "estado",
    etapa: "etapa",
    paginas: "paginas",
    paginasProcesadas: "paginas_procesadas",
    documentosDetectados: "documentos_detectados",
    documentosCorrectos: "documentos_correctos",
    documentosRevision: "documentos_revision",
    noIdentificados: "no_identificados",
    duplicados: "duplicados",
    errores: "errores",
    fechaFin: "fecha_fin",
    errorMensaje: "error_mensaje",
  };
  const sets = ["updated_at = now()"];
  const valores: unknown[] = [empresaId, id];
  for (const [clave, columna] of Object.entries(mapa)) {
    if (!(clave in cambios)) continue;
    valores.push((cambios as Record<string, unknown>)[clave]);
    sets.push(`${columna} = $${valores.length}`);
  }
  const { rows } = await db(e).query<Procesamiento>(
    `UPDATE orm_procesamientos SET ${sets.join(", ")} WHERE empresa_id = $1 AND id = $2 RETURNING ${COLUMNAS_PROCESO}`,
    valores
  );
  return rows[0] ?? null;
}

export async function procesamientoPorId(empresaId: string, id: string, e?: Ejecutor): Promise<Procesamiento | null> {
  const { rows } = await db(e).query<Procesamiento>(
    `SELECT ${COLUMNAS_PROCESO} FROM orm_procesamientos WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function listarProcesamientos(empresaId: string, limite = 50, e?: Ejecutor): Promise<Procesamiento[]> {
  const { rows } = await db(e).query<Procesamiento>(
    `SELECT ${COLUMNAS_PROCESO} FROM orm_procesamientos WHERE empresa_id = $1
      ORDER BY fecha_inicio DESC LIMIT $2`,
    [empresaId, limite]
  );
  return rows;
}

/* ── Avisos ──────────────────────────────────────────────────────────────── */

/**
 * Crea el aviso si no había uno vivo del mismo tipo para el mismo bloc, y si
 * lo había, le refresca el mensaje.
 *
 * Es un `ON CONFLICT` sobre el índice parcial de avisos vivos: sin él, cada
 * recálculo de un bloc incompleto dejaría una fila nueva y la pantalla de
 * Avisos sería un historial en vez de una lista de cosas por hacer.
 */
export async function abrirAviso(
  d: {
    empresaId: string;
    blocId: string;
    orId?: string | null;
    tipo: TipoAviso;
    mensaje: string;
    responsableId: string | null;
    responsableNombre: string | null;
  },
  e?: Ejecutor
): Promise<Aviso | null> {
  const { rows } = await db(e).query<Aviso>(
    `INSERT INTO orm_avisos (empresa_id, bloc_id, or_id, tipo, mensaje, responsable_id, responsable_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (bloc_id, tipo) WHERE estado <> 'RESUELTO' AND bloc_id IS NOT NULL
     DO UPDATE SET mensaje = EXCLUDED.mensaje,
                   responsable_id = EXCLUDED.responsable_id,
                   responsable_nombre = EXCLUDED.responsable_nombre,
                   updated_at = now()
     RETURNING id, bloc_id AS "blocId", or_id AS "orId", tipo, mensaje, responsable_id AS "responsableId",
               responsable_nombre AS "responsableNombre", canal, estado, fecha_creacion AS "fechaCreacion",
               fecha_notificacion AS "fechaNotificacion", fecha_resolucion AS "fechaResolucion"`,
    [d.empresaId, d.blocId, d.orId ?? null, d.tipo, d.mensaje, d.responsableId, d.responsableNombre]
  );
  return rows[0] ?? null;
}

export async function resolverAvisosDeBloc(empresaId: string, blocId: string, tipo: TipoAviso, e?: Ejecutor): Promise<void> {
  await db(e).query(
    `UPDATE orm_avisos SET estado = 'RESUELTO', fecha_resolucion = now(), updated_at = now()
      WHERE empresa_id = $1 AND bloc_id = $2 AND tipo = $3 AND estado <> 'RESUELTO'`,
    [empresaId, blocId, tipo]
  );
}

export async function listarAvisos(empresaId: string, incluirResueltos = false, e?: Ejecutor): Promise<Aviso[]> {
  const { rows } = await db(e).query<Aviso>(
    `SELECT a.id, a.bloc_id AS "blocId", a.or_id AS "orId", a.tipo, a.mensaje,
            a.responsable_id AS "responsableId", a.responsable_nombre AS "responsableNombre",
            a.canal, a.estado, a.fecha_creacion AS "fechaCreacion",
            a.fecha_notificacion AS "fechaNotificacion", a.fecha_resolucion AS "fechaResolucion",
            b.numero_bloc AS "numeroBloc"
       FROM orm_avisos a
       LEFT JOIN orm_blocs b ON b.id = a.bloc_id
      WHERE a.empresa_id = $1 ${incluirResueltos ? "" : "AND a.estado <> 'RESUELTO'"}
      ORDER BY a.fecha_creacion DESC LIMIT 300`,
    [empresaId]
  );
  return rows;
}

export async function avisoPorId(empresaId: string, id: string, e?: Ejecutor): Promise<Aviso | null> {
  const { rows } = await db(e).query<Aviso>(
    `SELECT id, bloc_id AS "blocId", or_id AS "orId", tipo, mensaje, responsable_id AS "responsableId",
            responsable_nombre AS "responsableNombre", canal, estado, fecha_creacion AS "fechaCreacion",
            fecha_notificacion AS "fechaNotificacion", fecha_resolucion AS "fechaResolucion"
       FROM orm_avisos WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ?? null;
}

export async function marcarAviso(
  empresaId: string,
  id: string,
  estado: EstadoAviso,
  e?: Ejecutor
): Promise<Aviso | null> {
  const { rows } = await db(e).query<Aviso>(
    `UPDATE orm_avisos
        SET estado = $3,
            fecha_notificacion = CASE WHEN $3 = 'NOTIFICADO' THEN now() ELSE fecha_notificacion END,
            fecha_resolucion  = CASE WHEN $3 = 'RESUELTO'  THEN now() ELSE fecha_resolucion END,
            updated_at = now()
      WHERE empresa_id = $1 AND id = $2
      RETURNING id, bloc_id AS "blocId", or_id AS "orId", tipo, mensaje, responsable_id AS "responsableId",
                responsable_nombre AS "responsableNombre", canal, estado, fecha_creacion AS "fechaCreacion",
                fecha_notificacion AS "fechaNotificacion", fecha_resolucion AS "fechaResolucion"`,
    [empresaId, id, estado]
  );
  return rows[0] ?? null;
}

/* ── Histórico ───────────────────────────────────────────────────────────── */

export async function registrarEvento(
  d: {
    empresaId: string;
    blocId?: string | null;
    orId?: string | null;
    documentoId?: string | null;
    accion: string;
    detalle?: unknown;
    usuarioId?: string | null;
    usuarioNombre?: string | null;
  },
  e?: Ejecutor
): Promise<void> {
  await db(e).query(
    `INSERT INTO orm_eventos (empresa_id, bloc_id, or_id, documento_id, accion, detalle, usuario_id, usuario_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      d.empresaId,
      d.blocId ?? null,
      d.orId ?? null,
      d.documentoId ?? null,
      d.accion,
      d.detalle ? JSON.stringify(d.detalle) : null,
      d.usuarioId ?? null,
      d.usuarioNombre ?? null,
    ]
  );
}

export async function listarEventos(
  empresaId: string,
  filtro: { blocId?: string; limite?: number },
  e?: Ejecutor
): Promise<Evento[]> {
  const valores: unknown[] = [empresaId];
  let cond = "empresa_id = $1";
  if (filtro.blocId) {
    valores.push(filtro.blocId);
    cond += ` AND bloc_id = $${valores.length}`;
  }
  valores.push(filtro.limite ?? 200);
  const { rows } = await db(e).query<Evento>(
    `SELECT id, bloc_id AS "blocId", or_id AS "orId", documento_id AS "documentoId", accion, detalle,
            usuario_nombre AS "usuarioNombre", created_at AS "createdAt"
       FROM orm_eventos WHERE ${cond} ORDER BY created_at DESC, id DESC LIMIT $${valores.length}`,
    valores
  );
  return rows;
}

/* ── Indicadores del panel ───────────────────────────────────────────────── */

export type Indicadores = {
  blocsEntregados: number;
  blocsPendientes: number;
  blocsIncompletos: number;
  blocsCerrados: number;
  orPendientes: number;
  documentosPorRevisar: number;
  avisosAbiertos: number;
  procesosEnCurso: number;
};

/**
 * Los números del panel, en una sola ida a la base.
 *
 * Son subconsultas y no una tabla de contadores a propósito: son ocho COUNT
 * sobre tablas con índice por empresa y estado, y un contador guardado es un
 * contador que algún día se queda desincronizado sin que nadie se entere.
 */
export async function indicadores(empresaId: string, e?: Ejecutor): Promise<Indicadores> {
  const { rows } = await db(e).query<Indicadores>(
    `SELECT
       (SELECT COUNT(*) FROM orm_blocs WHERE empresa_id = $1 AND estado = 'ENTREGADO')::int AS "blocsEntregados",
       (SELECT COUNT(*) FROM orm_blocs WHERE empresa_id = $1 AND estado IN ('DISPONIBLE','DEVUELTO','PENDIENTE_ESCANEO'))::int AS "blocsPendientes",
       (SELECT COUNT(*) FROM orm_blocs WHERE empresa_id = $1 AND estado IN ('INCOMPLETO','PENDIENTE_ESCANEO','REVISAR'))::int AS "blocsIncompletos",
       (SELECT COUNT(*) FROM orm_blocs WHERE empresa_id = $1 AND estado = 'CERRADO')::int AS "blocsCerrados",
       (SELECT COUNT(*) FROM orm_or o JOIN orm_blocs b ON b.id = o.bloc_id
         WHERE o.empresa_id = $1 AND o.estado IN ('PENDIENTE','ERROR') AND b.estado <> 'CERRADO')::int AS "orPendientes",
       (SELECT COUNT(*) FROM orm_documentos WHERE empresa_id = $1
         AND estado_procesamiento IN ('REVISION','NO_IDENTIFICADO','DUPLICADO','ERROR'))::int AS "documentosPorRevisar",
       (SELECT COUNT(*) FROM orm_avisos WHERE empresa_id = $1 AND estado <> 'RESUELTO')::int AS "avisosAbiertos",
       (SELECT COUNT(*) FROM orm_procesamientos WHERE empresa_id = $1 AND estado IN ('PENDIENTE','EN_CURSO'))::int AS "procesosEnCurso"`,
    [empresaId]
  );
  return rows[0];
}
