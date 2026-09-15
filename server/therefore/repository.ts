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
  CandidatoPuntuado,
  ExpedienteCandidato,
  TipoNotificacion,
} from "./domain/dedupe.ts";
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
  /** «MODIFICAR FECHA», «Costes (modificar)». `null` si no hubo matiz. */
  accionTexto: string | null;
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
    accionTexto: f.accion_texto ?? null,
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

const CAMPOS_ACT = `id, expediente_id, tipo_accion, accion_texto, albaran_solicitado, albaran_normalizado,
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
  // Las mueve la ingesta de correo al enlazar una notificación.
  numero_notificaciones: number;
  numero_reclamaciones: number;
  fecha_ultima_notificacion: string;
  urgente: boolean;
  tarea_vencida: boolean;
}>;

/**
 * Las columnas que `actualizarExpediente` puede escribir, en tiempo de
 * ejecución.
 *
 * El nombre de la columna se interpola en el SQL —no hay forma de pasarlo como
 * parámetro— y el tipo de arriba sólo existe al compilar. Con esta lista, un
 * objeto que llegue con una clave rara desde un `JSON.parse` no puede acabar
 * dentro de un UPDATE.
 */
const COLUMNAS_EXPEDIENTE = new Set<string>([
  "estado",
  "prioridad",
  "prioridad_score",
  "prioridad_manual",
  "requiere_revision",
  "asignado_usuario_id",
  "fecha_inicio_gestion",
  "fecha_resolucion",
  "resuelto_por_usuario_id",
  "fecha_cierre",
  "observaciones",
  "numero_notificaciones",
  "numero_reclamaciones",
  "fecha_ultima_notificacion",
  "urgente",
  "tarea_vencida",
]);

export async function actualizarExpediente(
  empresaId: string,
  id: string,
  cambios: CambiosExpediente,
  ejecutor?: Ejecutor
): Promise<Expediente | null> {
  const columnas = (Object.keys(cambios) as (keyof CambiosExpediente)[]).filter((c) =>
    COLUMNAS_EXPEDIENTE.has(c)
  );
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
  accionTexto?: string | null;
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
        origen_notificacion_id, accion_texto)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      datos.accionTexto ?? null,
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
      ORDER BY orden`,
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
      ORDER BY expediente_id, orden`,
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
  /** Lo que dijo el ERP, tal cual, y cuándo. JSONB: se guarda serializado. */
  erp_estado: string | null;
  erp_consultado_at: string | null;
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
  albaranAnalizadoId?: string | null;
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
       (empresa_id, expediente_id, actuacion_id, notificacion_id, albaran_analizado_id,
        tipo, actor_tipo, usuario_id, usuario_nombre, datos_anteriores, datos_nuevos, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      empresaId,
      a.expedienteId ?? null,
      a.actuacionId ?? null,
      a.notificacionId ?? null,
      a.albaranAnalizadoId ?? null,
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

/* ════════════════════════════════════════════════════════════════════════════
   NOTIFICACIONES, ADJUNTOS Y DECISIONES
   ════════════════════════════════════════════════════════════════════════════

   La parte que recibe el correo. El orden de arriba abajo es el de la ingesta:
   se registra el correo, se buscan expedientes candidatos, y si no se sabe a
   cuál va, se levanta una decisión para que la mire una persona.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Notificacion = {
  id: string;
  expedienteId: string | null;
  messageId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  inReplyTo: string | null;
  fechaEmail: string;
  remitente: string;
  destinatario: string;
  asunto: string;
  textoOriginal: string;
  tipoNotificacion: TipoNotificacion;
  urgenteDetectado: boolean;
  personaSolicitante: string | null;
  hashContenido: string;
  parseado: unknown;
  estadoProceso: EstadoProcesoNotificacion;
  errorProceso: string | null;
  createdAt: string;
};

export const ESTADOS_PROCESO_NOTIFICACION = [
  "PROCESADA",
  "PENDIENTE_DECISION",
  "ERROR_PARSER",
  "IGNORADA",
] as const;
export type EstadoProcesoNotificacion = (typeof ESTADOS_PROCESO_NOTIFICACION)[number];

const CAMPOS_NOTIF = `
  id, expediente_id, message_id, gmail_message_id, gmail_thread_id, in_reply_to,
  fecha_email, remitente, destinatario, asunto, texto_original, tipo_notificacion,
  urgente_detectado, persona_solicitante, hash_contenido, parseado,
  estado_proceso, error_proceso, created_at`;

function aNotificacion(r: QueryResultRow): Notificacion {
  return {
    id: String(r.id),
    expedienteId: r.expediente_id ? String(r.expediente_id) : null,
    messageId: String(r.message_id),
    gmailMessageId: r.gmail_message_id ? String(r.gmail_message_id) : null,
    gmailThreadId: r.gmail_thread_id ? String(r.gmail_thread_id) : null,
    inReplyTo: r.in_reply_to ? String(r.in_reply_to) : null,
    fechaEmail: new Date(r.fecha_email).toISOString(),
    remitente: String(r.remitente ?? ""),
    destinatario: String(r.destinatario ?? ""),
    asunto: String(r.asunto ?? ""),
    textoOriginal: String(r.texto_original ?? ""),
    tipoNotificacion: r.tipo_notificacion as TipoNotificacion,
    urgenteDetectado: Boolean(r.urgente_detectado),
    personaSolicitante: r.persona_solicitante ? String(r.persona_solicitante) : null,
    hashContenido: String(r.hash_contenido),
    parseado: r.parseado ?? null,
    estadoProceso: r.estado_proceso as EstadoProcesoNotificacion,
    errorProceso: r.error_proceso ? String(r.error_proceso) : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export type DatosNotificacion = {
  messageId: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  inReplyTo?: string | null;
  fechaEmail: string;
  remitente?: string;
  destinatario?: string;
  asunto?: string;
  textoOriginal: string;
  htmlOriginal?: string | null;
  tipoNotificacion?: TipoNotificacion;
  urgenteDetectado?: boolean;
  personaSolicitante?: string | null;
  hashContenido: string;
  parseado?: unknown;
  estadoProceso?: EstadoProcesoNotificacion;
};

/**
 * Registra el correo, o devuelve el que ya estaba.
 *
 * `yaEstaba` es toda la idempotencia de la ingesta. El `ON CONFLICT DO NOTHING`
 * sobre `(empresa_id, message_id)` y no una comprobación previa: dos pasadas
 * del buzón a la vez pasarían las dos por un «¿ya existe?» y las dos
 * insertarían. Aquí la base decide, que es la única que puede.
 *
 * Cuando ya estaba, se devuelve la fila existente en vez de `null`: quien llama
 * casi siempre quiere saber a qué expediente fue a parar la primera vez.
 */
export async function registrarNotificacion(
  empresaId: string,
  datos: DatosNotificacion,
  ejecutor?: Ejecutor
): Promise<{ notificacion: Notificacion; yaEstaba: boolean }> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_notificaciones
       (empresa_id, message_id, gmail_message_id, gmail_thread_id, in_reply_to,
        fecha_email, remitente, destinatario, asunto, texto_original, html_original,
        tipo_notificacion, urgente_detectado, persona_solicitante, hash_contenido,
        parseado, estado_proceso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (empresa_id, message_id) DO NOTHING
     RETURNING ${CAMPOS_NOTIF}`,
    [
      empresaId,
      datos.messageId,
      datos.gmailMessageId ?? null,
      datos.gmailThreadId ?? null,
      datos.inReplyTo ?? null,
      datos.fechaEmail,
      datos.remitente ?? "",
      datos.destinatario ?? "",
      datos.asunto ?? "",
      datos.textoOriginal,
      datos.htmlOriginal ?? null,
      datos.tipoNotificacion ?? "SOLICITUD",
      datos.urgenteDetectado ?? false,
      datos.personaSolicitante ?? null,
      datos.hashContenido,
      datos.parseado === undefined ? null : JSON.stringify(datos.parseado),
      datos.estadoProceso ?? "PROCESADA",
    ]
  );

  if (rows[0]) return { notificacion: aNotificacion(rows[0]), yaEstaba: false };

  const previa = await db(ejecutor).query(
    `SELECT ${CAMPOS_NOTIF} FROM thf_notificaciones
      WHERE empresa_id = $1 AND message_id = $2`,
    [empresaId, datos.messageId]
  );
  if (!previa.rows[0]) {
    // El INSERT dijo que ya existía y el SELECT no la encuentra: alguien la ha
    // borrado entre las dos consultas. Se dice, en vez de reventar más abajo
    // con un error de propiedad de `undefined` que no explicaría nada.
    throw new ErrorTherefore(
      "NOTIFICACION_DESAPARECIDA",
      "El correo existía al insertarlo y ya no está. Vuelve a intentarlo.",
      409
    );
  }
  return { notificacion: aNotificacion(previa.rows[0]), yaEstaba: true };
}

