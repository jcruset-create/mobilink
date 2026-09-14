/**
 * Acceso a datos del módulo Therefore.
 *
 * Todas las consultas llevan `empresa_id` en el WHERE, **sin excepción**. Es
 * una base multiempresa y aquí dentro hay números de factura, proveedores e
 * importes: el aislamiento vive en las consultas, no en el panel, porque un
 * panel se salta con `curl`.
 *
 * Y por el mismo motivo, buscar por id sin acertar la empresa devuelve `null`,
 * que el router traduce a **404 y no a 403**: «no existe» y «no es tuyo» tienen
 * que contestar igual, o quien va probando identificadores averigua cuáles
 * existen.
 *
 * Las funciones que escriben aceptan un `Ejecutor` —el pool o un cliente de
 * transacción— para que el servicio pueda meter el cambio, el histórico y el
 * recálculo de prioridad en la misma transacción.
 */

import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import pool from "../db.ts";
import { claveAlbaran } from "./domain/albaran.ts";
import type {
  EstadoActuacion,
  EstadoExpediente,
  Prioridad,
  TipoAccion,
  TipoExpediente,
} from "./domain/estados.ts";

// La clase vive en errors.ts para que el dominio puro pueda lanzarla sin
// arrastrar db.ts, que revienta al cargarse si no hay DATABASE_URL.
import { ErrorTherefore } from "./errors.ts";
export { ErrorTherefore };

/** El pool o un cliente dentro de una transacción. */
export type Ejecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    texto: string,
    valores?: unknown[]
  ): Promise<QueryResult<T>>;
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

export type Expediente = {
  id: string;
  numero: string;
  empresaCodigo: string;
  empresaNombre: string;
  tipo: TipoExpediente;
  estado: EstadoExpediente;
  prioridad: Prioridad;
  prioridadScore: number;
  prioridadManual: Prioridad | null;
  requiereRevision: boolean;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  facturaFecha: string | null;
  importeCentimos: number | null;
  moneda: string;
  casoReferencia: string | null;
  fechaPrimeraNotificacion: string;
  fechaUltimaNotificacion: string;
  numeroNotificaciones: number;
  numeroReclamaciones: number;
  urgente: boolean;
  tareaVencida: boolean;
  asignadoUsuarioId: string | null;
  fechaInicioGestion: string | null;
  fechaResolucion: string | null;
  resueltoPorUsuarioId: string | null;
  fechaCierre: string | null;
  observaciones: string;
  createdAt: string;
  updatedAt: string;
};

export type Actuacion = {
  id: string;
  expedienteId: string;
  tipoAccion: TipoAccion;
  albaranSolicitado: string | null;
  albaranNormalizado: string | null;
  importeCentimos: number | null;
  indicadorAdicional: string | null;
  estado: EstadoActuacion;
  obligatoria: boolean;
  resultado: string | null;
  erpReferencia: string | null;
  erpEstado: unknown;
  erpConsultadoAt: string | null;
  confianza: number;
  origenNotificacionId: string | null;
  iniciadaPorUsuarioId: string | null;
  iniciadaAt: string | null;
  resueltaPorUsuarioId: string | null;
  resueltaAt: string | null;
  observaciones: string;
  createdAt: string;
  updatedAt: string;
};

export type Evento = {
  id: number;
  expedienteId: string | null;
  actuacionId: string | null;
  tipo: string;
  actorTipo: "sistema" | "usuario";
  usuarioId: string | null;
  usuarioNombre: string | null;
  datosAnteriores: unknown;
  datosNuevos: unknown;
  descripcion: string;
  occurredAt: string;
};

/* ── Conversión de filas ─────────────────────────────────────────────────── */

/**
 * `TIMESTAMPTZ` a ISO. `pg` ya devuelve un `Date`; se pasa a texto aquí para
 * que la API entregue siempre lo mismo y el panel no tenga que adivinar.
 */
