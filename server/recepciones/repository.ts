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
  destinoTexto: string | null;
  clienteProveedor: string | null;
  estado: EstadoPedido;
  canceladoAt: string | null;
  canceladoMotivo: string | null;
  observaciones: string | null;
  origen: string;
  /**
   * El pedido se dedujo de un albarán porque su correo no había llegado (o no
   * llega nunca). Mientras sea true, `cantidadPedida` es «lo expedido hasta
   * ahora», no lo que se pidió.
   */
  derivadoDeAlbaran: boolean;
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
  /** Cuándo se encargó. Los pedidos deducidos de un albarán no la saben. */
  pedidoFecha: string | null;
  /** El móvil que venía en las observaciones del albarán, si lo traía. */
  telefonoContacto: string | null;
  numeroProveedor: string;
  numeroNormalizado: string;
  fechaExpedicion: string | null;
  transportista: string | null;
  estado: EstadoAlbaran;
  cerradoAt: string | null;
  cerradoMotivo: string | null;
  observaciones: string | null;
  origen: string;
  enlacePdfProveedor: string | null;
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
  /** La SESIÓN desde la que se cerró. */
  recibidoPor: string;
  recibidoNombre: string;
  /** Quien contó la mercancía, confirmado con su PIN. Es lo que firma el papel. */
  operarioId: string | null;
  operarioNombre: string | null;
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
  destinoTexto: r.destino_texto ?? null,
  clienteProveedor: r.cliente_proveedor ?? null,
  estado: r.estado,
  canceladoAt: iso(r.cancelado_at),
  canceladoMotivo: r.cancelado_motivo ?? null,
  observaciones: r.observaciones ?? null,
  origen: r.origen,
  derivadoDeAlbaran: r.derivado_de_albaran === true,
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
  pedidoFecha: fecha(r.pedido_fecha),
  telefonoContacto: r.telefono_contacto ?? null,
  numeroProveedor: r.numero_proveedor,
  numeroNormalizado: r.numero_normalizado,
  fechaExpedicion: fecha(r.fecha_expedicion),
  transportista: r.transportista ?? null,
  estado: r.estado,
  cerradoAt: iso(r.cerrado_at),
  cerradoMotivo: r.cerrado_motivo ?? null,
  observaciones: r.observaciones ?? null,
  origen: r.origen,
  enlacePdfProveedor: r.enlace_pdf_proveedor ?? null,
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
  operarioId: r.operario_id ?? null,
  operarioNombre: r.operario_nombre ?? null,
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
  datos: Partial<{ codigo: string; nombre: string; nif: string | null; remitentesCorreo: string[]; activo: boolean }>,
  ejecutor?: Ejecutor
): Promise<Proveedor | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE rcp_proveedores
        SET codigo = COALESCE($7, codigo),
            nombre = COALESCE($3, nombre),
            nif = CASE WHEN $4::text IS NULL THEN nif ELSE NULLIF($4, '') END,
            remitentes_correo = COALESCE($5, remitentes_correo),
            activo = COALESCE($6, activo),
            updated_at = now()
      WHERE empresa_id = $1 AND id = $2
      RETURNING *`,
    [empresaId, id, datos.nombre ?? null, datos.nif === undefined ? null : datos.nif ?? "", datos.remitentesCorreo ?? null, datos.activo ?? null, datos.codigo ?? null]
  );
  return rows[0] ? aProveedor(rows[0]) : null;
}

/* ── Avisos a quien espera la mercancía ──────────────────────────────────── */

export type Aviso = {
  id: string;
  /** «MATERIAL_RECIBIDO» o «FALTA_ALBARAN». */
  tipo: string;
  /** Nulo en el aviso de que falta el PDF: ahí todavía no hay recepción. */
  recepcionId: string | null;
  albaranId: string;
  recepcionNumero: string;
  albaranNumero: string;
  canal: string;
  destinatario: string | null;
  telefono: string | null;
  estado: "ENVIADO" | "OMITIDO" | "ERROR";
  motivo: string | null;
  referenciaExterna: string | null;
  creadoNombre: string | null;
  createdAt: string;
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const aAviso = (r: any): Aviso => ({
  id: r.id,
  tipo: r.tipo ?? "MATERIAL_RECIBIDO",
  recepcionId: r.recepcion_id ?? null,
  albaranId: r.albaran_id,
  recepcionNumero: r.recepcion_numero ?? "",
  albaranNumero: r.albaran_numero ?? "",
  canal: r.canal,
  destinatario: r.destinatario ?? null,
  telefono: r.telefono ?? null,
  estado: r.estado,
  motivo: r.motivo ?? null,
  referenciaExterna: r.referencia_externa ?? null,
  creadoNombre: r.creado_nombre ?? null,
  createdAt: iso(r.created_at)!,
});

export async function anotarAviso(
  empresaId: string,
  datos: {
    tipo?: "MATERIAL_RECIBIDO" | "FALTA_ALBARAN";
    recepcionId: string | null;
    albaranId: string;
    destinatario: string | null;
    telefono: string | null;
    estado: "ENVIADO" | "OMITIDO" | "ERROR";
    motivo: string | null;
    referenciaExterna: string | null;
    creadoPor: string | null;
    creadoNombre: string | null;
  },
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `INSERT INTO rcp_avisos
       (empresa_id, recepcion_id, albaran_id, destinatario, telefono, estado, motivo, referencia_externa, creado_por, creado_nombre, tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      empresaId,
      datos.recepcionId,
      datos.albaranId,
      datos.destinatario,
      datos.telefono,
      datos.estado,
      datos.motivo,
      datos.referenciaExterna,
      datos.creadoPor,
      datos.creadoNombre,
      datos.tipo ?? "MATERIAL_RECIBIDO",
    ]
  );
}

