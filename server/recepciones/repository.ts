/**
 * Acceso a datos del módulo Recepciones.
 *
 * Todas las consultas llevan `empresa_id` en el WHERE, sin excepción: es una
 * base multiempresa y el aislamiento vive en las consultas, no en el panel.
 * Buscar por id sin acertar la empresa devuelve `null`, que el router traduce
 * a 404 y no a 403.
 *
 * Las funciones que escriben aceptan un `Ejecutor` —el pool o un cliente de
 * transacción— para que el servicio pueda meter la recepción, sus líneas, las
 * incidencias, los acumulados y el histórico en la MISMA transacción.
 *
 * Aquí no hay ninguna consulta a `movimientos_stock` ni a ninguna tabla del
 * almacén: este módulo no gestiona existencias.
 */

import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import pool from "../db.ts";
import { numero } from "./domain/cantidades.ts";
import type { EstadoAlbaran, EstadoIncidencia, EstadoPedido, ResultadoRecepcion, TipoIncidencia } from "./domain/estados.ts";

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

export type Proveedor = {
  id: string;
  codigo: string;
  nombre: string;
  nif: string | null;
  remitentesCorreo: string[];
  activo: boolean;
};

export type MapeoArticulo = {
  id: string;
  proveedorId: string;
  referenciaProveedor: string | null;
  descripcionProveedor: string;
  descripcionNormalizada: string;
  productoId: string | null;
  productoTexto: string | null;
  ean: string | null;
  estado: string;
  vecesUsado: number;
};