export async function obtenerNotificacion(
  empresaId: string,
  id: string,
  ejecutor?: Ejecutor
): Promise<Notificacion | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_NOTIF} FROM thf_notificaciones WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aNotificacion(rows[0]) : null;
}

export async function listarNotificaciones(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<Notificacion[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_NOTIF} FROM thf_notificaciones
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY fecha_email, created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aNotificacion);
}

export type CambiosNotificacion = Partial<{
  expedienteId: string | null;
  tipoNotificacion: TipoNotificacion;
  estadoProceso: EstadoProcesoNotificacion;
  errorProceso: string | null;
  parseado: unknown;
}>;

export async function actualizarNotificacion(
  empresaId: string,
  id: string,
  cambios: CambiosNotificacion,
  ejecutor?: Ejecutor
): Promise<Notificacion | null> {
  const sets: string[] = [];
  const vals: unknown[] = [empresaId, id];
  const poner = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };

  if (cambios.expedienteId !== undefined) poner("expediente_id", cambios.expedienteId);
  if (cambios.tipoNotificacion !== undefined) poner("tipo_notificacion", cambios.tipoNotificacion);
  if (cambios.estadoProceso !== undefined) poner("estado_proceso", cambios.estadoProceso);
  if (cambios.errorProceso !== undefined) poner("error_proceso", cambios.errorProceso);
  if (cambios.parseado !== undefined) poner("parseado", JSON.stringify(cambios.parseado));
  if (sets.length === 0) return obtenerNotificacion(empresaId, id, ejecutor);

  const { rows } = await db(ejecutor).query(
    `UPDATE thf_notificaciones SET ${sets.join(", ")}
      WHERE empresa_id = $1 AND id = $2
      RETURNING ${CAMPOS_NOTIF}`,
    vals
  );
  return rows[0] ? aNotificacion(rows[0]) : null;
}

/* ── Adjuntos ────────────────────────────────────────────────────────────── */

export const TIPOS_DOCUMENTO_ADJUNTO = [
  "PDF_FACTURA",
  "PDF_ABONO",
  "XML_FACTURA",
  "OTRO",
] as const;
export type TipoDocumentoAdjunto = (typeof TIPOS_DOCUMENTO_ADJUNTO)[number];

export type Adjunto = {
  id: string;
  notificacionId: string;
  expedienteId: string | null;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number | null;
  tipoDocumento: TipoDocumentoAdjunto;
  hashArchivo: string;
  storagePath: string | null;
  parsed: boolean;
  createdAt: string;
};

const CAMPOS_ADJ = `
  id, notificacion_id, expediente_id, nombre_archivo, mime_type, tamano_bytes,
  tipo_documento, hash_archivo, storage_path, parsed, created_at`;

function aAdjunto(r: QueryResultRow): Adjunto {
  return {
    id: String(r.id),
    notificacionId: String(r.notificacion_id),
    expedienteId: r.expediente_id ? String(r.expediente_id) : null,
    nombreArchivo: String(r.nombre_archivo ?? ""),
    mimeType: String(r.mime_type ?? ""),
    tamanoBytes: r.tamano_bytes === null ? null : Number(r.tamano_bytes),
    tipoDocumento: r.tipo_documento as TipoDocumentoAdjunto,
    hashArchivo: String(r.hash_archivo),
    storagePath: r.storage_path ? String(r.storage_path) : null,
    parsed: Boolean(r.parsed),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export type DatosAdjunto = {
  nombreArchivo?: string;
  mimeType?: string;
  tamanoBytes?: number | null;
  tipoDocumento?: TipoDocumentoAdjunto;
  hashArchivo: string;
  storagePath?: string | null;
};

/** El mismo fichero en el mismo correo no se registra dos veces. */
export async function registrarAdjunto(
  empresaId: string,
  notificacionId: string,
  expedienteId: string | null,
  datos: DatosAdjunto,
  ejecutor?: Ejecutor
): Promise<Adjunto | null> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_adjuntos
       (empresa_id, notificacion_id, expediente_id, nombre_archivo, mime_type,
        tamano_bytes, tipo_documento, hash_archivo, storage_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (notificacion_id, hash_archivo) DO NOTHING
     RETURNING ${CAMPOS_ADJ}`,
    [
      empresaId,
      notificacionId,
      expedienteId,
      datos.nombreArchivo ?? "",
      datos.mimeType ?? "",
      datos.tamanoBytes ?? null,
      datos.tipoDocumento ?? "OTRO",
      datos.hashArchivo,
      datos.storagePath ?? null,
    ]
  );
  return rows[0] ? aAdjunto(rows[0]) : null;
}

export async function adjuntosDeNotificacion(
  empresaId: string,
  notificacionId: string,
  ejecutor?: Ejecutor
): Promise<Adjunto[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ADJ} FROM thf_adjuntos
      WHERE empresa_id = $1 AND notificacion_id = $2 ORDER BY created_at, id`,
    [empresaId, notificacionId]
  );
  return rows.map(aAdjunto);
}

export async function adjuntosDeExpediente(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<Adjunto[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ADJ} FROM thf_adjuntos
      WHERE empresa_id = $1 AND expediente_id = $2 ORDER BY created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aAdjunto);
}

