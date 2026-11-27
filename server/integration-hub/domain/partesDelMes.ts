/**
 * El mes de una unidad pedido POR PARTES, cuando el resumen del mes entero
 * falla.
 *
 * ── El caso que lo motiva ──────────────────────────────────────────────────
 *
 * Desde octubre de 2026, Movertis contesta «Cannot read properties of
 * undefined (reading 'toString')» al resumen de algunas unidades, pero solo si
 * la ventana incluye ciertos días. Medido con 0179JDJ (unidad 26262993):
 *
 *   octubre entero  → error          1–15 oct → error
 *   1–7 oct         → 190 km, odómetro 587.322 → 587.512
 *   10 oct          → 0 km
 *   16–31 oct       → 43 km,  odómetro 587.936 → 587.979
 *
 * O sea, un viaje de entre el 8 y el 15 que su servidor no sabe procesar. El
 * mes no está perdido: se pide por partes —la mitad que falla se vuelve a
 * partir, hasta días sueltos—, se suman las que funcionan y el hueco de los
 * días que siguen fallando se rellena con el ODÓMETRO de las partes vecinas:
 * 587.936 − 587.512 = 424 km. Total 190 + 424 + 43 = 657, que es justo lo que
 * avanzó el odómetro en el mes.
 *
 * Un hueco solo se rellena si a los dos lados hay una parte con odómetro. Si
 * no, el mes no se da por bueno: mejor sin dato que un número inventado.
 */

import { limitesDelMes, medianocheEn, type Mes } from "./meses.ts";

export interface Parte {
  desde: Date;
  hasta: Date;
  /** Días del mes que cubre: [primero, último] (1-31). */
  dias: [number, number];
  resultado:
    | { tipo: "ok"; km: number; odometroInicial: number | null; odometroFinal: number | null; viajes: number | null }
    | { tipo: "error"; mensaje: string }
    | { tipo: "sin_turno" };
}

export interface MesPorPartes {
  /** null si no se ha podido completar. */
  km: number | null;
  odometroInicial: number | null;
  odometroFinal: number | null;
  viajes: number;
  /** Días que fallan incluso pedidos solos. */
  diasFallidos: number[];
  /** Km puestos con el odómetro de las partes vecinas. */
  kmPorOdometro: number;
  /** La suma de las partes pasaba del avance del odómetro y se ha tomado este. */
  ajustadoAlOdometro?: boolean;
  peticiones: number;
  partes: Parte[];
  motivo?: string;
}

const diasDelMes = (m: Mes) => new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();

/** El instante en que empieza el día `d` del mes (d = N+1 es el final del mes). */
function inicioDelDia(mes: Mes, d: number, zona: string): Date {
  return d > diasDelMes(mes) ? limitesDelMes(mes, zona).hasta : medianocheEn(mes.year, mes.month, d, zona);
}

/**
 * Pide el mes por partes. `pedir` hace UNA petición al proveedor (pasando por
 * el limitador) y lanza si falla; devuelve null si no hay turno. Se para al
 * llegar a `maxPeticiones` y lo que falte queda como sin turno.
 *
 * `primeraFallida`: si quien llama ya sabe que el mes entero falla, no se
 * vuelve a pedir y se empieza partiendo.
 */
