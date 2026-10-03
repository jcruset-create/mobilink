/**
 * Teltonika RUT241 (y otros routers RutOS 7.x) por la API web de RutOS.
 *
 * Lo que está CONFIRMADO en la documentación de Teltonika (ver
 * docs/self-storage/ARQUITECTURA.md §18.4):
 *   · POST /api/login {username, password} → token Bearer de ~5 min;
 *   · POST /api/io/{dout}/actions/change_state {"data":{"value":"1"}};
 *   · desde RutOS 7.18 ese mismo endpoint acepta una duración (pulso nativo);
 *   · el RUT241 tiene UNA salida digital de colector abierto (30 V/300 mA):
 *     la cerradura va con un relé externo.
 *
 * Lo que NO está confirmado y por eso es configurable (`driver_options`) y,
 * si no se configura, no se intenta:
 *   · el nombre exacto del campo de duración del pulso (`pulseTimeField`);
 *   · la API de los grupos de teléfonos de «Call utilities»
 *     (`phoneGroupPath`, `phoneGroupField`). Sin ella, la sincronización de
 *     teléfonos queda en `failed` con un motivo claro, nunca «a medias».
 *
 * Transporte: HTTPS directo al equipo (`direct_http`, IP pública o fija) o
 * por VPN (`vpn_http`, dirección privada). Es el mismo adapter: cambia cómo se
 * llega, no qué se pide. Credenciales en la variable de entorno cuyo NOMBRE
 * guarda el dispositivo: {"username":"…","password":"…","ca":"-----BEGIN…"}.
 * Nada de esto se registra ni se guarda.
 */

import http from "node:http";
import https from "node:https";
import {
  conTiempo,
  ErrorDispositivo,
  type AccessDeviceAdapter,
  type DispositivoAcceso,
  type ResultadoConexion,
  type ResultadoSalida,
  type SalidaAcceso,
} from "./types.ts";

type Credenciales = { username: string; password: string; ca?: string };

function credenciales(d: DispositivoAcceso): Credenciales {
  if (!d.credentialsSecretName) throw new ErrorDispositivo("NOT_CONFIGURED", "El dispositivo no tiene variable de credenciales.");
  const crudo = process.env[d.credentialsSecretName];
  if (!crudo) throw new ErrorDispositivo("NOT_CONFIGURED", `Falta la variable de entorno ${d.credentialsSecretName} en el servidor.`);
  try {
    const c = JSON.parse(crudo) as Credenciales;
    if (!c.username || !c.password) throw new Error("incompleta");
    return c;
  } catch {
    throw new ErrorDispositivo("NOT_CONFIGURED", `La variable ${d.credentialsSecretName} no es un JSON {"username","password"} válido.`);
  }
}