export type Pedido = {
  id: string;
  proveedorId: string;
  proveedorCodigo: string;
  proveedorNombre: string;
  numeroProveedor: string;
  numeroNormalizado: string;
  fechaPedido: string | null;
  usuarioPedido: string | null;
  centroId: string | null;
  centroNombre: string;
  almacenOrigen: string | null;
  transportista: string | null;
  estado: EstadoPedido;
  canceladoAt: string | null;
  canceladoMotivo: string | null;
  observaciones: string | null;
  origen: string;
  creadoNombre: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PedidoLinea = {
  id: string;
  pedidoId: string;
  numeroLinea: number;
  referenciaProveedor: string | null;
  descripcionProveedor: string;
  productoId: string | null;
  productoTexto: string | null;
  cantidadPedida: number;
  cantidadExpedida: number;
  cantidadRecibida: number;
  precioUnitarioCentimos: number | null;
};

export type Albaran = {
  id: string;
  pedidoId: string;
  proveedorId: string;
  proveedorCodigo: string;
  proveedorNombre: string;
  pedidoNumero: string;
  numeroProveedor: string;
  numeroNormalizado: string;
  fechaExpedicion: string | null;
  transportista: string | null;
  estado: EstadoAlbaran;
  cerradoAt: string | null;
  cerradoMotivo: string | null;
  observaciones: string | null;
  origen: string;
  centroId: string | null;
  centroNombre: string;
  creadoNombre: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AlbaranLinea = {
  id: string;
  albaranId: string;
  pedidoLineaId: string | null;
  numeroLinea: number;
  referenciaProveedor: string | null;
  descripcionProveedor: string;
  productoId: string | null;
  productoTexto: string | null;
  cantidadExpedida: number;
  cantidadRecibida: number;
  /** De la línea de pedido, si la hay. */
  cantidadPedida: number | null;
};

export type Recepcion = {
  id: string;
  numero: string;
  albaranId: string;
  pedidoId: string;
  proveedorId: string;
  centroId: string | null;
  centroNombre: string;
  resultado: ResultadoRecepcion;
  recibidoPor: string;
  recibidoNombre: string;
  recibidoAt: string;
  observaciones: string | null;
  documentoId: string | null;
  documentoEstado: string;
  documentoError: string | null;
  createdAt: string;
};

export type RecepcionLinea = {
  id: string;
  recepcionId: string;
  albaranLineaId: string;
  descripcionProveedor: string;
  productoTexto: string | null;
  cantidadExpedida: number;
  cantidadEsperada: number;
  cantidadRecibida: number;
  diferencia: number;
};

export type Incidencia = {
  id: string;
  recepcionId: string;
  recepcionLineaId: string | null;
  albaranId: string;
  albaranLineaId: string | null;
  pedidoId: string;
  proveedorId: string;
  proveedorNombre: string;
  albaranNumero: string;
  pedidoNumero: string;
  recepcionNumero: string;
  centroId: string | null;
  centroNombre: string;
  transportista: string | null;
  tipo: TipoIncidencia;
  descripcionProducto: string;
  cantidadEsperada: number;
  cantidadRecibida: number;
  diferencia: number;
  observaciones: string | null;
  estado: EstadoIncidencia;
  resolucion: string | null;
  creadaNombre: string;
  resueltaNombre: string | null;
  resueltaAt: string | null;
  createdAt: string;
};

export type Documento = {
  id: string;
  tipo: string;
  albaranId: string | null;
  recepcionId: string | null;
  nombreFichero: string;
  storagePath: string;
  hashSha256: string;
  tamanoBytes: number;
  mime: string;
  origen: string;
  subidoNombre: string | null;
  createdAt: string;
};

export type Rectificacion = {
  id: string;
  numero: string;
  recepcionId: string;
  albaranId: string;
  motivo: string;
  rectificadoNombre: string;
  rectificadoAt: string;
  lineas: { recepcionLineaId: string; albaranLineaId: string; cantidadAnterior: number; cantidadNueva: number }[];
};

export type Evento = {
  id: number;
  pedidoId: string | null;
  albaranId: string | null;
  recepcionId: string | null;
  incidenciaId: string | null;
  tipo: string;
  actorTipo: string;
  usuarioNombre: string | null;
  datos: unknown;
  descripcion: string;
  occurredAt: string;
};

/* ── Filas → tipos ───────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: any): string | null => (v instanceof Date ? v.toISOString() : v ?? null);
const fecha = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const aProveedor = (r: any): Proveedor => ({
  id: r.id,
  codigo: r.codigo,
  nombre: r.nombre,
  nif: r.nif ?? null,
  remitentesCorreo: r.remitentes_correo ?? [],
  activo: Boolean(r.activo),
});

const aMapeo = (r: any): MapeoArticulo => ({
  id: r.id,
  proveedorId: r.proveedor_id,
  referenciaProveedor: r.referencia_proveedor ?? null,
  descripcionProveedor: r.descripcion_proveedor,
  descripcionNormalizada: r.descripcion_normalizada,
  productoId: r.producto_id ?? null,
  productoTexto: r.producto_texto ?? null,
  ean: r.ean ?? null,
  estado: r.estado,
  vecesUsado: Number(r.veces_usado ?? 0),
});

const aPedido = (r: any): Pedido => ({
  id: r.id,
  proveedorId: r.proveedor_id,
  proveedorCodigo: r.proveedor_codigo,
  proveedorNombre: r.proveedor_nombre,
  numeroProveedor: r.numero_proveedor,
  numeroNormalizado: r.numero_normalizado,
  fechaPedido: fecha(r.fecha_pedido),
  usuarioPedido: r.usuario_pedido ?? null,
  centroId: r.centro_id ?? null,
  centroNombre: r.centro_nombre ?? "",
  almacenOrigen: r.almacen_origen ?? null,
  transportista: r.transportista ?? null,
  estado: r.estado,
  canceladoAt: iso(r.cancelado_at),
  canceladoMotivo: r.cancelado_motivo ?? null,
  observaciones: r.observaciones ?? null,
  origen: r.origen,
  creadoNombre: r.creado_nombre ?? null,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const aPedidoLinea = (r: any): PedidoLinea => ({
  id: r.id,
  pedidoId: r.pedido_id,
  numeroLinea: Number(r.numero_linea),
  referenciaProveedor: r.referencia_proveedor ?? null,
  descripcionProveedor: r.descripcion_proveedor,
  productoId: r.producto_id ?? null,
  productoTexto: r.producto_texto ?? null,
  cantidadPedida: numero(r.cantidad_pedida),
  cantidadExpedida: numero(r.cantidad_expedida),
  cantidadRecibida: numero(r.cantidad_recibida),
  precioUnitarioCentimos: r.precio_unitario_centimos == null ? null : Number(r.precio_unitario_centimos),
});

const aAlbaran = (r: any): Albaran => ({
  id: r.id,
  pedidoId: r.pedido_id,
  proveedorId: r.proveedor_id,
  proveedorCodigo: r.proveedor_codigo,
  proveedorNombre: r.proveedor_nombre,
  pedidoNumero: r.pedido_numero,
  numeroProveedor: r.numero_proveedor,
  numeroNormalizado: r.numero_normalizado,
  fechaExpedicion: fecha(r.fecha_expedicion),
  transportista: r.transportista ?? null,
  estado: r.estado,
  cerradoAt: iso(r.cerrado_at),
  cerradoMotivo: r.cerrado_motivo ?? null,
  observaciones: r.observaciones ?? null,
  origen: r.origen,
  centroId: r.centro_id ?? null,
  centroNombre: r.centro_nombre ?? "",
  creadoNombre: r.creado_nombre ?? null,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const aAlbaranLinea = (r: any): AlbaranLinea => ({
  id: r.id,
  albaranId: r.albaran_id,
  pedidoLineaId: r.pedido_linea_id ?? null,
  numeroLinea: Number(r.numero_linea),
  referenciaProveedor: r.referencia_proveedor ?? null,
  descripcionProveedor: r.descripcion_proveedor,
  productoId: r.producto_id ?? null,
  productoTexto: r.producto_texto ?? null,
  cantidadExpedida: numero(r.cantidad_expedida),
  cantidadRecibida: numero(r.cantidad_recibida),
  cantidadPedida: r.cantidad_pedida == null ? null : numero(r.cantidad_pedida),
});

const aRecepcion = (r: any): Recepcion => ({
  id: r.id,
  numero: r.numero,
  albaranId: r.albaran_id,
  pedidoId: r.pedido_id,
  proveedorId: r.proveedor_id,
  centroId: r.centro_id ?? null,
  centroNombre: r.centro_nombre ?? "",
  resultado: r.resultado,
  recibidoPor: r.recibido_por,
  recibidoNombre: r.recibido_nombre,
  recibidoAt: iso(r.recibido_at)!,
  observaciones: r.observaciones ?? null,
  documentoId: r.documento_id ?? null,
  documentoEstado: r.documento_estado,
  documentoError: r.documento_error ?? null,
  createdAt: iso(r.created_at)!,
});

const aRecepcionLinea = (r: any): RecepcionLinea => ({
  id: r.id,
  recepcionId: r.recepcion_id,
  albaranLineaId: r.albaran_linea_id,
  descripcionProveedor: r.descripcion_proveedor,
  productoTexto: r.producto_texto ?? null,
  cantidadExpedida: numero(r.cantidad_expedida),
  cantidadEsperada: numero(r.cantidad_esperada),
  cantidadRecibida: numero(r.cantidad_recibida),
  diferencia: numero(r.diferencia),
});

const aIncidencia = (r: any): Incidencia => ({
  id: r.id,
  recepcionId: r.recepcion_id,
  recepcionLineaId: r.recepcion_linea_id ?? null,
  albaranId: r.albaran_id,
  albaranLineaId: r.albaran_linea_id ?? null,
  pedidoId: r.pedido_id,
  proveedorId: r.proveedor_id,
  proveedorNombre: r.proveedor_nombre ?? "",
  albaranNumero: r.albaran_numero ?? "",
  pedidoNumero: r.pedido_numero ?? "",
  recepcionNumero: r.recepcion_numero ?? "",
  centroId: r.centro_id ?? null,
  centroNombre: r.centro_nombre ?? "",
  transportista: r.transportista ?? null,
  tipo: r.tipo,
  descripcionProducto: r.descripcion_producto,
  cantidadEsperada: numero(r.cantidad_esperada),
  cantidadRecibida: numero(r.cantidad_recibida),
  diferencia: numero(r.diferencia),
  observaciones: r.observaciones ?? null,
  estado: r.estado,
  resolucion: r.resolucion ?? null,
  creadaNombre: r.creada_nombre,
  resueltaNombre: r.resuelta_nombre ?? null,
  resueltaAt: iso(r.resuelta_at),
  createdAt: iso(r.created_at)!,
});

const aDocumento = (r: any): Documento => ({
  id: r.id,
  tipo: r.tipo,
  albaranId: r.albaran_id ?? null,
  recepcionId: r.recepcion_id ?? null,
  nombreFichero: r.nombre_fichero,
  storagePath: r.storage_path,
  hashSha256: r.hash_sha256,
  tamanoBytes: Number(r.tamano_bytes),
  mime: r.mime,
  origen: r.origen,
  subidoNombre: r.subido_nombre ?? null,
  createdAt: iso(r.created_at)!,
});

const aEvento = (r: any): Evento => ({
  id: Number(r.id),
  pedidoId: r.pedido_id ?? null,
  albaranId: r.albaran_id ?? null,
  recepcionId: r.recepcion_id ?? null,
  incidenciaId: r.incidencia_id ?? null,
  tipo: r.tipo,
  actorTipo: r.actor_tipo,
  usuarioNombre: r.usuario_nombre ?? null,
  datos: r.datos ?? null,
  descripcion: r.descripcion ?? "",
  occurredAt: iso(r.occurred_at)!,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Numeración ──────────────────────────────────────────────────────────── */

/**
 * El siguiente número de la serie, de forma atómica: `REC-2026-00018452`,
 * `RECT-2026-00007`. El `INSERT … ON CONFLICT DO UPDATE … RETURNING` incrementa
 * y devuelve en la misma sentencia, así que dos cierres a la vez no pueden
 * coger el mismo; y el UNIQUE de (empresa_id, numero) es el segundo cerrojo.
 */
export async function siguienteNumero(
  empresaId: string,
  serie: "REC" | "RECT",
  ejecutor?: Ejecutor,
  fecha = new Date()
): Promise<string> {
  const anio = fecha.getFullYear();
  const { rows } = await db(ejecutor).query<{ last_seq: number }>(
    `INSERT INTO rcp_contadores (empresa_id, serie, anio, last_seq)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (empresa_id, serie, anio)
       DO UPDATE SET last_seq = rcp_contadores.last_seq + 1
     RETURNING last_seq`,
    [empresaId, serie, anio]
  );
  const ancho = serie === "REC" ? 8 : 5;
  return `${serie}-${anio}-${String(rows[0].last_seq).padStart(ancho, "0")}`;
}

/* ── Proveedores ─────────────────────────────────────────────────────────── */

export async function listarProveedores(empresaId: string, ejecutor?: Ejecutor): Promise<Proveedor[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_proveedores WHERE empresa_id = $1 ORDER BY activo DESC, nombre`,
    [empresaId]
  );
  return rows.map(aProveedor);
}

export async function proveedorPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Proveedor | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_proveedores WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id]
  );
  return rows[0] ? aProveedor(rows[0]) : null;
}

export async function crearProveedor(
  empresaId: string,
  datos: { codigo: string; nombre: string; nif: string | null; remitentesCorreo: string[] },
  ejecutor?: Ejecutor
): Promise<Proveedor> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_proveedores (empresa_id, codigo, nombre, nif, remitentes_correo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [empresaId, datos.codigo, datos.nombre, datos.nif, datos.remitentesCorreo]
  );
  return aProveedor(rows[0]);
}

export async function actualizarProveedor(
  empresaId: string,
  id: string,
  datos: Partial<{ nombre: string; nif: string | null; remitentesCorreo: string[]; activo: boolean }>,
  ejecutor?: Ejecutor
): Promise<Proveedor | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE rcp_proveedores
        SET nombre = COALESCE($3, nombre),
            nif = CASE WHEN $4::text IS NULL THEN nif ELSE NULLIF($4, '') END,
            remitentes_correo = COALESCE($5, remitentes_correo),
            activo = COALESCE($6, activo),
            updated_at = now()
      WHERE empresa_id = $1 AND id = $2
      RETURNING *`,
    [empresaId, id, datos.nombre ?? null, datos.nif === undefined ? null : datos.nif ?? "", datos.remitentesCorreo ?? null, datos.activo ?? null]
  );
  return rows[0] ? aProveedor(rows[0]) : null;
}

/* ── Mapeo de artículos ──────────────────────────────────────────────────── */

export async function mapeoConfirmado(
  empresaId: string,
  proveedorId: string,
  descripcionNormalizada: string,
  ejecutor?: Ejecutor
): Promise<MapeoArticulo | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_proveedor_articulos
      WHERE empresa_id = $1 AND proveedor_id = $2 AND descripcion_normalizada = $3
        AND estado = 'CONFIRMADO'`,
    [empresaId, proveedorId, descripcionNormalizada]
  );
  return rows[0] ? aMapeo(rows[0]) : null;
}

export async function listarMapeos(empresaId: string, proveedorId?: string, ejecutor?: Ejecutor): Promise<MapeoArticulo[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_proveedor_articulos
      WHERE empresa_id = $1 AND ($2::uuid IS NULL OR proveedor_id = $2)
      ORDER BY descripcion_proveedor`,
    [empresaId, proveedorId ?? null]
  );
  return rows.map(aMapeo);
}

