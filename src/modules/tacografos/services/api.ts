/**
 * Cliente de la API del módulo Tacógrafos.
 *
 * Único sitio donde se hace `fetch`, con las cabeceras de la sesión unificada y
 * los errores del backend traducidos a una excepción que lleva el código. Las
 * pantallas nunca leen `response.ok` ni parsean mensajes a mano.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  Bootstrap,
  Centro,
  DatosExpediente,
  Documento,
  Emitible,
  Expediente,
  Firma,
  PapelFirma,
  Comunicacion,
  FilaCustodia,
  Importacion,
  Sugerencia,
  TextoTramite,
  TipoDocumento,
} from "../types";

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

/**
 * Anular borra del todo un expediente que nunca emitió documento
 * (`eliminado: true`); uno con papel emitido queda como rastro anulado.
 */
export function anularExpediente(
  id: string
): Promise<{ eliminado: boolean; expediente: Expediente | null }> {
  return pedir(`/expedientes/${id}/anular`, { method: "POST" });
}

export function listarDocumentos(
  expedienteId: string
): Promise<{ documentos: Documento[]; emitibles: Emitible[] }> {
  return pedir(`/expedientes/${expedienteId}/documentos`);
}

export function emitirDocumento(
  expedienteId: string,
  tipo: TipoDocumento
): Promise<{ documento: Documento }> {
  return pedir(`/expedientes/${expedienteId}/documentos`, {
    method: "POST",
    body: JSON.stringify({ tipo }),
  });
}

export function anularDocumento(
  documentoId: string,
  motivo: string
): Promise<{ documento: Documento }> {
  return pedir(`/documentos/${documentoId}/anular`, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });
}

/**
 * Descarga el PDF con la sesión puesta.
 *
 * No puede ser un enlace normal: el endpoint exige la cabecera Authorization y
 * un `<a href>` navega sin ella — el navegador enseñaba
 * «Falta el token de sesión» en vez del documento.
 */
export async function descargarDocumento(documentoId: string): Promise<Blob> {
  const r = await fetch(`${BASE}/documentos/${documentoId}/descargar`, {
    headers: await sessionHeaders(),
  });
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}));
    throw new ApiError(
      datos?.error ?? "No se ha podido abrir el documento",
      datos?.code ?? "ERROR",
      r.status
    );
  }
  return r.blob();
}

export function listarFirmas(expedienteId: string): Promise<{ firmas: Firma[] }> {
  return pedir(`/expedientes/${expedienteId}/firmas`);
}

export function firmar(
  expedienteId: string,
  papel: PapelFirma,
  imagen: string,
  nombre: string,
  dni: string
): Promise<{ firma: Firma; expediente: Expediente | null }> {
  return pedir(`/expedientes/${expedienteId}/firmas/${papel}`, {
    method: "PUT",
    body: JSON.stringify({ imagen, nombre, dni }),
  });
}

export function borrarFirma(expedienteId: string, papel: PapelFirma): Promise<{ ok: boolean }> {
  return pedir(`/expedientes/${expedienteId}/firmas/${papel}`, { method: "DELETE" });
}

export function registrarEntrega(
  expedienteId: string,
  d: { fechaEntrega: string; receptorNombre: string; receptorDni: string }
): Promise<{ expediente: Expediente }> {
  return pedir(`/expedientes/${expedienteId}/entregar`, {
    method: "POST",
    body: JSON.stringify(d),
  });
}

export function buscarIntervenciones(texto: string): Promise<{ sugerencias: Sugerencia[] }> {
  return pedir(`/intervenciones?texto=${encodeURIComponent(texto)}`);
}

/** Respaldo en hoja de cálculo, también con la sesión puesta. */
export async function descargarExportacion(
  expedienteId: string
): Promise<{ blob: Blob; nombre: string }> {
  const r = await fetch(`${BASE}/expedientes/${expedienteId}/exportar`, {
    headers: await sessionHeaders(),
  });
  if (!r.ok) {
    const datos = await r.json().catch(() => ({}));
    throw new ApiError(
      datos?.error ?? "No se ha podido exportar",
      datos?.code ?? "ERROR",
      r.status
    );
  }
  const disposicion = r.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(disposicion)?.[1] ?? "expediente.xlsx";
  return { blob: await r.blob(), nombre };
}

/**
 * Sube el informe del anexo II y devuelve lo que se ha leído.
 *
 * Va con `FormData` y sin `Content-Type`: el navegador tiene que poner el suyo
 * con el `boundary`, y fijarlo a mano rompe la subida.
 */
export async function importarInforme(fichero: File): Promise<Importacion> {
  const cuerpo = new FormData();
  cuerpo.append("fichero", fichero);
  const r = await fetch(`${BASE}/importar`, {
    method: "POST",
    headers: await sessionHeaders(),
    body: cuerpo,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ApiError(
      datos?.error ?? "No se ha podido leer el informe",
      datos?.code ?? "ERROR",
      r.status
    );
  }
  return datos as Importacion;
}

export function listarCustodia(): Promise<{ custodia: FilaCustodia[] }> {
  return pedir("/custodia");
}

export function registrarDestruccion(
  expedienteId: string,
  d: { fecha: string; metodo: string; persona: string; hash: string }
): Promise<{ expediente: Expediente }> {
  return pedir(`/expedientes/${expedienteId}/destruccion`, {
    method: "POST",
    body: JSON.stringify(d),
  });
}

export function pendientesComunicar(): Promise<{ pendientes: Expediente[] }> {
  return pedir("/comunicaciones/pendientes");
}

export function listarComunicaciones(
  expedienteId: string
): Promise<{ comunicaciones: Comunicacion[] }> {
  return pedir(`/expedientes/${expedienteId}/comunicaciones`);
}

export function registrarComunicacion(
  expedienteId: string,
  d: { fechaPresentacion: string; referencia: string; notas: string }
): Promise<{ comunicacion: Comunicacion }> {
  return pedir(`/expedientes/${expedienteId}/comunicaciones`, {
    method: "POST",
    body: JSON.stringify(d),
  });
}

export function textoTramite(expedienteId: string): Promise<TextoTramite> {
  return pedir(`/expedientes/${expedienteId}/texto-tramite`);
}

export function guardarCentro(c: Centro): Promise<{ centro: Centro }> {
  return pedir("/centro", { method: "PUT", body: JSON.stringify(c) });
}
