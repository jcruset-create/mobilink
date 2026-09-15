/**
 * Cliente de la API del módulo Therefore.
 *
 * Único sitio donde se hace `fetch`, con las cabeceras de la sesión unificada y
 * los errores del backend traducidos a una excepción que lleva el código. Las
 * pantallas nunca leen `response.ok` ni parsean mensajes a mano.
 *
 * `sessionHeaders()` se espera con `await`: sin él sale un 401 que no se
 * explica por ninguna parte, y ya costó un rato en otro módulo.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  Adjunto,
  AlbaranAnalizado,
  ConsultaErp,
  AnalisisDeExpediente,
  Bootstrap,
  Config,
  Contadores,
  Decision,
  Ficha,
  FilaBandeja,
  Notificacion,
  Prioridad,
} from "../types";

const BASE = "/api/therefore";

export class ApiError extends Error {
  code: string;
  status: number;
  /** Lo que el servidor añade al error: los ids de lo que falta, por ejemplo. */
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
  const cabeceras = await sessionHeaders(
    init?.body ? { "Content-Type": "application/json" } : undefined
  );
  const r = await fetch(`${BASE}${ruta}`, { ...init, headers: cabeceras });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ApiError(
      cuerpo?.error ?? "Error en el módulo Therefore",
      cuerpo?.code ?? "ERROR",
      r.status,
      cuerpo?.detalle
    );
  }
  return cuerpo as T;
}

export function bootstrap(): Promise<Bootstrap> {
  return pedir<Bootstrap>("/bootstrap");
}

export type FiltroBandeja = {
  pestana?: string;
  estado?: string;
  prioridad?: string;
  empresa?: string;
  proveedor?: string;
  accion?: string;
  usuario?: string;
  reclamado?: boolean;
  urgente?: boolean;
  revision?: boolean;
  desde?: string;
  hasta?: string;
  texto?: string;
  orden?: string;
};

export function listarExpedientes(
  filtro: FiltroBandeja
): Promise<{ expedientes: FilaBandeja[]; total: number; contadores: Contadores }> {
  const q = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor === undefined || valor === "" || valor === null) continue;
    q.set(clave, String(valor));
  }
  const cadena = q.toString();
  return pedir(`/expedientes${cadena ? `?${cadena}` : ""}`);
}

export function obtenerExpediente(id: string): Promise<Ficha> {
  return pedir(`/expedientes/${id}`);
}

export type DatosExpediente = {
  tipo: string;
  empresaCodigo: string;
  empresaNombre: string;
  proveedorCodigo: string;
  proveedorNombre: string;
  cuentaContable: string;
  facturaNumero: string;
  facturaFecha: string | null;
  /** En céntimos y con signo. El formulario convierte; el servidor no acepta euros. */
  importeCentimos: number | null;
  casoReferencia: string;
  urgente: boolean;
  observaciones: string;
};

export function crearExpediente(d: DatosExpediente): Promise<Ficha> {
  return pedir("/expedientes", { method: "POST", body: JSON.stringify(d) });
}

export function editarExpediente(
  id: string,
  cambios: { asignadoUsuarioId?: string | null; prioridadManual?: Prioridad | ""; observaciones?: string }
): Promise<Ficha> {
  return pedir(`/expedientes/${id}`, { method: "PATCH", body: JSON.stringify(cambios) });
}

export function cambiarEstado(id: string, estado: string, motivo: string): Promise<Ficha> {
  return pedir(`/expedientes/${id}/estado`, {
    method: "POST",
    body: JSON.stringify({ estado, motivo }),
  });
}

export type DatosActuacion = {
  tipoAccion: string;
  albaranSolicitado: string;
  importeCentimos: number | null;
  indicadorAdicional: string;
  observaciones?: string;
};

export function anadirActuacion(
  expedienteId: string,
  d: DatosActuacion
): Promise<Ficha & { nueva: boolean }> {
  return pedir(`/expedientes/${expedienteId}/actuaciones`, {
    method: "POST",
    body: JSON.stringify(d),
  });
}

