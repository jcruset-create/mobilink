/**
 * Rendimiento kilométrico de un neumático y su proyección hasta la retirada.
 *
 * La base (`tc_rendimiento_datos`) da los puntos; aquí se hace la cuenta, que
 * así se prueba sin base de datos:
 *
 *  - Punto de partida: (0 km de la goma, profundidad de origen).
 *  - Cada revisión: (km del vehículo − km de inicio, mm medidos).
 *  - Hoy: (km del vehículo ahora − km de inicio, profundidad actual).
 *
 * Con 3 o más puntos distintos se ajusta una recta por mínimos cuadrados a
 * todos (el arco mide con ±0,6 mm de ruido y una sola lectura engaña); con
 * menos, la recta va del origen a hoy. Con menos de 1 mm gastado no se
 * proyecta: dividir por casi cero da vidas de un millón de km.
 */

import { supabase } from "./supabase";
import { kmActualFlota, kmFichaVehiculo } from "./data";

export interface DatosRendimiento {
  vehiculo_id: string;
  matricula: string;
  numero_unidad: string | null;
  km_actual_vehiculo: number | null;
  desde_origen: boolean;
  fecha_inicio: string;
  minimo_mm: number;
  posicion_id: string;
  posicion: string;
  eje: number | null;
  orden: number | null;
  neumatico_id: string;
  numero_interno: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  /** La referencia del catálogo de esa goma (por equivalencia o por texto), si la hay. */
  ref_marca?: string | null;
  ref_modelo?: string | null;
  ref_medida?: string | null;
  recauchutado: boolean | null;
  reesculturado: boolean | null;
  profundidad_actual_mm: number | null;
  km_vehiculo_inicio: number | null;
  profundidad_inicial_mm: number | null;
  fuente_inicio: "catalogo" | "manual";
  /** Marcada «sin seguimiento»: no cuenta en ninguna pantalla. */
  excluido?: boolean;
  puntos: { km_vehiculo: number; mm: number; fecha: string }[];
}

export interface Punto { km: number; mm: number }

