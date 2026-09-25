/**
 * Cliente de la API del módulo OR Manuales.
 *
 * Único sitio donde se hace `fetch`, con las cabeceras de la sesión unificada
 * y los errores del backend traducidos a una excepción con código. Misma forma
 * que `recepciones/services/api.ts`.
 *
 * Los documentos no pasan por `pedir`: se piden como `Blob` para verlos en un
 * visor con la sesión puesta. Un `<a href>` al backend no llevaría la cabecera
 * `Authorization` y enseñaría un error en vez del PDF.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  Aviso,
  Bootstrap,
  Configuracion,
  Documento,
  FichaBloc,
  FilaBloc,
  Indicadores,
  Procesamiento,
  Propuesta,
  ResultadoArchivado,
  ResultadoBusqueda,
  Evento,
  ZonaOcr,
} from "../types";

const BASE = "/api/or-manuales";

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

/* ── Arranque ────────────────────────────────────────────────────────────── */

export const bootstrap = () => pedir<Bootstrap>("/bootstrap");
export const indicadores = () => pedir<{ indicadores: Indicadores }>("/indicadores");

/* ── Blocs ───────────────────────────────────────────────────────────────── */

export type FiltroBlocs = {
  estado?: string;
  q?: string;
  desde?: string;
  hasta?: string;
  incompletos?: boolean;
  cerrados?: boolean;
  conRevisiones?: boolean;
};

export const listarBlocs = (f: FiltroBlocs = {}) =>
  pedir<{ blocs: FilaBloc[] }>(
    `/blocs${query({
      estado: f.estado,
      q: f.q,
      desde: f.desde,
      hasta: f.hasta,
      incompletos: f.incompletos ? "1" : undefined,
      cerrados: f.cerrados ? "1" : undefined,
      conRevisiones: f.conRevisiones ? "1" : undefined,
    })}`
  );

export const propuestaBloc = () => pedir<{ propuesta: Propuesta }>("/blocs/propuesta");

export const crearBloc = (datos: {
  numeroBloc?: string;
  orInicial: number;
  orFinal?: number;
  cantidadOr?: number;
  responsableNombre?: string;
  observaciones?: string;
}) => pedir<FichaBloc>("/blocs", json(datos));

export const bloc = (id: string) => pedir<FichaBloc>(`/blocs/${id}`);

export const editarBloc = (id: string, datos: { numeroBloc?: string; responsableNombre?: string; observaciones?: string }) =>
  pedir<FichaBloc>(`/blocs/${id}`, json(datos, "PATCH"));

/**
 * Borra el bloc. Sin `confirmar`, el servidor se planta si tiene hojas
 * archivadas y contesta cuántas son: la pantalla lo vuelve a pedir con el
 * número delante.
 */
export const eliminarBloc = (id: string, datos: { confirmar?: boolean; motivo?: string } = {}) =>
  pedir<{ ok: true; numeroBloc: string; documentosRetirados: number }>(`/blocs/${id}`, json(datos, "DELETE"));

export const entregarBloc = (
  id: string,
  datos: { responsableNombre: string; fechaEntrega?: string; observaciones?: string }
) => pedir<FichaBloc>(`/blocs/${id}/entregar`, json(datos));

export const devolverBloc = (id: string, datos: { fechaDevolucion?: string; observaciones?: string }) =>
  pedir<FichaBloc>(`/blocs/${id}/devolver`, json(datos));

export const cerrarBloc = (id: string, datos: { observaciones?: string } = {}) =>
  pedir<FichaBloc>(`/blocs/${id}/cerrar`, json(datos));

export const recalcularBloc = (id: string) => pedir<{ estado: string; progreso: FichaBloc["progreso"] }>(`/blocs/${id}/recalcular`, json({}));

/* ── Documentos ──────────────────────────────────────────────────────────── */

export type RespuestaSubida = {
  procesos: Procesamiento[];
  fallidos: { archivo: string; error: string; code: string }[];
};

/** Sube los escaneos. Contesta enseguida: el trabajo va por detrás. */
export const subirDocumentos = (ficheros: File[]) => {
  const form = new FormData();
  for (const f of ficheros) form.append("documentos", f, f.name);
  return pedir<RespuestaSubida>("/documentos", { method: "POST", body: form });
};

export const documentosPendientes = () => pedir<{ documentos: Documento[] }>("/documentos/pendientes");

export const documento = (id: string) => pedir<{ documento: Documento; bloc: FichaBloc["bloc"] | null }>(`/documentos/${id}`);

export const asignarOr = (id: string, numeroOr: number) =>
  pedir<ResultadoArchivado>(`/documentos/${id}/asignar`, json({ numeroOr }));

export const confirmarDocumento = (id: string) => pedir<{ documento: Documento }>(`/documentos/${id}/confirmar`, json({}));

export const sustituirDocumento = (id: string) => pedir<ResultadoArchivado>(`/documentos/${id}/sustituir`, json({}));

export const reprocesarDocumento = (id: string) => pedir<{ documento: Documento }>(`/documentos/${id}/reprocesar`, json({}));

export const eliminarDocumento = (id: string, motivo?: string) =>
  pedir<{ ok: true }>(`/documentos/${id}`, json({ motivo }, "DELETE"));

export const verificarDocumento = (id: string) =>
  pedir<{ documento: Documento; hashActual: string; integro: boolean }>(`/documentos/${id}/verificar`);

/**
 * El contenido del documento, ya descargado.
 *
 * Se pide con `fetch` y se devuelve el blob porque la sesión va en una
 * cabecera: un enlace directo enseñaría «falta el token de sesión».
 */
export async function contenidoDocumento(id: string): Promise<Blob> {
  const cabeceras = await sessionHeaders();
  const r = await fetch(`${BASE}/documentos/${id}/contenido`, { headers: cabeceras });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null);
    throw new ApiError(cuerpo?.error ?? "No se ha podido abrir el documento.", cuerpo?.code ?? "ERROR", r.status);
  }
  return r.blob();
}

/* ── Procesamientos ──────────────────────────────────────────────────────── */

export const procesamientos = () => pedir<{ procesamientos: Procesamiento[] }>("/procesamientos");
export const procesamiento = (id: string) => pedir<{ procesamiento: Procesamiento }>(`/procesamientos/${id}`);

/* ── Avisos ──────────────────────────────────────────────────────────────── */

export const avisos = (todos = false) => pedir<{ avisos: Aviso[] }>(`/avisos${todos ? "?todos=1" : ""}`);
export const notificarAviso = (id: string) => pedir<{ aviso: Aviso }>(`/avisos/${id}/notificar`, json({}));
export const resolverAviso = (id: string) => pedir<{ aviso: Aviso }>(`/avisos/${id}/resolver`, json({}));

/* ── Búsqueda e histórico ────────────────────────────────────────────────── */

export const buscar = (q: string) => pedir<ResultadoBusqueda>(`/buscar${query({ q })}`);
export const historico = (blocId?: string) => pedir<{ eventos: Evento[] }>(`/historico${query({ blocId })}`);

/* ── Configuración ───────────────────────────────────────────────────────── */

export const config = () => pedir<{ config: Configuracion }>("/config");

export const guardarConfig = (datos: {
  zona?: ZonaOcr;
  umbralAutomatico?: number;
  umbralRevision?: number;
  orPorBloc?: number;
  ocrConIa?: boolean;
}) => pedir<{ config: Configuracion }>("/config", json(datos, "PUT"));
