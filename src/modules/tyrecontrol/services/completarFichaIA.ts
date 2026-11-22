/** Cliente de «✨ Completar fichas con IA» (servidor: catalogoIA/completar.ts). */
import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const BASE = `${API}/api/tyrecontrol/catalogo-ia`;

async function llamar<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    ...init, headers: { ...(await authHeaders()), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as T;
}

export interface FilaHueco {
  id: string; referenciaCompleta: string; marca: string; modelo: string; medida: string;
  enFlota: number; rellenos: number; total: number; vacios: string[];
}
export interface ResumenHuecos { referencias: number; sinProfundidad: number; sinEtiqueta: number; conHueco: number }
export interface Propuesta {
  id: string; referencia_id: string; campo: string; valor: string; url: string | null;
  tipo_fuente: "oficial" | "eprel" | "distribuidor" | null; estado: "pendiente" | "invalida"; motivo: string | null;
  /** Por qué se descartó: «modelo» y «medida» se rescatan a mano («Es el mismo modelo» / «Es la misma medida»). */
  causa?: string | null;
  /** Cómo llama la ficha al modelo («BT 200 R»). */
  modelo_leido?: string | null;
}

export const huecosCatalogo = (f: { marca?: string; campo?: string; soloFlota?: boolean }) => {
  const q = new URLSearchParams();
  if (f.marca) q.set("marca", f.marca);
  if (f.campo) q.set("campo", f.campo);
  if (f.soloFlota) q.set("soloFlota", "1");
  return llamar<{ filas: FilaHueco[]; resumen: ResumenHuecos }>(`/huecos?${q}`);
};
export const completarReferenciaIA = (id: string) =>
  llamar<{ ok: boolean; aviso: string; propuestas: number; invalidas: number }>(`/completar/${id}`, { method: "POST" });
export const propuestasIA = (referenciaIds: string[]) =>
  llamar<Propuesta[]>("/propuestas", { method: "POST", body: JSON.stringify({ referenciaIds }) });
export const aceptarPropuestasIA = (ids: string[], corregir = false) =>
  llamar<{ aceptadas: number; saltadas: number }>("/aceptar", { method: "POST", body: JSON.stringify({ ids, corregir }) });
export const descartarPropuestasIA = (ids: string[]) =>
  llamar<{ ok: true }>("/descartar", { method: "POST", body: JSON.stringify({ ids }) });
export const mismoModeloIA = (referenciaId: string) =>
  llamar<{ alias: string; rescatadas: number; siguenDescartadas: number }>(`/mismo-modelo/${referenciaId}`, { method: "POST" });
export const mismaMedidaIA = (referenciaId: string) =>
  llamar<{ rescatadas: number; siguenDescartadas: number }>(`/misma-medida/${referenciaId}`, { method: "POST" });