export interface Rendimiento {
  /**
   * Los puntos de la línea, ordenados por km de la goma: el origen y cada
   * medición que ha bajado al menos 1 mm desde el punto anterior.
   */
  puntos: Punto[];
  /** Mediciones que no han bajado 1 mm desde el último punto: se ven, no cuentan. */
  descartados: Punto[];
  kmGoma: number | null;
  origenMm: number | null;
  actualMm: number | null;
  gastadoMm: number | null;
  kmPorMm: number | null;
  quedanKm: number | null;
  vidaKm: number | null;
  minimoMm: number;
  metodo: "recta" | "origen" | null;
  /** Por qué no hay proyección, si no la hay. */
  sinProyeccion: string | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Recta por mínimos cuadrados: la pendiente, en mm por km. */
export function pendiente(puntos: Punto[]): number | null {
  if (puntos.length < 2) return null;
  const mx = puntos.reduce((a, p) => a + p.km, 0) / puntos.length;
  const my = puntos.reduce((a, p) => a + p.mm, 0) / puntos.length;
  let sxy = 0, sxx = 0;
  for (const p of puntos) { sxy += (p.km - mx) * (p.mm - my); sxx += (p.km - mx) ** 2; }
  return sxx === 0 ? null : sxy / sxx;
}

/**
 * Cada medición, cambiada por la mediana de ella con la de antes y la de
 * después. El origen (km 0) y la última no se tocan: el origen es un dato y la
 * última es la de hoy, la que enseña la fila.
 */
export function suavizar(p: Punto[]): Punto[] {
  // Solo entre mediciones: el origen no hace de vecino (sus 16,5 mm
  // arrastrarían hacia arriba la primera lectura).
  const med = p.filter((x) => x.km !== 0);
  const suaves = new Map<Punto, Punto>();
  med.forEach((x, i) => {
    if (i === 0 || i === med.length - 1) return;
    const tres = [med[i - 1].mm, x.mm, med[i + 1].mm].sort((a, b) => a - b);
    suaves.set(x, { km: x.km, mm: tres[1] });
  });
  return p.map((x) => suaves.get(x) ?? x);
}

/** Cuánto tiene que bajar una medición, desde el último punto, para entrar en la línea. */
export const BAJADA_MINIMA_MM = 1;

export function calcularRendimiento(d: Pick<DatosRendimiento,
  "km_actual_vehiculo" | "km_vehiculo_inicio" | "profundidad_inicial_mm" | "profundidad_actual_mm" | "minimo_mm" | "puntos">,
): Rendimiento {
  const minimoMm = n(d.minimo_mm) ?? 3;
  const inicio = n(d.km_vehiculo_inicio);
  const origenMm = n(d.profundidad_inicial_mm);
  const actualMm = n(d.profundidad_actual_mm);
  const kmVeh = n(d.km_actual_vehiculo);
  const kmGoma = inicio !== null && kmVeh !== null ? Math.max(0, kmVeh - inicio) : null;

  const base: Rendimiento = {
    puntos: [], descartados: [], kmGoma, origenMm, actualMm, gastadoMm: null, kmPorMm: null,
    quedanKm: null, vidaKm: null, minimoMm, metodo: null, sinProyeccion: null,
  };
  if (origenMm === null) return { ...base, sinProyeccion: "Falta la profundidad de origen" };
  if (inicio === null) return { ...base, sinProyeccion: "Falta el km de inicio" };

  // Un punto por km: si dos lecturas caen en el mismo km, vale la media.
  const porKm = new Map<number, number[]>();
  const meter = (km: number, mm: number) => {
    if (!(km >= 0) || !Number.isFinite(mm)) return;
    porKm.set(km, [...(porKm.get(km) ?? []), mm]);
  };
  meter(0, origenMm);
  for (const p of d.puntos ?? []) {
    const km = n(p.km_vehiculo), mm = n(p.mm);
    if (km !== null && mm !== null && km >= inicio) meter(km - inicio, mm);
  }
  if (kmGoma !== null && actualMm !== null && !porKm.has(kmGoma)) meter(kmGoma, actualMm);
  const todos = [...porKm.entries()]
    .map(([km, l]) => ({ km, mm: l.reduce((a, b) => a + b, 0) / l.length }))
    .sort((a, b) => a.km - b.km);

  // Solo entra en la línea una medición que ha bajado al menos 1 mm desde el
  // último punto: entre medias, lo que sube y baja es el calibre, no la goma
  // (0039LXV: diez revisiones entre 13,5 y 14,3 mm en 6.000 km hacían una
  // nube y movían la recta).
  //
  // Y se compara la medición SUAVIZADA (mediana con la de antes y la de
  // después), no la suelta: una lectura mala —2,3 mm entre dos de 8,5 en
  // 0039LXV eje 2 izq. ext.— bajaba «1 mm» de golpe y hundía la recta.
  const suave = suavizar(todos);
  const puntos: Punto[] = [];
  const descartados: Punto[] = [];
  todos.forEach((p, i) => {
    const ref = puntos[puntos.length - 1];
    const s = suave[i];
    if (!ref || p.km === 0 || s.mm <= ref.mm - BAJADA_MINIMA_MM + 1e-9) puntos.push(s);
    else descartados.push(p);
  });

  const ultimo = todos[todos.length - 1];
  const hoyMm = actualMm ?? ultimo?.mm ?? null;
  const hoyKm = kmGoma ?? ultimo?.km ?? null;
  const gastadoMm = hoyMm !== null ? Math.round((origenMm - hoyMm) * 10) / 10 : null;
  const r: Rendimiento = { ...base, puntos, descartados, gastadoMm, actualMm: hoyMm, kmGoma: hoyKm };

  if (hoyMm === null || hoyKm === null || hoyKm <= 0) return { ...r, sinProyeccion: "Aún no ha recorrido kilómetros" };
  if (gastadoMm === null || gastadoMm < BAJADA_MINIMA_MM) {
    return { ...r, sinProyeccion: "Poco gasto para proyectar (aún no ha bajado 1 mm)" };
  }

  // Con 3 o más puntos de la línea, la recta. Si no, del origen a HOY: los
  // mismos números que enseña la fila (Hoy, Gastado, Km). Antes iba del
  // origen al último punto de la línea, y dos gomas con el mismo Hoy y el
  // mismo Gastado salían con km/mm distintos según cuál fuera su primera
  // lectura suelta (0039LXV eje 1: 6.981 y 8.476).
  let kmPorMm: number;
  let metodo: "recta" | "origen";
  const m = puntos.length >= 3 ? pendiente(puntos) : null;
  if (m !== null && m < 0) { kmPorMm = -1 / m; metodo = "recta"; }
  else { kmPorMm = hoyKm / (origenMm - hoyMm); metodo = "origen"; }

  const quedanKm = Math.max(0, (hoyMm - minimoMm) * kmPorMm);
  return {
    ...r, metodo,
    kmPorMm: Math.round(kmPorMm),
    quedanKm: Math.round(quedanKm),
    vidaKm: Math.round(hoyKm + quedanKm),
  };
}

/** Un grupo del informe: mismo modelo y medida, mismo eje, misma «vida». */
export interface GrupoRendimiento {
  clave: string;
  modelo: string;
  eje: number | null;
  tipo: "nuevo" | "recauchutado" | "reesculturado";
  gomas: number;
  conProyeccion: number;
  kmPorMm: number | null;
  vidaKm: number | null;
  vehiculos: string[];
}

export function agruparRendimiento(filas: DatosRendimiento[]): GrupoRendimiento[] {
  const grupos = new Map<string, GrupoRendimiento & { _kmmm: number[]; _vida: number[] }>();
  for (const f of filas) {
    const tipo = f.reesculturado ? "reesculturado" : f.recauchutado ? "recauchutado" : "nuevo";
    // Por la referencia del catálogo cuando la hay: «COACHZ» y «X COACH Z» son la misma.
    const modelo = (f.ref_modelo
      ? [f.ref_marca, f.ref_modelo, f.ref_medida]
      : [f.marca, f.modelo, f.medida]).filter(Boolean).join(" ") || "Sin modelo";
    const clave = `${modelo}|${f.eje ?? "-"}|${tipo}`;
    const g = grupos.get(clave) ?? {
      clave, modelo, eje: f.eje, tipo, gomas: 0, conProyeccion: 0, kmPorMm: null, vidaKm: null, vehiculos: [],
      _kmmm: [], _vida: [],
    };
    g.gomas += 1;
    if (!g.vehiculos.includes(f.matricula)) g.vehiculos.push(f.matricula);
    const r = calcularRendimiento(f);
    if (r.kmPorMm !== null && r.vidaKm !== null) { g.conProyeccion += 1; g._kmmm.push(r.kmPorMm); g._vida.push(r.vidaKm); }
    grupos.set(clave, g);
  }
  const media = (l: number[]) => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null);
  return [...grupos.values()]
    .map(({ _kmmm, _vida, ...g }) => ({ ...g, kmPorMm: media(_kmmm), vidaKm: media(_vida) }))
    .sort((a, b) => a.modelo.localeCompare(b.modelo) || (a.eje ?? 99) - (b.eje ?? 99));
}