export async function listarAvisos(empresaId: string, limite = 50, ejecutor?: Ejecutor): Promise<Aviso[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT v.*, r.numero AS recepcion_numero, a.numero_proveedor AS albaran_numero
       FROM rcp_avisos v
       LEFT JOIN rcp_recepciones r ON r.id = v.recepcion_id
       JOIN rcp_albaranes a ON a.id = v.albaran_id
      WHERE v.empresa_id = $1
      ORDER BY v.created_at DESC
      LIMIT $2`,
    [empresaId, Math.min(Math.max(limite, 1), 200)]
  );
  return rows.map(aAviso);
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

/* ── Operarios del muelle ────────────────────────────────────────────────── */

/** Lo que se puede enseñar de un operario: nunca el PIN ni su hash. */
export type Operario = {
  id: string;
  centroId: string | null;
  nombre: string;
  activo: boolean;
  bloqueadoHasta: string | null;
  creadoNombre: string | null;
  createdAt: string;
};

/** Con el secreto dentro: sólo para verificar, nunca para devolver por la API. */
export type OperarioConPin = Operario & { pinHash: string; pinSalt: string; intentosFallidos: number };

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const aOperario = (r: any): Operario => ({
  id: r.id,
  centroId: r.centro_id ?? null,
  nombre: r.nombre,
  activo: r.activo === true,
  bloqueadoHasta: iso(r.bloqueado_hasta),
  creadoNombre: r.creado_nombre ?? null,
  createdAt: iso(r.created_at)!,
});

/**
 * Los operarios de la empresa. Con `centroId` salen los de ese centro más los
 * que valen para todos; sin él, todos, que es lo que ve quien los gestiona.
 */
export async function listarOperarios(
  empresaId: string,
  filtro: { centroId?: string | null; soloActivos?: boolean } = {},
  ejecutor?: Ejecutor
): Promise<Operario[]> {
  const params: unknown[] = [empresaId];
  const cond = ["empresa_id = $1"];
  if (filtro.soloActivos) cond.push("activo");
  if (filtro.centroId) {
    params.push(filtro.centroId);
    cond.push(`(centro_id IS NULL OR centro_id = $${params.length}::uuid)`);
  }
  const { rows } = await db(ejecutor).query(`SELECT * FROM rcp_operarios WHERE ${cond.join(" AND ")} ORDER BY nombre`, params);
  return rows.map(aOperario);
}

export async function operarioPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<OperarioConPin | null> {
  const { rows } = await db(ejecutor).query(`SELECT * FROM rcp_operarios WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  if (!rows[0]) return null;
  return { ...aOperario(rows[0]), pinHash: rows[0].pin_hash, pinSalt: rows[0].pin_salt, intentosFallidos: Number(rows[0].intentos_fallidos ?? 0) };
}

