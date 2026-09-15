/**
 * Los tipos del módulo Recepciones en el panel: espejo de lo que devuelve
 * `/api/recepciones/*`, más las etiquetas y colores con que se pintan.
 *
 * El vocabulario (estados, tipos de incidencia) lo manda el servidor en el
 * `bootstrap`; aquí sólo están las ETIQUETAS y los colores, así que un estado
 * nuevo en el servidor sale con su nombre técnico hasta que se le ponga una.
 */

export type EstadoPedido = "PENDIENTE_EXPEDICION" | "PARCIALMENTE_EXPEDIDO" | "EXPEDIDO" | "COMPLETADO" | "CANCELADO";
export type EstadoAlbaran = "EMITIDO" | "EN_TRANSITO" | "PARCIALMENTE_RECIBIDO" | "RECIBIDO" | "RECIBIDO_CON_INCIDENCIA";
export type EstadoIncidencia = "ABIERTA" | "EN_GESTION" | "RESUELTA" | "CANCELADA";
export type TipoIncidencia = "FALTA_MERCANCIA" | "SOBRA_MERCANCIA" | "PRODUCTO_INCORRECTO" | "MERCANCIA_DANADA" | "EMBALAJE_DANADO" | "OTRO";
export type ResultadoRecepcion = "OK" | "CON_INCIDENCIA";

export type Proveedor = { id: string; codigo: string; nombre: string; nif: string | null; remitentesCorreo: string[]; activo: boolean };
export type Centro = { id: string; nombre: string; activo: boolean };

export type Contadores = { pendientes: number; recibidos: number; incidenciasAbiertas: number; pedidosPendientes: number };

export type Bootstrap = {
  rol: string | null;
  permisos: string[];
  centroId: string | null;
  usuario: { id: string; nombre: string };
  proveedores: Proveedor[];
  centros: Centro[];
  contadores: Contadores;
  vocabulario: {
    estadosPedido: EstadoPedido[];
    estadosAlbaran: EstadoAlbaran[];
    estadosIncidencia: EstadoIncidencia[];
    tiposIncidencia: TipoIncidencia[];
    resultados: ResultadoRecepcion[];
    etiquetas: { estadoPedido: Record<string, string>; estadoAlbaran: Record<string, string>; tipoIncidencia: Record<string, string> };
  };
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
  cantidadPedida: number | null;
};

export type FilaBandeja = Albaran & { unidadesExpedidas: number; unidadesRecibidas: number; lineas: number; incidenciasAbiertas: number };

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
  documentoEstado: "PENDIENTE" | "GENERADO" | "ERROR";
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
  tipo: "ALBARAN_ORIGINAL" | "ALBARAN_RECEPCION" | "OTRO";
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

export type FichaPedido = {
  pedido: Pedido;
  lineas: PedidoLinea[];
  albaranes: (Albaran & { lineas: AlbaranLinea[]; documentos: Documento[] })[];
  recepciones: (Recepcion & { lineas: RecepcionLinea[] })[];
  incidencias: Incidencia[];
  eventos: Evento[];
};

export type FichaAlbaran = {
  albaran: Albaran;
  lineas: (AlbaranLinea & { cantidadPendiente: number; articuloLeido: string; sinMapear: boolean })[];
  recepciones: (Recepcion & { lineas: RecepcionLinea[]; rectificaciones: Rectificacion[] })[];
  incidencias: Incidencia[];
  documentos: Documento[];
  eventos: Evento[];
  recibible: boolean;
};

export type FichaRecepcion = {
  recepcion: Recepcion;
  albaran: Albaran | null;
  lineas: RecepcionLinea[];
  incidencias: Incidencia[];
  documentos: Documento[];
  rectificaciones: Rectificacion[];
};

export type ResultadoCierre = {
  recepcion: Recepcion;
  lineas: RecepcionLinea[];
  incidencias: Incidencia[];
  albaran: Albaran;
  repetida: boolean;
};

/* ── Etiquetas y colores ─────────────────────────────────────────────────── */

export const COLOR_ESTADO_PEDIDO: Record<string, string> = {
  PENDIENTE_EXPEDICION: "bg-slate-600/40 text-slate-200",
  PARCIALMENTE_EXPEDIDO: "bg-sky-500/15 text-sky-300",
  EXPEDIDO: "bg-sky-500/25 text-sky-200",
  COMPLETADO: "bg-emerald-500/15 text-emerald-300",
  CANCELADO: "bg-rose-500/15 text-rose-300",
};

export const COLOR_ESTADO_ALBARAN: Record<string, string> = {
  EMITIDO: "bg-slate-600/40 text-slate-200",
  EN_TRANSITO: "bg-sky-500/25 text-sky-200",
  PARCIALMENTE_RECIBIDO: "bg-amber-500/15 text-amber-300",
  RECIBIDO: "bg-emerald-500/15 text-emerald-300",
  RECIBIDO_CON_INCIDENCIA: "bg-amber-500/25 text-amber-200",
};

export const COLOR_ESTADO_INCIDENCIA: Record<string, string> = {
  ABIERTA: "bg-rose-500/15 text-rose-300",
  EN_GESTION: "bg-amber-500/15 text-amber-300",
  RESUELTA: "bg-emerald-500/15 text-emerald-300",
  CANCELADA: "bg-slate-600/40 text-slate-300",
};

export const ETIQUETA_ESTADO_INCIDENCIA: Record<string, string> = {
  ABIERTA: "Abierta",
  EN_GESTION: "En gestión",
  RESUELTA: "Resuelta",
  CANCELADA: "Cancelada",
};

export const ETIQUETA_EVENTO: Record<string, string> = {
  PEDIDO_CREADO: "Pedido creado",
  PEDIDO_CANCELADO: "Pedido cancelado",
  ALBARAN_CREADO: "Albarán creado · en tránsito",
  ORIGINAL_ADJUNTADO: "PDF original adjuntado",
  RECEPCION_OK: "Recepción OK",
  RECEPCION_CON_INCIDENCIA: "Recepción con incidencia",
  INCIDENCIA_ABIERTA: "Incidencia abierta",
  INCIDENCIA_EN_GESTION: "Incidencia en gestión",
  INCIDENCIA_RESUELTA: "Incidencia resuelta",
  INCIDENCIA_CANCELADA: "Incidencia cancelada",
  RECTIFICACION: "Rectificación",
  DOCUMENTO_GENERADO: "Documento generado",
  ALBARAN_CERRADO_CON_DIFERENCIA: "Albarán cerrado con diferencia aceptada",
};

/** Cantidades sin ruido: «2», «2,5». */
export function fmtCantidad(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

export function fmtDiferencia(n: number): string {
  return n > 0 ? `+${fmtCantidad(n)}` : fmtCantidad(n);
}

export function fmtEuros(centimos: number | null | undefined): string {
  if (centimos === null || centimos === undefined) return "—";
  return (centimos / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