/**
 * Cuelga del expediente los adjuntos de un correo que acaba de enlazarse.
 *
 * Va aparte de `registrarAdjunto` porque el orden importa: cuando el correo
 * queda esperando una decisión, sus adjuntos existen pero todavía no son de
 * ningún expediente. Se les pone el expediente cuando lo hay, y no antes.
 */
export async function asignarAdjuntosAExpediente(
  empresaId: string,
  notificacionId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `UPDATE thf_adjuntos SET expediente_id = $3
      WHERE empresa_id = $1 AND notificacion_id = $2`,
    [empresaId, notificacionId, expedienteId]
  );
}

/* ── Candidatos para deduplicar (F.1) ────────────────────────────────────── */

/**
 * Los expedientes que PODRÍAN ser el mismo asunto que este correo.
 *
 * No decide nada: recorta. Lo que sale de aquí lo puntúa `domain/dedupe.ts`,
 * que es código puro y se prueba sin base de datos. El reparto es deliberado:
 * la consulta hace lo que SQL hace bien —filtrar muchas filas por índice— y la
 * decisión vive donde se puede leer y probar caso a caso.
 *
 * Se incluyen los RESUELTO y CERRADO a propósito. Un expediente cerrado que
 * recibe una reclamación no es un expediente nuevo: es una reclamación sobre
 * uno cerrado, y hay que verla como tal. Si se filtraran por estado, el
 * sistema abriría un duplicado y nadie notaría que ya se había hecho.
 *
 * La ventana de días está aquí y no en el dominio porque es lo único que evita
 * recorrer el histórico entero: dos años de incidencias del mismo proveedor
 * puntuarían todas, y la más antigua ganaría algún empate tonto.
 */
export type ClavesCandidatos = {
  facturaNumero: string | null;
  albaranes: readonly string[];
  hashesAdjuntos: readonly string[];
  hilo: string | null;
  enRespuestaA: string | null;
  hashContenido: string | null;
  ventanaDias: number;
};

export async function candidatosDedupe(
  empresaId: string,
  claves: ClavesCandidatos,
  ejecutor?: Ejecutor
): Promise<ExpedienteCandidato[]> {
  const e = db(ejecutor);
  const albaranes = [...claves.albaranes];
  const hashes = [...claves.hashesAdjuntos];

  /*
   * Un OR de subconsultas y no un montón de LEFT JOIN: cada rama usa su propio
   * índice y ninguna multiplica filas. La ventana se aplica una sola vez,
   * fuera, para que no haya que repetirla en cada rama y olvidarla en una.
   */
  const { rows: ids } = await e.query<{ id: string }>(
    `SELECT id FROM thf_expedientes x
      WHERE x.empresa_id = $1
        AND x.fecha_ultima_notificacion >= now() - make_interval(days => $2::int)
        AND (
          ($3::text IS NOT NULL AND thf_normalizar_id(x.factura_numero) = thf_normalizar_id($3))
          OR EXISTS (
            SELECT 1 FROM thf_actuaciones a
             WHERE a.expediente_id = x.id
               AND a.estado <> 'DESCARTADA'
               AND a.albaran_normalizado = ANY($4::text[])
          )
          OR EXISTS (
            SELECT 1 FROM thf_adjuntos d
             WHERE d.expediente_id = x.id AND d.hash_archivo = ANY($5::text[])
          )
          OR EXISTS (
            SELECT 1 FROM thf_notificaciones n
             WHERE n.expediente_id = x.id
               AND (
                 ($6::text IS NOT NULL AND n.gmail_thread_id = $6)
                 OR ($7::text IS NOT NULL AND n.message_id = $7)
                 OR ($8::text IS NOT NULL AND n.hash_contenido = $8)
               )
          )
        )`,
    [
      empresaId,
      Math.max(1, Math.trunc(claves.ventanaDias)),
      claves.facturaNumero,
      albaranes,
      hashes,
      claves.hilo,
      claves.enRespuestaA,
      claves.hashContenido,
    ]
  );

  if (ids.length === 0) return [];
  return armarCandidatos(empresaId, ids.map((r) => String(r.id)), ejecutor);
}

/**
 * Un expediente concreto con la forma que espera el deduplicador.
 *
 * Lo usa la resolución de decisiones: cuando una persona dice «fúndelo en
 * INC-452», hay que aplicar la MISMA fusión que habría aplicado el motor, no
 * una versión simplificada escrita aparte. Dos caminos distintos para el mismo
 * resultado acaban divergiendo, y el que menos se usa es el que se rompe.
 */
