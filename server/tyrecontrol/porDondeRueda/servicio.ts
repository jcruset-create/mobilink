/**
 * Analizar UN día de UN vehículo: pedir el recorrido a Movertis, cargar el
 * mapa que falte, pegar los puntos a las vías y guardar el resumen.
 *
 * Lo usan el trabajo nocturno (worker.ts) y el botón «Analizar un día» de la
 * ficha, que además devuelve los tramos para dibujarlos. Los puntos NO se
 * guardan: solo el resumen por tipo y carretera.
 */

import { supabase } from "../../supabase.ts";
import { enlaceParaPrueba } from "../kilometrajeMensual/router.ts";
import { nextCorrelationId } from "../../integration-hub/infrastructure/repositories.ts";
import { ErrorRitmo, limitadorDe, ritmoDeConfig } from "../../integration-hub/infrastructure/ritmo.ts";
import { medianocheEn, ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";
import {
  asignarVias, puntosABuscar, resumirDia, teselasDe, type Candidata, type PuntoDia, type ResumenDia, type Tramo,
} from "./clasificar.ts";
import { cargarTeselas } from "./mapa.ts";

/** Puntos por llamada a `tc_vias_candidatas`. */
const LOTE_PUNTOS = 800;
const RADIO_M = 30;

export interface ResultadoDia {
  estado: "ok" | "sin_puntos" | "error" | "mapa_pendiente";
  /** Con `mapa_pendiente`: trozos del mapa cargados en esta llamada y los que faltan. */
  teselasCargadas?: number;
  teselasPendientes?: number;
  puntos: number;
  kmResumen: number | null;
  resumen: ResumenDia | null;
  error: string | null;
}

/** [inicio, fin) del día `fecha` (AAAA-MM-DD) en la zona dada. */
export function ventanaDelDia(fecha: string, zona: string): { from: Date; to: Date } {
  const [y, m, d] = fecha.split("-").map(Number);
  const manana = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    from: medianocheEn(y, m, d, zona),
    to: medianocheEn(manana.getUTCFullYear(), manana.getUTCMonth() + 1, manana.getUTCDate(), zona),
  };
}

async function candidatas(p: PuntoDia[], indices: number[]): Promise<Candidata[]> {
  const out: Candidata[] = [];
  for (let i = 0; i < indices.length; i += LOTE_PUNTOS) {
    const lote = indices.slice(i, i + LOTE_PUNTOS).map((k) => ({ i: k, lat: p[k].lat, lng: p[k].lng }));
    const { data, error } = await supabase.rpc("tc_vias_candidatas", { p_puntos: lote, p_radio_m: RADIO_M });
    if (error) throw new Error(`No se pudo buscar en el mapa: ${error.message}`);
    for (const c of (data ?? []) as Candidata[]) out.push({ ...c, osm_id: Number(c.osm_id), dist_m: Number(c.dist_m) });
  }
  return out;
}

async function guardar(vehiculoId: string, empresaId: string, fecha: string, r: ResultadoDia): Promise<void> {
  const { error } = await supabase.from("tc_recorrido_dia").upsert({
    vehiculo_id: vehiculoId, empresa_id: empresaId, fecha,
    estado: r.estado === "mapa_pendiente" ? "error" : r.estado,
    puntos: r.puntos,
    km_puntos: r.resumen?.kmPuntos ?? null,
    km_resumen: r.kmResumen,
    km_sin_via: r.resumen?.kmSinVia ?? null,
    error: r.error,
    procesado_at: new Date().toISOString(),
  }, { onConflict: "vehiculo_id,fecha" });
  if (error) throw new Error(`No se pudo guardar el día: ${error.message}`);
  const { error: eBorrar } = await supabase.from("tc_recorrido_tipo_via").delete().eq("vehiculo_id", vehiculoId).eq("fecha", fecha);
  if (eBorrar) throw new Error(`No se pudo rehacer el día: ${eBorrar.message}`);
  const filas = (r.resumen?.filas ?? []).map((f) => ({
    vehiculo_id: vehiculoId, empresa_id: empresaId, fecha, tipo: f.tipo, ref: f.ref, km: f.km, segundos: f.segundos,
  }));
  if (filas.length) {
    const { error: e } = await supabase.from("tc_recorrido_tipo_via").insert(filas);
    if (e) throw new Error(`No se pudo guardar el resumen: ${e.message}`);
  }
}

export interface OpcionesDia {
  /** Cuánto se puede esperar por el cupo de Movertis. */
  esperaMs: number;
  /** Tope de teselas nuevas que se descargan en esta llamada. */
  topeTeselas?: number;
  /** Cuánto tiempo, como mucho, se dedica a cargar mapa en esta llamada. */
  plazoMapaMs?: number;
}

