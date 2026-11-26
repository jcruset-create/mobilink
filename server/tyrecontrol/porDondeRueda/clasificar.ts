/**
 * «Por dónde rueda»: de los puntos GPS de un día a km por tipo de vía.
 *
 * Todo lo de aquí es puro (sin base ni red) para poder probarlo:
 *   · `tipoDeVia`: la clase de OpenStreetMap + la matrícula de la carretera
 *     (AP-7, A-2, N-340, C-31, T-11, BV-2002…) → uno de los seis tipos.
 *   · `teselasDe`: qué trozos del mapa hacen falta para unos puntos.
 *   · `asignarVias`: a qué vía se pega cada punto, sin saltar de una a otra
 *     cuando hay dos casi igual de cerca (autovía y vía de servicio paralela).
 *   · `resumirDia`: km y tiempo por tipo y carretera, y los tramos para el mapa.
 */

import { distanciaKm } from "../kilometrajeMensual/recorrido.ts";

export const TIPOS = ["autopista", "autovia", "nacional", "autonomica", "local", "urbana", "sin_via"] as const;
export type TipoVia = (typeof TIPOS)[number];

export interface DatosVia {
  osm_id: number;
  highway: string;
  ref: string | null;
  nombre: string | null;
  maxspeed: number | null;
  peaje: boolean;
}
export interface Candidata extends DatosVia { i: number; dist_m: number }

/** La primera matrícula, normalizada: «AP 7;E-15» → «AP-7». */
export function refPrincipal(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const primera = ref.split(/[;,]/)[0].trim().toUpperCase().replace(/\s+/g, "-").replace(/-+/g, "-");
  return primera || null;
}

/**
 * Carreteras de diputación (provinciales): BV-, TV-, LV-, GIV- en Cataluña,
 * CV-xxx de tres cifras no (en Valencia CV- es autonómica). Las ponemos como
 * «local», que es lo que son para el neumático: estrechas y con curvas.
 */
const PROVINCIAL = /^(BV|TV|LV|GIV|GI-V)-?\d/;

export function tipoDeVia(v: Pick<DatosVia, "highway" | "ref" | "maxspeed" | "peaje">): TipoVia {
  const h = v.highway.replace(/_link$/, "");
  const ref = refPrincipal(v.ref);
  const urbanaPorVelocidad = v.maxspeed != null && v.maxspeed <= 50;

  if (h === "motorway") return v.peaje || (ref != null && /^AP-/.test(ref)) ? "autopista" : "autovia";
  if (ref) {
    if (/^AP-/.test(ref)) return "autopista";
    if (/^A-\d/.test(ref)) return "autovia";
    if (/^N-\d/.test(ref)) return "nacional";
    if (h === "trunk") return "autovia";
    if (PROVINCIAL.test(ref)) return "local";
    if (/^[A-Z]{1,3}-\d/.test(ref)) return "autonomica";
  }
  if (h === "trunk") return "autovia";
  if (h === "residential" || h === "living_street") return "urbana";
  // Sin matrícula: una avenida dentro del pueblo (primary/secondary sin ref)
  // es urbana; un camino asfaltado entre campos a 70-90 es local.
  if (urbanaPorVelocidad) return "urbana";
  if (v.maxspeed == null && ["primary", "secondary", "tertiary"].includes(h)) return "urbana";
  return "local";
}

/** Velocidad máxima de OSM: «50», «ES:urban», «ES:rural», «ES:motorway». */
export function velocidadMaxima(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const s = valor.trim().toLowerCase();
  if (s.endsWith(":urban") || s.endsWith(":zone30") || s === "walk") return s.endsWith("zone30") ? 30 : 50;
  if (s.endsWith(":rural")) return 90;
  if (s.endsWith(":trunk")) return 100;
  if (s.endsWith(":motorway")) return 120;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return s.includes("mph") ? Math.round(n * 1.609) : n;
}

// ── Teselas ───────────────────────────────────────────────────────────────
/** Lado de una tesela, en grados. 0,1° ≈ 11 × 8 km en España. */
export const LADO_TESELA = 0.1;

export function teselaDe(lat: number, lng: number): string {
  return `${Math.floor(lat / LADO_TESELA)}_${Math.floor(lng / LADO_TESELA)}`;
}

/** La caja [sur, oeste, norte, este] de una tesela. */
export function cajaDeTesela(t: string): [number, number, number, number] {
  const [a, b] = t.split("_").map(Number);
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return [r(a * LADO_TESELA), r(b * LADO_TESELA), r((a + 1) * LADO_TESELA), r((b + 1) * LADO_TESELA)];
}

/**
 * Las teselas que tocan unos puntos. Un punto pegado al borde también pide la
 * vecina: la carretera puede estar al otro lado de la línea.
 */
export function teselasDe(puntos: { lat: number; lng: number }[], margen = 0.0005): string[] {
  const s = new Set<string>();
  for (const p of puntos) {
    for (const dLat of [-margen, 0, margen]) {
      for (const dLng of [-margen, 0, margen]) s.add(teselaDe(p.lat + dLat, p.lng + dLng));
    }
  }
  return [...s].sort();
}

// ── Asignar cada punto a una vía ──────────────────────────────────────────
export interface PuntoDia { t: number; lat: number; lng: number }
export interface PuntoAsignado extends PuntoDia { via: DatosVia | null; tipo: TipoVia }

/** Si la vía de antes sigue entre las candidatas y no está más de esto peor, se sigue en ella. */
const HISTERESIS_M = 12;
/** Por debajo de esto el vehículo está parado: no se busca vía, se queda la de antes. */
export const PARADO_KM = 0.02;

/**
 * Los índices de los puntos que hay que buscar en el mapa: los que se han
 * movido desde el último buscado. Parado en la base, un punto basta.
 */