export async function candidatoPorId(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<ExpedienteCandidato | null> {
  const [uno] = await armarCandidatos(empresaId, [expedienteId], ejecutor);
  return uno ?? null;
}

async function armarCandidatos(
  empresaId: string,
  lista: readonly string[],
  ejecutor?: Ejecutor
): Promise<ExpedienteCandidato[]> {
  if (lista.length === 0) return [];
  const e = db(ejecutor);

  /*
   * Cuatro consultas, UNA detrás de otra y no en un `Promise.all`.
   *
   * `e` puede ser el cliente de una transacción, y un cliente de `pg` no admite
   * dos consultas a la vez: lanzarlas en paralelo da un aviso de obsolescencia
   * hoy y un error en pg@9. Con el puñado de identificadores que llegan aquí, lo
   * que se pierde por ir en serie no se nota.
   */
  const expedientes = await e.query(
    `SELECT id, numero, estado, tipo, empresa_codigo, proveedor_codigo, proveedor_nombre,
            factura_numero, importe_centimos, fecha_ultima_notificacion, numero_notificaciones
       FROM thf_expedientes WHERE empresa_id = $1 AND id = ANY($2::uuid[])`,
    [empresaId, lista]
  );
  const actuaciones = await e.query(
    `SELECT id, expediente_id, tipo_accion, albaran_normalizado, estado
       FROM thf_actuaciones WHERE empresa_id = $1 AND expediente_id = ANY($2::uuid[])`,
    [empresaId, lista]
  );
  const adjuntos = await e.query(
    `SELECT expediente_id, hash_archivo
       FROM thf_adjuntos WHERE empresa_id = $1 AND expediente_id = ANY($2::uuid[])`,
    [empresaId, lista]
  );
  const notificaciones = await e.query(
    `SELECT expediente_id, message_id, gmail_thread_id
       FROM thf_notificaciones WHERE empresa_id = $1 AND expediente_id = ANY($2::uuid[])`,
    [empresaId, lista]
  );

  const porExpediente = <T>(filas: readonly QueryResultRow[], saca: (r: QueryResultRow) => T) => {
    const mapa = new Map<string, T[]>();
    for (const f of filas) {
      const k = String(f.expediente_id);
      const l = mapa.get(k);
      if (l) l.push(saca(f));
      else mapa.set(k, [saca(f)]);
    }
    return mapa;
  };

  const acts = porExpediente(actuaciones.rows, (r) => ({
    id: String(r.id),
    accion: r.tipo_accion as TipoAccion,
    albaranNormalizado: r.albaran_normalizado ? String(r.albaran_normalizado) : null,
    descartada: r.estado === "DESCARTADA",
  }));
  const hs = porExpediente(adjuntos.rows, (r) => String(r.hash_archivo));
  const mids = porExpediente(notificaciones.rows, (r) => String(r.message_id));
  const hilos = porExpediente(
    notificaciones.rows.filter((r) => r.gmail_thread_id),
    (r) => String(r.gmail_thread_id)
  );

  return expedientes.rows.map((r) => ({
    id: String(r.id),
    numero: String(r.numero),
    estado: r.estado as EstadoExpediente,
    tipo: r.tipo as TipoExpediente,
    empresaCodigo: r.empresa_codigo ? String(r.empresa_codigo) : null,
    proveedorCodigo: r.proveedor_codigo ? String(r.proveedor_codigo) : null,
    proveedorNombre: r.proveedor_nombre ? String(r.proveedor_nombre) : null,
    facturaNumero: r.factura_numero ? String(r.factura_numero) : null,
    importeCentimos: r.importe_centimos === null ? null : Number(r.importe_centimos),
    fechaUltimaNotificacion: new Date(r.fecha_ultima_notificacion).toISOString(),
    actuaciones: acts.get(String(r.id)) ?? [],
    hashesAdjuntos: hs.get(String(r.id)) ?? [],
    hilos: hilos.get(String(r.id)) ?? [],
    messageIds: mids.get(String(r.id)) ?? [],
    numeroNotificaciones: Number(r.numero_notificaciones ?? 0),
  }));
}

/* ── Decisiones ──────────────────────────────────────────────────────────── */

export const TIPOS_DECISION = [
  "POSIBLE_DUPLICADO",
  "CAMBIO_INSTRUCCION",
  "RECLAMACION_SOBRE_RESUELTO",
  "REQUIERE_REVISION",
  "ERROR_PARSER",
] as const;
export type TipoDecision = (typeof TIPOS_DECISION)[number];

export type Decision = {
  id: string;
  tipo: TipoDecision;
  notificacionId: string | null;
  expedienteId: string | null;
  actuacionId: string | null;
  candidatos: CandidatoPuntuado[];
  detalle: Record<string, unknown> | null;
  estado: "PENDIENTE" | "DECIDIDA";
  decision: string | null;
  motivo: string | null;
  decididaPorNombre: string | null;
  decididaAt: string | null;
  createdAt: string;
};

const CAMPOS_DEC = `
  id, tipo, notificacion_id, expediente_id, actuacion_id, candidatos, detalle,
  estado, decision, motivo, decidida_por_nombre, decidida_at, created_at`;

function aDecision(r: QueryResultRow): Decision {
  return {
    id: String(r.id),
    tipo: r.tipo as TipoDecision,
    notificacionId: r.notificacion_id ? String(r.notificacion_id) : null,
    expedienteId: r.expediente_id ? String(r.expediente_id) : null,
    actuacionId: r.actuacion_id ? String(r.actuacion_id) : null,
    candidatos: (r.candidatos ?? []) as CandidatoPuntuado[],
    detalle: (r.detalle ?? null) as Record<string, unknown> | null,
    estado: r.estado as "PENDIENTE" | "DECIDIDA",
    decision: r.decision ? String(r.decision) : null,
    motivo: r.motivo ? String(r.motivo) : null,
    decididaPorNombre: r.decidida_por_nombre ? String(r.decidida_por_nombre) : null,
    decididaAt: r.decidida_at ? new Date(r.decidida_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export type DatosDecision = {
  tipo: TipoDecision;
  notificacionId: string | null;
  expedienteId?: string | null;
  actuacionId?: string | null;
  candidatos?: CandidatoPuntuado[];
  detalle?: Record<string, unknown> | null;
};

/**
 * Levanta una decisión, o devuelve `null` si ya había una igual pendiente.
 *
 * `null` no es un error: significa que el mismo correo ya está esperando por lo
 * mismo. Pasa al reprocesar un correo a mano, y dejar dos entradas idénticas en
 * la cola haría que quien resolviera la primera se encontrara la segunda sin
 * saber si es otro caso.
 */
export async function crearDecision(
  empresaId: string,
  datos: DatosDecision,
  ejecutor?: Ejecutor
): Promise<Decision | null> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_decisiones
       (empresa_id, tipo, notificacion_id, expediente_id, actuacion_id, candidatos, detalle)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
     ON CONFLICT (notificacion_id, tipo,
                  COALESCE(actuacion_id, '00000000-0000-0000-0000-000000000000'::uuid))
       WHERE estado = 'PENDIENTE' AND notificacion_id IS NOT NULL
       DO NOTHING
     RETURNING ${CAMPOS_DEC}`,
    [
      empresaId,
      datos.tipo,
      datos.notificacionId,
      datos.expedienteId ?? null,
      datos.actuacionId ?? null,
      JSON.stringify(datos.candidatos ?? []),
      datos.detalle === undefined || datos.detalle === null ? null : JSON.stringify(datos.detalle),
    ]
  );
  return rows[0] ? aDecision(rows[0]) : null;
}

export async function obtenerDecision(
  empresaId: string,
  id: string,
  ejecutor?: Ejecutor
): Promise<Decision | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_DEC} FROM thf_decisiones WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aDecision(rows[0]) : null;
}

/** Igual que `obtenerExpedienteBloqueado`: para decidir sin que dos a la vez. */
export async function obtenerDecisionBloqueada(
  empresaId: string,
  id: string,
  cliente: PoolClient
): Promise<Decision | null> {
  const { rows } = await cliente.query(
    `SELECT ${CAMPOS_DEC} FROM thf_decisiones
      WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
    [empresaId, id]
  );
  return rows[0] ? aDecision(rows[0]) : null;
}

export async function listarDecisiones(
  empresaId: string,
  filtro: { estado?: "PENDIENTE" | "DECIDIDA"; expedienteId?: string; limite?: number } = {},
  ejecutor?: Ejecutor
): Promise<Decision[]> {
  const vals: unknown[] = [empresaId];
  const cond: string[] = ["empresa_id = $1"];
  if (filtro.estado) {
    vals.push(filtro.estado);
    cond.push(`estado = $${vals.length}`);
  }
  if (filtro.expedienteId) {
    vals.push(filtro.expedienteId);
    cond.push(`expediente_id = $${vals.length}`);
  }
  vals.push(Math.min(Math.max(filtro.limite ?? 100, 1), 500));
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_DEC} FROM thf_decisiones
      WHERE ${cond.join(" AND ")}
      ORDER BY created_at DESC, id
      LIMIT $${vals.length}`,
    vals
  );
  return rows.map(aDecision);
}

export async function contarDecisionesPendientes(
  empresaId: string,
  ejecutor?: Ejecutor
): Promise<number> {
  const { rows } = await db(ejecutor).query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM thf_decisiones
      WHERE empresa_id = $1 AND estado = 'PENDIENTE'`,
    [empresaId]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Cierra la decisión. Devuelve `null` si otra sesión se adelantó. */
export async function cerrarDecision(
  empresaId: string,
  id: string,
  resolucion: {
    decision: string;
    motivo?: string | null;
    usuarioId?: string | null;
    usuarioNombre?: string | null;
  },
  ejecutor?: Ejecutor
): Promise<Decision | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_decisiones
        SET estado = 'DECIDIDA', decision = $3, motivo = $4,
            decidida_por_usuario_id = $5, decidida_por_nombre = $6, decidida_at = now()
      WHERE empresa_id = $1 AND id = $2 AND estado = 'PENDIENTE'
      RETURNING ${CAMPOS_DEC}`,
    [
      empresaId,
      id,
      resolucion.decision,
      resolucion.motivo ?? null,
      resolucion.usuarioId ?? null,
      resolucion.usuarioNombre ?? null,
    ]
  );
  return rows[0] ? aDecision(rows[0]) : null;
}

/* ── Análisis de documentos (fase 3b) ────────────────────────────────────── */

const CAMPOS_DOC = `
  id, empresa_id, expediente_id, adjunto_id, hash_archivo, tipo_documento,
  numero_documento, fecha_documento, proveedor_nombre, proveedor_nif,
  cliente_nombre, cliente_nif, base_centimos, iva_centimos, total_centimos,
  moneda, albaranes_detectados, origen, parser_usado, confianza, metadata_json,
  validacion, discrepancias, created_at, updated_at`;

export type Documento = {
  id: string;
  expedienteId: string;
  adjuntoId: string | null;
  hashArchivo: string;
  tipoDocumento: string;
  numeroDocumento: string | null;
  fechaDocumento: string | null;
  proveedorNombre: string | null;
  proveedorNif: string | null;
  baseCentimos: number | null;
  ivaCentimos: number | null;
  totalCentimos: number | null;
  albaranesDetectados: unknown[];
  origen: string | null;
  parserUsado: string | null;
  validacion: string;
  createdAt: string | null;
};

function aDocumento(r: QueryResultRow): Documento {
  return {
    id: String(r.id),
    expedienteId: String(r.expediente_id),
    adjuntoId: r.adjunto_id ? String(r.adjunto_id) : null,
    hashArchivo: String(r.hash_archivo),
    tipoDocumento: String(r.tipo_documento),
    numeroDocumento: r.numero_documento ? String(r.numero_documento) : null,
    fechaDocumento: aFecha(r.fecha_documento as Date | string | null),
    proveedorNombre: r.proveedor_nombre ? String(r.proveedor_nombre) : null,
    proveedorNif: r.proveedor_nif ? String(r.proveedor_nif) : null,
    baseCentimos: aEntero(r.base_centimos as string | number | null),
    ivaCentimos: aEntero(r.iva_centimos as string | number | null),
    totalCentimos: aEntero(r.total_centimos as string | number | null),
    albaranesDetectados: Array.isArray(r.albaranes_detectados) ? r.albaranes_detectados : [],
    origen: r.origen ? String(r.origen) : null,
    parserUsado: r.parser_usado ? String(r.parser_usado) : null,
    validacion: String(r.validacion),
    createdAt: aIso(r.created_at as Date | string | null),
  };
}

export type DatosDocumento = {
  adjuntoId: string | null;
  hashArchivo: string;
  tipoDocumento?: string;
  numeroDocumento?: string | null;
  fechaDocumento?: string | null;
  proveedorNombre?: string | null;
  proveedorNif?: string | null;
  baseCentimos?: number | null;
  ivaCentimos?: number | null;
  totalCentimos?: number | null;
  albaranesDetectados?: unknown[];
  origen?: string | null;
  parserUsado?: string | null;
  confianza?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  validacion?: string;
  discrepancias?: unknown[];
};

/**
 * Guarda la cabecera del documento. El mismo fichero se analiza una vez.
 *
 * Es un upsert y no un insert porque reanalizar tiene que poder actualizar lo
 * que se leyó del papel sin perder el id: las filas de análisis apuntan a él.
 */
export async function guardarDocumento(
  empresaId: string,
  expedienteId: string,
  datos: DatosDocumento,
  ejecutor?: Ejecutor
): Promise<Documento> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_documentos
       (empresa_id, expediente_id, adjunto_id, hash_archivo, tipo_documento,
        numero_documento, fecha_documento, proveedor_nombre, proveedor_nif,
        base_centimos, iva_centimos, total_centimos, albaranes_detectados,
        origen, parser_usado, confianza, metadata_json, validacion, discrepancias)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (expediente_id, hash_archivo) DO UPDATE SET
       tipo_documento = EXCLUDED.tipo_documento,
       numero_documento = EXCLUDED.numero_documento,
       fecha_documento = EXCLUDED.fecha_documento,
       proveedor_nombre = EXCLUDED.proveedor_nombre,
       proveedor_nif = EXCLUDED.proveedor_nif,
       base_centimos = EXCLUDED.base_centimos,
       iva_centimos = EXCLUDED.iva_centimos,
       total_centimos = EXCLUDED.total_centimos,
       albaranes_detectados = EXCLUDED.albaranes_detectados,
       origen = EXCLUDED.origen,
       parser_usado = EXCLUDED.parser_usado,
       confianza = EXCLUDED.confianza,
       metadata_json = EXCLUDED.metadata_json,
       validacion = EXCLUDED.validacion,
       discrepancias = EXCLUDED.discrepancias,
       updated_at = now()
     RETURNING ${CAMPOS_DOC}`,
    [
      empresaId,
      expedienteId,
      datos.adjuntoId,
      datos.hashArchivo,
      datos.tipoDocumento ?? "OTRO",
      datos.numeroDocumento ?? null,
      datos.fechaDocumento ?? null,
      datos.proveedorNombre ?? null,
      datos.proveedorNif ?? null,
      datos.baseCentimos ?? null,
      datos.ivaCentimos ?? null,
      datos.totalCentimos ?? null,
      JSON.stringify(datos.albaranesDetectados ?? []),
      datos.origen ?? null,
      datos.parserUsado ?? null,
      JSON.stringify(datos.confianza ?? {}),
      JSON.stringify(datos.metadata ?? {}),
      datos.validacion ?? "SIN_COMPARAR",
      JSON.stringify(datos.discrepancias ?? []),
    ]
  );
  return aDocumento(rows[0]);
}