export async function crearOperario(
  empresaId: string,
  datos: { nombre: string; centroId: string | null; pinHash: string; pinSalt: string; creadoPor: string | null; creadoNombre: string | null },
  ejecutor?: Ejecutor
): Promise<Operario> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_operarios (empresa_id, nombre, centro_id, pin_hash, pin_salt, creado_por, creado_nombre)
     VALUES ($1,$2,$3::uuid,$4,$5,$6,$7) RETURNING *`,
    [empresaId, datos.nombre, datos.centroId, datos.pinHash, datos.pinSalt, datos.creadoPor, datos.creadoNombre]
  );
  return aOperario(rows[0]);
}

export async function actualizarOperario(
  empresaId: string,
  id: string,
  datos: { nombre?: string; centroId?: string | null; activo?: boolean; pinHash?: string; pinSalt?: string },
  ejecutor?: Ejecutor
): Promise<Operario | null> {
  const { rows } = await db(ejecutor).query(
    `UPDATE rcp_operarios SET
       nombre    = COALESCE($3, nombre),
       centro_id = CASE WHEN $4::boolean THEN $5::uuid ELSE centro_id END,
       activo    = COALESCE($6::boolean, activo),
       pin_hash  = COALESCE($7, pin_hash),
       pin_salt  = COALESCE($8, pin_salt),
       -- Un PIN nuevo levanta el bloqueo: es la forma de desatascar a alguien.
       intentos_fallidos = CASE WHEN $7 IS NULL THEN intentos_fallidos ELSE 0 END,
       bloqueado_hasta   = CASE WHEN $7 IS NULL THEN bloqueado_hasta ELSE NULL END,
       updated_at = now()
     WHERE empresa_id = $1 AND id = $2 RETURNING *`,
    [empresaId, id, datos.nombre ?? null, datos.centroId !== undefined, datos.centroId ?? null, datos.activo ?? null, datos.pinHash ?? null, datos.pinSalt ?? null]
  );
  return rows[0] ? aOperario(rows[0]) : null;
}

/** Deja constancia de cómo fue el intento de PIN. Fuera de la transacción del cierre. */
export async function anotarIntentoPin(
  empresaId: string,
  id: string,
  estado: { intentos: number; bloqueadoHasta: Date | null }
): Promise<void> {
  await pool.query(
    `UPDATE rcp_operarios SET intentos_fallidos = $3, bloqueado_hasta = $4, updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id, estado.intentos, estado.bloqueadoHasta]
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

/** Un pedido de la lista, con lo que se encargó: es lo que se busca en pantalla. */
export type FilaPedido = Pedido & { articulos: ArticuloBandeja[] };

export async function listarPedidos(empresaId: string, f: FiltroPedidos, ejecutor?: Ejecutor): Promise<FilaPedido[]> {
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
    `${SELECT_PEDIDO.replace(
      "SELECT p.*",
      `SELECT p.*,
         (SELECT json_agg(json_build_object(
                    'descripcion_proveedor', l.descripcion_proveedor,
                    'producto_texto', l.producto_texto,
                    'cantidad_expedida', l.cantidad_pedida,
                    'cantidad_pendiente', GREATEST(l.cantidad_pedida - l.cantidad_expedida, 0)
                  ) ORDER BY l.numero_linea)
            FROM rcp_pedido_lineas l WHERE l.pedido_id = p.id) AS articulos`
    )}
      WHERE ${cond.join(" AND ")}
      -- Lo más NUEVO primero, al revés que la bandeja, y a propósito: la
      -- bandeja es una cola de trabajo —se recepciona por orden de llegada— y
      -- esto es la lista de lo que se ha pedido, donde lo que se mira es lo
      -- último. Sin fecha de pedido manda cuándo entró en Mobilink.
      ORDER BY COALESCE(p.fecha_pedido, p.created_at::date) DESC, p.created_at DESC
      LIMIT $${params.length}`,
    params
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    ...aPedido(r),
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    articulos: ((r.articulos ?? []) as any[]).map((l) => ({
      descripcionProveedor: l.descripcion_proveedor,
      productoTexto: l.producto_texto ?? null,
      cantidadExpedida: numero(l.cantidad_expedida),
      cantidadPendiente: numero(l.cantidad_pendiente),
    })),
  }));
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
    destinoTexto?: string | null;
    clienteProveedor?: string | null;
    derivadoDeAlbaran?: boolean;
    creadoPor: string | null;
    creadoNombre: string | null;
  },
  ejecutor?: Ejecutor
): Promise<Pedido> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_pedidos
       (empresa_id, proveedor_id, numero_proveedor, numero_normalizado, fecha_pedido, usuario_pedido,
        centro_id, centro_nombre, almacen_origen, transportista, observaciones, origen,
        external_message_id, source_received_at, creado_por, creado_nombre, destino_texto, cliente_proveedor,
        derivado_de_albaran)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
      datos.destinoTexto ?? null,
      datos.clienteProveedor ?? null,
      datos.derivadoDeAlbaran === true,
    ]
  );
  return (await pedidoPorId(empresaId, rows[0].id, ejecutor))!;
}

