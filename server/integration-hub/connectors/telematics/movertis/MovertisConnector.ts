/**
 * MovertisConnector — primera implementación de `ITelematicsConnector`.
 *
 * Movertis es el proveedor de telemática de la flota de Autocares Plana y el
 * que estrena el Telematics Hub. Lo que se busca con él es poder decir «este
 * neumático se montó a 512.480 km y se desmontó a 578.864 km» con una fuente
 * verificable.
 *
 * ── Estado: esqueleto real, mapeo por confirmar ─────────────────────────────
 *
 * El conector está completo en lo que NO depende de conocer la API: contrato,
 * credenciales por el gestor de secretos, timeouts, reintentos, clasificación
 * de errores y modo simulación. Lo que sigue abierto es la forma exacta de la
 * respuesta de Movertis —rutas y nombres de campo—, porque su API lleva caída
 * desde que se montó la sonda (`scripts/movertis-probe.mjs`, 503 en las 27
 * rutas tanteadas).
 *
 * Por eso las rutas viven en la config (`endpoints`) y los nombres de campo en
 * `mapeo.ts`, no repartidos por el código: cuando la sonda conteste, cerrar la
 * incógnita es ajustar esos dos sitios y un test, sin tocar la lógica.
 *
 * ── Credenciales ────────────────────────────────────────────────────────────
 *
 * Ninguna implementación pide credenciales por parámetro (regla 1 del
 * contrato): el `tenantId` viaja en el `OperationContext` y el secreto se
 * resuelve aquí. Nombres esperados, por el `SecretsProvider`:
 *
 *   IH_SECRET__<TENANT>__MOVERTIS__TOKEN      (Bearer; lo primero que se mira)
 *   IH_SECRET__<TENANT>__MOVERTIS__API_KEY    (cabecera X-Api-Key)
 *   IH_SECRET__<TENANT>__MOVERTIS__USERNAME   + __PASSWORD  (Basic)
 *
 * Con el fallback global sin tenant que ya define `secrets.ts`.
 */

import type { ConnectorInfo, ITelematicsConnector } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import {
  TELEMATICS_CAPABILITIES,
  type ProviderVehicle,
  type TelemetryWindow,
  type VehicleTelemetry,
} from "../../../domain/telematics.ts";
import {
  aProviderVehicle,
  aVehicleTelemetry,
  filasDe,
  masCercana,
  type CamposMovertis,
  type UnidadOdometro,
} from "./mapeo.ts";

/** Rutas de la API. Configurables porque aún no están confirmadas. */
export interface EndpointsMovertis {
  /** Lista de vehículos de la cuenta. */
  vehicles?: string;
  /** Última lectura conocida. `{id}` se sustituye por el id del vehículo. */
  current?: string;
  /**
   * Histórico. Admite `{id}`, `{from}` y `{to}` (ISO 8601). Si la API espera
   * otros nombres de parámetro, se escriben aquí: es una plantilla, no un
   * formato fijo.
   */
  history?: string;
}

export interface MovertisConfig {
  /** Base de la API, p. ej. https://api.hellomovertis.com */
  baseUrl?: string;
  /** Cuenta telemática dentro de Movertis. Un cliente puede tener varias. */
  accountKey?: string;
  endpoints?: EndpointsMovertis;
  /**
   * Unidad del odómetro. SIN DEFECTO a propósito: si no se declara, las
   * lecturas salen sin odómetro. Ver la trampa de las unidades en `mapeo.ts`.
   */
  odometroEn?: UnidadOdometro;
  /** De dónde sale el odómetro, si Movertis lo aclara. */
  origenOdometro?: "vehicle" | "gps" | "unknown";
  /** Nombres de campo, una vez confirmados por la sonda. */
  campos?: CamposMovertis;
  /** Timeout por petición en ms (por defecto 30 s). */
  timeoutMs?: number;
  /** Reintentos ante 429/5xx/red antes de rendirse. */
  maxRetries?: number;
}

const ENDPOINTS_POR_DEFECTO: Required<EndpointsMovertis> = {
  vehicles: "/api/vehicles",
  current: "/api/vehicles/{id}/position",
  history: "/api/vehicles/{id}/positions?from={from}&to={to}",
};