export async function documentosDeExpediente(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<Documento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_DOC} FROM thf_documentos
      WHERE empresa_id = $1 AND expediente_id = $2 ORDER BY created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aDocumento);
}

const CAMPOS_ALB = `
  id, empresa_id, expediente_id, actuacion_id, adjunto_id, documento_id,
  numero_solicitado, numero_documento, numero_normalizado, confianza_match,
  resultado_match, fecha, matricula, bastidor, observaciones,
  importe_incidencia_centimos, importe_lineas_centimos, diferencia_centimos,
  estado_analisis, estado_proceso, intentos, error, pagina_inicio, pagina_fin,
  parser_usado, origen, metadata_json, created_at, updated_at`;

export type EstadoProcesoAnalisis = "PENDIENTE" | "PROCESANDO" | "COMPLETADO" | "ERROR";

export type AlbaranAnalizado = {
  id: string;
  empresaId: string;
  expedienteId: string;
  actuacionId: string;
  adjuntoId: string | null;
  documentoId: string | null;
  numeroSolicitado: string;
  numeroDocumento: string | null;
  numeroNormalizado: string | null;
  confianzaMatch: number | null;
  resultadoMatch: string | null;
  fecha: string | null;
  matricula: string | null;
  bastidor: string | null;
  observaciones: string | null;
  importeIncidenciaCentimos: number | null;
  importeLineasCentimos: number | null;
  diferenciaCentimos: number | null;
  estadoAnalisis: string | null;
  estadoProceso: EstadoProcesoAnalisis;
  intentos: number;
  error: string | null;
  paginaInicio: number | null;
  paginaFin: number | null;
  parserUsado: string | null;
  origen: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

function aAlbaranAnalizado(r: QueryResultRow): AlbaranAnalizado {
  return {
    id: String(r.id),
    empresaId: String(r.empresa_id),
    expedienteId: String(r.expediente_id),
    actuacionId: String(r.actuacion_id),
    adjuntoId: r.adjunto_id ? String(r.adjunto_id) : null,
    documentoId: r.documento_id ? String(r.documento_id) : null,
    numeroSolicitado: String(r.numero_solicitado),
    numeroDocumento: r.numero_documento ? String(r.numero_documento) : null,
    numeroNormalizado: r.numero_normalizado ? String(r.numero_normalizado) : null,
    confianzaMatch: r.confianza_match === null ? null : Number(r.confianza_match),
    resultadoMatch: r.resultado_match ? String(r.resultado_match) : null,
    fecha: aFecha(r.fecha as Date | string | null),
    matricula: r.matricula ? String(r.matricula) : null,
    bastidor: r.bastidor ? String(r.bastidor) : null,
    observaciones: r.observaciones ? String(r.observaciones) : null,
    importeIncidenciaCentimos: aEntero(r.importe_incidencia_centimos as string | number | null),
    importeLineasCentimos: aEntero(r.importe_lineas_centimos as string | number | null),
    diferenciaCentimos: aEntero(r.diferencia_centimos as string | number | null),
    estadoAnalisis: r.estado_analisis ? String(r.estado_analisis) : null,
    estadoProceso: String(r.estado_proceso) as EstadoProcesoAnalisis,
    intentos: Number(r.intentos ?? 0),
    error: r.error ? String(r.error) : null,
    paginaInicio: aEntero(r.pagina_inicio as string | number | null),
    paginaFin: aEntero(r.pagina_fin as string | number | null),
    parserUsado: r.parser_usado ? String(r.parser_usado) : null,
    origen: r.origen ? String(r.origen) : null,
    metadata: (r.metadata_json ?? {}) as Record<string, unknown>,
    createdAt: aIso(r.created_at as Date | string | null),
  };
}

/**
 * Pone un albarán en la cola de análisis.
 *
 * Se encola aunque todavía no haya PDF: la fila saldrá en ERROR «documento no
 * disponible» y se reencolará cuando llegue un adjunto. Es mejor que no
 * encolar: así la pantalla enseña que ese albarán ESPERA un documento, en vez
 * de no enseñar nada y parecer que no hacía falta ninguno.
 */
export async function encolarAnalisis(
  empresaId: string,
  expedienteId: string,
  actuacionId: string,
  numeroSolicitado: string,
  importeIncidenciaCentimos: number | null,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO thf_albaranes_analizados
       (empresa_id, expediente_id, actuacion_id, numero_solicitado,
        numero_normalizado, importe_incidencia_centimos)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${CAMPOS_ALB}`,
    [empresaId, expedienteId, actuacionId, numeroSolicitado, claveAlbaran(numeroSolicitado), importeIncidenciaCentimos]
  );
  return aAlbaranAnalizado(rows[0]);
}

/**
 * Coge UNA fila pendiente y la marca en curso, atómicamente.
 *
 * `FOR UPDATE SKIP LOCKED` dentro del propio UPDATE es lo que permite que haya
 * varias instancias: la que no reciba fila es que no la tenía. Sin él, en
 * Render dos procesos analizarían el mismo documento y el segundo machacaría
 * el resultado del primero.
 */
export async function cogerAnalisisPendiente(ejecutor?: Ejecutor): Promise<AlbaranAnalizado | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados
        SET estado_proceso = 'PROCESANDO',
            intentos = intentos + 1,
            procesando_desde = now(),
            updated_at = now()
      WHERE id = (
        SELECT id FROM thf_albaranes_analizados
         WHERE estado_proceso = 'PENDIENTE'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
     RETURNING ${CAMPOS_ALB}`
  );
  return rows[0] ? aAlbaranAnalizado(rows[0]) : null;
}