function aIso(v: Date | string | null): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}

/**
 * `DATE` a `aaaa-mm-dd`, con los componentes LOCALES.
 *
 * No con `toISOString()`: `pg` construye la fecha de una columna DATE a
 * medianoche local, así que en Madrid un `2026-08-31` es
 * `2026-08-30T22:00:00Z` y saldría fechado el día anterior. Es el mismo error
 * que ya costó un certificado mal fechado en el módulo de tacógrafos.
 */
function aFecha(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
}

/** `BIGINT` llega como texto desde `pg`: perdería precisión como número. */
function aEntero(v: string | number | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function aExpediente(f: any): Expediente {
  return {
    id: f.id,
    numero: f.numero,
    empresaCodigo: f.empresa_codigo,
    empresaNombre: f.empresa_nombre,
    tipo: f.tipo,
    estado: f.estado,
    prioridad: f.prioridad,
    prioridadScore: Number(f.prioridad_score) || 0,
    prioridadManual: f.prioridad_manual ?? null,
    requiereRevision: Boolean(f.requiere_revision),
    proveedorCodigo: f.proveedor_codigo ?? null,
    proveedorNombre: f.proveedor_nombre ?? null,
    cuentaContable: f.cuenta_contable ?? null,
    facturaNumero: f.factura_numero ?? null,
    facturaFecha: aFecha(f.factura_fecha),
    importeCentimos: aEntero(f.importe_centimos),
    moneda: f.moneda,
    casoReferencia: f.caso_referencia ?? null,
    fechaPrimeraNotificacion: aIso(f.fecha_primera_notificacion)!,
    fechaUltimaNotificacion: aIso(f.fecha_ultima_notificacion)!,
    numeroNotificaciones: Number(f.numero_notificaciones) || 0,
    numeroReclamaciones: Number(f.numero_reclamaciones) || 0,
    urgente: Boolean(f.urgente),
    tareaVencida: Boolean(f.tarea_vencida),
    asignadoUsuarioId: f.asignado_usuario_id ?? null,
    fechaInicioGestion: aIso(f.fecha_inicio_gestion),
    fechaResolucion: aIso(f.fecha_resolucion),
    resueltoPorUsuarioId: f.resuelto_por_usuario_id ?? null,
    fechaCierre: aIso(f.fecha_cierre),
    observaciones: f.observaciones ?? "",
    createdAt: aIso(f.created_at)!,
    updatedAt: aIso(f.updated_at)!,
  };
}

function aActuacion(f: any): Actuacion {
  return {
    id: f.id,
    expedienteId: f.expediente_id,
    tipoAccion: f.tipo_accion,
    albaranSolicitado: f.albaran_solicitado ?? null,
    albaranNormalizado: f.albaran_normalizado ?? null,
    importeCentimos: aEntero(f.importe_centimos),
    indicadorAdicional: f.indicador_adicional ?? null,
    estado: f.estado,
    obligatoria: Boolean(f.obligatoria),
    resultado: f.resultado ?? null,
    erpReferencia: f.erp_referencia ?? null,
    erpEstado: f.erp_estado ?? null,
    erpConsultadoAt: aIso(f.erp_consultado_at),
    confianza: Number(f.confianza),
    origenNotificacionId: f.origen_notificacion_id ?? null,
    iniciadaPorUsuarioId: f.iniciada_por_usuario_id ?? null,
    iniciadaAt: aIso(f.iniciada_at),
    resueltaPorUsuarioId: f.resuelta_por_usuario_id ?? null,
    resueltaAt: aIso(f.resuelta_at),
    observaciones: f.observaciones ?? "",
    createdAt: aIso(f.created_at)!,
    updatedAt: aIso(f.updated_at)!,
  };
}

function aEvento(f: any): Evento {
  return {
    id: Number(f.id),
    expedienteId: f.expediente_id ?? null,
    actuacionId: f.actuacion_id ?? null,
    tipo: f.tipo,
    actorTipo: f.actor_tipo,
    usuarioId: f.usuario_id ?? null,
    usuarioNombre: f.usuario_nombre ?? null,
    datosAnteriores: f.datos_anteriores ?? null,
    datosNuevos: f.datos_nuevos ?? null,
    descripcion: f.descripcion ?? "",
    occurredAt: aIso(f.occurred_at)!,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const CAMPOS_EXP = `id, numero, empresa_codigo, empresa_nombre, tipo, estado, prioridad,
  prioridad_score, prioridad_manual, requiere_revision, proveedor_codigo, proveedor_nombre,
  cuenta_contable, factura_numero, factura_fecha, importe_centimos, moneda, caso_referencia,
  fecha_primera_notificacion, fecha_ultima_notificacion, numero_notificaciones,
  numero_reclamaciones, urgente, tarea_vencida, asignado_usuario_id, fecha_inicio_gestion,
  fecha_resolucion, resuelto_por_usuario_id, fecha_cierre, observaciones, created_at, updated_at`;

const CAMPOS_ACT = `id, expediente_id, tipo_accion, albaran_solicitado, albaran_normalizado,
  importe_centimos, indicador_adicional, estado, obligatoria, resultado, erp_referencia,
  erp_estado, erp_consultado_at, confianza, origen_notificacion_id, iniciada_por_usuario_id,
  iniciada_at, resuelta_por_usuario_id, resuelta_at, observaciones, created_at, updated_at`;

/* ── Numeración ──────────────────────────────────────────────────────────── */

const SERIE_POR_TIPO: Record<TipoExpediente, string> = {
  INCIDENCIA_ALBARAN: "INC",
  APROBACION_FACTURA: "APR",
  OTRO: "EXP",
};

/**
 * El siguiente número de la serie, de forma atómica.
 *
 * El `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` incrementa y devuelve en
 * la misma sentencia, así que dos expedientes creados a la vez no pueden coger
 * el mismo. Sin esto habría que leer y luego escribir, que es exactamente la
 * carrera que produce dos INC-000452.
 */
export async function siguienteNumero(
  empresaId: string,
  tipo: TipoExpediente,
  ejecutor?: Ejecutor
): Promise<string> {
  const serie = SERIE_POR_TIPO[tipo] ?? "EXP";
  const { rows } = await db(ejecutor).query<{ last_seq: number }>(
    `INSERT INTO thf_contadores (empresa_id, serie, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (empresa_id, serie)
       DO UPDATE SET last_seq = thf_contadores.last_seq + 1
     RETURNING last_seq`,
    [empresaId, serie]
  );
  return `${serie}-${String(rows[0].last_seq).padStart(6, "0")}`;
}

/* ── Expedientes ─────────────────────────────────────────────────────────── */

export type DatosExpediente = {
  tipo: TipoExpediente;
  empresaCodigo: string;
  empresaNombre: string;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  cuentaContable: string | null;
  facturaNumero: string | null;
  facturaFecha: string | null;
  importeCentimos: number | null;
  moneda: string;
  casoReferencia: string | null;
  urgente: boolean;
  tareaVencida: boolean;
  observaciones: string;
  /** Cuándo se pidió por primera vez. Por defecto, ahora. */
  fechaPrimeraNotificacion?: string | null;
};

export async function crearExpediente(
  empresaId: string,
  userId: string | null,
  datos: DatosExpediente,
  ejecutor?: Ejecutor
): Promise<Expediente> {
  const numero = await siguienteNumero(empresaId, datos.tipo, ejecutor);
  const primera = datos.fechaPrimeraNotificacion || null;
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_expedientes
       (empresa_id, numero, empresa_codigo, empresa_nombre, tipo,
        proveedor_codigo, proveedor_nombre, cuenta_contable,
        factura_numero, factura_fecha, importe_centimos, moneda, caso_referencia,
        urgente, tarea_vencida, observaciones, created_by,
        fecha_primera_notificacion, fecha_ultima_notificacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             COALESCE($18::timestamptz, now()), COALESCE($18::timestamptz, now()))
     RETURNING ${CAMPOS_EXP}`,
    [
      empresaId,
      numero,
      datos.empresaCodigo,
      datos.empresaNombre,
      datos.tipo,
      datos.proveedorCodigo,
      datos.proveedorNombre,
      datos.cuentaContable,
      datos.facturaNumero,
      datos.facturaFecha,
      datos.importeCentimos,
      datos.moneda || "EUR",
      datos.casoReferencia,
      datos.urgente,
      datos.tareaVencida,
      datos.observaciones ?? "",
      userId,
      primera,
    ]
  );
  return aExpediente(rows[0]);
}

export async function obtenerExpediente(
  empresaId: string,
  id: string,
  ejecutor?: Ejecutor
): Promise<Expediente | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_EXP} FROM thf_expedientes WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

/** Igual que el anterior pero bloqueando la fila: para leer y escribir seguido. */
export async function obtenerExpedienteBloqueado(
  empresaId: string,
  id: string,
  ejecutor: Ejecutor
): Promise<Expediente | null> {
  const { rows } = await ejecutor.query(
    `SELECT ${CAMPOS_EXP} FROM thf_expedientes
      WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
    [empresaId, id]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

/** Los cambios se expresan en columnas de base: sólo lo escribe el servicio. */
export type CambiosExpediente = Partial<{
  estado: EstadoExpediente;
  prioridad: Prioridad;
  prioridad_score: number;
  prioridad_manual: Prioridad | null;
  requiere_revision: boolean;
  asignado_usuario_id: string | null;
  fecha_inicio_gestion: string | null;
  fecha_resolucion: string | null;
  resuelto_por_usuario_id: string | null;
  fecha_cierre: string | null;
  observaciones: string;
}>;

export async function actualizarExpediente(
  empresaId: string,
  id: string,
  cambios: CambiosExpediente,
  ejecutor?: Ejecutor
): Promise<Expediente | null> {
  const columnas = Object.keys(cambios) as (keyof CambiosExpediente)[];
  if (columnas.length === 0) return obtenerExpediente(empresaId, id, ejecutor);

  const set = columnas.map((c, i) => `${c} = $${i + 3}`).join(", ");
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_expedientes SET ${set}, updated_at = now()
      WHERE empresa_id = $1 AND id = $2
      RETURNING ${CAMPOS_EXP}`,
    [empresaId, id, ...columnas.map((c) => cambios[c])]
  );
  return rows[0] ? aExpediente(rows[0]) : null;
}

export type Pestana =
  | "pendientes"
  | "urgentes"
  | "reclamados"
  | "en_proceso"
  | "revisar"
  | "resueltos"
  | "todos";

export type FiltroExpedientes = {
  pestana?: Pestana;
  estado?: string;
  prioridad?: string;
  empresaCodigo?: string;
  proveedor?: string;
  accion?: string;
  asignado?: string;
  reclamado?: boolean;
  urgente?: boolean;
  requiereRevision?: boolean;
  desde?: string;
  hasta?: string;
  texto?: string;
  orden?: "prioridad" | "antiguedad" | "reciente";
  limite?: number;
  desplazamiento?: number;
};

/** Las condiciones de una pestaña, que son un filtro y no un estado. */
function condicionPestana(p: Pestana | undefined): string | null {
  switch (p) {
    case "pendientes":
      return `estado IN ('NUEVO','PENDIENTE','BLOQUEADO')`;
    case "en_proceso":
      return `estado = 'EN_PROCESO'`;
    case "urgentes":
      return `urgente AND estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO')`;
    case "reclamados":
      return `numero_reclamaciones > 0 AND estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO')`;
    case "revisar":
      return `requiere_revision AND estado <> 'CERRADO'`;
    case "resueltos":
      return `estado IN ('RESUELTO','CERRADO')`;
    default:
      return null;
  }
}

function construirWhere(
  empresaId: string,
  f: FiltroExpedientes
): { where: string; valores: unknown[] } {
  const cond: string[] = ["empresa_id = $1"];
  const valores: unknown[] = [empresaId];
  const nuevo = (v: unknown) => `$${valores.push(v)}`;

  const pestana = condicionPestana(f.pestana);
  if (pestana) cond.push(pestana);

  if (f.estado) cond.push(`estado = ${nuevo(f.estado)}`);
  if (f.prioridad) cond.push(`prioridad = ${nuevo(f.prioridad)}`);
  if (f.empresaCodigo) cond.push(`empresa_codigo = ${nuevo(f.empresaCodigo)}`);
  if (f.proveedor) {
    const v = nuevo(`%${f.proveedor}%`);
    cond.push(`(proveedor_nombre ILIKE ${v} OR proveedor_codigo ILIKE ${v})`);
  }
  if (f.asignado) cond.push(`asignado_usuario_id = ${nuevo(f.asignado)}`);
  if (f.reclamado != null) cond.push(f.reclamado ? `numero_reclamaciones > 0` : `numero_reclamaciones = 0`);
  if (f.urgente != null) cond.push(f.urgente ? `urgente` : `NOT urgente`);
  if (f.requiereRevision != null) {
    cond.push(f.requiereRevision ? `requiere_revision` : `NOT requiere_revision`);
  }
  if (f.desde) cond.push(`fecha_ultima_notificacion >= ${nuevo(f.desde)}::timestamptz`);
  if (f.hasta) {
    // Fin de día inclusive: quien filtra «hasta el 14» quiere el 14 entero.
    cond.push(`fecha_ultima_notificacion < (${nuevo(f.hasta)}::date + 1)`);
  }

  if (f.accion) {
    cond.push(`EXISTS (SELECT 1 FROM thf_actuaciones a
                        WHERE a.expediente_id = thf_expedientes.id
                          AND a.estado <> 'DESCARTADA'
                          AND a.tipo_accion = ${nuevo(f.accion)})`);
  }

  if (f.texto) {
    const v = nuevo(`%${f.texto}%`);
    cond.push(`(numero ILIKE ${v}
             OR factura_numero ILIKE ${v}
             OR proveedor_nombre ILIKE ${v}
             OR empresa_nombre ILIKE ${v}
             OR EXISTS (SELECT 1 FROM thf_actuaciones a
                         WHERE a.expediente_id = thf_expedientes.id
                           AND a.albaran_solicitado ILIKE ${v}))`);
  }

  return { where: cond.join(" AND "), valores };
}

/**
 * Orden de la bandeja.
 *
 * Por prioridad y no por `prioridad_score` a secas: una prioridad fijada a mano
 * puede tener el score bajo, y ordenar por el número la mandaría al final justo
 * después de que alguien dijera que corre.
 */
const ORDEN: Record<NonNullable<FiltroExpedientes["orden"]>, string> = {
  prioridad: `CASE prioridad WHEN 'CRITICA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'NORMAL' THEN 2 ELSE 1 END DESC,
              prioridad_score DESC, fecha_ultima_notificacion DESC`,
  antiguedad: `fecha_primera_notificacion ASC`,
  reciente: `fecha_ultima_notificacion DESC`,
};

export async function listarExpedientes(
  empresaId: string,
  filtro: FiltroExpedientes = {}
): Promise<{ expedientes: Expediente[]; total: number }> {
  const { where, valores } = construirWhere(empresaId, filtro);
  const limite = Math.min(Math.max(Number(filtro.limite) || 100, 1), 500);
  const desplazamiento = Math.max(Number(filtro.desplazamiento) || 0, 0);
  const orden = ORDEN[filtro.orden ?? "prioridad"] ?? ORDEN.prioridad;

  const { rows } = await pool.query(
    `SELECT ${CAMPOS_EXP}, COUNT(*) OVER () AS total
       FROM thf_expedientes
      WHERE ${where}
      ORDER BY ${orden}
      LIMIT ${limite} OFFSET ${desplazamiento}`,
    valores
  );

  return {
    expedientes: rows.map(aExpediente),
    total: rows[0] ? Number(rows[0].total) : 0,
  };
}

/** Lo que va en los contadores de las pestañas, en una sola consulta. */
export async function contarPestanas(empresaId: string): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE estado IN ('NUEVO','PENDIENTE','BLOQUEADO')) AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'EN_PROCESO') AS en_proceso,
       COUNT(*) FILTER (WHERE urgente AND estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO')) AS urgentes,
       COUNT(*) FILTER (WHERE numero_reclamaciones > 0
                          AND estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO')) AS reclamados,
       COUNT(*) FILTER (WHERE requiere_revision AND estado <> 'CERRADO') AS revisar,
       COUNT(*) FILTER (WHERE estado IN ('RESUELTO','CERRADO')) AS resueltos,
       COUNT(*) AS todos
     FROM thf_expedientes WHERE empresa_id = $1`,
    [empresaId]
  );
  const f = rows[0] ?? {};
  const n = (v: unknown) => Number(v) || 0;
  return {
    pendientes: n(f.pendientes),
    urgentes: n(f.urgentes),
    reclamados: n(f.reclamados),
    en_proceso: n(f.en_proceso),
    revisar: n(f.revisar),
    resueltos: n(f.resueltos),
    todos: n(f.todos),
  };
}

/* ── Actuaciones ─────────────────────────────────────────────────────────── */

export type DatosActuacion = {
  tipoAccion: TipoAccion;
  albaranSolicitado: string | null;
  importeCentimos: number | null;
  indicadorAdicional: string | null;
  obligatoria?: boolean;
  confianza?: number;
  observaciones?: string;
  origenNotificacionId?: string | null;
};

/**
 * Crea una actuación, o no hace nada si el expediente ya tenía esa misma acción
 * sobre ese mismo albarán.
 *
 * El `ON CONFLICT DO NOTHING` sobre el índice único es lo que hace que una
 * reclamación que repite los albaranes de siempre no duplique el trabajo. Sin
 * fila devuelta = ya estaba, y quien llama decide si eso es una novedad o no.
 */
export async function crearActuacion(
  empresaId: string,
  expedienteId: string,
  datos: DatosActuacion,
  ejecutor?: Ejecutor
): Promise<Actuacion | null> {
  const normalizado = claveAlbaran(datos.albaranSolicitado);
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_actuaciones
       (empresa_id, expediente_id, tipo_accion, albaran_solicitado, albaran_normalizado,
        importe_centimos, indicador_adicional, obligatoria, confianza, observaciones,
        origen_notificacion_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (expediente_id, tipo_accion, albaran_normalizado)
       WHERE albaran_normalizado IS NOT NULL AND estado <> 'DESCARTADA'
       DO NOTHING
     RETURNING ${CAMPOS_ACT}`,
    [
      empresaId,
      expedienteId,
      datos.tipoAccion,
      datos.albaranSolicitado,
      normalizado,
      datos.importeCentimos,
      datos.indicadorAdicional,
      datos.obligatoria ?? true,
      datos.confianza ?? 1,
      datos.observaciones ?? "",
      datos.origenNotificacionId ?? null,
    ]
  );
  return rows[0] ? aActuacion(rows[0]) : null;
}

export async function listarActuaciones(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<Actuacion[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ACT} FROM thf_actuaciones
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aActuacion);
}

