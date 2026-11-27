/**
 * Cargar de una vez el mapa de carreteras de una región, sin Overpass.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * El mapa se iba cargando por teselas desde Overpass, el servicio público de
 * OpenStreetMap. El 27/11/2026 dejaron de contestar al servidor el oficial y
 * sus dos espejos a la vez («Falta el mapa de la zona: overpass-api.de no
 * contesta»): con eso no se analiza ningún día de una zona nueva.
 *
 * Aquí se descarga UNA vez el extracto de la región de Geofabrik (el mismo
 * OpenStreetMap, en un fichero) y se meten sus carreteras en `tc_vias_osm`,
 * marcando sus teselas como cargadas. A partir de ahí «Por dónde rueda» no
 * necesita a Overpass dentro de la región; fuera de ella sigue como antes.
 *
 * ── Memoria ─────────────────────────────────────────────────────────────────
 *
 * Dos pasadas por el fichero (en disco, bloque a bloque): primero las vías que
 * son carretera, apuntando qué nodos usan; después, solo esos nodos. Los ids
 * de nodo van en un Float64Array ordenado y la posición en dos Float32Array:
 * unos pocos millones de números, no millones de objetos. Para Cataluña se
 * calculan unos 200-300 MB de pico.
 */

import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { supabase } from "../../supabase.ts";
import { refPrincipal, teselaDe, velocidadMaxima } from "./clasificar.ts";
import { bloquesDeFichero, recorrerBloque } from "./pbf.ts";
import { buscar, unicos } from "./indiceNodos.ts";

export const REGIONES: Record<string, { nombre: string; url: string }> = {
  cataluna: { nombre: "Cataluña", url: "https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf" },
};

/** Las mismas clases que se piden a Overpass (mapa.ts): sin caminos, pistas ni aceras. */
const CLASES = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road)(_link)?$/;
const LOTE = 500;

export interface EstadoCarga {
  region: string;
  fase: "descargando" | "leyendo vías" | "leyendo nodos" | "guardando vías" | "guardando teselas" | "hecho" | "error";
  detalle: string;
  inicio: string;
  fin: string | null;
  vias: number;
  teselas: number;
  error: string | null;
}

let estado: EstadoCarga | null = null;
export const estadoCarga = (): EstadoCarga | null => estado;

function poner(c: Partial<EstadoCarga>) {
  if (estado) estado = { ...estado, ...c };
}

interface Via { id: number; highway: string; ref: string | null; nombre: string | null; maxspeed: number | null; peaje: boolean; desde: number; hasta: number }

/** Arranca la carga en segundo plano. Lanza si ya hay una en marcha. */
export function iniciarCarga(region: string): EstadoCarga {
  const r = REGIONES[region];
  if (!r) throw new Error(`Región desconocida: ${region}`);
  if (estado && !["hecho", "error"].includes(estado.fase)) throw new Error("Ya hay una carga en marcha");
  estado = {
    region, fase: "descargando", detalle: `Descargando el mapa de ${r.nombre} de Geofabrik…`,
    inicio: new Date().toISOString(), fin: null, vias: 0, teselas: 0, error: null,
  };
  void cargar(region).catch((e) => {
    console.error("[mapa-region]", e?.message ?? e);
    poner({ fase: "error", error: e instanceof Error ? e.message : String(e), fin: new Date().toISOString() });
  });
  return estado;
}

