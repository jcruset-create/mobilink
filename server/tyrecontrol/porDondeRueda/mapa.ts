/**
 * El mapa de carreteras, cargado por teselas de OpenStreetMap solo donde
 * ruedan los vehículos marcados. Se descarga de Overpass (gratis, sin clave)
 * la primera vez que hace falta una tesela y se queda en `tc_vias_osm`.
 *
 * Solo las clases que importan para el neumático; caminos, pistas, aceras y
 * vías de servicio no entran (un autobús por un camino es un error del GPS o
 * una cochera, y meterlos haría que se pegara a ellos).
 *
 * Hablar con Overpass —reintentos, cambio de servidor y el motivo en
 * cristiano— es cosa de `overpass.ts`: es un servicio compartido que va a
 * ratos, y rendirse al primer tropiezo dejaba el día sin analizar.
 */

import { supabase } from "../../supabase.ts";
import { cajaDeTesela, refPrincipal, velocidadMaxima } from "./clasificar.ts";
import { pedirAOverpass, servidoresDe } from "./overpass.ts";

/**
 * Los servidores de Overpass, en orden. Varios separados por comas en
 * `TC_OVERPASS_URL`; sin variable, el oficial. Se lee en cada descarga y no
 * al cargar el módulo: así cambiar la variable en el panel de Render surte
 * efecto al reiniciar, sin depender de cuándo se importó esto.
 */
const servidores = () => servidoresDe(process.env.TC_OVERPASS_URL);
const CLASES = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road)(_link)?$";
/** Las teselas no caducan solas: las carreteras cambian poco. Se recargan pasado esto. */
const VIGENCIA_TESELA_MS = 180 * 24 * 3600 * 1000;
const LOTE = 500;

export interface FilaVia {
  osm_id: number;
  highway: string;
  ref: string | null;
  nombre: string | null;
  maxspeed: number | null;
  peaje: boolean;
  geom: string;
}

interface ElementoOverpass {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** De la respuesta de Overpass a filas de `tc_vias_osm` (geometría en EWKT). */
export function filasDeOverpass(json: { elements?: ElementoOverpass[] }): FilaVia[] {
  const out: FilaVia[] = [];
  for (const e of json.elements ?? []) {
    if (e.type !== "way" || !e.tags?.highway || !e.geometry || e.geometry.length < 2) continue;
    const coords = e.geometry.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
    if (coords.length < 2) continue;
    const t = e.tags;
    out.push({
      osm_id: e.id,
      highway: t.highway,
      ref: refPrincipal(t.ref),
      nombre: t.name ?? null,
      maxspeed: velocidadMaxima(t.maxspeed),
      peaje: t.toll === "yes",
      geom: `SRID=4326;LINESTRING(${coords.map((g) => `${g.lon} ${g.lat}`).join(",")})`,
    });
  }
  return out;
}

export function consultaOverpass(tesela: string): string {
  const [s, w, n, e] = cajaDeTesela(tesela);
  return `[out:json][timeout:90];way["highway"~"${CLASES}"](${s},${w},${n},${e});out tags geom;`;
}

async function descargar(tesela: string): Promise<FilaVia[]> {
  // Los reintentos y el cambio de servidor los lleva el cliente: aquí solo se
  // pide la tesela y se traduce lo que venga.
  const json = await pedirAOverpass(consultaOverpass(tesela), { servidores: servidores() });
  return filasDeOverpass(json as { elements?: ElementoOverpass[] });
}

/** Las teselas de la lista que aún no están (o están caducadas). */
export async function teselasQueFaltan(teselas: string[]): Promise<string[]> {
  if (teselas.length === 0) return [];
  const hay = new Map<string, number>();
  for (let i = 0; i < teselas.length; i += 200) {
    const { data, error } = await supabase
      .from("tc_vias_osm_teselas").select("tesela, cargada_at").in("tesela", teselas.slice(i, i + 200));
    if (error) throw new Error(`No se pudieron leer las teselas: ${error.message}`);
    for (const f of (data ?? []) as { tesela: string; cargada_at: string }[]) hay.set(String(f.tesela), Date.parse(String(f.cargada_at)));
  }
  const ahora = Date.now();
  return teselas.filter((t) => !hay.has(t) || ahora - hay.get(t)! > VIGENCIA_TESELA_MS);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga y guarda las teselas que faltan, una a una (Overpass es un
 * servicio compartido: nada de pedir veinte a la vez). Devuelve cuántas quedan
 * sin cargar, por tope o por error; el que llama decide si espera.
 */
export async function cargarTeselas(
  teselas: string[], tope = 60, limiteMs?: number,
): Promise<{ cargadas: number; pendientes: number; error: string | null }> {
  const faltan = await teselasQueFaltan(teselas);
  let cargadas = 0;
  let error: string | null = null;
  for (const t of faltan.slice(0, tope)) {
    // Con plazo (petición desde la pantalla), se para a tiempo y se contesta:
    // el proxy de Render corta una petición larga con un 502 (27/11/2026).
    if (limiteMs != null && Date.now() >= limiteMs) break;
    try {
      const filas = await descargar(t);
      for (let i = 0; i < filas.length; i += LOTE) {
        const { error: e } = await supabase.from("tc_vias_osm").upsert(filas.slice(i, i + LOTE), { onConflict: "osm_id" });
        if (e) throw new Error(`No se pudieron guardar las vías: ${e.message}`);
      }
      const { error: e2 } = await supabase.from("tc_vias_osm_teselas")
        .upsert({ tesela: t, vias: filas.length, cargada_at: new Date().toISOString() }, { onConflict: "tesela" });
      if (e2) throw new Error(`No se pudo guardar la tesela: ${e2.message}`);
      cargadas += 1;
      await espera(1_000);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break; // Overpass ocupado o caído: se sigue en la próxima vuelta.
    }
  }
  return { cargadas, pendientes: faltan.length - cargadas, error };
}