export function puntosABuscar(p: PuntoDia[]): number[] {
  const out: number[] = [];
  let ultimo: PuntoDia | null = null;
  p.forEach((x, i) => {
    if (!ultimo || distanciaKm(ultimo, x) >= PARADO_KM) { out.push(i); ultimo = x; }
  });
  return out;
}

/**
 * A qué vía se pega cada punto. `buscados` son los índices que se miraron en
 * el mapa (ver `puntosABuscar`); los demás estaban parados y heredan la vía
 * de antes. Uno buscado sin ninguna vía cerca queda «sin vía».
 */
export function asignarVias(p: PuntoDia[], buscados: number[], candidatas: Candidata[]): PuntoAsignado[] {
  const porPunto = new Map<number, Candidata[]>();
  for (const c of candidatas) {
    const l = porPunto.get(c.i) ?? [];
    l.push(c);
    porPunto.set(c.i, l);
  }
  const mirados = new Set(buscados);
  const out: PuntoAsignado[] = [];
  let anterior: DatosVia | null = null;
  let anteriorTipo: TipoVia = "sin_via";
  for (let i = 0; i < p.length; i++) {
    const lista = porPunto.get(i);
    if (!lista) {
      if (mirados.has(i)) { anterior = null; anteriorTipo = "sin_via"; }
      out.push({ ...p[i], via: anterior, tipo: anteriorTipo });
      continue;
    }
    const orden = [...lista].sort((x, y) => x.dist_m - y.dist_m);
    let elegida: Candidata = orden[0];
    if (anterior) {
      const prev: DatosVia = anterior;
      const cerca = (c: Candidata | undefined) => c != null && c.dist_m <= orden[0].dist_m + HISTERESIS_M;
      const misma = orden.find((c) => c.osm_id === prev.osm_id);
      // La misma vía, o la misma carretera en otro tramo de OSM.
      const mismaRef = prev.ref ? orden.find((c) => c.ref === prev.ref) : undefined;
      if (cerca(misma)) elegida = misma!;
      else if (cerca(mismaRef)) elegida = mismaRef!;
    }
    const via: DatosVia = {
      osm_id: elegida.osm_id, highway: elegida.highway, ref: elegida.ref, nombre: elegida.nombre,
      maxspeed: elegida.maxspeed, peaje: elegida.peaje,
    };
    anterior = via;
    anteriorTipo = tipoDeVia(via);
    out.push({ ...p[i], via, tipo: anteriorTipo });
  }
  return out;
}

// ── Resumen del día ───────────────────────────────────────────────────────
export interface FilaTipoVia { tipo: TipoVia; ref: string; km: number; segundos: number }
export interface Tramo { tipo: TipoVia; ref: string | null; nombre: string | null; puntos: [number, number][] }
export interface ResumenDia {
  kmPuntos: number;
  kmSinVia: number;
  filas: FilaTipoVia[];
  tramos: Tramo[];
}

/** Más rápido que esto entre dos puntos es un salto del GPS, no un trayecto. */
const VELOCIDAD_IMPOSIBLE_KMH = 160;
/** Un hueco de más de esto no suma tiempo (sí km): no sabemos qué pasó dentro. */
const HUECO_TIEMPO_S = 10 * 60;

export function resumirDia(p: PuntoAsignado[]): ResumenDia {
  const acum = new Map<string, FilaTipoVia>();
  const sumar = (tipo: TipoVia, ref: string, km: number, s: number) => {
    const k = `${tipo}|${ref}`;
    const f = acum.get(k) ?? { tipo, ref, km: 0, segundos: 0 };
    f.km += km;
    f.segundos += s;
    acum.set(k, f);
  };
  const tramos: Tramo[] = [];
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    const b = p[i];
    const refB = refPrincipal(b.via?.ref) ?? "";
    const ultimo = tramos[tramos.length - 1];
    if (!ultimo || ultimo.tipo !== b.tipo || (ultimo.ref ?? "") !== refB) {
      const nuevo: Tramo = { tipo: b.tipo, ref: refB || null, nombre: b.via?.nombre ?? null, puntos: [] };
      // Que los tramos se toquen en el mapa: el nuevo empieza donde acaba el otro.
      if (ultimo) nuevo.puntos.push(ultimo.puntos[ultimo.puntos.length - 1]);
      tramos.push(nuevo);
    }
    tramos[tramos.length - 1].puntos.push([b.lat, b.lng]);
    if (i === 0) continue;

    const a = p[i - 1];
    const km = distanciaKm(a, b);
    const s = (b.t - a.t) / 1000;
    if (km < PARADO_KM / 2) continue; // parado: ni km ni tiempo en marcha
    if (s > 0 && km / (s / 3600) > VELOCIDAD_IMPOSIBLE_KMH) continue;
    total += km;
    const seg = s > HUECO_TIEMPO_S ? 0 : s;
    const refA = refPrincipal(a.via?.ref) ?? "";
    if (a.tipo === b.tipo && refA === refB) sumar(b.tipo, refB, km, seg);
    else {
      sumar(a.tipo, refA, km / 2, seg / 2);
      sumar(b.tipo, refB, km / 2, seg / 2);
    }
  }
  const filas = [...acum.values()]
    .map((f) => ({ ...f, km: Math.round(f.km * 100) / 100, segundos: Math.round(f.segundos) }))
    .filter((f) => f.km > 0)
    .sort((x, y) => y.km - x.km);
  const kmSinVia = filas.filter((f) => f.tipo === "sin_via").reduce((s, f) => s + f.km, 0);
  return { kmPuntos: Math.round(total * 100) / 100, kmSinVia: Math.round(kmSinVia * 100) / 100, filas, tramos };
}