async function cargar(region: string): Promise<void> {
  const r = REGIONES[region];
  const ruta = join(tmpdir(), `osm-${region}-${Date.now()}.pbf`);
  try {
    // 1. Descargar a disco (no a memoria).
    const resp = await fetch(r.url, { headers: { "User-Agent": "MobilinkTyreControl/1.0" } });
    if (!resp.ok || !resp.body) throw new Error(`Geofabrik ha contestado ${resp.status}`);
    await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(ruta));
    const mb = Math.round((await stat(ruta)).size / 1e6);

    // 2. Primera pasada: las vías que son carretera y qué nodos usan.
    poner({ fase: "leyendo vías", detalle: `${mb} MB descargados; buscando las carreteras…` });
    const vias: Via[] = [];
    const refs: number[] = [];
    for await (const b of bloquesDeFichero(ruta)) {
      recorrerBloque(b, {
        quiereVia: (t) => CLASES.test(t.highway ?? "") && t.area !== "yes",
        alaVia: (v) => {
          if (v.refs.length < 2) return;
          const t = v.tags;
          vias.push({
            id: v.id, highway: t.highway, ref: refPrincipal(t.ref), nombre: t.name ?? null,
            maxspeed: velocidadMaxima(t.maxspeed), peaje: t.toll === "yes",
            desde: refs.length, hasta: refs.length + v.refs.length,
          });
          for (const n of v.refs) refs.push(n);
        },
      });
    }
    poner({ detalle: `${vias.length.toLocaleString("es-ES")} carreteras encontradas` });

    // 3. Segunda pasada: la posición de los nodos que hacen falta.
    poner({ fase: "leyendo nodos", detalle: `Leyendo la posición de ${refs.length.toLocaleString("es-ES")} puntos…` });
    const ids = unicos(refs);
    // Float32: ~0,3 m de precisión, de sobra para pegar puntos GPS a una
    // carretera, y la mitad de memoria (el servidor no es grande).
    const lat = new Float32Array(ids.length).fill(NaN);
    const lon = new Float32Array(ids.length).fill(NaN);
    for await (const b of bloquesDeFichero(ruta)) {
      recorrerBloque(b, {
        alNodo: (id, la, lo) => {
          const i = buscar(ids, id);
          if (i >= 0) { lat[i] = la; lon[i] = lo; }
        },
      });
    }

    // 4. Guardar las vías, por lotes, y contar las teselas que tocan.
    poner({ fase: "guardando vías", detalle: "Guardando las carreteras…" });
    const teselas = new Map<string, number>();
    let lote: object[] = [];
    let guardadas = 0;
    const vaciar = async () => {
      if (!lote.length) return;
      await conReintento(async () => {
        const { error } = await supabase.from("tc_vias_osm").upsert(lote, { onConflict: "osm_id" });
        if (error) throw new Error(`No se pudieron guardar las vías: ${error.message}`);
      });
      guardadas += lote.length;
      lote = [];
      poner({ vias: guardadas, detalle: `${guardadas.toLocaleString("es-ES")} de ${vias.length.toLocaleString("es-ES")} carreteras guardadas` });
    };
    for (const v of vias) {
      const coords: string[] = [];
      const enVia = new Set<string>();
      for (let k = v.desde; k < v.hasta; k++) {
        const i = buscar(ids, refs[k]);
        if (i < 0 || !Number.isFinite(lat[i])) continue;
        coords.push(`${lon[i].toFixed(7)} ${lat[i].toFixed(7)}`);
        enVia.add(teselaDe(lat[i], lon[i]));
      }
      if (coords.length < 2) continue;
      for (const t of enVia) teselas.set(t, (teselas.get(t) ?? 0) + 1);
      lote.push({
        osm_id: v.id, highway: v.highway, ref: v.ref, nombre: v.nombre, maxspeed: v.maxspeed, peaje: v.peaje,
        geom: `SRID=4326;LINESTRING(${coords.join(",")})`, cargada_at: new Date().toISOString(),
      });
      if (lote.length >= LOTE) await vaciar();
    }
    await vaciar();

    // 5. Marcar las teselas como cargadas: ya no se pedirán a Overpass.
    poner({ fase: "guardando teselas", detalle: `Marcando ${teselas.size.toLocaleString("es-ES")} teselas como cargadas…` });
    const filas = [...teselas].map(([tesela, n]) => ({ tesela, vias: n, cargada_at: new Date().toISOString() }));
    for (let i = 0; i < filas.length; i += LOTE) {
      const trozo = filas.slice(i, i + LOTE);
      await conReintento(async () => {
        const { error } = await supabase.from("tc_vias_osm_teselas").upsert(trozo, { onConflict: "tesela" });
        if (error) throw new Error(`No se pudieron guardar las teselas: ${error.message}`);
      });
    }
    poner({
      fase: "hecho", teselas: teselas.size, fin: new Date().toISOString(),
      detalle: `Mapa de ${r.nombre} cargado: ${guardadas.toLocaleString("es-ES")} carreteras en ${teselas.size.toLocaleString("es-ES")} teselas.`,
    });
    console.log(`[mapa-region] ${estado?.detalle}`);
  } finally {
    await rm(ruta, { force: true }).catch(() => undefined);
  }
}

/** Un fallo pasajero de la base no tira una carga de diez minutos. */
async function conReintento(f: () => Promise<void>): Promise<void> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * (i + 1)));
    }
  }
}
