/**
 * Elige el adapter de un dispositivo. Es el único sitio que sabe que existen
 * RUT241, VPN o RMS: el resto del módulo habla con `AccessDeviceAdapter`.
 *
 *   mock                    → simulador (desarrollo, pruebas, demo)
 *   direct_http / vpn_http  → RutOS (RUT241 y otros Teltonika con RutOS 7.x)
 *   rms                     → preparado, no implementado
 *
 * Otros controladores (módulos de relés…) serán otro adapter aquí, sin tocar
 * el dominio.
 */

import { MockAccessDeviceAdapter } from "./mock.ts";
import { RmsAdapter } from "./rms.ts";
import { Rut241Adapter } from "./rutos.ts";
import type { AccessDeviceAdapter, DispositivoAcceso } from "./types.ts";

export * from "./types.ts";

const mock = new MockAccessDeviceAdapter();
const rutos = new Rut241Adapter();
const rms = new RmsAdapter();

/** Sustituible en pruebas. */
let sustituto: ((d: DispositivoAcceso) => AccessDeviceAdapter | null) | null = null;
export function fijarAdapter(f: typeof sustituto): void {
  sustituto = f;
}

export function adapterDe(d: DispositivoAcceso): AccessDeviceAdapter {
  const s = sustituto?.(d);
  if (s) return s;
  switch (d.connectionType) {
    case "mock":
      return mock;
    case "direct_http":
    case "vpn_http":
      return rutos;
    case "rms":
      return rms;
  }
}
