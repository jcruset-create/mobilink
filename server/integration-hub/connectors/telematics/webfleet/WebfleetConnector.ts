/**
 * WebfleetConnector — Webfleet entra en el Telematics Hub.
 *
 * Hasta ahora Webfleet vivía FUERA del Hub: repartido por `server/index.ts`,
 * `webfleetSync.ts` y `connect/`, con su propio cliente HTTP en cada sitio. El
 * Hub, mientras tanto, tenía contrato (fase 3) y un conector cuyo proveedor
 * está caído (Movertis, fase 6). Eso dejaba el contrato sin validar contra
 * datos reales, que es la peor situación posible para un contrato.
 *
 * Este conector cierra ese hueco por el mismo motivo que la fase 4 eligió
 * Webfleet para estrenar el gestor de secretos: es el que ya funciona y tiene
 * datos reales, así que si algo del recorrido está mal se nota aquí y no
 * estrenando integración y proveedor a la vez.
 *
 * ── Alcance: se añade, no se arranca nada ───────────────────────────────────
 *
 * Los llamadores de siempre (`/api/tyrecontrol/webfleet/*`, la sincronización,
 * el módulo de asistencia) siguen intactos y funcionando. Esto es una vía
 * nueva en paralelo, no un reemplazo: migrarlos es otra fase y otro riesgo.
 * Lo que NO se hace es duplicar la resolución de credenciales —se reutiliza
 * `resolverCredencialesWebfleet`, que ya implementa el orden gestor → tabla →
 * globales de la fase 4—, porque dos copias de esa lógica acabarían
 * divergiendo y una de las dos expondría credenciales por el camino viejo.
 *
 * ── El tenant es la empresa ─────────────────────────────────────────────────
 *
 * `ctx.tenantId` es el uuid de `tc_empresas`, que es exactamente lo que
 * `resolverCredencialesWebfleet` espera como `empresaId`. No hay traducción
 * que hacer: el `SecretsProvider` ya era por tenant desde que se escribió.
 */

import type { ConnectorInfo, ITelematicsConnector } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import {
  TELEMATICS_CAPABILITIES,
  type ProviderVehicle,
  type TelemetryWindow,
  type VehicleTelemetry,
} from "../../../domain/telematics.ts";
import {
  buildWebfleetRequest,
  resolverCredencialesWebfleet,
  type WebfleetCreds,
} from "../../../../tyrecontrol/webfleetCredenciales.ts";
import {
  filasDe,
  masCercana,
  objetoALectura,
  objetoAVehiculo,
  viajeALectura,
} from "./mapeo.ts";

export interface WebfleetConfig {
  /** Cuenta telemática. Una empresa podría tener más de una. */
  accountKey?: string;
  /** Timeout por petición en ms. Por defecto 30 s. */
  timeoutMs?: number;
  /**
   * Acción para el histórico. `showTripReportExtern` está siempre disponible
   * pero solo trae distancia; `showLogbook` trae odómetro y no todas las
   * cuentas lo tienen contratado. Por defecto el libro de ruta, que es el que
   * sostiene la trazabilidad; quien no lo tenga puede bajar a los viajes.
   */
  accionHistorico?: "showLogbook" | "showTripReportExtern";
}

export class WebfleetConnector implements ITelematicsConnector {
  readonly info: ConnectorInfo = {
    key: "webfleet",
    kind: "telematics",
    displayName: "Webfleet",
    /**
     * A diferencia de Movertis, aquí sí se puede afirmar qué trae: la API
     * lleva años leyéndose en producción. Falta FUEL a propósito y no por
     * desconocimiento — los equipos de esta flota no tienen enlace CAN/FMS y
     * Webfleet devuelve combustible siempre a 0, que es ausencia de sensor y
     * no un depósito vacío.
     */
    capabilities: [
      TELEMATICS_CAPABILITIES.LIST_VEHICLES,
      TELEMATICS_CAPABILITIES.CURRENT_TELEMETRY,
      TELEMATICS_CAPABILITIES.HISTORY,
      TELEMATICS_CAPABILITIES.ODOMETER,
      TELEMATICS_CAPABILITIES.POSITION,
    ],
  };

  constructor(private readonly config: WebfleetConfig = {}) {}

  private get opcionesMapeo() {
    return { provider: this.info.key, accountKey: this.config.accountKey ?? "default" };
  }

  private async credenciales(ctx: OperationContext): Promise<WebfleetCreds | null> {
    return (await resolverCredencialesWebfleet(ctx.tenantId)).creds;
  }