/**
 * Sube la cantidad pedida de una línea. Sólo sube: es para completar un pedido
 * derivado, y bajarla por debajo de lo ya expedido dejaría el pedido incoherente.
 */
export async function subirCantidadPedida(empresaId: string, lineaId: string, cantidad: number, cliente: Ejecutor): Promise<void> {
  await cliente.query(
    `UPDATE rcp_pedido_lineas SET cantidad_pedida = GREATEST(cantidad_pedida, $3::numeric)
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, lineaId, cantidad]
  );
}

/** Rellena los huecos de la cabecera de un pedido. Nunca pisa lo que ya tiene valor. */
export async function rellenarCabeceraPedido(
  empresaId: string,
  pedidoId: string,
  datos: {
    /** El único que sí se pisa: el correo del pedido trae el número con su serie. */
    numeroProveedor?: string | null;
    fechaPedido?: string | null;
    usuarioPedido?: string | null;
    centroId?: string | null;
    centroNombre?: string | null;
    almacenOrigen?: string | null;
    transportista?: string | null;
    destinoTexto?: string | null;
    clienteProveedor?: string | null;
    derivadoDeAlbaran?: boolean;
  },
  cliente: Ejecutor
): Promise<void> {
  await cliente.query(
    `UPDATE rcp_pedidos SET
       -- El número del correo del pedido manda: el del albarán venía sin serie.
       numero_proveedor   = COALESCE($3, numero_proveedor),
       fecha_pedido       = COALESCE(fecha_pedido, $4::date),
       usuario_pedido     = COALESCE(usuario_pedido, $5),
       centro_id          = COALESCE(centro_id, $6::uuid),
       centro_nombre      = CASE WHEN centro_nombre = '' THEN COALESCE($7, '') ELSE centro_nombre END,
       almacen_origen     = COALESCE(almacen_origen, $8),
       transportista      = COALESCE(transportista, $9),
       destino_texto      = COALESCE(destino_texto, $10),
       cliente_proveedor  = COALESCE(cliente_proveedor, $11),
       derivado_de_albaran = COALESCE($12::boolean, derivado_de_albaran),
       updated_at         = now()
     WHERE empresa_id = $1 AND id = $2`,
    [
      empresaId,
      pedidoId,
      datos.numeroProveedor ?? null,
      datos.fechaPedido ?? null,
      datos.usuarioPedido ?? null,
      datos.centroId ?? null,
      datos.centroNombre ?? null,
      datos.almacenOrigen ?? null,
      datos.transportista ?? null,
      datos.destinoTexto ?? null,
      datos.clienteProveedor ?? null,
      datos.derivadoDeAlbaran ?? null,
    ]
  );
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
         p.numero_proveedor AS pedido_numero, p.fecha_pedido AS pedido_fecha, p.centro_id, p.centro_nombre
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

/** Un artículo del albarán, para enseñarlo en la bandeja sin abrir la ficha. */
export type ArticuloBandeja = {
  descripcionProveedor: string;
  productoTexto: string | null;
  cantidadExpedida: number;
  cantidadPendiente: number;
};

export type FilaBandeja = Albaran & {
  unidadesExpedidas: number;
  unidadesRecibidas: number;
  lineas: number;
  incidenciasAbiertas: number;
  /** Lo que trae el albarán. Es lo que mira quien está en el muelle. */
  articulos: ArticuloBandeja[];
  /** El PDF del proveedor, si está guardado: para consultarlo antes de contar. */
  documentoOriginalId: string | null;
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
         (SELECT COUNT(*) FROM rcp_incidencias i WHERE i.albaran_id = a.id AND i.estado IN ('ABIERTA','EN_GESTION')) AS incidencias_abiertas,
         (SELECT json_agg(json_build_object(
                    'descripcion_proveedor', l.descripcion_proveedor,
                    'producto_texto', l.producto_texto,
                    'cantidad_expedida', l.cantidad_expedida,
                    'cantidad_pendiente', GREATEST(l.cantidad_expedida - l.cantidad_recibida, 0)
                  ) ORDER BY l.numero_linea)
            FROM rcp_albaran_lineas l WHERE l.albaran_id = a.id) AS articulos,
         (SELECT d.id FROM rcp_documentos d
            WHERE d.albaran_id = a.id AND d.tipo = 'ALBARAN_ORIGINAL' LIMIT 1) AS documento_original_id`)}
      WHERE ${cond.join(" AND ")}
      -- Lo más viejo primero: el muelle es una cola, y lo que lleva más días
      -- expedido es lo que antes hay que contar. Se ordena por la fecha de
      -- EXPEDICIÓN, que es la que se ve en pantalla; cuando el albarán no la
      -- trae, por cuándo entró, para que el orden nunca quede indefinido.
      ORDER BY CASE a.estado WHEN 'EN_TRANSITO' THEN 0 WHEN 'PARCIALMENTE_RECIBIDO' THEN 1 WHEN 'EMITIDO' THEN 2 ELSE 3 END,
               COALESCE(a.fecha_expedicion, a.created_at::date) ASC,
               a.created_at ASC
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
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    articulos: ((r.articulos ?? []) as any[]).map((l) => ({
      descripcionProveedor: l.descripcion_proveedor,
      productoTexto: l.producto_texto ?? null,
      cantidadExpedida: numero(l.cantidad_expedida),
      cantidadPendiente: numero(l.cantidad_pendiente),
    })),
    documentoOriginalId: r.documento_original_id ?? null,
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