/**
 * Devuelve a la cola lo que lleva demasiado en curso.
 *
 * Una instancia que se reinicia a mitad deja su fila en PROCESANDO para
 * siempre, y ese albarán no lo vuelve a mirar nadie. No hay forma de
 * distinguir «se está procesando» de «se estaba procesando cuando el proceso
 * murió» salvo por el tiempo, así que se usa el tiempo.
 */
export async function reencolarHuerfanos(minutos = 10, ejecutor?: Ejecutor): Promise<number> {
  const { rowCount } = await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados
        SET estado_proceso = 'PENDIENTE', procesando_desde = NULL, updated_at = now()
      WHERE estado_proceso = 'PROCESANDO'
        AND procesando_desde < now() - ($1 || ' minutes')::interval`,
    [String(minutos)]
  );
  return rowCount ?? 0;
}

export type ResultadoAnalisis = {
  documentoId?: string | null;
  adjuntoId?: string | null;
  numeroDocumento?: string | null;
  numeroNormalizado?: string | null;
  confianzaMatch?: number | null;
  resultadoMatch?: string | null;
  fecha?: string | null;
  matricula?: string | null;
  bastidor?: string | null;
  observaciones?: string | null;
  importeLineasCentimos?: number | null;
  diferenciaCentimos?: number | null;
  estadoAnalisis?: string | null;
  paginaInicio?: number | null;
  paginaFin?: number | null;
  parserUsado?: string | null;
  origen?: string | null;
  metadata?: Record<string, unknown>;
};

export async function guardarResultadoAnalisis(
  id: string,
  estadoProceso: EstadoProcesoAnalisis,
  datos: ResultadoAnalisis,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados SET
        estado_proceso = $2,
        documento_id = COALESCE($3, documento_id),
        adjunto_id = COALESCE($4, adjunto_id),
        numero_documento = $5,
        numero_normalizado = COALESCE($6, numero_normalizado),
        confianza_match = $7,
        resultado_match = $8,
        fecha = $9,
        matricula = $10,
        bastidor = $11,
        observaciones = $12,
        importe_lineas_centimos = $13,
        diferencia_centimos = $14,
        estado_analisis = $15,
        pagina_inicio = $16,
        pagina_fin = $17,
        parser_usado = $18,
        origen = $19,
        metadata_json = $20,
        error = NULL,
        procesando_desde = NULL,
        updated_at = now()
      WHERE id = $1
      RETURNING ${CAMPOS_ALB}`,
    [
      id,
      estadoProceso,
      datos.documentoId ?? null,
      datos.adjuntoId ?? null,
      datos.numeroDocumento ?? null,
      datos.numeroNormalizado ?? null,
      datos.confianzaMatch ?? null,
      datos.resultadoMatch ?? null,
      datos.fecha ?? null,
      datos.matricula ?? null,
      datos.bastidor ?? null,
      datos.observaciones ?? null,
      datos.importeLineasCentimos ?? null,
      datos.diferenciaCentimos ?? null,
      datos.estadoAnalisis ?? null,
      datos.paginaInicio ?? null,
      datos.paginaFin ?? null,
      datos.parserUsado ?? null,
      datos.origen ?? null,
      JSON.stringify(datos.metadata ?? {}),
    ]
  );
  return rows[0] ? aAlbaranAnalizado(rows[0]) : null;
}

