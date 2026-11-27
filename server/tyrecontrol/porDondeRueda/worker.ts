/**
 * Trabajo de cada mañana de «Por dónde rueda».
 *
 * Se despierta cada hora; entre las 6 y las 10 (hora de Madrid), cuando el
 * cierre de km mensuales (2-6) ya ha soltado el cupo de Movertis, analiza los
 * días que falten de los vehículos marcados: ayer y, si un día falló o el
 * vehículo se acaba de marcar, hasta 7 días atrás. Dos peticiones por día y
 * vehículo, al ritmo del mismo limitador que el resto: 30 vehículos son unos
 * 25 minutos.
 */

import { supabase } from "../../supabase.ts";
import { ErrorRitmo } from "../../integration-hub/infrastructure/ritmo.ts";
import { ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";
import { analizarDia } from "./servicio.ts";
import type { UltimaVuelta } from "./resumen.ts";

const LATIDO_MS = 60 * 60 * 1000;
export const HORA_INICIO = Number(process.env.TC_VIAS_HORA_INICIO ?? 6);
export const HORA_FIN = Number(process.env.TC_VIAS_HORA_FIN ?? 10);

/**
 * Lo que hizo la última vuelta, para que la pantalla diga por qué un vehículo
 * marcado aún no tiene datos (cargando el mapa, error…). En memoria: tras un
 * reinicio vale `null` hasta la siguiente vuelta, y la pantalla lo dice así.
 */
let ultima: UltimaVuelta | null = null;
export const ultimaVuelta = (): UltimaVuelta | null => ultima;
export const DIAS_ATRAS = 7;
/** Un día que falló no se reintenta hasta pasado esto. */
const REINTENTO_ERROR_MS = 3 * 3600 * 1000;
/** Días por vuelta: lo que cabe en menos de una hora de cupo. */
const DIAS_POR_VUELTA = 45;
const ESPERA_CUPO_MS = 10 * 60 * 1000;

function partes(ahora: Date, zona: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(ahora);
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? "0";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) % 24 };
}

/** Los días a mirar, de ayer hacia atrás, en AAAA-MM-DD. */
export function diasAMirar(ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO, n = DIAS_ATRAS): string[] {
  const hoy = partes(ahora, zona).fecha;
  const [y, m, d] = hoy.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - 1 - i)).toISOString().slice(0, 10));
}

export interface DiaHecho { vehiculo_id: string; fecha: string; estado: string; procesado_at: string }

/** Qué (vehículo, día) faltan, primero los más recientes. Pura, para probarla. */
export function pendientes(
  vehiculos: { vehiculo_id: string; empresa_id: string }[], dias: string[], hechos: DiaHecho[], ahora: Date,
): { vehiculo_id: string; empresa_id: string; fecha: string }[] {
  const hecho = new Map(hechos.map((h) => [`${h.vehiculo_id}|${h.fecha}`, h]));
  const out: { vehiculo_id: string; empresa_id: string; fecha: string }[] = [];
  for (const fecha of dias) {
    for (const v of vehiculos) {
      const h = hecho.get(`${v.vehiculo_id}|${fecha}`);
      if (h && h.estado !== "error") continue;
      if (h && ahora.getTime() - Date.parse(h.procesado_at) < REINTENTO_ERROR_MS) continue;
      out.push({ ...v, fecha });
    }
  }
  return out;
}

let ocupado = false;

export async function tickPorDondeRueda(ahora = new Date(), forzar = false): Promise<string> {
  if (ocupado) return "ya hay una vuelta en marcha";
  const { hora } = partes(ahora, ZONA_HORARIA_POR_DEFECTO);
  if (!forzar && (hora < HORA_INICIO || hora >= HORA_FIN)) return "fuera de horario";
  ocupado = true;
  try {
    const { data: marcados, error } = await supabase
      .from("tc_analisis_vias_vehiculo").select("vehiculo_id, empresa_id").eq("activo", true);
    if (error) throw new Error(error.message);
    const vehiculos = ((marcados ?? []) as { vehiculo_id: string; empresa_id: string }[])
      .map((v) => ({ vehiculo_id: String(v.vehiculo_id), empresa_id: String(v.empresa_id) }));
    if (vehiculos.length === 0) {
      ultima = { at: ahora.toISOString(), resumen: "sin vehículos marcados", esperandoMapa: false };
      return "sin vehículos marcados";
    }
    const dias = diasAMirar(ahora);
    const { data: hechos, error: e2 } = await supabase
      .from("tc_recorrido_dia").select("vehiculo_id, fecha, estado, procesado_at")
      .in("vehiculo_id", vehiculos.map((v) => v.vehiculo_id)).gte("fecha", dias[dias.length - 1]).limit(5000);
    if (e2) throw new Error(e2.message);
    const cola = pendientes(vehiculos, dias, (hechos ?? []) as DiaHecho[], ahora).slice(0, DIAS_POR_VUELTA);

    const cuenta = { ok: 0, sin_puntos: 0, error: 0, mapa_pendiente: 0 };
    let errorMapa: string | null = null;
    for (const p of cola) {
      try {
        const r = await analizarDia(p.empresa_id, p.vehiculo_id, p.fecha, { esperaMs: ESPERA_CUPO_MS });
        cuenta[r.estado] += 1;
        if (r.estado === "mapa_pendiente") { errorMapa = r.error; break; } // el mapa sigue en la próxima vuelta
      } catch (e) {
        if (e instanceof ErrorRitmo) break; // sin cupo: a la próxima hora
        cuenta.error += 1;
        console.error(`[por-donde-rueda] ${p.vehiculo_id} ${p.fecha}:`, (e as Error)?.message ?? e);
      }
    }
    const resumen = `${cola.length} días en cola: ${cuenta.ok} ok, ${cuenta.sin_puntos} sin puntos, ${cuenta.error} con error, ${cuenta.mapa_pendiente} esperando mapa` +
      (errorMapa ? ` (${errorMapa})` : "");
    ultima = { at: ahora.toISOString(), resumen, esperandoMapa: cuenta.mapa_pendiente > 0 };
    return resumen;
  } finally {
    ocupado = false;
  }
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startPorDondeRueda(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickPorDondeRueda()
      .then((r) => { if (r !== "fuera de horario") console.log(`[por-donde-rueda] ${r}`); })
      .catch((e) => console.error("[por-donde-rueda]", e?.message ?? e));
  };
  setTimeout(vuelta, 15 * 60 * 1000);
  temporizador = setInterval(vuelta, LATIDO_MS);
  console.log(`TyreControl: «por dónde rueda» cada mañana entre las ${HORA_INICIO}:00 y las ${HORA_FIN}:00`);
}
