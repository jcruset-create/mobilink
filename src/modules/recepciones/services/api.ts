/**
 * Cliente de la API del módulo Recepciones.
 *
 * Único sitio donde se hace `fetch`, con las cabeceras de la sesión unificada
 * y los errores del backend traducidos a una excepción con código. Misma
 * forma que `cash/services/api.ts` y `therefore/services/api.ts`.
 *
 * Los PDF no pasan por `pedir`: se piden como `Blob` para abrirlos en un
 * iframe con la sesión puesta (un `<a href>` no llevaría la cabecera).
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  Bootstrap,
  Contadores,
  Correo,
  EstadoAvisos,
  EstadoBuzon,
  ResultadoEml,
  ResultadoPasada,
  FichaAlbaran,
  FichaPedido,
  FichaRecepcion,
  FilaBandeja,
  FilaPedido,
  Incidencia,
  MapeoArticulo,
  Operario,
  Pedido,
  Proveedor,
  Recepcion,
  Rectificacion,
  ResultadoCierre,
  TipoIncidencia,
} from "../types";

const BASE = "/api/recepciones";

export class ApiError extends Error {
  code: string;
  status: number;
  detalle: unknown;
  constructor(message: string, code: string, status: number, detalle?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detalle = detalle;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const esFormulario = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const cabeceras = await sessionHeaders(init?.body && !esFormulario ? { "Content-Type": "application/json" } : undefined);
  let r: Response;
  try {
    r = await fetch(`${BASE}${ruta}`, { ...init, headers: { ...cabeceras, ...((init?.headers as Record<string, string>) ?? {}) } });
  } catch {
    throw new ApiError("No hay conexión con el servidor.", "SIN_CONEXION", 0);
  }
  const texto = await r.text();
  const cuerpo = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    throw new ApiError(cuerpo?.error ?? `Error ${r.status}`, cuerpo?.code ?? "ERROR", r.status, cuerpo?.detalle);
  }
  return cuerpo as T;
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

const query = (params: Record<string, string | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const bootstrap = () => pedir<Bootstrap>("/bootstrap");

export const bandeja = (f: { pestana?: string; estado?: string; centroId?: string; proveedorId?: string; q?: string }) =>
  pedir<{ albaranes: FilaBandeja[]; contadores: Contadores }>(`/bandeja${query(f)}`);

export const listarPedidos = (f: { estado?: string; centroId?: string; proveedorId?: string; q?: string }) =>
  pedir<{ pedidos: FilaPedido[] }>(`/pedidos${query(f)}`);

export const fichaPedido = (id: string) => pedir<FichaPedido>(`/pedidos/${id}`);

export const crearPedido = (datos: {
  proveedorId: string;
  numeroProveedor: string;
  fechaPedido?: string;
  usuarioPedido?: string;
  centroId?: string;
  centroNombre?: string;
  almacenOrigen?: string;
  transportista?: string;
  observaciones?: string;
  lineas: { descripcionProveedor: string; referenciaProveedor?: string; cantidadPedida: number; precioUnitarioCentimos?: number | null }[];
}) => pedir<FichaPedido>("/pedidos", json(datos));

export const cancelarPedido = (id: string, motivo: string) => pedir<{ pedido: Pedido }>(`/pedidos/${id}/cancelar`, json({ motivo }));

export const crearAlbaran = (
  pedidoId: string,
  datos: {
    numeroProveedor: string;
    fechaExpedicion?: string;
    transportista?: string;
    observaciones?: string;
    lineas: { pedidoLineaId?: string | null; descripcionProveedor?: string; cantidadExpedida: number }[];
  }
) => pedir<FichaPedido>(`/pedidos/${pedidoId}/albaranes`, json(datos));

export const fichaAlbaran = (id: string) => pedir<FichaAlbaran>(`/albaranes/${id}`);

/** Relee los PDF ya guardados para rellenar observación y teléfono donde falten. */
export const releerObservaciones = () =>
  pedir<{ revisados: number; completados: number; sinObservaciones: number; errores: number }>("/albaranes/observaciones/releer", json({}));

export const listarOperarios = (centroId?: string, soloActivos?: boolean) =>
  pedir<{ operarios: Operario[] }>(`/operarios${query({ centroId, soloActivos: soloActivos ? "1" : undefined })}`);

export const crearOperario = (datos: { nombre: string; pin: string; centroId?: string | null }) =>
  pedir<{ operario: Operario }>("/operarios", json(datos));

export const actualizarOperario = (id: string, datos: { nombre?: string; pin?: string; centroId?: string | null; activo?: boolean }) =>
  pedir<{ operario: Operario }>(`/operarios/${id}`, { ...json(datos), method: "PATCH" });

export const cerrarRecepcion = (
  albaranId: string,
  datos: {
    resultado: "OK" | "CON_INCIDENCIA";
    observaciones?: string;
    lineas?: { albaranLineaId: string; cantidadRecibida: number; incidencia?: { tipo: TipoIncidencia; observaciones?: string } | null }[];
    /** Quién recibe y su PIN, cuando el centro tiene operarios dados de alta. */
    operarioId?: string | null;
    pin?: string | null;
  },
  idempotencyKey: string
) =>
  pedir<ResultadoCierre>(`/albaranes/${albaranId}/recepcion`, {
    ...json(datos),
    headers: { "Idempotency-Key": idempotencyKey },
  });

export const cerrarAlbaranConDiferencia = (albaranId: string, motivo: string) =>
  pedir<{ albaran: FichaAlbaran["albaran"] }>(`/albaranes/${albaranId}/cerrar`, json({ motivo }));