/**
 * Marca el fallo.
 *
 * `reintentable` separa las dos familias que el diseño distingue: un fallo
 * TÉCNICO (la IA no responde, el almacenamiento no contesta) vuelve a la cola
 * hasta agotar los intentos, y uno de DOMINIO (el albarán no está en el
 * documento) es terminal y se enseña. Reintentar el segundo sería repetir
 * tres veces la misma lectura correcta.
 */
export async function marcarErrorAnalisis(
  id: string,
  motivo: string,
  reintentable: boolean,
  maxIntentos: number,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados SET
        estado_proceso = CASE
          WHEN $3 AND intentos < $4 THEN 'PENDIENTE'
          ELSE 'ERROR' END,
        estado_analisis = CASE WHEN $3 AND intentos < $4 THEN estado_analisis ELSE 'ERROR' END,
        error = $2,
        procesando_desde = NULL,
        updated_at = now()
      WHERE id = $1
      RETURNING ${CAMPOS_ALB}`,
    [id, motivo.slice(0, 1000), reintentable, maxIntentos]
  );
  return rows[0] ? aAlbaranAnalizado(rows[0]) : null;
}

export async function albaranAnalizadoPorId(
  empresaId: string,
  id: string,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ALB} FROM thf_albaranes_analizados WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aAlbaranAnalizado(rows[0]) : null;
}

export async function albaranesDeExpediente(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ALB} FROM thf_albaranes_analizados
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aAlbaranAnalizado);
}

/**
 * Marca la fila anterior como sustituida por un reanálisis.
 *
 * No se borra: la comparación «antes y después» de un parser corregido es lo
 * que permite responder a «¿por qué ahora dice otra cosa?».
 */
export async function marcarSustituida(
  id: string,
  nuevaId: string,
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados
        SET metadata_json = metadata_json || jsonb_build_object('sustituidaPor', $2::text),
            updated_at = now()
      WHERE id = $1`,
    [id, nuevaId]
  );
}

export type LineaGuardada = {
  numeroLinea: number;
  referencia: string | null;
  descripcion: string | null;
  cantidad: number | null;
  precioUnitarioCentimos: number | null;
  importeCentimos: number | null;
  confianza: {
    referencia: number;
    descripcion: number;
    cantidad: number;
    precio: number;
    importe: number;
    descuentos: number;
  };
  cuadraAritmetica: boolean | null;
  descuentosRaw: string;
  descuentos: { orden: number; porcentaje: number; raw: string }[];
  rawText: string;
  pagina: number | null;
  bbox: unknown;
};

/**
 * Reemplaza las líneas de un análisis.
 *
 * Se borran y se vuelven a escribir en la misma transacción: un análisis
 * a medias —la mitad de las líneas viejas y la mitad de las nuevas— sumaría un
 * total que no es de ninguna de las dos lecturas.
 */
export async function guardarLineas(
  empresaId: string,
  albaranAnalizadoId: string,
  lineas: LineaGuardada[],
  ejecutor?: Ejecutor
): Promise<void> {
  const e = db(ejecutor);
  await e.query(`DELETE FROM thf_albaran_lineas WHERE albaran_analizado_id = $1`, [albaranAnalizadoId]);

  for (const l of lineas) {
    const { rows } = await e.query(
      `INSERT INTO thf_albaran_lineas
         (empresa_id, albaran_analizado_id, numero_linea, referencia, descripcion,
          cantidad, precio_unitario_centimos, importe_centimos,
          confianza_referencia, confianza_descripcion, confianza_cantidad,
          confianza_precio, confianza_importe, confianza_descuentos,
          cuadra_aritmetica, raw_text, pagina, bbox)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        empresaId,
        albaranAnalizadoId,
        l.numeroLinea,
        l.referencia,
        l.descripcion,
        l.cantidad,
        l.precioUnitarioCentimos,
        l.importeCentimos,
        l.confianza.referencia,
        l.confianza.descripcion,
        l.confianza.cantidad,
        l.confianza.precio,
        l.confianza.importe,
        l.confianza.descuentos,
        l.cuadraAritmetica,
        l.rawText,
        l.pagina,
        l.bbox === null || l.bbox === undefined ? null : JSON.stringify(l.bbox),
      ]
    );
    const lineaId = String(rows[0].id);
    for (const d of l.descuentos) {
      await e.query(
        `INSERT INTO thf_albaran_linea_descuentos (linea_id, orden, porcentaje, raw_value)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (linea_id, orden) DO NOTHING`,
        [lineaId, d.orden, d.porcentaje, d.raw]
      );
    }
  }
}

export type LineaConDescuentos = LineaGuardada & { id: string };

export async function lineasDeAlbaran(
  empresaId: string,
  albaranAnalizadoId: string,
  ejecutor?: Ejecutor
): Promise<LineaConDescuentos[]> {
  const e = db(ejecutor);
  const { rows } = await e.query(
    `SELECT l.*,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('orden', d.orden, 'porcentaje', d.porcentaje, 'raw', d.raw_value)
                                ORDER BY d.orden)
                 FROM thf_albaran_linea_descuentos d WHERE d.linea_id = l.id),
              '[]'::jsonb) AS descuentos
       FROM thf_albaran_lineas l
      WHERE l.empresa_id = $1 AND l.albaran_analizado_id = $2
      ORDER BY l.numero_linea`,
    [empresaId, albaranAnalizadoId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    numeroLinea: Number(r.numero_linea),
    referencia: r.referencia ? String(r.referencia) : null,
    descripcion: r.descripcion ? String(r.descripcion) : null,
    cantidad: r.cantidad === null ? null : Number(r.cantidad),
    precioUnitarioCentimos: aEntero(r.precio_unitario_centimos as string | number | null),
    importeCentimos: aEntero(r.importe_centimos as string | number | null),
    confianza: {
      referencia: Number(r.confianza_referencia ?? 0),
      descripcion: Number(r.confianza_descripcion ?? 0),
      cantidad: Number(r.confianza_cantidad ?? 0),
      precio: Number(r.confianza_precio ?? 0),
      importe: Number(r.confianza_importe ?? 0),
      descuentos: Number(r.confianza_descuentos ?? 0),
    },
    cuadraAritmetica: r.cuadra_aritmetica === null ? null : Boolean(r.cuadra_aritmetica),
    descuentosRaw: (r.descuentos as { raw: string }[]).map((d) => d.raw).join(" + "),
    descuentos: (r.descuentos as { orden: number; porcentaje: string | number; raw: string }[]).map((d) => ({
      orden: Number(d.orden),
      porcentaje: Number(d.porcentaje),
      raw: String(d.raw),
    })),
    rawText: String(r.raw_text),
    pagina: aEntero(r.pagina as string | number | null),
    bbox: r.bbox ?? null,
  }));
}

export type ValidacionGuardada = {
  tipo: string;
  estado: string;
  mensaje: string;
  valorEsperado: string | null;
  valorObtenido: string | null;
  metadata: Record<string, unknown>;
};

export type ValidacionFila = ValidacionGuardada & { id: string; albaranAnalizadoId: string | null };

/** Reemplaza las validaciones de un análisis: son el retrato de ESTA lectura. */
export async function guardarValidaciones(
  empresaId: string,
  expedienteId: string,
  actuacionId: string | null,
  albaranAnalizadoId: string,
  validaciones: ValidacionGuardada[],
  ejecutor?: Ejecutor
): Promise<void> {
  const e = db(ejecutor);
  await e.query(`DELETE FROM thf_validaciones WHERE albaran_analizado_id = $1`, [albaranAnalizadoId]);
  for (const v of validaciones) {
    await e.query(
      `INSERT INTO thf_validaciones
         (empresa_id, expediente_id, actuacion_id, albaran_analizado_id,
          tipo, estado, mensaje, valor_esperado, valor_obtenido, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        empresaId,
        expedienteId,
        actuacionId,
        albaranAnalizadoId,
        v.tipo,
        v.estado,
        v.mensaje,
        v.valorEsperado,
        v.valorObtenido,
        JSON.stringify(v.metadata ?? {}),
      ]
    );
  }
}