interface Credenciales {
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export class MovertisConnector implements ITelematicsConnector {
  readonly info: ConnectorInfo = {
    key: "movertis",
    kind: "telematics",
    displayName: "Movertis",
    /**
     * Solo lo que esta versión implementa DE VERDAD. Falta a propósito
     * `ODOMETER`, `POSITION` y `FUEL`: mientras no se confirme con datos
     * reales qué trae Movertis, anunciarlos sería prometer un dato que el
     * panel enseñaría sin tener. Se añaden cuando la sonda los vea.
     */
    capabilities: [
      TELEMATICS_CAPABILITIES.LIST_VEHICLES,
      TELEMATICS_CAPABILITIES.CURRENT_TELEMETRY,
      TELEMATICS_CAPABILITIES.HISTORY,
    ],
  };

  constructor(private readonly config: MovertisConfig = {}) {}

  // ── Modo simulación ────────────────────────────────────────────────────────

  /**
   * Sin baseUrl o sin credenciales, el conector no llama a nadie.
   *
   * Aquí la simulación no fabrica lecturas de mentira, al revés que en los
   * conectores de catálogo: un kilometraje inventado es exactamente el dato
   * que este hub existe para NO producir. Devuelve vacío y lo dice.
   */
  private async enSimulacion(ctx: OperationContext): Promise<boolean> {
    if (!this.config.baseUrl) return true;
    const cred = await this.credenciales(ctx);
    return !cred.token && !cred.apiKey && !(cred.username && cred.password);
  }

  private async credenciales(ctx: OperationContext): Promise<Credenciales> {
    const secrets = getSecretsProvider();
    const [token, apiKey, username, password] = await Promise.all([
      secrets.get(ctx.tenantId, this.info.key, "token"),
      secrets.get(ctx.tenantId, this.info.key, "api_key"),
      secrets.get(ctx.tenantId, this.info.key, "username"),
      secrets.get(ctx.tenantId, this.info.key, "password"),
    ]);
    return { token, apiKey, username, password };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private url(plantilla: string, sustituciones: Record<string, string> = {}): string {
    let ruta = plantilla;
    for (const [clave, valor] of Object.entries(sustituciones)) {
      ruta = ruta.replaceAll(`{${clave}}`, encodeURIComponent(valor));
    }
    const base = (this.config.baseUrl ?? "").replace(/\/+$/, "");
    return `${base}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
  }

  /**
   * GET con reintentos, timeout y errores clasificados.
   *
   * La clasificación importa más de lo que parece: el Queue Manager decide si
   * reintenta o manda a revisión manual según el `kind`, así que un 401 que se
   * marcara como transitorio se reintentaría eternamente contra una credencial
   * que nunca va a funcionar.
   */
  private async pedir(ctx: OperationContext, url: string): Promise<unknown> {
    const cred = await this.credenciales(ctx);
    const cabeceras: Record<string, string> = { Accept: "application/json" };
    if (cred.token) cabeceras.Authorization = `Bearer ${cred.token}`;
    else if (cred.username && cred.password) {
      cabeceras.Authorization = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}`;
    }
    if (cred.apiKey) cabeceras["X-Api-Key"] = cred.apiKey;

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const maxRetries = this.config.maxRetries ?? 2;

    let ultimo: unknown;
    for (let intento = 0; intento <= maxRetries; intento++) {
      try {
        const r = await fetch(url, {
          headers: cabeceras,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (r.status === 401 || r.status === 403) {
          throw IntegrationError.auth(
            "MOVERTIS_AUTH",
            `Movertis rechazó las credenciales (HTTP ${r.status})`,
          );
        }
        if (r.status === 404) {
          throw IntegrationError.notFound("MOVERTIS_NOT_FOUND", `Movertis no conoce ${url}`);
        }
        if (r.status === 429 || r.status >= 500) {
          // Transitorio: merece otra pasada.
          ultimo = IntegrationError.transient(
            "MOVERTIS_UNAVAILABLE",
            `Movertis no disponible (HTTP ${r.status})`,
          );
          if (intento < maxRetries) {
            await espera(2 ** intento * 500);
            continue;
          }
          throw ultimo;
        }
        if (!r.ok) {
          throw IntegrationError.permanent(
            "MOVERTIS_HTTP",
            `Movertis respondió HTTP ${r.status}`,
          );
        }

        const texto = await r.text();
        try {
          return JSON.parse(texto);
        } catch {
          throw IntegrationError.permanent(
            "MOVERTIS_BAD_JSON",
            `Movertis devolvió algo que no es JSON (${texto.slice(0, 120)})`,
          );
        }
      } catch (e) {
        // Un IntegrationError ya clasificado no se reinterpreta.
        if (e instanceof IntegrationError) {
          if (e.retryable && intento < maxRetries) {
            await espera(2 ** intento * 500);
            continue;
          }
          throw e;
        }
        // Fallo de red o timeout: transitorio.
        ultimo = IntegrationError.transient(
          "MOVERTIS_NETWORK",
          `No se pudo hablar con Movertis: ${(e as Error)?.message ?? e}`,
        );
        if (intento < maxRetries) {
          await espera(2 ** intento * 500);
          continue;
        }
        throw ultimo;
      }
    }
    throw ultimo ?? IntegrationError.transient("MOVERTIS_NETWORK", "No se pudo hablar con Movertis");
  }

  private get endpoints(): Required<EndpointsMovertis> {
    return { ...ENDPOINTS_POR_DEFECTO, ...(this.config.endpoints ?? {}) };
  }

  private get opcionesMapeo() {
    return {
      provider: this.info.key,
      accountKey: this.config.accountKey ?? "default",
      // Sin declarar, se propaga `undefined` y la lectura sale sin odómetro:
      // preferimos la ausencia a un kilometraje mil veces menor.
      unidadOdometro: this.config.odometroEn,
      origenOdometro: this.config.origenOdometro,
      campos: this.config.campos,
    };
  }

  // ── Contrato ───────────────────────────────────────────────────────────────

  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    if (!this.config.baseUrl) {
      return { ok: false, message: "Movertis sin configurar: falta baseUrl." };
    }
    const cred = await this.credenciales(ctx);
    if (!cred.token && !cred.apiKey && !(cred.username && cred.password)) {
      return {
        ok: false,
        message:
          "Movertis sin credenciales: define IH_SECRET__…__MOVERTIS__TOKEN, __API_KEY o __USERNAME/__PASSWORD.",
      };
    }
    try {
      const datos = await this.pedir(ctx, this.url(this.endpoints.vehicles));
      const filas = filasDe(datos);
      // Conectar y traer kilometraje no es lo mismo: si falta la unidad, la
      // conexión es buena pero las lecturas saldrán sin odómetro, y eso hay
      // que decirlo aquí y no dejar que se descubra con un informe vacío.
      const aviso = this.config.odometroEn
        ? ""
        : " Ojo: sin `odometroEn` declarado las lecturas saldrán SIN odómetro.";
      return {
        ok: true,
        message: `Movertis responde: ${filas.length} vehículos en la cuenta.${aviso}`,
      };
    } catch (e) {
      const err = e as IntegrationError;
      return { ok: false, message: `Movertis no responde: ${err.message}` };
    }
  }

  async listVehicles(ctx: OperationContext): Promise<ProviderVehicle[]> {
    if (await this.enSimulacion(ctx)) return [];
    const datos = await this.pedir(ctx, this.url(this.endpoints.vehicles));
    return filasDe(datos)
      .map((f) => aProviderVehicle(f, this.config.campos))
      .filter((v): v is ProviderVehicle => v !== null);
  }

  async getCurrentTelemetry(
    ctx: OperationContext,
    providerVehicleId: string,
  ): Promise<VehicleTelemetry | null> {
    if (await this.enSimulacion(ctx)) return null;
    const datos = await this.pedir(ctx, this.url(this.endpoints.current, { id: providerVehicleId }));
    const filas = filasDe(datos);
    // La ruta «posición actual» puede devolver el objeto pelado en vez de una
    // lista de un elemento; ambas formas valen.
    const registro = filas.length
      ? filas[filas.length - 1]
      : (datos && typeof datos === "object" ? (datos as Record<string, unknown>) : null);
    if (!registro) return null;
    return aVehicleTelemetry(registro, this.opcionesMapeo, providerVehicleId);
  }

  async getTelemetryHistory(
    ctx: OperationContext,
    providerVehicleId: string,
    window: TelemetryWindow,
  ): Promise<VehicleTelemetry[]> {
    if (await this.enSimulacion(ctx)) return [];
    const url = this.url(this.endpoints.history, {
      id: providerVehicleId,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    });
    const datos = await this.pedir(ctx, url);
    return filasDe(datos)
      .map((f) => aVehicleTelemetry(f, this.opcionesMapeo, providerVehicleId))
      .filter((l): l is VehicleTelemetry => l !== null)
      // En orden cronológico, como pide el contrato: el proveedor no garantiza
      // devolverlas ordenadas y quien las consuma lo da por hecho.
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  }

  /**
   * La lectura más cercana a `at` dentro de la tolerancia.
   *
   * Pide una ventana de ±tolerancia y elige de ahí. No interpola (regla 3):
   * devuelve una lectura que existió, o null. Un camión parado en el taller
   * puede no emitir nada durante horas, y ese es justo el momento en que se
   * cambian los neumáticos: el null es una respuesta legítima y frecuente.
   */
  async getTelemetryAt(
    ctx: OperationContext,
    providerVehicleId: string,
    at: Date,
    toleranceMinutes: number,
  ): Promise<VehicleTelemetry | null> {
    if (await this.enSimulacion(ctx)) return null;
    const margen = Math.abs(toleranceMinutes) * 60_000;
    const lecturas = await this.getTelemetryHistory(ctx, providerVehicleId, {
      from: new Date(at.getTime() - margen),
      to: new Date(at.getTime() + margen),
    });
    return masCercana(lecturas, at, toleranceMinutes);
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