  /**
   * Llama a una acción de Webfleet y devuelve sus filas.
   *
   * Webfleet no usa códigos HTTP para sus errores de negocio: responde 200 con
   * un `errorCode` en el cuerpo. Por eso no basta con mirar `r.ok`, y por eso
   * el error se clasifica por ese código: el 9 es «acción desconocida o no
   * contratada», que es permanente y no debe reintentarse, mientras que una
   * caída de red sí.
   */
  private async llamar(
    ctx: OperationContext,
    action: string,
    extra: Record<string, string> = {},
  ): Promise<Record<string, unknown>[]> {
    const creds = await this.credenciales(ctx);
    if (!creds) {
      throw IntegrationError.auth(
        "WEBFLEET_SIN_CREDENCIALES",
        `Webfleet no está configurado para la empresa ${ctx.tenantId}`,
      );
    }

    const { url, headers } = buildWebfleetRequest(action, extra, creds);

    let r: Response;
    try {
      r = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw IntegrationError.transient(
        "WEBFLEET_RED",
        `No se pudo hablar con Webfleet: ${(e as Error)?.message ?? e}`,
      );
    }

    if (r.status === 401 || r.status === 403) {
      throw IntegrationError.auth("WEBFLEET_AUTH", `Webfleet rechazó las credenciales (HTTP ${r.status})`);
    }
    if (r.status === 429 || r.status >= 500) {
      throw IntegrationError.transient("WEBFLEET_NO_DISPONIBLE", `Webfleet no disponible (HTTP ${r.status})`);
    }
    if (!r.ok) {
      throw IntegrationError.permanent("WEBFLEET_HTTP", `Webfleet respondió HTTP ${r.status}`);
    }

    const datos = await r.json().catch(() => null);
    if (datos && !Array.isArray(datos) && (datos as Record<string, unknown>).errorCode != null) {
      const codigo = Number((datos as Record<string, unknown>).errorCode);
      const mensaje = String((datos as Record<string, unknown>).errorMsg ?? "");
      // 9 = acción desconocida o no contratada. Reintentarla no la contrata.
      if (codigo === 9) {
        throw IntegrationError.validation(
          "WEBFLEET_ACCION_NO_DISPONIBLE",
          `Webfleet no ofrece '${action}' en esta cuenta (error 9: ${mensaje})`,
        );
      }
      throw IntegrationError.permanent("WEBFLEET_ERROR", `Webfleet ${codigo}: ${mensaje}`);
    }

    return filasDe(datos);
  }

  async testConnection(ctx: OperationContext): Promise<{ ok: boolean; message: string }> {
    const { creds, origen } = await resolverCredencialesWebfleet(ctx.tenantId);
    if (!creds) {
      return { ok: false, message: "Webfleet sin credenciales por ninguna vía (gestor, tabla ni globales)." };
    }
    try {
      const filas = await this.llamar(ctx, "showObjectReportExtern");
      // El origen se dice porque es lo que la fase 5 hizo visible en el panel:
      // saber si una empresa ya va por el gestor de secretos o sigue en la
      // tabla es justo lo que permite migrarlas de una en una.
      return { ok: true, message: `Webfleet responde: ${filas.length} vehículos (credenciales: ${origen}).` };
    } catch (e) {
      return { ok: false, message: `Webfleet no responde: ${(e as Error).message}` };
    }
  }

  async listVehicles(ctx: OperationContext): Promise<ProviderVehicle[]> {
    const filas = await this.llamar(ctx, "showObjectReportExtern");
    return filas
      .map((f) => objetoAVehiculo(f))
      .filter((v): v is ProviderVehicle => v !== null);
  }

  async getCurrentTelemetry(
    ctx: OperationContext,
    providerVehicleId: string,
  ): Promise<VehicleTelemetry | null> {
    const filas = await this.llamar(ctx, "showObjectReportExtern", { objectno: providerVehicleId });
    // Webfleet puede devolver toda la flota aunque se filtre por objectno, así
    // que se busca el pedido en vez de fiarse del primero.
    const o =
      filas.find((f) => String(f.objectno) === String(providerVehicleId)) ?? filas[0];
    if (!o) return null;
    return objetoALectura(o, this.opcionesMapeo, providerVehicleId);
  }

  async getTelemetryHistory(
    ctx: OperationContext,
    providerVehicleId: string,
    window: TelemetryWindow,
  ): Promise<VehicleTelemetry[]> {
    const accion = this.config.accionHistorico ?? "showLogbook";
    const filas = await this.llamar(ctx, accion, {
      objectno: providerVehicleId,
      range_pattern: "ud",
      rangefrom_string: iso(window.from),
      rangeto_string: iso(window.to),
    });
    return filas
      .map((f) => viajeALectura(f, this.opcionesMapeo, providerVehicleId))
      .filter((l): l is VehicleTelemetry => l !== null)
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  }

  /**
   * La lectura más cercana a `at` dentro de la tolerancia.
   *
   * Pide la ventana ±tolerancia y elige de ahí, sin interpolar. Devolver
   * `null` es frecuente y legítimo: un autobús parado en el taller no emite
   * viajes, y el taller es justo donde se le cambian los neumáticos.
   */
  async getTelemetryAt(
    ctx: OperationContext,
    providerVehicleId: string,
    at: Date,
    toleranceMinutes: number,
  ): Promise<VehicleTelemetry | null> {
    const margen = Math.abs(toleranceMinutes) * 60_000;
    const lecturas = await this.getTelemetryHistory(ctx, providerVehicleId, {
      from: new Date(at.getTime() - margen),
      to: new Date(at.getTime() + margen),
    });
    return masCercana(lecturas, at, toleranceMinutes);
  }
}

/** Webfleet quiere ISO 8601 sin milisegundos, como ya hacía `webfleetRange`. */
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
