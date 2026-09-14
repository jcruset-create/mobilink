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
import type { Bootstrap, Config, Ficha, FilaBandeja, Contadores, Prioridad } from "../types";

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

export function leerConfig(): Promise<Config> {
  return pedir("/config");
}

export function guardarConfig(cambios: Partial<Config>): Promise<Config> {
  return pedir("/config", { method: "PUT", body: JSON.stringify(cambios) });
}
