/**
 * MovertisConnector — primera implementación de `ITelematicsConnector`.
 *
 * Movertis es el proveedor de telemática de la flota de Autocares Plana y el
 * que estrena el Telematics Hub. Lo que se busca con él es poder decir «este
 * neumático se montó a 512.480 km y se desmontó a 578.864 km» con una fuente
 * verificable.
 *
 * ── Estado: la API ya se conoce, y NO es la que este fichero supone ─────────
 *
 * Hasta ahora este comentario decía que la API de Movertis llevaba caída y que
 * no se conocían sus rutas ni sus nombres de campo. Ya se conocen: la sonda
 * (`scripts/movertis-probe.mjs --contrato`) habla con ella y trae datos reales
 * de la flota. Lo que se sabe, y que este conector todavía NO hace:
 *
 *   POST /vehicle/showvehicles   {"flags":{...},"id":[]}
 *        Banderas válidas: basicData, counters, sensors. Una que no exista
 *        devuelve «Flag incorrecta» DENTRO de un cuerpo con HTTP 201. `id`
 *        vacío = toda la flota. Responde 201, no 200.
 *        El odómetro real está en `counters.odometer`; `sensors` trae los
 *        cálculos del dispositivo, y ahí `-348201.3876` y `0` significan los
 *        dos «sin lectura».
 *        NO trae posición: ni un campo, en ningún vehículo.
 *
 *   POST /vehicle/showtrips      [{"id":N,"initial_date":ms,"end_date":ms}]
 *        Histórico. Devuelve `[{unit, coords:[{time, timeString, pos}]}]`, con
 *        `pos` como cadena "lat,lng" y `time` en epoch de milisegundos.
 *        SOLO posiciones: no hay odómetro ni distancia. Por eso `getTelemetryAt`
 *        no puede dar kilometraje de un instante pasado; sirve para demostrar
 *        que un vehículo no se ha movido, que no es lo mismo pero resuelve el
 *        caso que se buscaba.
 *
 * Un campo que falta en el cuerpo se responde con un 500 y el error de
 * JavaScript en crudo («Cannot read properties of undefined»), así que tantear
 * a ciegas sale caro: se prueba con la sonda, que ya sabe las formas buenas.
 *
 * Lo que queda por hacer aquí es el transporte: este fichero hace GET con
 * plantillas de URL (`endpoints`, `{id}`, `{from}`, `{to}`) y la API quiere POST
 * con cuerpo JSON. La lógica de reintentos, timeouts, clasificación de errores
 * y simulación sí vale tal como está.
 *
 * ── Credenciales ────────────────────────────────────────────────────────────
 *
 * Ninguna implementación pide credenciales por parámetro (regla 1 del
 * contrato): el `tenantId` viaja en el `OperationContext` y el secreto se
 * resuelve aquí. Nombres esperados, por el `SecretsProvider`:
 *
 *   IH_SECRET__<TENANT>__MOVERTIS__TOKEN      (lo primero que se mira)
 *   IH_SECRET__<TENANT>__MOVERTIS__API_KEY    (cabecera X-Api-Key)
 *   IH_SECRET__<TENANT>__MOVERTIS__USERNAME   + __PASSWORD  (Basic)
 *
 * Con el fallback global sin tenant que ya define `secrets.ts`. Ese fallback es
 * cómodo para probar y peligroso para quedarse: con dos clientes de Movertis,
 * los dos cogerían el mismo token. El nombre con tenant es el que vale.
 *
 * ── El token va EN CRUDO, sin «Bearer» ──────────────────────────────────────
 *
 * Esta versión mandaba `Authorization: Bearer <token>`, que es lo habitual y no
 * es lo que Movertis pide: su ejemplo documentado manda la cabecera
 * `authorization` con el token tal cual. Un `Bearer` de más es un 401 con la
 * credencial correcta, que es de los fallos más caros de diagnosticar porque
 * todo apunta al secreto.
 *
 * No se deja fijo, se deja en la config (`esquemaToken`), porque el valor del
 * ejemplo venía tapado y no se puede leer de ahí si el prefijo estaba dentro:
 * lo que sí se sabe es que la cabecera va en minúsculas y sin nada delante en
 * la documentación del proveedor. Por defecto, crudo; `"bearer"` para volver al
 * comportamiento anterior sin tocar código el día que haga falta.
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
  /**
   * Cómo se manda el token en la cabecera `authorization`.
   *
   * `"raw"` (por defecto) manda el token tal cual, que es lo que pide Movertis.
   * `"bearer"` le pone el prefijo, por si alguna instalación lo espera.
   */
  esquemaToken?: "raw" | "bearer";
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
   * Cabeceras de autenticación, aparte para poder probarlas sin red.
   *
   * El token manda sobre lo demás, y va en crudo salvo que la config diga
   * `esquemaToken: "bearer"`: ver la cabecera del fichero. Basic solo se usa si
   * no hay token, y la API key se acumula, porque hay instalaciones que piden
   * las dos cosas.
   */
  cabecerasDe(cred: Credenciales): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (cred.token) {
      h.authorization = this.config.esquemaToken === "bearer" ? `Bearer ${cred.token}` : cred.token;
    } else if (cred.username && cred.password) {
      h.authorization = `Basic ${Buffer.from(`${cred.username}:${cred.password}`).toString("base64")}`;
    }
    if (cred.apiKey) h["X-Api-Key"] = cred.apiKey;
    return h;
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
    const cabeceras = this.cabecerasDe(cred);

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