/** `iniciar` | `resolver` | `bloquear` | `descartar` | `reabrir`. */
export function moverActuacion(
  actuacionId: string,
  verbo: string,
  datos: { resultado?: string; erpReferencia?: string; motivo?: string } = {}
): Promise<Ficha> {
  return pedir(`/actuaciones/${actuacionId}/${verbo}`, {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

/* ── Correos y decisiones ────────────────────────────────────────────────── */

export function notificacionesDe(
  expedienteId: string
): Promise<{ notificaciones: Notificacion[]; adjuntos: Adjunto[] }> {
  return pedir(`/expedientes/${expedienteId}/notificaciones`);
}

export function listarDecisiones(
  filtro: { estado?: "PENDIENTE" | "DECIDIDA"; expedienteId?: string } = {}
): Promise<{ decisiones: Decision[]; respuestas: Record<string, string[]> }> {
  const q = new URLSearchParams();
  if (filtro.estado) q.set("estado", filtro.estado);
  if (filtro.expedienteId) q.set("expedienteId", filtro.expedienteId);
  const cadena = q.toString();
  return pedir(`/decisiones${cadena ? `?${cadena}` : ""}`);
}

export function resolverDecision(
  id: string,
  respuesta: { decision: string; expedienteId?: string; motivo?: string }
): Promise<{ decision: Decision; expedienteId: string | null; expedienteNumero: string | null }> {
  return pedir(`/decisiones/${id}`, { method: "POST", body: JSON.stringify(respuesta) });
}

export function leerConfig(): Promise<Config> {
  return pedir("/config");
}

export function guardarConfig(cambios: Partial<Config>): Promise<Config> {
  return pedir("/config", { method: "PUT", body: JSON.stringify(cambios) });
}

/* ── Análisis de albaranes ───────────────────────────────────────────────── */

export function analisisDeExpediente(id: string): Promise<AnalisisDeExpediente> {
  return pedir(`/expedientes/${id}/analisis`);
}

/**
 * Sube un PDF al expediente.
 *
 * Va por `FormData` y **sin** `Content-Type`: el navegador tiene que poner el
 * suyo con el `boundary`, y ponerlo a mano rompe el multipart de una forma que
 * el servidor sólo puede describir como «falta el fichero».
 */
export async function subirDocumento(
  expedienteId: string,
  archivo: File
): Promise<{ adjuntoId: string; hash: string; reencolados: number }> {
  const cabeceras = await sessionHeaders();
  const cuerpo = new FormData();
  cuerpo.append("archivo", archivo);
  const r = await fetch(`${BASE}/expedientes/${expedienteId}/documentos`, {
    method: "POST",
    headers: cabeceras,
    body: cuerpo,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ApiError(
      json?.error ?? "No se ha podido subir el documento",
      json?.code ?? "ERROR",
      r.status,
      json?.detalle
    );
  }
  return json;
}

export function reanalizar(actuacionId: string): Promise<AlbaranAnalizado> {
  return pedir(`/actuaciones/${actuacionId}/reanalizar`, { method: "POST" });
}

export function enlaceDocumento(albaranAnalizadoId: string): Promise<{ url: string }> {
  return pedir(`/albaranes/${albaranAnalizadoId}/documento`);
}

/* ── El buzón ────────────────────────────────────────────────────────────── */

export type PasadaBuzon = {
  id: string;
  iniciada_at: string;
  terminada_at: string | null;
  correos: number;
  procesados: number;
  ignorados: number;
  errores: number;
  error: string | null;
  origen: "temporizador" | "manual";
  detalle: { messageId: string; asunto: string; resultado: string; expedienteNumero?: string; error?: string }[];
};

export type EstadoBuzon = {
  configurado: boolean;
  usuario: string | null;
  cadaMinutos: number | null;
  activadoEl: string | null;
  remitentes: string[];
  pasadas: PasadaBuzon[];
};

export function estadoBuzon(): Promise<EstadoBuzon> {
  return pedir("/buzon");
}

export function guardarRemitentes(remitentes: string): Promise<{ remitentes: string[] }> {
  return pedir("/buzon/remitentes", { method: "PUT", body: JSON.stringify({ remitentes }) });
}

export function revisarBuzon(): Promise<Omit<PasadaBuzon, "id" | "iniciada_at" | "terminada_at" | "error" | "origen">> {
  return pedir("/buzon/revisar", { method: "POST" });
}

/**
 * Descarga la bandeja como Excel con los filtros dados.
 *
 * Va a mano y no por `pedir` porque lo que vuelve no es JSON: es un fichero,
 * y hay que entregárselo al navegador como tal.
 */
export async function exportarExcel(filtro: FiltroBandeja): Promise<Blob> {
  const q = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor === undefined || valor === "" || valor === null) continue;
    q.set(clave, String(valor));
  }
  const cabeceras = await sessionHeaders();
  const r = await fetch(`${BASE}/expedientes/exportar?${q.toString()}`, { headers: cabeceras });
  if (!r.ok) {
    const json = await r.json().catch(() => ({}));
    throw new ApiError(json?.error ?? "No se ha podido exportar", json?.code ?? "ERROR", r.status, json?.detalle);
  }
  return r.blob();
}

export type ResultadoEml = {
  messageId: string;
  asunto: string;
  resultado: "procesado" | "duplicado" | "ignorado" | "error";
  expedienteNumero?: string;
  error?: string;
};

export async function importarEml(archivo: File): Promise<ResultadoEml> {
  const cabeceras = await sessionHeaders();
  const cuerpo = new FormData();
  cuerpo.append("archivo", archivo);
  const r = await fetch(`${BASE}/correos/eml`, { method: "POST", headers: cabeceras, body: cuerpo });
  const json = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) {
    throw new ApiError(json?.error ?? "No se ha podido importar el correo", json?.code ?? "ERROR", r.status, json?.detalle);
  }
  return json;
}

export function cargarHistorico(desde: string): Promise<Omit<PasadaBuzon, "id" | "iniciada_at" | "terminada_at" | "error" | "origen">> {
  return pedir("/buzon/historico", { method: "POST", body: JSON.stringify({ desde }) });
}

/* ── ERP ─────────────────────────────────────────────────────────────────── */

export function consultarErp(actuacionId: string): Promise<ConsultaErp> {
  return pedir(`/actuaciones/${actuacionId}/consultar-erp`, { method: "POST" });
}