export async function guardarMapeo(
  empresaId: string,
  datos: {
    proveedorId: string;
    referenciaProveedor: string | null;
    descripcionProveedor: string;
    descripcionNormalizada: string;
    productoId: string | null;
    productoTexto: string | null;
    ean: string | null;
    userId: string;
    userNombre: string;
  },
  ejecutor?: Ejecutor
): Promise<MapeoArticulo> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_proveedor_articulos
       (empresa_id, proveedor_id, referencia_proveedor, descripcion_proveedor, descripcion_normalizada,
        producto_id, producto_texto, ean, estado, confirmado_por, confirmado_nombre, confirmado_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CONFIRMADO', $9, $10, now())
     ON CONFLICT (empresa_id, proveedor_id, descripcion_normalizada) DO UPDATE SET
       referencia_proveedor = EXCLUDED.referencia_proveedor,
       producto_id = EXCLUDED.producto_id,
       producto_texto = EXCLUDED.producto_texto,
       ean = EXCLUDED.ean,
       estado = 'CONFIRMADO',
       confirmado_por = EXCLUDED.confirmado_por,
       confirmado_nombre = EXCLUDED.confirmado_nombre,
       confirmado_at = now(),
       updated_at = now()
     RETURNING *`,
    [
      empresaId,
      datos.proveedorId,
      datos.referenciaProveedor,
      datos.descripcionProveedor,
      datos.descripcionNormalizada,
      datos.productoId,
      datos.productoTexto,
      datos.ean,
      datos.userId,
      datos.userNombre,
    ]
  );
  return aMapeo(rows[0]);
}

export async function contarUsoMapeo(id: string, ejecutor?: Ejecutor): Promise<void> {
  await db(ejecutor).query(
    `UPDATE rcp_proveedor_articulos SET veces_usado = veces_usado + 1, updated_at = now() WHERE id = $1`,
    [id]
  );
}

/** Aplica un mapeo recién confirmado a las líneas que aún no tienen artículo. */
export async function aplicarMapeoALineas(
  empresaId: string,
  proveedorId: string,
  mapeo: MapeoArticulo,
  ejecutor?: Ejecutor
): Promise<void> {
  const e = db(ejecutor);
  await e.query(
    `UPDATE rcp_pedido_lineas l SET producto_id = $3, producto_texto = $4, mapeo_id = $5
       FROM rcp_pedidos p
      WHERE l.pedido_id = p.id AND l.empresa_id = $1 AND p.proveedor_id = $2
        AND l.producto_id IS NULL AND l.mapeo_id IS NULL
        AND upper(regexp_replace(l.descripcion_proveedor, '\\s+', ' ', 'g')) = upper($6)`,
    [empresaId, proveedorId, mapeo.productoId, mapeo.productoTexto, mapeo.id, mapeo.descripcionProveedor.trim()]
  );
  await e.query(
    `UPDATE rcp_albaran_lineas l SET producto_id = $3, producto_texto = $4
       FROM rcp_albaranes a
      WHERE l.albaran_id = a.id AND l.empresa_id = $1 AND a.proveedor_id = $2
        AND l.producto_id IS NULL
        AND upper(regexp_replace(l.descripcion_proveedor, '\\s+', ' ', 'g')) = upper($5)`,
    [empresaId, proveedorId, mapeo.productoId, mapeo.productoTexto, mapeo.descripcionProveedor.trim()]
  );
}

/* ── Pedidos ─────────────────────────────────────────────────────────────── */

const SELECT_PEDIDO = `
  SELECT p.*, pr.codigo AS proveedor_codigo, pr.nombre AS proveedor_nombre
    FROM rcp_pedidos p
    JOIN rcp_proveedores pr ON pr.id = p.proveedor_id`;

export async function pedidoPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Pedido | null> {
  const { rows } = await db(ejecutor).query(`${SELECT_PEDIDO} WHERE p.empresa_id = $1 AND p.id = $2`, [empresaId, id]);
  return rows[0] ? aPedido(rows[0]) : null;
}

export async function pedidoPorNumero(
  empresaId: string,
  proveedorId: string,
  numeroNormalizado: string,
  ejecutor?: Ejecutor
): Promise<Pedido | null> {
  const { rows } = await db(ejecutor).query(
    `${SELECT_PEDIDO} WHERE p.empresa_id = $1 AND p.proveedor_id = $2 AND p.numero_normalizado = $3`,
    [empresaId, proveedorId, numeroNormalizado]
  );
  return rows[0] ? aPedido(rows[0]) : null;
}

export type FiltroPedidos = {
  estado?: string;
  centroId?: string | null;
  proveedorId?: string;
  texto?: string;
  limite?: number;
};

export async function listarPedidos(empresaId: string, f: FiltroPedidos, ejecutor?: Ejecutor): Promise<Pedido[]> {
  const params: unknown[] = [empresaId];
  const cond: string[] = ["p.empresa_id = $1"];
  if (f.estado) {
    params.push(f.estado);
    cond.push(`p.estado = $${params.length}`);
  }
  if (f.centroId) {
    params.push(f.centroId);
    cond.push(`p.centro_id = $${params.length}`);
  }
  if (f.proveedorId) {
    params.push(f.proveedorId);
    cond.push(`p.proveedor_id = $${params.length}`);
  }
  if (f.texto) {
    params.push(`%${f.texto}%`);
    const n = params.length;
    cond.push(`(p.numero_proveedor ILIKE $${n}
      OR EXISTS (SELECT 1 FROM rcp_albaranes a WHERE a.pedido_id = p.id AND a.numero_proveedor ILIKE $${n})
      OR EXISTS (SELECT 1 FROM rcp_pedido_lineas l WHERE l.pedido_id = p.id
                   AND (l.descripcion_proveedor ILIKE $${n} OR l.producto_texto ILIKE $${n} OR l.referencia_proveedor ILIKE $${n})))`);
  }
  params.push(Math.min(Math.max(f.limite ?? 200, 1), 500));
  const { rows } = await db(ejecutor).query(
    `${SELECT_PEDIDO} WHERE ${cond.join(" AND ")} ORDER BY p.created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(aPedido);
}

