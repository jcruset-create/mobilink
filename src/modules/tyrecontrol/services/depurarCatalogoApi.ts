/** Cliente de «🧹 Depurar catálogo» (servidor: catalogoIA/depurar.ts). */
import { authHeaders } from "./data";
import type { Diagnostico } from "./depurarCatalogo";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const BASE = `${API}/api/tyrecontrol/catalogo-ia/depurar`;

async function llamar<T>(ruta: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as T;
}

export const diagnosticoCatalogo = () => llamar<Diagnostico>("");
export const guardarEquivalencias = (items: { marca: string; modelo: string; medida: string; referenciaId: string }[]) =>
  llamar<{ guardadas: number }>("/equivalencias", { items });
export const quitarEquivalencias = (ids: string[]) => llamar<{ ok: true }>("/equivalencias/quitar", { ids });
export const cambiarActivoCatalogo = (f: { marcas: string[]; modelos: string[]; activo: boolean }) =>
  llamar<{ marcas: number; modelos: number; saltadas: number }>("/activo", f);
export const marcarDistintos = (tipo: "modelo" | "medida", a: string, b: string) =>
  llamar<{ ok: true }>("/distintos", { tipo, a, b });
