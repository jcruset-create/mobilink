/**
 * Km de una revisión o de un montaje pedidos A DEMANDA desde la ficha del
 * neumático: la parte pura (sin base ni red), con pruebas.
 *
 * Es la misma decisión que toma el relleno nocturno (`worker.ts`) —odómetro del
 * Hub, cotas de fuera de la API, coherencia—, pero devuelta como PROPUESTA para
 * que una persona la vea y la guarde, en vez de escribirse sola.
 */

import { esCoherente, hayCotaIndependiente, type Cotas } from "./coherencia.ts";

/** Lo que importa de `odometroEnInstante` (HistoricOdometerService). */
export type LecturaHub =
  | { estado: "encontrado"; odometro: { odometerKm: number; corroboracion: "dos_ventanas" | "una_ventana"; instante: Date } }
  | { estado: "discrepancia"; motivo: string }
  | { estado: "sin_lectura" }
  | { estado: "sin_telematica" }
  | { estado: "dia_abierto"; motivo: string }
  | { estado: "no_disponible"; motivo: string };

export type Propuesta =
  | { estado: "ok"; km: number; corroboracion: "dos_ventanas" | "una_ventana"; capturadoAt: string }
  | { estado: "no"; motivo: string };

const redondo = (km: number) => Math.round(km).toLocaleString("es-ES");

/** De la lectura del Hub y las cotas, una propuesta con su motivo. */
export function proponer(lectura: LecturaHub, cotas: Cotas): Propuesta {
  if (lectura.estado !== "encontrado") {
    const motivo =
      lectura.estado === "sin_telematica" ? "El vehículo no está enlazado con ninguna cuenta de telemática."
      : lectura.estado === "sin_lectura" ? "El proveedor no tiene odómetro para esa fecha (sin viajes registrados alrededor)."
      : lectura.estado === "dia_abierto" ? "Es de hoy: el proveedor aún está cerrando el día. Se podrá pedir mañana."
      : lectura.motivo;
    return { estado: "no", motivo };
  }
  const km = lectura.odometro.odometerKm;
  if (lectura.odometro.corroboracion === "una_ventana" && !hayCotaIndependiente(cotas)) {
    return {
      estado: "no",
      motivo: `El proveedor da ${redondo(km)} km, pero en una sola consulta y sin nada con qué comprobarlo. Escríbelo a mano si lo sabes.`,
    };
  }
  const v = esCoherente(km, cotas);
  if (v.estado === "rechazado") return { estado: "no", motivo: v.motivo };
  return {
    estado: "ok",
    km: Math.round(km),
    corroboracion: lectura.odometro.corroboracion,
    capturadoAt: lectura.odometro.instante.toISOString(),
  };
}

/** Un km escrito a mano: entero, positivo y coherente con las vecinas. */
export function validarManual(km: unknown, cotas: Cotas): { estado: "ok"; km: number } | { estado: "no"; motivo: string } {
  let t = String(km ?? "").trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, ""); // «34.157» son miles
  const n = Math.round(Number(t.replace(",", ".")));
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return { estado: "no", motivo: "Escribe los km del vehículo (un número positivo)." };
  const v = esCoherente(n, cotas);
  return v.estado === "ok" ? { estado: "ok", km: n } : { estado: "no", motivo: v.motivo };
}
