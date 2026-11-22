/**
 * Cliente de la búsqueda de catálogo con IA.
 *
 * La búsqueda pasa por el backend y no por Supabase: hace falta la clave de
 * OpenAI y una clave en el navegador es una clave pública. Aquí solo viaja la
 * frase, y vuelven los candidatos ya clasificados contra el catálogo.
 *
 * Crear NO pasa por aquí: eso lo hace `crearReferenciaNeumatico`, el mismo
 * servicio que usa «Nueva referencia», con la sesión de quien lo pulsa.
 */

import { authHeaders } from "./data";
import type { Candidato } from "./catalogoIA";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";

export interface RespuestaBusquedaIA {
  consulta: { texto: string; fabricante: string | null; medida: string | null; modelo?: string | null };
  candidatos: Candidato[];
  /** URLs que la IA consultó de verdad. Vacío = no buscó. */
  citas: string[];
  /** Por qué no hay resultados, cuando no los hay. Vacío si todo fue normal. */
  aviso: string;
  /** Cuántas referencias de esa marca había ya en el catálogo. */
  enCatalogo: number;
}

/**
 * Busca modelos de una marca en una medida.
 *
 * Marca y medida van por separado, no como frase: en la pantalla se eligen de
 * sendos desplegables y lo elegido no hay que adivinarlo. El servidor sigue
 * aceptando una frase suelta, pero esto no la usa.
 */
export async function buscarModelosIA(params: { marca: string; medida: string; modelo?: string }): Promise<RespuestaBusquedaIA> {
  const r = await fetch(`${API}/api/tyrecontrol/catalogo-ia/buscar`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ marca: params.marca, medida: params.medida, modelo: params.modelo || undefined }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `La búsqueda ha fallado (HTTP ${r.status})`);
  return data as RespuestaBusquedaIA;
}