/**
 * Borra las líneas de un albarán. Sólo se puede cuando no cuelga nada de
 * ellas: una recepción o una incidencia las referencian, y la base lo
 * impediría —que es lo que se quiere—. El servicio comprueba antes que el
 * albarán no tenga recepciones.
 */
export async function borrarLineasDeAlbaran(empresaId: string, albaranId: string, cliente: Ejecutor): Promise<number> {
  const { rowCount } = await cliente.query(`DELETE FROM rcp_albaran_lineas WHERE empresa_id = $1 AND albaran_id = $2`, [empresaId, albaranId]);
  return rowCount ?? 0;
}

/**
 * Quita las líneas de un pedido DEDUCIDO que se han quedado sin nada detrás:
 * ni expedido, ni recibido, ni un solo renglón de albarán apuntando a ellas.
 *
 * Es la limpieza de releer un albarán del PDF: la línea que el correo dedujo
 * mal deja de tener quien la sostenga, y en un pedido deducido esa línea no
 * era más que el reflejo del albarán. En un pedido de verdad NO se toca nada:
 * sus líneas las dijo su propio correo.
 */
export async function limpiarLineasHuerfanas(empresaId: string, pedidoId: string, cliente: Ejecutor): Promise<number> {
  const { rowCount } = await cliente.query(
    `DELETE FROM rcp_pedido_lineas l
      WHERE l.empresa_id = $1 AND l.pedido_id = $2
        AND l.cantidad_expedida = 0 AND l.cantidad_recibida = 0
        AND NOT EXISTS (SELECT 1 FROM rcp_albaran_lineas al WHERE al.pedido_linea_id = l.id)
        AND EXISTS (SELECT 1 FROM rcp_pedidos p WHERE p.id = l.pedido_id AND p.derivado_de_albaran)`,
    [empresaId, pedidoId]
  );
  return rowCount ?? 0;
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

/**
 * Anota las observaciones que traía el PDF del proveedor. Sólo rellena el
 * hueco: si alguien escribió algo a mano en el albarán, no se le pisa.
 */
export async function anotarObservacionesAlbaran(
  empresaId: string,
  albaranId: string,
  datos: { texto: string | null; telefono: string | null },
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `UPDATE rcp_albaranes SET
       observaciones     = CASE WHEN observaciones IS NULL OR observaciones = '' THEN $3 ELSE observaciones END,
       telefono_contacto = COALESCE(telefono_contacto, $4),
       updated_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [empresaId, albaranId, datos.texto, datos.telefono]
  );
}

/**
 * Los albaranes que tienen su PDF original guardado pero les falta la
 * observación o el teléfono. Es a lo que le hace falta una relectura: los que
 * entraron antes de que el módulo supiera leer esa parte del papel.
 */
export async function albaranesSinObservaciones(
  empresaId: string,
  limite = 200,
  ejecutor?: Ejecutor
): Promise<{ id: string; numeroProveedor: string; storagePath: string }[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT a.id, a.numero_proveedor, d.storage_path
       FROM rcp_albaranes a
       JOIN rcp_documentos d
         ON d.albaran_id = a.id AND d.tipo = 'ALBARAN_ORIGINAL' AND d.empresa_id = a.empresa_id
      WHERE a.empresa_id = $1
        AND ((a.observaciones IS NULL OR a.observaciones = '') OR a.telefono_contacto IS NULL)
      ORDER BY a.created_at DESC
      LIMIT $2`,
    [empresaId, Math.min(Math.max(limite, 1), 500)]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({ id: r.id, numeroProveedor: r.numero_proveedor, storagePath: r.storage_path }));
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
    operarioId: string | null;
    operarioNombre: string | null;
    observaciones: string | null;
    idempotencyKey: string | null;
  },
  cliente: Ejecutor
): Promise<Recepcion> {
  const { rows } = await cliente.query(
    `INSERT INTO rcp_recepciones
       (empresa_id, numero, albaran_id, pedido_id, proveedor_id, centro_id, centro_nombre, resultado,
        recibido_por, recibido_nombre, observaciones, idempotency_key, operario_id, operario_nombre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid,$14)
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
      datos.operarioId,
      datos.operarioNombre,
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
    /** El correo del que salió, cuando todavía no hay albarán al que colgarlo. */
    correoId?: string | null;
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
        mime, origen, generado_desde_hash, subido_por, subido_nombre, correo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
      datos.correoId ?? null,
    ]
  );
  return aDocumento(rows[0]);
}

/**
 * Los PDF que llegaron adjuntos a un correo y todavía no cuelgan de ningún
 * albarán. Es lo que hace que «Reprocesar» pueda volver a leerlos.
 */
export async function adjuntosDeCorreo(empresaId: string, correoId: string, ejecutor?: Ejecutor): Promise<Documento[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT * FROM rcp_documentos WHERE empresa_id = $1 AND correo_id = $2 ORDER BY created_at`,
    [empresaId, correoId]
  );
  return rows.map(aDocumento);
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

/**
 * El nombre de nuestra empresa, el que firma los avisos. Nunca lanza y puede
 * devolver `null`: la base de una instalación suelta no tiene `app_empresas`,
 * y quedarse sin firma no es motivo para no avisar.
 */
export async function nombreEmpresa(empresaId: string): Promise<string | null> {
  try {
    const { rows: hay } = await pool.query(`SELECT to_regclass('public.app_empresas') IS NOT NULL AS hay`);
    if (!hay[0]?.hay) return null;
    const { rows } = await pool.query<{ nombre: string | null }>(`SELECT nombre FROM app_empresas WHERE id = $1`, [empresaId]);
    const nombre = (rows[0]?.nombre ?? "").trim();
    return nombre || null;
  } catch {
    return null;
  }
}

/* ══ Fase 2: correos del proveedor ═════════════════════════════════════════ */

export type ResultadoCorreo = "RECIBIDO" | "PROCESADO" | "DUPLICADO" | "IGNORADO" | "PENDIENTE_REVISION" | "ERROR";

export type Correo = {
  id: string;
  proveedorId: string | null;
  proveedorNombre: string | null;
  messageId: string;
  asunto: string;
  remitente: string | null;
  fecha: string | null;
  texto: string;
  tipo: "PEDIDO" | "ALBARAN" | "DESCONOCIDO";
  resultado: ResultadoCorreo;
  motivo: string | null;
  datosExtraidos: unknown;
  avisos: string[];
  pedidoId: string | null;
  pedidoNumero: string | null;
  albaranId: string | null;
  albaranNumero: string | null;
  origen: string;
  intentos: number;
  procesadoAt: string | null;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const aCorreo = (r: any): Correo => ({
  id: r.id,
  proveedorId: r.proveedor_id ?? null,
  proveedorNombre: r.proveedor_nombre ?? null,
  messageId: r.message_id,
  asunto: r.asunto ?? "",
  remitente: r.remitente ?? null,
  fecha: iso(r.fecha),
  texto: r.texto ?? "",
  tipo: r.tipo,
  resultado: r.resultado,
  motivo: r.motivo ?? null,
  datosExtraidos: r.datos_extraidos ?? null,
  avisos: r.avisos ?? [],
  pedidoId: r.pedido_id ?? null,
  pedidoNumero: r.pedido_numero ?? null,
  albaranId: r.albaran_id ?? null,
  albaranNumero: r.albaran_numero ?? null,
  origen: r.origen,
  intentos: Number(r.intentos ?? 0),
  procesadoAt: iso(r.procesado_at),
  createdAt: iso(r.created_at)!,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT_CORREO = `
  SELECT c.*, pr.nombre AS proveedor_nombre, p.numero_proveedor AS pedido_numero, a.numero_proveedor AS albaran_numero
    FROM rcp_correos c
    LEFT JOIN rcp_proveedores pr ON pr.id = c.proveedor_id
    LEFT JOIN rcp_pedidos p ON p.id = c.pedido_id
    LEFT JOIN rcp_albaranes a ON a.id = c.albaran_id`;

/**
 * Registra la llegada de un correo. Si ya estaba (mismo message_id), devuelve
 * la fila existente y `nuevo: false`: el UNIQUE es quien decide, no un
 * «¿existe?» previo que dos pasadas a la vez pasarían las dos.
 */
export async function registrarCorreo(
  empresaId: string,
  datos: {
    messageId: string;
    inReplyTo: string | null;
    hashContenido: string | null;
    asunto: string;
    remitente: string | null;
    fecha: string | null;
    texto: string;
    origen: "buzon" | "eml" | "api";
  },
  ejecutor?: Ejecutor
): Promise<{ correo: Correo; nuevo: boolean }> {
  const { rows } = await db(ejecutor).query(
    `INSERT INTO rcp_correos (empresa_id, message_id, in_reply_to, hash_contenido, asunto, remitente, fecha, texto, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (empresa_id, message_id) DO NOTHING
     RETURNING id`,
    [empresaId, datos.messageId, datos.inReplyTo, datos.hashContenido, datos.asunto, datos.remitente, datos.fecha, datos.texto, datos.origen]
  );
  if (rows[0]) return { correo: (await correoPorId(empresaId, rows[0].id, ejecutor))!, nuevo: true };
  const { rows: previas } = await db(ejecutor).query(`${SELECT_CORREO} WHERE c.empresa_id = $1 AND c.message_id = $2`, [empresaId, datos.messageId]);
  return { correo: aCorreo(previas[0]), nuevo: false };
}

export async function correoPorId(empresaId: string, id: string, ejecutor?: Ejecutor): Promise<Correo | null> {
  const { rows } = await db(ejecutor).query(`${SELECT_CORREO} WHERE c.empresa_id = $1 AND c.id = $2`, [empresaId, id]);
  return rows[0] ? aCorreo(rows[0]) : null;
}

export async function actualizarCorreo(
  empresaId: string,
  id: string,
  datos: {
    proveedorId?: string | null;
    tipo?: "PEDIDO" | "ALBARAN" | "DESCONOCIDO";
    resultado: ResultadoCorreo;
    motivo: string | null;
    datosExtraidos?: unknown;
    avisos?: string[];
    pedidoId?: string | null;
    albaranId?: string | null;
  },
  ejecutor?: Ejecutor
): Promise<void> {
  await db(ejecutor).query(
    `UPDATE rcp_correos SET
        proveedor_id = COALESCE($3, proveedor_id),
        tipo = COALESCE($4, tipo),
        resultado = $5,
        motivo = $6,
        datos_extraidos = COALESCE($7, datos_extraidos),
        avisos = COALESCE($8, avisos),
        pedido_id = COALESCE($9, pedido_id),
        albaran_id = COALESCE($10, albaran_id),
        intentos = intentos + 1,
        procesado_at = now()
      WHERE empresa_id = $1 AND id = $2`,
    [
      empresaId,
      id,
      datos.proveedorId ?? null,
      datos.tipo ?? null,
      datos.resultado,
      datos.motivo,
      datos.datosExtraidos === undefined ? null : JSON.stringify(datos.datosExtraidos),
      datos.avisos ?? null,
      datos.pedidoId ?? null,
      datos.albaranId ?? null,
    ]
  );
}

export async function listarCorreos(
  empresaId: string,
  f: { resultado?: string; tipo?: string; limite?: number },
  ejecutor?: Ejecutor
): Promise<Correo[]> {
  const params: unknown[] = [empresaId];
  const cond = ["c.empresa_id = $1"];
  if (f.resultado) {
    params.push(f.resultado);
    cond.push(`c.resultado = $${params.length}`);
  }
  if (f.tipo) {
    params.push(f.tipo);
    cond.push(`c.tipo = $${params.length}`);
  }
  params.push(Math.min(Math.max(f.limite ?? 100, 1), 500));
  const { rows } = await db(ejecutor).query(`${SELECT_CORREO} WHERE ${cond.join(" AND ")} ORDER BY c.created_at DESC LIMIT $${params.length}`, params);
  return rows.map(aCorreo);
}

/** Los correos de albarán que esperan a que exista este pedido. */
export async function correosDeAlbaranEnEspera(empresaId: string, numeroPedidoNormalizado: string, ejecutor?: Ejecutor): Promise<Correo[]> {
  const { rows } = await db(ejecutor).query(
    `${SELECT_CORREO}
      WHERE c.empresa_id = $1 AND c.tipo = 'ALBARAN' AND c.resultado = 'PENDIENTE_REVISION'
        AND c.datos_extraidos->>'pedidoNormalizado' = $2
      ORDER BY c.created_at`,
    [empresaId, numeroPedidoNormalizado]
  );
  return rows.map(aCorreo);
}

export async function contarCorreosEnRevision(empresaId: string, ejecutor?: Ejecutor): Promise<number> {
  const { rows } = await db(ejecutor).query(
    `SELECT COUNT(*)::int AS n FROM rcp_correos WHERE empresa_id = $1 AND resultado IN ('PENDIENTE_REVISION','ERROR')`,
    [empresaId]
  );
  return rows[0]?.n ?? 0;
}

/* ── Pasadas del buzón ───────────────────────────────────────────────────── */

export async function abrirPasada(empresaId: string, origen: "temporizador" | "manual" | "historico" | "eml", correos = 0): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO rcp_buzon_pasadas (empresa_id, origen, correos) VALUES ($1, $2, $3) RETURNING id`,
    [empresaId, origen, correos]
  );
  return rows[0].id;
}

export async function cerrarPasada(
  id: string,
  datos: { correos: number; procesados: number; ignorados: number; errores: number; error: string | null; detalle: unknown[] }
): Promise<void> {
  await pool
    .query(
      `UPDATE rcp_buzon_pasadas
          SET terminada_at = now(), correos = $2, procesados = $3, ignorados = $4, errores = $5, error = $6, detalle = $7
        WHERE id = $1`,
      [id, datos.correos, datos.procesados, datos.ignorados, datos.errores, datos.error, JSON.stringify(datos.detalle)]
    )
    .catch((e) => console.error("[Recepciones] no se ha podido cerrar la pasada:", (e as Error).message));
}

export async function ultimasPasadas(empresaId: string, limite = 10): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id, iniciada_at, terminada_at, correos, procesados, ignorados, errores, error, origen, detalle
       FROM rcp_buzon_pasadas WHERE empresa_id = $1 ORDER BY iniciada_at DESC LIMIT $2`,
    [empresaId, limite]
  );
  return rows;
}

/** Los remitentes admitidos: la unión de los de todos los proveedores activos. */
export async function remitentesAdmitidos(empresaId: string, ejecutor?: Ejecutor): Promise<{ proveedorId: string; remitente: string }[]> {
  const { rows } = await db(ejecutor).query(
    `SELECT id, unnest(remitentes_correo) AS remitente FROM rcp_proveedores WHERE empresa_id = $1 AND activo`,
    [empresaId]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({ proveedorId: r.id, remitente: String(r.remitente).toLowerCase() }));
}