/** Las actuaciones de varios expedientes a la vez, para la bandeja. */
export async function actuacionesDe(
  empresaId: string,
  expedienteIds: readonly string[]
): Promise<Map<string, Actuacion[]>> {
  const mapa = new Map<string, Actuacion[]>();
  if (expedienteIds.length === 0) return mapa;
  const { rows } = await pool.query(
    `SELECT ${CAMPOS_ACT} FROM thf_actuaciones
      WHERE empresa_id = $1 AND expediente_id = ANY($2::uuid[])
      ORDER BY created_at, id`,
    [empresaId, [...expedienteIds]]
  );
  for (const f of rows) {
    const a = aActuacion(f);
    const lista = mapa.get(a.expedienteId);
    if (lista) lista.push(a);
    else mapa.set(a.expedienteId, [a]);
  }
  return mapa;
}

export async function obtenerActuacion(
  empresaId: string,
  id: string,
  ejecutor?: Ejecutor
): Promise<Actuacion | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ACT} FROM thf_actuaciones WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aActuacion(rows[0]) : null;
}

export type CambiosActuacion = Partial<{
  estado: EstadoActuacion;
  resultado: string | null;
  erp_referencia: string | null;
  observaciones: string;
  iniciada_por_usuario_id: string | null;
  iniciada_at: string | null;
  resuelta_por_usuario_id: string | null;
  resuelta_at: string | null;
}>;