export async function crearPedido(
  empresaId: string,
  datos: {
    proveedorId: string;
    numeroProveedor: string;
    numeroNormalizado: string;
    fechaPedido: string | null;
    usuarioPedido: string | null;
    centroId: string | null;
    centroNombre: string;
    almacenOrigen: string | null;
    transportista: string | null;
    observaciones: string | null;
    origen: "MANUAL" | "CORREO";
    externalMessageId?: string | null;
    sourceReceivedAt?: string | null;
    creadoPor: string | null;
    creadoNombre: string | null;
  },
  ejecutor?: Ejecutor
): Promise<Pedido> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_pedidos
       (empresa_id, proveedor_id, numero_proveedor, numero_normalizado, fecha_pedido, usuario_pedido,
        centro_id, centro_nombre, almacen_origen, transportista, observaciones, origen,
        external_message_id, source_received_at, creado_por, creado_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      empresaId,
      datos.proveedorId,
      datos.numeroProveedor,
      datos.numeroNormalizado,
      datos.fechaPedido,
      datos.usuarioPedido,
      datos.centroId,
      datos.centroNombre,
      datos.almacenOrigen,
      datos.transportista,
      datos.observaciones,
      datos.origen,
      datos.externalMessageId ?? null,
      datos.sourceReceivedAt ?? null,
      datos.creadoPor,
      datos.creadoNombre,
    ]
  );
  return (await pedidoPorId(empresaId, rows[0].id, ejecutor))!;
}

export async function crearPedidoLinea(
  empresaId: string,
  datos: {
    pedidoId: string;
    numeroLinea: number;
    referenciaProveedor: string | null;
    descripcionProveedor: string;
    productoId: string | null;
    productoTexto: string | null;
    mapeoId: string | null;
    cantidadPedida: number;
    precioUnitarioCentimos: number | null;
  },
  ejecutor?: Ejecutor
): Promise<PedidoLinea> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_pedido_lineas
       (empresa_id, pedido_id, numero_linea, referencia_proveedor, descripcion_proveedor,
        producto_id, producto_texto, mapeo_id, cantidad_pedida, precio_unitario_centimos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      empresaId,
      datos.pedidoId,
      datos.numeroLinea,
      datos.referenciaProveedor,
      datos.descripcionProveedor,
      datos.productoId,
      datos.productoTexto,
      datos.mapeoId,
      datos.cantidadPedida,
      datos.precioUnitarioCentimos,
    ]
  );
  return aPedidoLinea(rows[0]);
}

export async function lineasDePedido(
  empresaId: string,
  pedidoId: string,
  ejecutor?: Ejecutor,
  bloquear = false
): Promise<PedidoLinea[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_pedido_lineas WHERE empresa_id = $1 AND pedido_id = $2
      ORDER BY numero_linea ${bloquear ? "FOR UPDATE" : ""}`,
    [empresaId, pedidoId]
  );
  return rows.map(aPedidoLinea);
}

/** Bloquea la fila del pedido dentro de una transacción. */
export async function bloquearPedido(empresaId: string, id: string, cliente: Ejecutor): Promise<Pedido | null> {
  await cliente.query(`SELECT id FROM rcp_pedidos WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [empresaId, id]);
  return pedidoPorId(empresaId, id, cliente);
}

/**
 * Recalcula los acumulados de las líneas del pedido a partir de sus albaranes.
 * Se llama dentro de la transacción que cambió algo; el estado derivado lo
 * fija el servicio después, con `fijarEstadoPedido`.
 */
export async function recalcularLineasPedido(empresaId: string, pedidoId: string, cliente: Ejecutor): Promise<void> {
  await cliente.query(
    `UPDATE rcp_pedido_lineas l SET
        cantidad_expedida = COALESCE((SELECT SUM(al.cantidad_expedida) FROM rcp_albaran_lineas al WHERE al.pedido_linea_id = l.id), 0),
        cantidad_recibida = COALESCE((SELECT SUM(al.cantidad_recibida) FROM rcp_albaran_lineas al WHERE al.pedido_linea_id = l.id), 0)
      WHERE l.empresa_id = $1 AND l.pedido_id = $2`,
    [empresaId, pedidoId]
  );
}

export async function fijarEstadoPedido(empresaId: string, pedidoId: string, estado: EstadoPedido, cliente: Ejecutor): Promise<void> {
  await cliente.query(
    `UPDATE rcp_pedidos SET estado = $3, updated_at = now() WHERE empresa_id = $1 AND id = $2`,
    [empresaId, pedidoId, estado]
  );
}