// ── Base de datos ──────────────────────────────────────────────────────────

export async function datosRendimiento(
  f: { vehiculoId?: string | null; empresaId?: string | null; incluirExcluidos?: boolean } = {},
): Promise<DatosRendimiento[]> {
  const { data, error } = await supabase.rpc("tc_rendimiento_datos", {
    p_vehiculo: f.vehiculoId ?? null, p_empresa: f.empresaId ?? null,
  });
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as DatosRendimiento[];
  // Las ruedas «sin seguimiento» solo las quiere la ventana que las reactiva.
  return conKmReconstruido(f.incluirExcluidos ? filas : filas.filter((x) => !x.excluido), f);
}

/** Por encima de esto un odómetro es de otra unidad (Movertis ha dado 8 millones). */
const ODOMETRO_IMPOSIBLE_KM = 3_000_000;

/** Vehículos que se piden uno a uno; con más, hace falta la empresa. */
const MAX_VEHICULOS_SUELTOS = 5;

/**
 * El km del vehículo con el que se calcula el rendimiento.
 *
 * La base lo saca del mayor entre el km del vehículo, sus revisiones y el
 * odómetro mensual de Movertis, y ese odómetro no vale para la mayoría de la
 * flota: parado desde 08/2026, acumulado por GPS o en otra unidad. Aquí se
 * sustituye por el RECONSTRUIDO —la última lectura real (revisión o montaje)
 * más los km de viajes de la telemática desde entonces— o, si no se puede
 * reconstruir, por el último km real. Es el mismo que enseña la ficha.
 *
 * Si el servidor no contesta se queda el de la base, salvo que sea imposible:
 * el rendimiento no puede dejar de salir porque falle esta consulta.
 */