/** Direcciones privadas / CGNAT: lo esperable detrás de una VPN. */
export function esDireccionPrivada(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return /\.(lan|local|internal|vpn)$/i.test(host);
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

type Respuesta = { status: number; json: unknown };

const TIEMPO_PETICION_MS = 6_000;

/** HTTP(S) mínimo sobre node:https, para poder fijar la CA del equipo (certificado propio). */
function peticion(d: DispositivoAcceso, metodo: string, ruta: string, cuerpo: unknown, token: string | null, ca: string | undefined): Promise<Respuesta> {
  if (!d.endpoint) return Promise.reject(new ErrorDispositivo("NOT_CONFIGURED", "El dispositivo no tiene endpoint."));
  const url = new URL(ruta, d.endpoint);
  const datos = cuerpo === undefined ? undefined : Buffer.from(JSON.stringify(cuerpo));
  const opciones: https.RequestOptions = {
    method: metodo,
    headers: {
      Accept: "application/json",
      ...(datos ? { "Content-Type": "application/json", "Content-Length": String(datos.length) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: TIEMPO_PETICION_MS,
    // Certificado autofirmado del router: se fija su CA (credenciales). Sólo
    // si se pide expresamente se acepta cualquiera (pruebas de laboratorio).
    ...(url.protocol === "https:" ? { ca, rejectUnauthorized: d.driverOptions.tlsInsecure !== true } : {}),
  };
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, opciones, (res) => {
      const trozos: Buffer[] = [];
      res.on("data", (c) => trozos.push(c));
      res.on("end", () => {
        let json: unknown = null;
        try {
          json = JSON.parse(Buffer.concat(trozos).toString("utf8") || "null");
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("timeout", () => req.destroy(new ErrorDispositivo("TIMEOUT", "El dispositivo no contesta.")));
    req.on("error", (e) =>
      reject(e instanceof ErrorDispositivo ? e : new ErrorDispositivo("OFFLINE", `No se llega al dispositivo (${(e as NodeJS.ErrnoException).code ?? "error de red"}).`))
    );
    if (datos) req.write(datos);
    req.end();
  });
}

const sesiones = new Map<string, { token: string; caduca: number }>();

export class Rut241Adapter implements AccessDeviceAdapter {
  private async login(d: DispositivoAcceso, forzar = false): Promise<{ token: string; ca?: string }> {
    const cred = credenciales(d);
    const hit = sesiones.get(d.id);
    if (!forzar && hit && hit.caduca > Date.now()) return { token: hit.token, ca: cred.ca };
    if (d.connectionType === "vpn_http" && !esDireccionPrivada(new URL(d.endpoint ?? "http://x").hostname)) {
      throw new ErrorDispositivo("NOT_CONFIGURED", "Con conexión por VPN el endpoint tiene que ser una dirección privada.");
    }
    const r = await peticion(d, "POST", "/api/login", { username: cred.username, password: cred.password }, null, cred.ca);
    const data = (r.json as { success?: boolean; data?: { token?: string; expires?: number } } | null)?.data;
    if (r.status === 401 || r.status === 403 || !data?.token) throw new ErrorDispositivo("AUTH_FAILED", `El dispositivo rechazó el inicio de sesión (HTTP ${r.status}).`);
    // Se renueva 30 s antes de que caduque.
    sesiones.set(d.id, { token: data.token, caduca: Date.now() + Math.max(30, (data.expires ?? 299) - 30) * 1000 });
    return { token: data.token, ca: cred.ca };
  }

  /** Petición autenticada; un 401 (token caducado) se reintenta UNA vez con sesión nueva. */
  private async api(d: DispositivoAcceso, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
    let s = await this.login(d);
    let r = await peticion(d, metodo, ruta, cuerpo, s.token, s.ca);
    if (r.status === 401) {
      s = await this.login(d, true);
      r = await peticion(d, metodo, ruta, cuerpo, s.token, s.ca);
    }
    return r;
  }

  private rutaEstado(d: DispositivoAcceso): string {
    return typeof d.driverOptions.statusPath === "string" ? d.driverOptions.statusPath : "/api/io/status";
  }

  async testConnection(d: DispositivoAcceso): Promise<ResultadoConexion> {
    const t0 = Date.now();
    try {
      const r = await this.api(d, "GET", this.rutaEstado(d));
      if (r.status >= 400) return { ok: false, latencyMs: Date.now() - t0, code: "ERROR" as const, message: `HTTP ${r.status} en ${this.rutaEstado(d)}` };
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (e) {
      return fallo(e, t0);
    }
  }

  async getStatus(d: DispositivoAcceso) {
    const r = await this.testConnection(d);
    return { online: r.ok, latencyMs: r.latencyMs, code: r.code, message: r.message };
  }

  async activateOutput(d: DispositivoAcceso, s: SalidaAcceso): Promise<ResultadoSalida> {
    const t0 = Date.now();
    const io = typeof d.driverOptions.ioId === "string" ? d.driverOptions.ioId : `dout${s.outputNumber}`;
    const ruta = `/api/io/${encodeURIComponent(io)}/actions/change_state`;
    const modo = d.driverOptions.pulseMode === "on_off" ? "on_off" : "native";
    try {
      if (modo === "native") {
        // RutOS ≥ 7.18: la propia salida se apaga sola al cabo de `time`.
        const campo = typeof d.driverOptions.pulseTimeField === "string" ? d.driverOptions.pulseTimeField : "time";
        const enSegundos = d.driverOptions.pulseTimeUnit !== "ms";
        const duracion = enSegundos ? Math.max(1, Math.round(s.pulseDurationMs / 1000)) : s.pulseDurationMs;
        const r = await conTiempo(this.api(d, "POST", ruta, { data: { value: "1", [campo]: duracion } }), TIEMPO_PETICION_MS + 1000);
        return r.status < 300 ? { ok: true, latencyMs: Date.now() - t0, httpStatus: r.status } : { ok: false, latencyMs: Date.now() - t0, code: "OUTPUT_FAILED", httpStatus: r.status };
      }
      // Firmware antiguo: encender, esperar y apagar SIEMPRE (finally), también si algo falla.
      try {
        const on = await conTiempo(this.api(d, "POST", ruta, { data: { value: "1" } }), TIEMPO_PETICION_MS + 1000);
        if (on.status >= 300) return { ok: false, latencyMs: Date.now() - t0, code: "OUTPUT_FAILED", httpStatus: on.status };
        await new Promise((r) => setTimeout(r, s.pulseDurationMs));
        return { ok: true, latencyMs: Date.now() - t0 };
      } finally {
        await conTiempo(this.api(d, "POST", ruta, { data: { value: "0" } }), TIEMPO_PETICION_MS + 1000).catch(() => {});
      }
    } catch (e) {
      return fallo(e, t0);
    }
  }

  private grupo(d: DispositivoAcceso): { ruta: string; campo: string } {
    const ruta = d.driverOptions.phoneGroupPath;
    if (typeof ruta !== "string" || !ruta.startsWith("/api/")) {
      throw new ErrorDispositivo(
        "NOT_SUPPORTED",
        "La API de grupos de teléfonos del RUT241 no está confirmada: verifícala en el equipo y configura driver_options.phoneGroupPath."
      );
    }
    return { ruta, campo: typeof d.driverOptions.phoneGroupField === "string" ? d.driverOptions.phoneGroupField : "numbers" };
  }

  async syncAuthorizedPhones(d: DispositivoAcceso, phones: string[]) {
    try {
      const g = this.grupo(d);
      // Se escribe la lista COMPLETA del grupo gestionado por Mobilink.
      const r = await this.api(d, "PUT", g.ruta, { data: { [g.campo]: phones } });
      if (r.status >= 300) return { ok: false, applied: [], code: "SYNC_FAILED" as const, message: `HTTP ${r.status} al escribir el grupo de teléfonos` };
      return { ok: true, applied: [...phones].sort() };
    } catch (e) {
      const f = fallo(e, Date.now());
      return { ok: false, applied: [], code: f.code, message: f.message };
    }
  }

  async getAuthorizedPhones(d: DispositivoAcceso) {
    const g = this.grupo(d);
    const r = await this.api(d, "GET", g.ruta);
    const lista = ((r.json as { data?: Record<string, unknown> } | null)?.data?.[g.campo] ?? []) as unknown;
    return Array.isArray(lista) ? lista.map(String).sort() : [];
  }
}

function fallo(e: unknown, t0: number): { ok: false; latencyMs: number; code: ErrorDispositivo["code"]; message: string } {
  const err = e instanceof ErrorDispositivo ? e : new ErrorDispositivo("ERROR", "Error inesperado hablando con el dispositivo.");
  return { ok: false, latencyMs: Date.now() - t0, code: err.code, message: err.message };
}

/** Para pruebas: olvida las sesiones abiertas. */
export const reiniciarSesionesRutos = () => sesiones.clear();
