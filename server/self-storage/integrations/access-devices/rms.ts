/**
 * Teltonika RMS (preparado, NO implementado).
 *
 * Para equipos detrás de CGNAT sin VPN. La vía documentada es generar un
 * enlace «RMS Connect» por la API de RMS (token personal, cuota mensual de
 * peticiones y créditos) y, a través de él, hablar con la API de RutOS como
 * hace `Rut241Adapter`. No se implementa hasta probarlo con el equipo: hoy
 * cualquier operación devuelve NOT_SUPPORTED con un motivo claro, nunca una
 * apertura «fingida».
 */

import type { AccessDeviceAdapter } from "./types.ts";

const NO = { code: "NOT_SUPPORTED" as const, message: "Conexión por Teltonika RMS preparada pero no implementada todavía." };

export class RmsAdapter implements AccessDeviceAdapter {
  async testConnection() {
    return { ok: false, latencyMs: 0, ...NO };
  }
  async getStatus() {
    return { online: false, latencyMs: 0, ...NO };
  }
  async activateOutput() {
    return { ok: false, latencyMs: 0, ...NO };
  }
  async syncAuthorizedPhones() {
    return { ok: false, applied: [], ...NO };
  }
  async getAuthorizedPhones(): Promise<string[]> {
    return [];
  }
}