export async function cancelarPedido(
  empresaId: string,
  id: string,
  datos: { userId: string; motivo: string },
  cliente: Ejecutor
): Promise<void> {
  await cliente.query(
    `UPDATE rcp_pedidos SET estado = 'CANCELADO', cancelado_at = now(), cancelado_por = $3, cancelado_motivo = $4, updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id, datos.userId, datos.motivo]
  );
}

/* ── Albaranes ───────────────────────────────────────────────────────────── */

const SELECT_ALBARAN = `
  SELECT a.*, pr.codigo AS proveedor_codigo, pr.nombre AS proveedor_nombre,
         p.numero_proveedor AS pedido_numero, p.centro_id, p.centro_nombre
    FROM rcp_albaranes a
    JOIN rcp_proveedores pr ON pr.id = a.proveedor_id
    JOIN rcp_pedidos p ON p.id = a.pedido_id`;

export async function albaranPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Albaran | null> {
  const { rows } = await db(ejecutor).query(`${SELECT_ALBARAN} WHERE a.empresa_id = $1 AND a.id = $2`, [empresaId, id]);
  return rows[0] ? aAlbaran(rows[0]) : null;
}

/** Bloquea la fila del albarán: es el cerrojo del cierre de recepción. */
export async function bloquearAlbaran(empresaId: string, id: string, cliente: Ejecutor): Promise<Albaran | null> {
  await cliente.query(`SELECT id FROM rcp_albaranes WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [empresaId, id]);
  return albaranPorId(empresaId, id, cliente);
}

export async function albaranesDePedido(empresaId: string, pedidoId: string, ejecutor?: Ejecutor): Promise<Albaran[]> {
  const { rows } = await db(ejecutor).query(
    `${SELECT_ALBARAN} WHERE a.empresa_id = $1 AND a.pedido_id = $2 ORDER BY a.created_at`,
    [empresaId, pedidoId]
  );
  return rows.map(aAlbaran);
}

export type FiltroAlbaranes = {
  /** `pendientes` = recibibles; `recibidos` = los demás; vacío = todos. */
  pestana?: "pendientes" | "recibidos" | "";
  estado?: string;
  centroId?: string | null;
  proveedorId?: string;
  texto?: string;
  limite?: number;
};

export type FilaBandeja = Albaran & {
  unidadesExpedidas: number;
  unidadesRecibidas: number;
  lineas: number;
  incidenciasAbiertas: number;
};

export async function listarAlbaranes(empresaId: string, f: FiltroAlbaranes, ejecutor?: Ejecutor): Promise<FilaBandeja[]> {
  const params: unknown[] = [empresaId];
  const cond: string[] = ["a.empresa_id = $1"];
  if (f.pestana === "pendientes") cond.push(`a.estado IN ('EMITIDO','EN_TRANSITO','PARCIALMENTE_RECIBIDO')`);
  if (f.pestana === "recibidos") cond.push(`a.estado IN ('RECIBIDO','RECIBIDO_CON_INCIDENCIA')`);
  if (f.estado) {
    params.push(f.estado);
    cond.push(`a.estado = $${params.length}`);
  }
  if (f.centroId) {
    params.push(f.centroId);
    cond.push(`p.centro_id = $${params.length}`);
  }
  if (f.proveedorId) {
    params.push(f.proveedorId);
    cond.push(`a.proveedor_id = $${params.length}`);
  }
  if (f.texto) {
    params.push(`%${f.texto}%`);
    const n = params.length;
    cond.push(`(a.numero_proveedor ILIKE $${n} OR p.numero_proveedor ILIKE $${n} OR a.transportista ILIKE $${n}
      OR EXISTS (SELECT 1 FROM rcp_albaran_lineas l WHERE l.albaran_id = a.id
                   AND (l.descripcion_proveedor ILIKE $${n} OR l.producto_texto ILIKE $${n} OR l.referencia_proveedor ILIKE $${n})))`);
  }
  params.push(Math.min(Math.max(f.limite ?? 200, 1), 500));
  const { rows } = await db(ejecutor).query(
    `${SELECT_ALBARAN.replace("SELECT a.*", `SELECT a.*,
         (SELECT COALESCE(SUM(l.cantidad_expedida),0) FROM rcp_albaran_lineas l WHERE l.albaran_id = a.id) AS unidades_expedidas,
         (SELECT COALESCE(SUM(l.cantidad_recibida),0) FROM rcp_albaran_lineas l WHERE l.albaran_id = a.id) AS unidades_recibidas,
         (SELECT COUNT(*) FROM rcp_albaran_lineas l WHERE l.albaran_id = a.id) AS lineas,
         (SELECT COUNT(*) FROM rcp_incidencias i WHERE i.albaran_id = a.id AND i.estado IN ('ABIERTA','EN_GESTION')) AS incidencias_abiertas`)}
      WHERE ${cond.join(" AND ")}
      ORDER BY CASE a.estado WHEN 'EN_TRANSITO' THEN 0 WHEN 'PARCIALMENTE_RECIBIDO' THEN 1 WHEN 'EMITIDO' THEN 2 ELSE 3 END,
               a.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    ...aAlbaran(r),
    unidadesExpedidas: numero(r.unidades_expedidas),
    unidadesRecibidas: numero(r.unidades_recibidas),
    lineas: Number(r.lineas),
    incidenciasAbiertas: Number(r.incidencias_abiertas),
  }));
}

export async function contarBandeja(
  empresaId: string,
  centroId: string | null,
  ejecutor?: Ejecutor
): Promise<{ pendientes: number; recibidos: number; incidenciasAbiertas: number; pedidosPendientes: number }> {
  const { rows } = await db(ejecutor).query(
    `SELECT
       (SELECT COUNT(*) FROM rcp_albaranes a JOIN rcp_pedidos p ON p.id = a.pedido_id
         WHERE a.empresa_id = $1 AND a.estado IN ('EMITIDO','EN_TRANSITO','PARCIALMENTE_RECIBIDO')
           AND ($2::uuid IS NULL OR p.centro_id = $2)) AS pendientes,
       (SELECT COUNT(*) FROM rcp_albaranes a JOIN rcp_pedidos p ON p.id = a.pedido_id
         WHERE a.empresa_id = $1 AND a.estado IN ('RECIBIDO','RECIBIDO_CON_INCIDENCIA')
           AND ($2::uuid IS NULL OR p.centro_id = $2)) AS recibidos,
       (SELECT COUNT(*) FROM rcp_incidencias i
         WHERE i.empresa_id = $1 AND i.estado IN ('ABIERTA','EN_GESTION')
           AND ($2::uuid IS NULL OR i.centro_id = $2)) AS incidencias_abiertas,
       (SELECT COUNT(*) FROM rcp_pedidos p
         WHERE p.empresa_id = $1 AND p.estado IN ('PENDIENTE_EXPEDICION','PARCIALMENTE_EXPEDIDO')
           AND ($2::uuid IS NULL OR p.centro_id = $2)) AS pedidos_pendientes`,
    [empresaId, centroId]
  );
  const r = rows[0];
  return {
    pendientes: Number(r.pendientes),
    recibidos: Number(r.recibidos),
    incidenciasAbiertas: Number(r.incidencias_abiertas),
    pedidosPendientes: Number(r.pedidos_pendientes),
  };
}

export async function crearAlbaran(
  empresaId: string,
  datos: {
    proveedorId: string;
    pedidoId: string;
    numeroProveedor: string;
    numeroNormalizado: string;
    fechaExpedicion: string | null;
    transportista: string | null;
    observaciones: string | null;
    origen: "MANUAL" | "CORREO";
    externalMessageId?: string | null;
    sourceReceivedAt?: string | null;
    enlacePdfProveedor?: string | null;
    creadoPor: string | null;
    creadoNombre: string | null;
  },
  ejecutor?: Ejecutor
): Promise<Albaran> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_albaranes
       (empresa_id, proveedor_id, pedido_id, numero_proveedor, numero_normalizado, fecha_expedicion,
        transportista, observaciones, origen, external_message_id, source_received_at, enlace_pdf_proveedor,
        creado_por, creado_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      empresaId,
      datos.proveedorId,
      datos.pedidoId,
      datos.numeroProveedor,
      datos.numeroNormalizado,
      datos.fechaExpedicion,
      datos.transportista,
      datos.observaciones,
      datos.origen,
      datos.externalMessageId ?? null,
      datos.sourceReceivedAt ?? null,
      datos.enlacePdfProveedor ?? null,
      datos.creadoPor,
      datos.creadoNombre,
    ]
  );
  return (await albaranPorId(empresaId, rows[0].id, ejecutor))!;
}

export async function crearAlbaranLinea(
  empresaId: string,
  datos: {
    albaranId: string;
    pedidoLineaId: string | null;
    numeroLinea: number;
    referenciaProveedor: string | null;
    descripcionProveedor: string;
    productoId: string | null;
    productoTexto: string | null;
    cantidadExpedida: number;
  },
  ejecutor?: Ejecutor
): Promise<AlbaranLinea> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_albaran_lineas
       (empresa_id, albaran_id, pedido_linea_id, numero_linea, referencia_proveedor, descripcion_proveedor,
        producto_id, producto_texto, cantidad_expedida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *, NULL::numeric AS cantidad_pedida`,
    [
      empresaId,
      datos.albaranId,
      datos.pedidoLineaId,
      datos.numeroLinea,
      datos.referenciaProveedor,
      datos.descripcionProveedor,
      datos.productoId,
      datos.productoTexto,
      datos.cantidadExpedida,
    ]
  );
  return aAlbaranLinea(rows[0]);
}