export async function pedirPorPartes(
  mes: Mes,
  zona: string,
  pedir: (desde: Date, hasta: Date) => Promise<
    { km: number; odometroInicial: number | null; odometroFinal: number | null; viajes: number | null } | "vacio" | null>,
  opciones: { maxPeticiones?: number; primeraFallida?: boolean; rango?: [number, number] } = {},
): Promise<MesPorPartes> {
  const max = opciones.maxPeticiones ?? 24;
  let peticiones = 0;
  const partes: Parte[] = [];

  async function cubrir(d1: number, d2: number, yaFallo: boolean): Promise<void> {
    const desde = inicioDelDia(mes, d1, zona);
    const hasta = inicioDelDia(mes, d2 + 1, zona);
    let error = yaFallo ? "falla el mes entero" : "";
    if (!yaFallo) {
      if (peticiones >= max) { partes.push({ desde, hasta, dias: [d1, d2], resultado: { tipo: "sin_turno" } }); return; }
      peticiones += 1;
      try {
        const r = await pedir(desde, hasta);
        if (r === null) { partes.push({ desde, hasta, dias: [d1, d2], resultado: { tipo: "sin_turno" } }); return; }
        const ok = r === "vacio" ? { km: 0, odometroInicial: null, odometroFinal: null, viajes: 0 } : r;
        partes.push({ desde, hasta, dias: [d1, d2], resultado: { tipo: "ok", ...ok } });
        return;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (d1 === d2) { partes.push({ desde, hasta, dias: [d1, d2], resultado: { tipo: "error", mensaje: error } }); return; }
    const medio = Math.floor((d1 + d2) / 2);
    await cubrir(d1, medio, false);
    await cubrir(medio + 1, d2, false);
  }

  const [a, b] = opciones.rango ?? [1, diasDelMes(mes)];
  await cubrir(a, b, opciones.primeraFallida === true);
  return { ...combinarPartes(partes), peticiones, partes };
}

/** De las partes, el mes: suma lo que funciona y rellena los huecos con el odómetro. */
export function combinarPartes(partes: Parte[]): Omit<MesPorPartes, "peticiones" | "partes"> {
  const orden = [...partes].sort((x, y) => x.dias[0] - y.dias[0]);
  const diasFallidos = orden.filter((p) => p.resultado.tipo === "error").flatMap((p) => rango(p.dias));
  const base = { diasFallidos, viajes: 0, kmPorOdometro: 0 };
  if (orden.some((p) => p.resultado.tipo === "sin_turno")) {
    return { ...base, km: null, odometroInicial: null, odometroFinal: null, motivo: "No se ha podido pedir todo el mes (límite de peticiones)." };
  }

  let km = 0;
  let viajes = 0;
  let kmPorOdometro = 0;
  // La última parte buena CON odómetro, y si desde ella hay un hueco abierto.
  let anterior: number | null = null;
  let hueco = false;
  for (const p of orden) {
    const r = p.resultado;
    if (r.tipo === "error") { hueco = true; continue; }
    if (r.tipo !== "ok") continue;
    if (hueco) {
      if (anterior == null || r.odometroInicial == null) {
        if (r.odometroInicial == null && r.km === 0) continue; // parte vacía: el hueco sigue abierto
        return { ...base, km: null, odometroInicial: null, odometroFinal: null,
          motivo: "Hay días que fallan sin odómetro a los dos lados con el que rellenarlos." };
      }
      const delta = r.odometroInicial - anterior;
      if (delta < 0) {
        return { ...base, km: null, odometroInicial: null, odometroFinal: null, motivo: "El odómetro va hacia atrás entre las partes." };
      }
      kmPorOdometro += delta;
      hueco = false;
    }
    km += r.km;
    viajes += r.viajes ?? 0;
    if (r.odometroFinal != null) anterior = r.odometroFinal;
  }
  if (hueco) {
    return { ...base, km: null, odometroInicial: null, odometroFinal: null,
      motivo: "Los últimos días del mes fallan y no hay odómetro después con el que rellenarlos." };
  }
  const conOdo = orden.filter((p) => p.resultado.tipo === "ok" && p.resultado.odometroInicial != null);
  const ini = conOdo[0]?.resultado;
  const fin = [...orden].reverse().find((p) => p.resultado.tipo === "ok" && p.resultado.odometroFinal != null)?.resultado;
  const odometroInicial = ini?.tipo === "ok" ? ini.odometroInicial : null;
  const odometroFinal = fin?.tipo === "ok" ? fin.odometroFinal : null;
  const total = km + kmPorOdometro;

  // Pedidas por días, las partes de al lado del día roto pueden traer km de
  // más: 0179JDJ en octubre sumaba 1.356 km con el odómetro avanzando 657
  // (26667399: 4.492 frente a 1.177). Los viajes pueden perder tramos, nunca
  // inventarlos: si la suma pasa del avance del odómetro del mes, manda él.
  const avance = odometroInicial != null && odometroFinal != null ? odometroFinal - odometroInicial : null;
  if (avance != null && avance > 0 && total > avance * MARGEN_SOBRE_ODOMETRO) {
    return { diasFallidos, viajes, kmPorOdometro: avance, ajustadoAlOdometro: true, km: avance, odometroInicial, odometroFinal };
  }
  return { diasFallidos, viajes, kmPorOdometro, km: total, odometroInicial, odometroFinal };
}

/**
 * Cuánto puede pasar la suma de las partes del avance del odómetro. En los
 * meses cerrados de una pieza la razón sale 1,00 (mediana) y 1,01 (p90) en
 * 399 vehículos de Empresa Plana, octubre de 2026.
 */
export const MARGEN_SOBRE_ODOMETRO = 1.1;

function rango([a, b]: [number, number]): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