async function conKmReconstruido(
  filas: DatosRendimiento[],
  f: { vehiculoId?: string | null; empresaId?: string | null },
): Promise<DatosRendimiento[]> {
  if (!filas.length) return filas;
  const km = new Map<string, number | null>();
  try {
    const vehiculos = [...new Set(filas.map((x) => x.vehiculo_id))];
    if (f.empresaId && vehiculos.length > MAX_VEHICULOS_SUELTOS) {
      for (const v of await kmActualFlota(f.empresaId)) km.set(v.vehiculoId, v.km);
    } else if (vehiculos.length <= MAX_VEHICULOS_SUELTOS) {
      await Promise.all(vehiculos.map(async (id) => {
        const r = await kmFichaVehiculo(id, false);
        km.set(id, r.reconstruido?.km ?? r.ultimo?.km ?? null);
      }));
    }
  } catch { /* sin servidor: se queda el de la base */ }
  return filas.map((x) => {
    const nuevo = km.get(x.vehiculo_id);
    if (nuevo != null) return { ...x, km_actual_vehiculo: nuevo };
    const deLaBase = Number(x.km_actual_vehiculo);
    return Number.isFinite(deLaBase) && deLaBase >= ODOMETRO_IMPOSIBLE_KM ? { ...x, km_actual_vehiculo: null } : x;
  });
}

export async function estadoSeguimientoRendimiento(vehiculoId: string): Promise<{
  activo: boolean; desde_origen: boolean; km_inicio: number | null; fecha_inicio: string; minimo_retirada_mm: number;
} | null> {
  const { data, error } = await supabase.from("tc_seguimiento_rendimiento")
    .select("activo, desde_origen, km_inicio, fecha_inicio, minimo_retirada_mm").eq("vehiculo_id", vehiculoId).maybeSingle();
  if (error) return null;
  return data as never;
}

export async function activarSeguimientoRendimiento(p: {
  vehiculoId: string; desdeOrigen: boolean; kmInicio?: number | null; fechaInicio?: string | null;
  minimoMm?: number | null; profundidadOrigen?: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc("tc_rendimiento_activar", {
    p_vehiculo: p.vehiculoId, p_desde_origen: p.desdeOrigen, p_km_inicio: p.kmInicio ?? null,
    p_fecha_inicio: p.fechaInicio ?? null, p_minimo_mm: p.minimoMm ?? 3, p_profundidad_origen: p.profundidadOrigen ?? null,
  });
  if (error) throw new Error(error.message.replace(/^SIN_PROFUNDIDAD_ORIGEN:\s*/, ""));
}

export async function desactivarSeguimientoRendimiento(vehiculoId: string): Promise<void> {
  const { error } = await supabase.rpc("tc_rendimiento_desactivar", { p_vehiculo: vehiculoId });
  if (error) throw new Error(error.message);
}

/** El km de montaje de cada goma montada (para ofrecerlo como inicio). Solo lee. */
export async function kmMontajeDeVehiculo(vehiculoId: string): Promise<Map<string, number | null>> {
  const { data, error } = await supabase.from("tc_montajes_actuales")
    .select("neumatico_id, km_montaje").eq("vehiculo_id", vehiculoId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { neumatico_id: string; km_montaje: number | null }[])
    .map((m) => [m.neumatico_id, m.km_montaje == null ? null : Number(m.km_montaje)]));
}

/** Cambia a mano el punto de partida (km y profundidad) de cada goma. */
export async function ajustarInicioRendimiento(
  vehiculoId: string, inicios: { neumaticoId: string; km: number; profundidadMm: number; excluido?: boolean }[],
): Promise<void> {
  const { error } = await supabase.rpc("tc_rendimiento_ajustar_inicio", {
    p_vehiculo: vehiculoId,
    p_inicios: inicios.map((i) => ({ neumatico_id: i.neumaticoId, km: i.km, profundidad_mm: i.profundidadMm, excluido: i.excluido === true })),
  });
  if (error) throw new Error(error.message);
}

export const miles = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Math.round(v).toLocaleString("es-ES");