export async function lineasDeAlbaran(
  empresaId: string,
  albaranId: string,
  ejecutor?: Ejecutor,
  bloquear = false
): Promise<AlbaranLinea[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT l.*, pl.cantidad_pedida
       FROM rcp_albaran_lineas l
       LEFT JOIN rcp_pedido_lineas pl ON pl.id = l.pedido_linea_id
      WHERE l.empresa_id = $1 AND l.albaran_id = $2
      ORDER BY l.numero_linea ${bloquear ? "FOR UPDATE OF l" : ""}`,
    [empresaId, albaranId]
  );
  return rows.map(aAlbaranLinea);
}

/** Recalcula el acumulado recibido de cada línea a partir de las recepciones. */
export async function recalcularLineasAlbaran(empresaId: string, albaranId: string, cliente: Ejecutor): Promise<void> {
  await cliente.query(
    `UPDATE rcp_albaran_lineas l SET
        cantidad_recibida = COALESCE((SELECT SUM(rl.cantidad_recibida) FROM rcp_recepcion_lineas rl WHERE rl.albaran_linea_id = l.id), 0)
      WHERE l.empresa_id = $1 AND l.albaran_id = $2`,
    [empresaId, albaranId]
  );
}

export async function fijarEstadoAlbaran(
  empresaId: string,
  albaranId: string,
  estado: EstadoAlbaran,
  cliente: Ejecutor
): Promise<void> {
  await cliente.query(
    `UPDATE rcp_albaranes SET estado = $3, updated_at = now() WHERE empresa_id = $1 AND id = $2`,
    [empresaId, albaranId, estado]
  );
}

export async function cerrarAlbaran(
  empresaId: string,
  albaranId: string,
  datos: { userId: string; motivo: string },
  cliente: Ejecutor
): Promise<void> {
  await cliente.query(
    `UPDATE rcp_albaranes SET cerrado_at = now(), cerrado_por = $3, cerrado_motivo = $4, updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, albaranId, datos.userId, datos.motivo]
  );
}

export async function albaranTieneIncidencias(empresaId: string, albaranId: string, ejecutor?: Ejecutor): Promise<boolean> {
  const { rows } = await db(ejecutor).query(
    `SELECT 1 FROM rcp_incidencias WHERE empresa_id = $1 AND albaran_id = $2 AND estado <> 'CANCELADA' LIMIT 1`,
    [empresaId, albaranId]
  );
  return rows.length > 0;
}

/* ── Recepciones ─────────────────────────────────────────────────────────── */

export async function recepcionPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Recepcion | null> {
  const { rows } = await db(ejecutor).query(`SELECT * FROM rcp_recepciones WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  return rows[0] ? aRecepcion(rows[0]) : null;
}

export async function recepcionPorIdempotencia(empresaId: string, clave: string, ejecutor?: Ejecutor): Promise<Recepcion | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_recepciones WHERE empresa_id = $1 AND idempotency_key = $2`,
    [empresaId, clave]
  );
  return rows[0] ? aRecepcion(rows[0]) : null;
}

export async function recepcionesDeAlbaran(empresaId: string, albaranId: string, ejecutor?: Ejecutor): Promise<Recepcion[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_recepciones WHERE empresa_id = $1 AND albaran_id = $2 ORDER BY recibido_at`,
    [empresaId, albaranId]
  );
  return rows.map(aRecepcion);
}

export async function recepcionesDePedido(empresaId: string, pedidoId: string, ejecutor?: Ejecutor): Promise<Recepcion[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_recepciones WHERE empresa_id = $1 AND pedido_id = $2 ORDER BY recibido_at`,
    [empresaId, pedidoId]
  );
  return rows.map(aRecepcion);
}

export async function crearRecepcion(
  empresaId: string,
  datos: {
    numero: string;
    albaranId: string;
    pedidoId: string;
    proveedorId: string;
    centroId: string | null;
    centroNombre: string;
    resultado: ResultadoRecepcion;
    recibidoPor: string;
    recibidoNombre: string;
    observaciones: string | null;
    idempotencyKey: string | null;
  },
  cliente: Ejecutor
): Promise<Recepcion> {
  const { rows } = await cliente.query(
    `INSERT INTO rcp_recepciones
       (empresa_id, numero, albaran_id, pedido_id, proveedor_id, centro_id, centro_nombre, resultado,
        recibido_por, recibido_nombre, observaciones, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      empresaId,
      datos.numero,
      datos.albaranId,
      datos.pedidoId,
      datos.proveedorId,
      datos.centroId,
      datos.centroNombre,
      datos.resultado,
      datos.recibidoPor,
      datos.recibidoNombre,
      datos.observaciones,
      datos.idempotencyKey,
    ]
  );
  return aRecepcion(rows[0]);
}

export async function crearRecepcionLinea(
  empresaId: string,
  datos: {
    recepcionId: string;
    albaranLineaId: string;
    descripcionProveedor: string;
    productoTexto: string | null;
    cantidadExpedida: number;
    cantidadEsperada: number;
    cantidadRecibida: number;
    diferencia: number;
  },
  cliente: Ejecutor
): Promise<RecepcionLinea> {
  const { rows } = await cliente.query(
    `INSERT INTO rcp_recepcion_lineas
       (empresa_id, recepcion_id, albaran_linea_id, descripcion_proveedor, producto_texto,
        cantidad_expedida, cantidad_esperada, cantidad_recibida, diferencia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      empresaId,
      datos.recepcionId,
      datos.albaranLineaId,
      datos.descripcionProveedor,
      datos.productoTexto,
      datos.cantidadExpedida,
      datos.cantidadEsperada,
      datos.cantidadRecibida,
      datos.diferencia,
    ]
  );
  return aRecepcionLinea(rows[0]);
}