function aValidacion(r: QueryResultRow): ValidacionFila {
  return {
    id: String(r.id),
    albaranAnalizadoId: r.albaran_analizado_id ? String(r.albaran_analizado_id) : null,
    tipo: String(r.tipo),
    estado: String(r.estado),
    mensaje: String(r.mensaje),
    valorEsperado: r.valor_esperado ? String(r.valor_esperado) : null,
    valorObtenido: r.valor_obtenido ? String(r.valor_obtenido) : null,
    metadata: (r.metadata_json ?? {}) as Record<string, unknown>,
  };
}

export async function validacionesDeExpediente(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<ValidacionFila[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM thf_validaciones
      WHERE empresa_id = $1 AND expediente_id = $2
      ORDER BY created_at, id`,
    [empresaId, expedienteId]
  );
  return rows.map(aValidacion);
}

/** ¿Queda alguna validación sin resolver? Alimenta `requiere_revision`. */
export async function hayValidacionesVivas(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<boolean> {
  const { rows } = await db(ejecutor).query(
    `SELECT 1 FROM thf_validaciones
      WHERE empresa_id = $1 AND expediente_id = $2 AND estado <> 'OK' LIMIT 1`,
    [empresaId, expedienteId]
  );
  return rows.length > 0;
}

/**
 * Devuelve a la cola los análisis del expediente que fallaron.
 *
 * Se llama cuando llega un documento nuevo. Un análisis que falló por no tener
 * PDF —o por tener el que no era— merece otra oportunidad en cuanto aparece
 * otro papel; dejarlo en ERROR para siempre obligaría a pedirlo a mano justo
 * cuando por fin se podía hacer solo. Los intentos se ponen a cero: es una
 * situación nueva, no el mismo intento repetido.
 */
export async function reencolarDeExpediente(
  empresaId: string,
  expedienteId: string,
  ejecutor?: Ejecutor
): Promise<number> {
  const { rowCount } = await db(ejecutor).query(
    `UPDATE thf_albaranes_analizados
        SET estado_proceso = 'PENDIENTE', intentos = 0, error = NULL,
            procesando_desde = NULL, updated_at = now()
      WHERE empresa_id = $1 AND expediente_id = $2 AND estado_proceso = 'ERROR'`,
    [empresaId, expedienteId]
  );
  return rowCount ?? 0;
}

/** El último análisis vivo de una actuación, para saber si hay algo que rehacer. */
export async function ultimoAnalisisDeActuacion(
  empresaId: string,
  actuacionId: string,
  ejecutor?: Ejecutor
): Promise<AlbaranAnalizado | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_ALB} FROM thf_albaranes_analizados
      WHERE empresa_id = $1 AND actuacion_id = $2
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [empresaId, actuacionId]
  );
  return rows[0] ? aAlbaranAnalizado(rows[0]) : null;
}

/* ── Trabajo diario (fase 4b) ────────────────────────────────────────────── */

/** Las empresas que tienen algo abierto o resuelto: las únicas con trabajo diario. */
export async function empresasConTrabajoDiario(ejecutor?: Ejecutor): Promise<string[]> {
  const { rows } = await db(ejecutor).query<{ empresa_id: string }>(
    `SELECT DISTINCT empresa_id FROM thf_expedientes WHERE estado <> 'CERRADO'`
  );
  return rows.map((r) => String(r.empresa_id));
}

/**
 * Los expedientes abiertos cuya prioridad no se ha recalculado hoy.
 *
 * Sólo los abiertos: la prioridad de un resuelto no le importa a nadie, y
 * recalcularla cada día sería escribir filas para nada.
 */
export async function expedientesSinRecalcularHoy(
  empresaId: string,
  ejecutor?: Ejecutor
): Promise<Expediente[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_EXP} FROM thf_expedientes
      WHERE empresa_id = $1
        AND estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO')
        AND (recalculado_el IS NULL OR recalculado_el < CURRENT_DATE)
      ORDER BY created_at`,
    [empresaId]
  );
  return rows.map(aExpediente);
}

export async function marcarRecalculadoHoy(
  empresaId: string,
  ids: readonly string[],
  ejecutor?: Ejecutor
): Promise<void> {
  if (ids.length === 0) return;
  await db(ejecutor).query(
    `UPDATE thf_expedientes SET recalculado_el = CURRENT_DATE
      WHERE empresa_id = $1 AND id = ANY($2)`,
    [empresaId, ids]
  );
}

/**
 * Los RESUELTO que llevan al menos `dias` días así y no esperan a nadie.
 *
 * Se excluyen los que tienen una decisión pendiente: una reclamación sobre un
 * expediente resuelto deja una pregunta abierta (caso 24), y cerrar por
 * antigüedad algo que alguien todavía tiene que contestar sería enterrar la
 * pregunta con el expediente.
 */
export async function resueltosParaCerrar(
  empresaId: string,
  dias: number,
  ejecutor?: Ejecutor
): Promise<Expediente[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT ${CAMPOS_EXP} FROM thf_expedientes e
      WHERE e.empresa_id = $1
        AND e.estado = 'RESUELTO'
        AND e.fecha_resolucion IS NOT NULL
        AND e.fecha_resolucion < now() - ($2 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM thf_decisiones d
           WHERE d.expediente_id = e.id AND d.estado = 'PENDIENTE')
      ORDER BY e.fecha_resolucion`,
    [empresaId, String(dias)]
  );
  return rows.map(aExpediente);
}
