/**
 * Simulador de dispositivo (MockAccessDeviceAdapter).
 *
 * Toda la fase 3 funciona con él antes de tener el RUT241 conectado. Su
 * comportamiento se configura en `self_storage_devices.simulation` (desde el
 * panel o las pruebas):
 *
 *   { "online": true|false,                       // false → offline
 *     "open": "ok" | "timeout" | "output_failed",  // resultado de abrir
 *     "sync": "ok" | "fail",                        // resultado de sincronizar
 *     "latencyMs": 40 }
 *
 * La lista de teléfonos «del equipo» y las aperturas se guardan en memoria
 * por dispositivo: es lo que miran las pruebas para comprobar qué le llegó.
 */

import type { AccessDeviceAdapter, DispositivoAcceso } from "./types.ts";

const telefonos = new Map<string, string[]>();
const aperturas = new Map<string, number[]>();

type Sim = { online: boolean; open: "ok" | "timeout" | "output_failed"; sync: "ok" | "fail"; latencyMs: number };
function sim(d: DispositivoAcceso): Sim {
  const s = d.simulation ?? {};
  return {
    online: s.online !== false,
    open: s.open === "timeout" || s.open === "output_failed" ? s.open : "ok",
    sync: s.sync === "fail" ? "fail" : "ok",
    latencyMs: typeof s.latencyMs === "number" ? s.latencyMs : 25,
  };
}

export class MockAccessDeviceAdapter implements AccessDeviceAdapter {
  async testConnection(d: DispositivoAcceso) {
    const s = sim(d);
    return s.online ? { ok: true, latencyMs: s.latencyMs, firmware: "SIMULADOR" } : { ok: false, latencyMs: 0, code: "OFFLINE" as const, message: "Simulador: offline" };
  }

  async getStatus(d: DispositivoAcceso) {
    const s = sim(d);
    return { online: s.online, latencyMs: s.online ? s.latencyMs : 0, firmware: "SIMULADOR", ...(s.online ? {} : { code: "OFFLINE" as const }) };
  }

  async activateOutput(d: DispositivoAcceso, salida: { outputNumber: number }) {
    const s = sim(d);
    if (!s.online) return { ok: false, latencyMs: 0, code: "OFFLINE" as const, message: "Simulador: offline" };
    if (s.open === "timeout") return { ok: false, latencyMs: 5000, code: "TIMEOUT" as const, message: "Simulador: sin respuesta" };
    if (s.open === "output_failed") return { ok: false, latencyMs: s.latencyMs, code: "OUTPUT_FAILED" as const, message: "Simulador: la salida no cambió de estado" };
    aperturas.set(d.id, [...(aperturas.get(d.id) ?? []), salida.outputNumber]);
    return { ok: true, latencyMs: s.latencyMs };
  }

  async syncAuthorizedPhones(d: DispositivoAcceso, phones: string[]) {
    const s = sim(d);
    if (!s.online) return { ok: false, applied: [], code: "OFFLINE" as const, message: "Simulador: offline" };
    if (s.sync === "fail") return { ok: false, applied: [], code: "SYNC_FAILED" as const, message: "Simulador: el equipo rechazó la lista" };
    telefonos.set(d.id, [...phones].sort());
    return { ok: true, applied: [...phones].sort() };
  }

  async getAuthorizedPhones(d: DispositivoAcceso) {
    return telefonos.get(d.id) ?? [];
  }
}

/** Para pruebas: lo que «tiene» el equipo simulado. */
export const simulador = {
  telefonos: (deviceId: string) => telefonos.get(deviceId) ?? [],
  aperturas: (deviceId: string) => aperturas.get(deviceId) ?? [],
  reiniciar: () => {
    telefonos.clear();
    aperturas.clear();
  },
};