export async function lineasDeRecepcion(empresaId: string, recepcionId: string, ejecutor?: Ejecutor): Promise<RecepcionLinea[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_recepcion_lineas WHERE empresa_id = $1 AND recepcion_id = $2 ORDER BY created_at, id`,
    [empresaId, recepcionId]
  );
  return rows.map(aRecepcionLinea);
}

/**
 * Cambia la cantidad de una línea de recepción. SOLO desde una rectificación,
 * que deja constancia de la anterior: es el único camino por el que una
 * recepción cerrada cambia de cantidades.
 */
export async function rectificarLineaRecepcion(
  empresaId: string,
  recepcionLineaId: string,
  cantidadNueva: number,
  cliente: Ejecutor
): Promise<void> {
  await cliente.query(
    `UPDATE rcp_recepcion_lineas
        SET cantidad_recibida = $3, diferencia = $3 - cantidad_esperada
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, recepcionLineaId, cantidadNueva]
  );
}

export async function fijarDocumentoRecepcion(
  empresaId: string,
  recepcionId: string,
  datos: { documentoId: string | null; estado: "PENDIENTE" | "GENERADO" | "ERROR"; error: string | null },
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `UPDATE rcp_recepciones SET documento_id = $3, documento_estado = $4, documento_error = $5
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, recepcionId, datos.documentoId, datos.estado, datos.error]
  );
}

/* ── Rectificaciones ─────────────────────────────────────────────────────── */

export async function crearRectificacion(
  empresaId: string,
  datos: {
    numero: string;
    recepcionId: string;
    albaranId: string;
    motivo: string;
    userId: string;
    userNombre: string;
    lineas: { recepcionLineaId: string; albaranLineaId: string; cantidadAnterior: number; cantidadNueva: number }[];
  },
  cliente: Ejecutor
): Promise<Rectificacion> {
  const { rows } = await cliente.query(
    `INSERT INTO rcp_rectificaciones (empresa_id, numero, recepcion_id, albaran_id, motivo, rectificado_por, rectificado_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [empresaId, datos.numero, datos.recepcionId, datos.albaranId, datos.motivo, datos.userId, datos.userNombre]
  );
  const r = rows[0];
  for (const l of datos.lineas) {
    await cliente.query(
      `INSERT INTO rcp_rectificacion_lineas (rectificacion_id, recepcion_linea_id, albaran_linea_id, cantidad_anterior, cantidad_nueva)
       VALUES ($1,$2,$3,$4,$5)`,
      [r.id, l.recepcionLineaId, l.albaranLineaId, l.cantidadAnterior, l.cantidadNueva]
    );
  }
  return {
    id: r.id,
    numero: r.numero,
    recepcionId: r.recepcion_id,
    albaranId: r.albaran_id,
    motivo: r.motivo,
    rectificadoNombre: r.rectificado_nombre,
    rectificadoAt: iso(r.rectificado_at)!,
    lineas: datos.lineas,
  };
}

export async function rectificacionesDeRecepcion(empresaId: string, recepcionId: string, ejecutor?: Ejecutor): Promise<Rectificacion[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT r.*, COALESCE(json_agg(json_build_object(
              'recepcionLineaId', l.recepcion_linea_id, 'albaranLineaId', l.albaran_linea_id,
              'cantidadAnterior', l.cantidad_anterior, 'cantidadNueva', l.cantidad_nueva)
            ) FILTER (WHERE l.id IS NOT NULL), '[]') AS lineas
       FROM rcp_rectificaciones r
       LEFT JOIN rcp_rectificacion_lineas l ON l.rectificacion_id = r.id
      WHERE r.empresa_id = $1 AND r.recepcion_id = $2
      GROUP BY r.id ORDER BY r.rectificado_at`,
    [empresaId, recepcionId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    numero: r.numero,
    recepcionId: r.recepcion_id,
    albaranId: r.albaran_id,
    motivo: r.motivo,
    rectificadoNombre: r.rectificado_nombre,
    rectificadoAt: iso(r.rectificado_at)!,
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    lineas: (r.lineas as any[]).map((l) => ({
      recepcionLineaId: l.recepcionLineaId,
      albaranLineaId: l.albaranLineaId,
      cantidadAnterior: numero(l.cantidadAnterior),
      cantidadNueva: numero(l.cantidadNueva),
    })),
  }));
}

/* ── Incidencias ─────────────────────────────────────────────────────────── */

const SELECT_INCIDENCIA = `
  SELECT i.*, pr.nombre AS proveedor_nombre, a.numero_proveedor AS albaran_numero,
         p.numero_proveedor AS pedido_numero, r.numero AS recepcion_numero
    FROM rcp_incidencias i
    JOIN rcp_proveedores pr ON pr.id = i.proveedor_id
    JOIN rcp_albaranes a ON a.id = i.albaran_id
    JOIN rcp_pedidos p ON p.id = i.pedido_id
    JOIN rcp_recepciones r ON r.id = i.recepcion_id`;

export async function crearIncidencia(
  empresaId: string,
  datos: {
    recepcionId: string;
    recepcionLineaId: string | null;
    albaranId: string;
    albaranLineaId: string | null;
    pedidoId: string;
    proveedorId: string;
    centroId: string | null;
    centroNombre: string;
    transportista: string | null;
    tipo: TipoIncidencia;
    descripcionProducto: string;
    cantidadEsperada: number;
    cantidadRecibida: number;
    diferencia: number;
    observaciones: string | null;
    userId: string;
    userNombre: string;
  },
  cliente: Ejecutor
): Promise<Incidencia> {
  const { rows } = await cliente.query(
    `INSERT INTO rcp_incidencias
       (empresa_id, recepcion_id, recepcion_linea_id, albaran_id, albaran_linea_id, pedido_id, proveedor_id,
        centro_id, centro_nombre, transportista, tipo, descripcion_producto,
        cantidad_esperada, cantidad_recibida, diferencia, observaciones, creada_por, creada_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      empresaId,
      datos.recepcionId,
      datos.recepcionLineaId,
      datos.albaranId,
      datos.albaranLineaId,
      datos.pedidoId,
      datos.proveedorId,
      datos.centroId,
      datos.centroNombre,
      datos.transportista,
      datos.tipo,
      datos.descripcionProducto,
      datos.cantidadEsperada,
      datos.cantidadRecibida,
      datos.diferencia,
      datos.observaciones,
      datos.userId,
      datos.userNombre,
    ]
  );
  return (await incidenciaPorId(empresaId, rows[0].id, cliente))!;
}

export async function incidenciaPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Incidencia | null> {
  const { rows } = await db(ejecutor).query(`${SELECT_INCIDENCIA} WHERE i.empresa_id = $1 AND i.id = $2`, [empresaId, id]);
  return rows[0] ? aIncidencia(rows[0]) : null;
}