export async function actualizarActuacion(
  empresaId: string,
  id: string,
  cambios: CambiosActuacion,
  ejecutor?: Ejecutor
): Promise<Actuacion | null> {
  const columnas = Object.keys(cambios) as (keyof CambiosActuacion)[];
  if (columnas.length === 0) return obtenerActuacion(empresaId, id, ejecutor);

  const set = columnas.map((c, i) => `${c} = $${i + 3}`).join(", ");
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_actuaciones SET ${set}, updated_at = now()
      WHERE empresa_id = $1 AND id = $2
      RETURNING ${CAMPOS_ACT}`,
    [empresaId, id, ...columnas.map((c) => cambios[c])]
  );
  return rows[0] ? aActuacion(rows[0]) : null;
}

/* ── Histórico ───────────────────────────────────────────────────────────── */

export type Anotacion = {
  expedienteId?: string | null;
  actuacionId?: string | null;
  notificacionId?: string | null;
  tipo: string;
  actorTipo?: "sistema" | "usuario";
  usuarioId?: string | null;
  usuarioNombre?: string | null;
  datosAnteriores?: unknown;
  datosNuevos?: unknown;
  descripcion: string;
};

/**
 * Anota un evento. **Lanza si no puede.**
 *
 * Al revés que `registrarEvento` del diario de asistencias, que traga sus
 * errores. Aquí el histórico se escribe siempre DENTRO de la transacción que
 * hace el cambio, y «el expediente se resolvió pero no consta quién» no es un
 * estado aceptable: o consta entero o no consta. Es el mismo criterio que
 * `registrarAuditoriaEnTransaccion` para lo que mueve dinero.
 */
export async function anotarEvento(
  empresaId: string,
  a: Anotacion,
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `INSERT INTO thf_eventos
       (empresa_id, expediente_id, actuacion_id, notificacion_id, tipo, actor_tipo,
        usuario_id, usuario_nombre, datos_anteriores, datos_nuevos, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      empresaId,
      a.expedienteId ?? null,
      a.actuacionId ?? null,
      a.notificacionId ?? null,
      a.tipo,
      a.actorTipo ?? "sistema",
      a.usuarioId ?? null,
      a.usuarioNombre ?? null,
      a.datosAnteriores === undefined ? null : JSON.stringify(a.datosAnteriores),
      a.datosNuevos === undefined ? null : JSON.stringify(a.datosNuevos),
      a.descripcion,
    ]
  );
}

export async function listarEventos(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<Evento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT id, expediente_id, actuacion_id, tipo, actor_tipo, usuario_id, usuario_nombre,
            datos_anteriores, datos_nuevos, descripcion, occurred_at
       FROM thf_eventos
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY occurred_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aEvento);
}
