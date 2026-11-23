/**
 * Mapa de una base en el panel: qué autobuses se pintan y cómo se juntan los
 * que se pisan.
 *
 * Es la misma regla que el mapa de la tablet (`tyrecontrol_app/lib/models/
 * mapa_base.dart`), escrita en TypeScript y sin la librería del mapa para
 * poder probarla. Si una cambia, la otra también: el técnico de la tablet y la
 * oficina tienen que ver los mismos autobuses en el mismo patio.
 */

import type { RevisionEstado } from "../types";
import type { VehiculoPresencia } from "./presenciaBases";
import { prioridadRevision, tieneRevisionPendiente } from "./revisionPendiente";

/** Un autobús en el mapa de su base. */
export interface PinDeMapa {
  v: VehiculoPresencia;
  rev: RevisionEstado;
  /** La posición tiene más de una hora o ya es «posición antigua». */
  vieja: boolean;
  lat: number;
  lng: number;
}

/** Una posición que sirve para pintar: dentro de rango y no el (0, 0). */
export function posicionUtil(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** La posición tiene más de una hora: el autobús puede haberse movido. */
export function posicionVieja(antiguedadMin: number | null | undefined): boolean {
  return antiguedadMin != null && antiguedadMin > 60;
}

/**
 * Los autobuses de `baseId` que van al mapa: con la revisión pendiente y una
 * posición que sirva. Entran los que están dentro y también los de «posición
 * antigua» de esa base (su último punto cae dentro); los que circulan fuera
 * no, porque el mapa es del patio. Ordenados como la lista: primero el que
 * más falta hace.
 */
export function pinesDeLaBase(
  baseId: string,
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): PinDeMapa[] {
  const out: PinDeMapa[] = [];
  for (const v of vehiculos) {
    if (v.delegacion_id !== baseId) continue;
    if (v.estado !== "IN_BASE" && v.estado !== "STALE_POSITION") continue;
    const rev = revisiones.get(v.vehiculo_id);
    if (!rev || !tieneRevisionPendiente(rev)) continue;
    if (!posicionUtil(v.lat, v.lng)) continue;
    out.push({
      v,
      rev,
      vieja: v.estado === "STALE_POSITION" || posicionVieja(v.antiguedad_min),
      lat: v.lat as number,
      lng: v.lng as number,
    });
  }
  out.sort((a, b) => {
    const p = prioridadRevision(a.rev.estado) - prioridadRevision(b.rev.estado);
    if (p !== 0) return p;
    return (b.rev.dias_vencido ?? 0) - (a.rev.dias_vencido ?? 0);
  });
  return out;
}

/** Cuántos pines hay de cada estado de revisión, para la leyenda. */
export function cuentaPorEstado(pines: PinDeMapa[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of pines) m[p.rev.estado] = (m[p.rev.estado] ?? 0) + 1;
  return m;
}

/** Uno o varios autobuses que en pantalla caen en el mismo sitio. */
export interface GrupoDePines {
  pines: PinDeMapa[];
  lat: number;
  lng: number;
}

/** Cuántas matrículas de un grupo se leen en el propio mapa. */
export const MAX_A_LA_VISTA = 3;

/** El estado más urgente del grupo: es el color del grupo. */
export function estadoMasUrgente(g: GrupoDePines): string {
  return g.pines
    .map((p) => p.rev.estado)
    .reduce((a, b) => (prioridadRevision(a) <= prioridadRevision(b) ? a : b));
}

/** Posición en píxeles del mapa del mundo a ese zoom (Web Mercator, 256 px). */
function pixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const escala = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * escala;
  const l = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin((l * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * escala;
  return { x, y };
}

/**
 * Junta los pines que a ese `zoom` quedarían a menos de `separacionPx` en
 * pantalla: dos autobuses aparcados juntos están a tres metros y sus
 * matrículas se taparían. Cada pin se une al primer grupo cercano; como
 * llegan por urgencia, el grupo se forma alrededor del que más falta hace.
 * Desde `zoomMaximo` ya no se agrupa.
 */
export function agruparPines(
  pines: PinDeMapa[],
  zoom: number,
  { separacionPx = 56, zoomMaximo = 19 }: { separacionPx?: number; zoomMaximo?: number } = {},
): GrupoDePines[] {
  if (zoom >= zoomMaximo) return pines.map((p) => ({ pines: [p], lat: p.lat, lng: p.lng }));
  const grupos: PinDeMapa[][] = [];
  const anclas: { x: number; y: number }[] = [];
  for (const p of pines) {
    const px = pixel(p.lat, p.lng, zoom);
    const i = anclas.findIndex((a) => Math.hypot(a.x - px.x, a.y - px.y) < separacionPx);
    if (i >= 0) grupos[i].push(p);
    else {
      grupos.push([p]);
      anclas.push(px);
    }
  }
  return grupos.map((g) => ({
    pines: g,
    lat: g.reduce((s, p) => s + p.lat, 0) / g.length,
    lng: g.reduce((s, p) => s + p.lng, 0) / g.length,
  }));
}

/** La ruta en Google Maps hasta el autobús. Sin clave; abre la app en el móvil. */
export function rutaHasta(lat: number, lng: number, andando = true): string {
  const q = new URLSearchParams({
    api: "1",
    destination: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    travelmode: andando ? "walking" : "driving",
  });
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