export const subirOriginal = (albaranId: string, fichero: File) => {
  const form = new FormData();
  form.append("documento", fichero, fichero.name);
  return pedir<{ documento: FichaAlbaran["documentos"][number] }>(`/albaranes/${albaranId}/original`, { method: "POST", body: form });
};

export const fichaRecepcion = (id: string) => pedir<FichaRecepcion>(`/recepciones/${id}`);

export const rectificar = (recepcionId: string, datos: { motivo: string; lineas: { recepcionLineaId: string; cantidadRecibida: number }[] }) =>
  pedir<{ rectificacion: Rectificacion }>(`/recepciones/${recepcionId}/rectificar`, json(datos));

export const regenerarDocumento = (recepcionId: string) => pedir<{ recepcion: Recepcion }>(`/recepciones/${recepcionId}/documento/regenerar`, json({}));

/** El PDF, con la sesión: para el iframe y para `window.print()`. */
export async function contenidoDocumento(documentoId: string): Promise<Blob> {
  const cabeceras = await sessionHeaders();
  const r = await fetch(`${BASE}/documentos/${documentoId}/contenido`, { headers: cabeceras });
  if (!r.ok) throw new ApiError("No se ha podido abrir el documento.", "DOCUMENTO", r.status);
  return r.blob();
}

export const listarIncidencias = (f: { estado?: string; centroId?: string; proveedorId?: string }) =>
  pedir<{ incidencias: Incidencia[] }>(`/incidencias${query(f)}`);

export const cambiarEstadoIncidencia = (id: string, estado: string, resolucion?: string) =>
  pedir<{ incidencia: Incidencia }>(`/incidencias/${id}/estado`, json({ estado, resolucion }));

export const listarProveedores = () => pedir<{ proveedores: Proveedor[] }>("/proveedores");
export const crearProveedor = (datos: { codigo: string; nombre: string; nif?: string; remitentesCorreo?: string[] }) =>
  pedir<{ proveedor: Proveedor }>("/proveedores", json(datos));
export const actualizarProveedor = (id: string, datos: Partial<{ codigo: string; nombre: string; nif: string; remitentesCorreo: string[]; activo: boolean }>) =>
  pedir<{ proveedor: Proveedor }>(`/proveedores/${id}`, json(datos, "PATCH"));

export const listarMapeos = (proveedorId?: string) => pedir<{ mapeos: MapeoArticulo[] }>(`/mapeo${query({ proveedorId })}`);
export const confirmarMapeo = (datos: { proveedorId: string; descripcionProveedor: string; productoTexto?: string; productoId?: string; ean?: string; referenciaProveedor?: string }) =>
  pedir<{ mapeo: MapeoArticulo }>("/mapeo", json(datos));

/* ── Avisos por WhatsApp ─────────────────────────────────────────────────── */

export const estadoAvisos = () => pedir<EstadoAvisos>("/avisos");
export const guardarConfigAvisos = (datos: { activado?: boolean; telefonoRecepcion?: string }) =>
  pedir<{ activado: boolean; telefonoRecepcion: string | null }>("/avisos/config", json(datos, "PUT"));

/* ── Fase 2: correo del proveedor ────────────────────────────────────────── */

export const estadoBuzon = () => pedir<EstadoBuzon>("/correo/buzon");
export const revisarBuzon = () => pedir<ResultadoPasada>("/correo/buzon/revisar", json({}));
export const cargarHistorico = (desde: string) => pedir<ResultadoPasada>("/correo/buzon/historico", json({ desde }));
export const guardarConfigCorreo = (datos: { asumirExpedicionCompleta?: boolean }) =>
  pedir<{ asumirExpedicionCompleta: boolean }>("/correo/config", json(datos, "PUT"));
export const importarEml = (archivo: File) => {
  const form = new FormData();
  form.append("archivo", archivo, archivo.name);
  return pedir<ResultadoEml>("/correo/eml", { method: "POST", body: form });
};
export const listarCorreos = (f: { resultado?: string; tipo?: string }) => pedir<{ correos: Correo[] }>(`/correo${query(f)}`);
export const fichaCorreo = (id: string) => pedir<{ correo: Correo }>(`/correo/${id}`);
/** El PDF del albarán de un correo que se quedó sin líneas: se sube y se reprocesa. */
export const subirAlbaranDelCorreo = (id: string, archivo: File) => {
  const form = new FormData();
  form.append("documento", archivo, archivo.name);
  return pedir<{ correoId: string; resultado: string; motivo: string | null; pedidoNumero: string | null; albaranNumero: string | null }>(
    `/correo/${id}/albaran-pdf`,
    { method: "POST", body: form }
  );
};

export const reprocesarCorreo = (id: string) =>
  pedir<{ correoId: string; resultado: string; motivo: string | null; pedidoId: string | null; albaranId: string | null }>(`/correo/${id}/reprocesar`, json({}));
export const descargarOriginal = (albaranId: string, enlace?: string) =>
  pedir<{ documento: FichaAlbaran["documentos"][number] }>(`/albaranes/${albaranId}/original/descargar`, json({ enlace }));

/** Reescribe las líneas del albarán con las que dice su PDF. */
export const releerLineasDelOriginal = (albaranId: string) =>
  pedir<{ albaranId: string; numeroProveedor: string; lineasAntes: number; lineasAhora: number; sinPedido: number; avisos: string[] }>(
    `/albaranes/${albaranId}/lineas/releer`,
    json({})
  );