export async function listarIncidencias(
  empresaId: string,
  f: { estado?: string; centroId?: string | null; proveedorId?: string; albaranId?: string; recepcionId?: string; pedidoId?: string },
  ejecutor?: Ejecutor
): Promise<Incidencia[]> {
  const params: unknown[] = [empresaId];
  const cond = ["i.empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (f.estado === "abiertas") cond.push(`i.estado IN ('ABIERTA','EN_GESTION')`);
  else if (f.estado) add("i.estado = ?", f.estado);
  if (f.centroId) add("i.centro_id = ?", f.centroId);
  if (f.proveedorId) add("i.proveedor_id = ?", f.proveedorId);
  if (f.albaranId) add("i.albaran_id = ?", f.albaranId);
  if (f.recepcionId) add("i.recepcion_id = ?", f.recepcionId);
  if (f.pedidoId) add("i.pedido_id = ?", f.pedidoId);
  const { rows } = await db(ejecutor).query(
    `${SELECT_INCIDENCIA} WHERE ${cond.join(" AND ")} ORDER BY i.created_at DESC LIMIT 500`,
    params
  );
  return rows.map(aIncidencia);
}

export async function cambiarEstadoIncidencia(
  empresaId: string,
  id: string,
  datos: { estado: EstadoIncidencia; resolucion: string | null; userId: string; userNombre: string },
  cliente: Ejecutor
): Promise<void> {
  const cerrada = datos.estado === "RESUELTA" || datos.estado === "CANCELADA";
  await cliente.query(
    `UPDATE rcp_incidencias
        SET estado = $3,
            resolucion = COALESCE($4, resolucion),
            resuelta_por = CASE WHEN $5::boolean THEN $6::uuid ELSE resuelta_por END,
            resuelta_nombre = CASE WHEN $5::boolean THEN $7 ELSE resuelta_nombre END,
            resuelta_at = CASE WHEN $5::boolean THEN now() ELSE resuelta_at END,
            updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id, datos.estado, datos.resolucion, cerrada, datos.userId, datos.userNombre]
  );
}

/* ── Documentos ──────────────────────────────────────────────────────────── */

export async function crearDocumento(
  empresaId: string,
  datos: {
    tipo: "ALBARAN_ORIGINAL" | "ALBARAN_RECEPCION" | "OTRO";
    albaranId: string | null;
    recepcionId: string | null;
    nombreFichero: string;
    storagePath: string;
    hashSha256: string;
    tamanoBytes: number;
    mime: string;
    origen: "SUBIDA_MANUAL" | "CORREO" | "DESCARGA_PROVEEDOR" | "GENERADO";
    generadoDesdeHash: string | null;
    subidoPor: string | null;
    subidoNombre: string | null;
  },
  ejecutor?: Ejecutor
): Promise<Documento> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_documentos
       (empresa_id, tipo, albaran_id, recepcion_id, nombre_fichero, storage_path, hash_sha256, tamano_bytes,
        mime, origen, generado_desde_hash, subido_por, subido_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      empresaId,
      datos.tipo,
      datos.albaranId,
      datos.recepcionId,
      datos.nombreFichero,
      datos.storagePath,
      datos.hashSha256,
      datos.tamanoBytes,
      datos.mime,
      datos.origen,
      datos.generadoDesdeHash,
      datos.subidoPor,
      datos.subidoNombre,
    ]
  );
  return aDocumento(rows[0]);
}

export async function documentoPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Documento | null> {
  const { rows } = await db(ejecutor).query(`SELECT * FROM rcp_documentos WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  return rows[0] ? aDocumento(rows[0]) : null;
}

export async function originalDeAlbaran(empresaId: string, albaranId: string, ejecutor?: Ejecutor): Promise<Documento | null> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_documentos WHERE empresa_id = $1 AND albaran_id = $2 AND tipo = 'ALBARAN_ORIGINAL'`,
    [empresaId, albaranId]
  );
  return rows[0] ? aDocumento(rows[0]) : null;
}

export async function documentosDeAlbaran(empresaId: string, albaranId: string, ejecutor?: Ejecutor): Promise<Documento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT d.* FROM rcp_documentos d
      WHERE d.empresa_id = $1
        AND (d.albaran_id = $2 OR d.recepcion_id IN (SELECT id FROM rcp_recepciones WHERE albaran_id = $2))
      ORDER BY d.created_at`,
    [empresaId, albaranId]
  );
  return rows.map(aDocumento);
}

export async function documentosDeRecepcion(empresaId: string, recepcionId: string, ejecutor?: Ejecutor): Promise<Documento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_documentos WHERE empresa_id = $1 AND recepcion_id = $2 ORDER BY created_at`,
    [empresaId, recepcionId]
  );
  return rows.map(aDocumento);
}

/* ── Histórico ───────────────────────────────────────────────────────────── */

export async function anotarEvento(
  empresaId: string,
  datos: {
    pedidoId?: string | null;
    albaranId?: string | null;
    recepcionId?: string | null;
    incidenciaId?: string | null;
    tipo: string;
    actorTipo?: "sistema" | "usuario";
    usuarioId?: string | null;
    usuarioNombre?: string | null;
    datos?: unknown;
    descripcion: string;
  },
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `INSERT INTO rcp_eventos
       (empresa_id, pedido_id, albaran_id, recepcion_id, incidencia_id, tipo, actor_tipo, usuario_id, usuario_nombre, datos, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      empresaId,
      datos.pedidoId ?? null,
      datos.albaranId ?? null,
      datos.recepcionId ?? null,
      datos.incidenciaId ?? null,
      datos.tipo,
      datos.actorTipo ?? "usuario",
      datos.usuarioId ?? null,
      datos.usuarioNombre ?? null,
      datos.datos === undefined ? null : JSON.stringify(datos.datos),
      datos.descripcion,
    ]
  );
}

export async function eventosDePedido(empresaId: string, pedidoId: string, ejecutor?: Ejecutor): Promise<Evento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_eventos WHERE empresa_id = $1 AND pedido_id = $2 ORDER BY occurred_at, id`,
    [empresaId, pedidoId]
  );
  return rows.map(aEvento);
}

export async function eventosDeAlbaran(empresaId: string, albaranId: string, ejecutor?: Ejecutor): Promise<Evento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_eventos WHERE empresa_id = $1 AND albaran_id = $2 ORDER BY occurred_at, id`,
    [empresaId, albaranId]
  );
  return rows.map(aEvento);
}

/* ── Centros (fundación SaaS, si está) ───────────────────────────────────── */

export type Centro = { id: string; nombre: string; activo: boolean };

/** Los talleres de la empresa. Lista vacía si la base no tiene `app_centros`. */
export async function listarCentros(empresaId: string): Promise<Centro[]> {
  const { rows: hay } = await pool.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`);
  if (!hay[0]?.hay) return [];
  const { rows } = await pool.query(
    `SELECT id, nombre, activo FROM app_centros WHERE empresa_id = $1 ORDER BY activo DESC, nombre`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({ id: r.id, nombre: r.nombre, activo: Boolean(r.activo) }));
}
