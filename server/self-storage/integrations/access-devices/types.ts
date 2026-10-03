/**
 * Contrato común de los dispositivos de acceso (fase 3).
 *
 * El dominio NO sabe cómo se llega al equipo: sólo pide «activa esta salida» o
 * «deja exactamente esta lista de teléfonos». Cada adapter (simulador, RUT241
 * por la API de RutOS directa o por VPN, RMS…) resuelve el cómo. Cambiar de
 * conectividad es cambiar `connection_type`, no reglas de negocio.
 *
 * Nada de lo que devuelve un adapter puede llevar secretos: lo que llega a
 * `device_response` se guarda en los eventos.
 */

import type { ConnectionType } from "../../../../src/modules/self-storage/types/enums.ts";

/** Lo que el adapter necesita saber del dispositivo. Sin credenciales: sólo el NOMBRE de la variable que las tiene. */
export type DispositivoAcceso = {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  connectionType: ConnectionType;
  endpoint: string | null;
  credentialsSecretName: string | null;
  /** Opciones NO secretas del adapter (p. ej. `ioId`, `pulseMode`, `tlsInsecure`). */
  driverOptions: Record<string, unknown>;
  /** Sólo para el simulador. */
  simulation: Record<string, unknown>;
};

export type SalidaAcceso = { outputNumber: number; pulseDurationMs: number; outputType: "relay" | "digital_output" };

/** Código de error estable (no texto libre del equipo, que podría filtrar datos). */
export type CodigoFallo = "OFFLINE" | "TIMEOUT" | "OUTPUT_FAILED" | "AUTH_FAILED" | "NOT_SUPPORTED" | "NOT_CONFIGURED" | "SYNC_FAILED" | "ERROR";

export type ResultadoConexion = { ok: boolean; latencyMs: number; firmware?: string | null; code?: CodigoFallo; message?: string };
export type EstadoDispositivo = { online: boolean; latencyMs: number; firmware?: string | null; code?: CodigoFallo; message?: string };
export type ResultadoSalida = { ok: boolean; latencyMs: number; code?: CodigoFallo; message?: string; httpStatus?: number };
export type ResultadoSync = { ok: boolean; applied: string[]; code?: CodigoFallo; message?: string };

export interface AccessDeviceAdapter {
  /** ¿Se llega al equipo y acepta las credenciales? (botón «Probar conexión»). */
  testConnection(d: DispositivoAcceso): Promise<ResultadoConexion>;
  /** Latido: online/offline. */
  getStatus(d: DispositivoAcceso): Promise<EstadoDispositivo>;
  /** Activa la salida `pulseDurationMs` y la deja apagada SIEMPRE (también si algo falla a medias). */
  activateOutput(d: DispositivoAcceso, s: SalidaAcceso): Promise<ResultadoSalida>;
  /** Deja en el equipo EXACTAMENTE esta lista de teléfonos (estado deseado, no altas/bajas sueltas). */
  syncAuthorizedPhones(d: DispositivoAcceso, phones: string[]): Promise<ResultadoSync>;
  /** Lo que el equipo tiene ahora (para comparar y para el panel). */
  getAuthorizedPhones(d: DispositivoAcceso): Promise<string[]>;
}

/** Error de adapter con su código estable. */
export class ErrorDispositivo extends Error {
  constructor(
    readonly code: CodigoFallo,
    message: string
  ) {
    super(message);
    this.name = "ErrorDispositivo";
  }
}

/** Corta una promesa a los `ms`: un equipo que no contesta no deja la apertura colgada. */
export async function conTiempo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new ErrorDispositivo("TIMEOUT", `Sin respuesta del dispositivo en ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}
