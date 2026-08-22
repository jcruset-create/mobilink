/**
 * Cliente de la API del módulo Tacógrafos.
 *
 * Único sitio donde se hace `fetch`, con las cabeceras de la sesión unificada y
 * los errores del backend traducidos a una excepción que lleva el código. Las
 * pantallas nunca leen `response.ok` ni parsean mensajes a mano.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type { Bootstrap, Centro, DatosExpediente, Expediente } from "../types";

const BASE = "/api/tacografos";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
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
      cuerpo?.error ?? "Error en el módulo de Tacógrafos",
      cuerpo?.code ?? "ERROR",
      r.status
    );
  }
  return cuerpo as T;
}

export function bootstrap(): Promise<Bootstrap> {
  return pedir<Bootstrap>("/bootstrap");
}

export function listarExpedientes(filtro: {
  texto?: string;
  tipo?: string;
  estado?: string;
}): Promise<{ expedientes: Expediente[] }> {
  const q = new URLSearchParams();
  if (filtro.texto) q.set("texto", filtro.texto);
  if (filtro.tipo) q.set("tipo", filtro.tipo);
  if (filtro.estado) q.set("estado", filtro.estado);
  const cadena = q.toString();
  return pedir(`/expedientes${cadena ? `?${cadena}` : ""}`);
}

export function obtenerExpediente(id: string): Promise<{ expediente: Expediente }> {
  return pedir(`/expedientes/${id}`);
}

export function crearExpediente(d: DatosExpediente): Promise<{ expediente: Expediente }> {
  return pedir("/expedientes", { method: "POST", body: JSON.stringify(d) });
}

export function actualizarExpediente(
  id: string,
  d: DatosExpediente
): Promise<{ expediente: Expediente }> {
  return pedir(`/expedientes/${id}`, { method: "PUT", body: JSON.stringify(d) });
}

export function anularExpediente(id: string): Promise<{ expediente: Expediente }> {
  return pedir(`/expedientes/${id}/anular`, { method: "POST" });
}

export function guardarCentro(c: Centro): Promise<{ centro: Centro }> {
  return pedir("/centro", { method: "PUT", body: JSON.stringify(c) });
}
