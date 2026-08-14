/**
 * Connect Pro — cliente de la API del backoffice (/api/connect/bo).
 * Autenticación: Bearer de la sesión unificada Supabase (patrón apiFetch).
 */

import { supabase } from "../../administracion/services/supabase";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Descarga un fichero que genera el backend.
 *
 * No vale con un enlace: la API va con Bearer de la sesión y un `<a href>` no
 * lleva cabeceras, así que devolvería un 401. Se pide con fetch, se convierte
 * en blob y se dispara la descarga desde el propio navegador.
 */
export async function boDownload(path: string, nombrePorDefecto: string): Promise<void> {
  const headers: Record<string, string> = {};
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch {
    /* sin sesión: el backend devolverá 401 */
  }
  const res = await fetch(`${API_BASE}/api/connect/bo${path}`, { headers });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, json?.error?.code ?? "error",
      json?.error?.message ?? `Error HTTP ${res.status}`);
  }

  // El nombre lo manda el servidor en Content-Disposition; si no llega, el de aquí
  const cd = res.headers.get("Content-Disposition") ?? "";
  const nombre = /filename="([^"]+)"/.exec(cd)?.[1] ?? nombrePorDefecto;

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export async function boFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch {
    /* sin sesión: el backend devolverá 401 */
  }
  const res = await fetch(`${API_BASE}/api/connect/bo${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? json?.error ?? `Error HTTP ${res.status}`);
  }
  return json as T;
}