/**
 * Los puntos y el resumen de Movertis de un (vehículo, día), guardados unos
 * minutos: mientras se carga el mapa de una zona nueva, la pantalla vuelve a
 * llamar varias veces y no hay que gastar dos peticiones a Movertis en cada
 * una.
 */
const RECIENTES_MS = 20 * 60 * 1000;
const recientes = new Map<string, { t: number; puntos: PuntoDia[]; kmResumen: number | null }>();
function recordar(clave: string, puntos: PuntoDia[], kmResumen: number | null) {
  const ahora = Date.now();
  for (const [k, v] of recientes) if (ahora - v.t > RECIENTES_MS) recientes.delete(k);
  recientes.set(clave, { t: ahora, puntos, kmResumen });
}

/**
 * Analiza y guarda. Si faltan teselas por cargar (tope u Overpass ocupado) no
 * se clasifica a medias: devuelve `mapa_pendiente` y se reintenta luego.
 */
export async function analizarDia(
  empresaId: string, vehiculoId: string, fecha: string, op: OpcionesDia,
): Promise<ResultadoDia & { tramos: Tramo[] }> {
  const clave = `${vehiculoId}|${fecha}`;
  const reciente = recientes.get(clave);
  if (reciente && Date.now() - reciente.t <= RECIENTES_MS) {
    return clasificarYGuardar(empresaId, vehiculoId, fecha, reciente.puntos, reciente.kmResumen, op);
  }
  const enl = await enlaceParaPrueba(empresaId, vehiculoId);
  if ("error" in enl) throw new Error(enl.error);
  const { cuenta, unidad, conector } = enl;
  const zona = String(cuenta.config.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO);
  const ventana = ventanaDelDia(fecha, zona);
  const ctx = { tenantId: empresaId, correlationId: await nextCorrelationId() };
  const limitador = limitadorDe(`${empresaId}/${cuenta.key}/${cuenta.accountKey}`, ritmoDeConfig(cuenta.config));

  let puntos: PuntoDia[];
  try {
    await limitador.turno(op.esperaMs);
    const lecturas = await conector.getTelemetryHistory(ctx, unidad, ventana);
    puntos = lecturas
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({ t: l.capturedAt.getTime(), lat: Number(l.latitude), lng: Number(l.longitude) }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng) && !(x.lat === 0 && x.lng === 0))
      .sort((a, b) => a.t - b.t);
  } catch (e) {
    if (e instanceof ErrorRitmo) throw e; // sin cupo: que lo reintente quien llama, sin marcar el día
    const r: ResultadoDia = { estado: "error", puntos: 0, kmResumen: null, resumen: null, error: e instanceof Error ? e.message : String(e) };
    await guardar(vehiculoId, empresaId, fecha, r);
    return { ...r, tramos: [] };
  }

  let kmResumen: number | null = null;
  try {
    await limitador.turno(op.esperaMs);
    const [s] = await conector.getTripSummary(ctx, [unidad], ventana);
    kmResumen = s ? Math.round(s.distanceKm * 10) / 10 : 0;
  } catch {
    // El resumen solo sirve para comparar; sin él también vale (queda null).
  }

  if (puntos.length < 2) {
    const r: ResultadoDia = { estado: "sin_puntos", puntos: puntos.length, kmResumen, resumen: null, error: null };
    await guardar(vehiculoId, empresaId, fecha, r);
    return { ...r, tramos: [] };
  }

  recordar(clave, puntos, kmResumen);
  return clasificarYGuardar(empresaId, vehiculoId, fecha, puntos, kmResumen, op);
}

async function clasificarYGuardar(
  empresaId: string, vehiculoId: string, fecha: string, puntos: PuntoDia[], kmResumen: number | null, op: OpcionesDia,
): Promise<ResultadoDia & { tramos: Tramo[] }> {
  const limite = op.plazoMapaMs != null ? Date.now() + op.plazoMapaMs : undefined;
  const carga = await cargarTeselas(teselasDe(puntos), op.topeTeselas ?? 60, limite);
  if (carga.pendientes > 0) {
    return {
      estado: "mapa_pendiente", puntos: puntos.length, kmResumen, resumen: null, tramos: [],
      teselasCargadas: carga.cargadas, teselasPendientes: carga.pendientes,
      error: carga.error ?? `Faltan ${carga.pendientes} trozos del mapa por cargar.`,
    };
  }
  recientes.delete(`${vehiculoId}|${fecha}`);

  const buscados = puntosABuscar(puntos);
  const resumen = resumirDia(asignarVias(puntos, buscados, await candidatas(puntos, buscados)));
  const r: ResultadoDia = { estado: "ok", puntos: puntos.length, kmResumen, resumen, error: null };
  await guardar(vehiculoId, empresaId, fecha, r);
  return { ...r, tramos: resumen.tramos };
}
