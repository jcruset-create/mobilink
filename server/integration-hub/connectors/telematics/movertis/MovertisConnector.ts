/**
 * MovertisConnector — primera implementación de `ITelematicsConnector`.
 *
 * Movertis es el proveedor de telemática de la flota de Autocares Plana y el
 * que estrena el Telematics Hub. Lo que se busca con él es poder decir «este
 * neumático se montó a 512.480 km y se desmontó a 578.864 km» con una fuente
 * verificable.
 *
 * ── Estado: hablando con la API real ────────────────────────────────────────
 *
 * Este comentario dijo primero que la API llevaba caída, y luego que se conocía
 * pero que el conector no la sabía usar. Ya la usa: `scripts/movertis-probe.mjs
 * --contrato` la sondea y `MovertisConnector.integration.test.ts`
 * (`RUN_MOVERTIS=1`) comprueba que este cliente le saca la flota, el odómetro y
 * el histórico de verdad. El contrato es este:
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
 * Y hay una asimetría que conviene tener presente al leer lo de abajo: el
 * odómetro existe en la lectura ACTUAL y no en el histórico. Ver
 * `capabilities` y `getTelemetryHistory`.
 *
 * ── Credenciales ────────────────────────────────────────────────────────────
 *
 * Ninguna implementación pide credenciales por parámetro (regla 1 del
 * contrato): el `tenantId` viaja en el `OperationContext` y el secreto se
 * resuelve aquí. Nombres esperados, por el `SecretsProvider`:
 *
 *   IH_SECRET__<TENANT>__MOVERTIS__<CUENTA>__TOKEN   (lo primero que se mira)
 *   IH_SECRET__<TENANT>__MOVERTIS__TOKEN             (todas las cuentas del cliente)
 *   IH_SECRET__<TENANT>__MOVERTIS__<…>__API_KEY      (cabecera X-Api-Key)
 *   IH_SECRET__<TENANT>__MOVERTIS__<…>__USERNAME + __PASSWORD  (Basic)
 *
 * El escalón de la CUENTA hace falta porque un cliente puede tener dos cuentas
 * de Movertis con tokens distintos. Sin él las dos leerían la misma variable:
 * la segunda daría 401, o —peor— devolvería la flota de la primera.
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
 * COMPROBADO contra la cuenta real de Autocares Plana: con el token en crudo,
 * «Probar conexión» devuelve los 751 vehículos de la cuenta. Y `testConnection`
 * rechaza antes de llamar si no hay credencial, así que la mandó y Movertis la
 * aceptó sin prefijo. Hasta ese momento era una suposición razonada —el ejemplo
 * del proveedor traía el valor tapado— y por eso quedó en la config y no fija.
 *
 * Se queda configurable de todas formas: `"bearer"` vuelve al comportamiento
 * anterior sin tocar código, por si alguna instalación de Movertis lo espera.
 */

import type { ConnectorInfo, ITelematicsConnector } from "../../../domain/connectors.ts";
import type { OperationContext } from "../../../domain/identifiers.ts";
import { IntegrationError } from "../../../domain/errors.ts";
import { getSecretsProvider } from "../../../infrastructure/secrets.ts";
import {
  TELEMATICS_CAPABILITIES,
  type ITripSummaryProvider,
  type ProviderVehicle,
  type TelemetryWindow,
  type TripSummary,
  type VehicleTelemetry,
} from "../../../domain/telematics.ts";
import {
  aLecturaDeFlota,
  aLecturaDePunto,
  aVehiculoDeFlota,
  filasDe,
  masCercana,
  puntosDeUnidad,
  resumenesDe,
  aKilometros,
  type UnidadOdometro,
} from "./mapeo.ts";

/**
 * Las dos rutas de la API. Siguen en la config, pero ya no son plantillas.
 *
 * Antes admitían `{id}`, `{from}` y `{to}` porque se creía que la API era GET
 * con parámetros en la URL. No lo es: las dos rutas son POST y todo viaja en el
 * cuerpo, así que una plantilla no tiene nada que sustituir.
 */
export interface RutasMovertis {
  /** Lista de vehículos, contadores y sensores. POST. */
  vehicles?: string;
  /** Histórico de posiciones. POST. */
  trips?: string;
  /** Resumen de distancia por unidad y ventana. POST. */
  summary?: string;
}

export interface MovertisConfig {
  /**
   * Base de la API.
   *
   * La que contesta es **https://devapi.hellomovertis.com**, comprobado con la
   * sonda: devuelve la flota entera de Autocares Plana. `api.hellomovertis.com`
   * responde 502 y no sirve la API, así que configurarla ahí deja la pantalla de
   * conciliación en «no se pudo sincronizar» sin que nada esté mal en el código.
   * Este comentario decía justo eso como ejemplo, y de aquí salió la
   * configuración equivocada de la cuenta de Plana.
   *
   * Ojo: `*.hellomovertis.com` tiene DNS comodín, así que cualquier subdominio
   * resuelve y un host equivocado no falla como «no existe». Ver la cabecera de
   * `scripts/movertis-probe.mjs`, que nació de ese mismo engaño.
   */
  baseUrl?: string;
  /** Cuenta telemática dentro de Movertis. Un cliente puede tener varias. */
  accountKey?: string;
  rutas?: RutasMovertis;
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
  /**
   * Unidad de `total_mileage` en `summarytrips`. Si no se declara, se usa la
   * del odómetro (`odometroEn`); si tampoco, el resumen sale SIN kilómetros,
   * por la misma trampa de las unidades que se explica en `mapeo.ts`.
   */
  distanciaEn?: UnidadOdometro;
  /** Unidades por petición a `summarytrips`. Ver `UNIDADES_POR_PETICION`. */
  unidadesPorPeticion?: number;
  /**
   * Zona horaria con la que se cortan los meses del kilometraje mensual.
   * Por defecto Europe/Madrid, que es la de toda la casa.
   */
  zonaHoraria?: string;
  /** Timeout por petición en ms (por defecto 30 s). */
  timeoutMs?: number;
  /** Reintentos ante 429/5xx/red antes de rendirse. */
  maxRetries?: number;
}

const RUTAS_POR_DEFECTO: Required<RutasMovertis> = {
  vehicles: "/vehicle/showvehicles",
  trips: "/vehicle/showtrips",
  summary: "/vehicle/summarytrips",
};

/**
 * Cuántas unidades van en cada `summarytrips` si la config no dice otra cosa.
 *
 * Veinticinco es un punto de partida sobrio, no un óptimo medido: la sonda de
 * este entorno no llega a Movertis, así que la respuesta de la API con 50 no
 * se ha visto. Con 751 vehículos son 31 peticiones por mes; cabe de sobra en
 * el cupo y deja sitio para subirlo cuando se haya visto que aguanta.
 */
export const UNIDADES_POR_PETICION = 25;

/**
 * Tope al `Retry-After` que se obedece. Un proveedor que pida esperar una hora
 * se respeta hasta aquí; más allá, se rinde y lo cuenta, porque un job colgado
 * sesenta minutos en un `await` es peor de diagnosticar que un fallo.
 */
const RETRY_AFTER_MAXIMO_MS = 120_000;

/**
 * Cuánto se mira hacia atrás buscando la última emisión del vehículo.
 *
 * Una semana, y no es generosidad: `showvehicles` da el odómetro SIN FECHA, así
 * que el instante de la lectura hay que sacarlo de la última posición conocida.
 * Un autobús parado no emite, y el parado de varios días —en el taller— es
 * justo aquel al que se le cambian los neumáticos. Con una ventana corta ese
 * vehículo se quedaría sin lectura precisamente cuando hace falta.
 */
const VENTANA_ULTIMA_POSICION_H = 168;

interface Credenciales {
  token?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export class MovertisConnector implements ITelematicsConnector, ITripSummaryProvider {
  readonly info: ConnectorInfo = {
    key: "movertis",
    kind: "telematics",
    displayName: "Movertis",
    /**
     * Solo lo que esta versión implementa DE VERDAD. La sonda ya vio odómetro y
     * posición con datos reales, así que se anuncian; `FUEL` sigue fuera porque
     * los sensores de depósito de esta flota vienen todos «sin dato».
     *
     * `ODOMETER` con una asimetría que el contrato no sabe expresar y que por
     * eso se escribe aquí: el odómetro está en la lectura ACTUAL y NO en el
     * histórico, porque `showtrips` solo devuelve posiciones. Quien pida
     * kilometraje de un instante pasado no lo tendrá, y está bien así:
     * `VehicleOdometerService` filtra las lecturas que traen odómetro, de modo
     * que la respuesta degrada a «sin_lectura» en vez de a un número inventado.
     */
    capabilities: [
      TELEMATICS_CAPABILITIES.LIST_VEHICLES,
      TELEMATICS_CAPABILITIES.CURRENT_TELEMETRY,
      TELEMATICS_CAPABILITIES.HISTORY,
      TELEMATICS_CAPABILITIES.ODOMETER,
      TELEMATICS_CAPABILITIES.POSITION,
      TELEMATICS_CAPABILITIES.TRIP_SUMMARY,
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
    // La cuenta va en la resolución: dos cuentas del mismo cliente tienen
    // tokens distintos, y sin esto las dos leerían el mismo.
    const cuenta = this.config.accountKey;
    const leer = (nombre: string) => secrets.get(ctx.tenantId, this.info.key, nombre, cuenta);
    const [token, apiKey, username, password] = await Promise.all([
      leer("token"),
      leer("api_key"),
      leer("username"),
      leer("password"),
    ]);
    return { token, apiKey, username, password };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private url(ruta: string): string {
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
   * POST con cuerpo JSON, reintentos, timeout y errores clasificados.
   *
   * La clasificación importa más de lo que parece: el Queue Manager decide si
   * reintenta o manda a revisión manual según el `kind`, así que un 401 que se
   * marcara como transitorio se reintentaría eternamente contra una credencial
   * que nunca va a funcionar.
   *
   * ── Las dos formas que tiene Movertis de fallar diciendo 2xx o 500 ─────────
   *
   * 1. Una bandera que no existe se responde con **HTTP 201** y un cuerpo
   *    `{"status":500,"message":"position - Flag incorrecta","name":"HttpException"}`.
   *    Un 201 que en realidad es un 500: si no se mira el cuerpo, ese error
   *    entra en el sistema como si fueran datos y sale como una flota vacía.
   *
   * 2. Un campo que falta se responde con **HTTP 500** y el error de JavaScript
   *    en crudo: «Cannot read properties of undefined (reading 'length')», o
   *    «El flag basicData es obligatorio». Eso NO es un fallo transitorio del
   *    proveedor, es una petición mal construida por nuestra parte, y
   *    reintentarla tres veces con espera exponencial es perder seis segundos
   *    para volver a fallar igual. Un 500 con mensaje se marca permanente; uno
   *    sin cuerpo útil, y los 502/503/504, siguen siendo transitorios.
   */
  private async postear(ctx: OperationContext, ruta: string, cuerpo: unknown): Promise<unknown> {
    const url = this.url(ruta);
    const cred = await this.credenciales(ctx);
    const cabeceras = { ...this.cabecerasDe(cred), "Content-Type": "application/json" };
    const body = JSON.stringify(cuerpo);

    const timeoutMs = this.config.timeoutMs ?? 30_000;
    const maxRetries = this.config.maxRetries ?? 2;

    let ultimo: unknown;
    for (let intento = 0; intento <= maxRetries; intento++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: cabeceras,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (r.status === 401 || r.status === 403) {
          throw IntegrationError.auth(
            "MOVERTIS_AUTH",
            `Movertis rechazó las credenciales (HTTP ${r.status})`,
          );
        }
        if (r.status === 404) {
          throw IntegrationError.notFound("MOVERTIS_NOT_FOUND", `Movertis no conoce ${ruta}`);
        }

        // Ante un 429 el proveedor puede decir cuánto esperar. Se obedece
        // (con tope): dormir lo que pide es lo que evita el bloqueo del token,
        // que es el fallo que más cuesta deshacer.
        const retryAfterMs = esperaPedida(r);

        const texto = await r.text();
        let datos: unknown;
        try {
          datos = JSON.parse(texto);
        } catch {
          // Antes de dar el cuerpo por inválido hay que mirar el estado: un 502
          // de la pasarela llega como HTML y es transitorio, no un JSON roto.
          if (r.status === 429 || r.status >= 500) {
            ultimo = IntegrationError.transient(
              r.status === 429 ? "MOVERTIS_RATE_LIMITED" : "MOVERTIS_UNAVAILABLE",
              r.status === 429
                ? "Movertis está limitando las peticiones (HTTP 429)"
                : `Movertis no disponible (HTTP ${r.status})`,
            );
            if (intento < maxRetries) { await espera(retryAfterMs ?? 2 ** intento * 500); continue; }
            throw ultimo;
          }
          throw IntegrationError.permanent(
            "MOVERTIS_BAD_JSON",
            `Movertis devolvió algo que no es JSON (${texto.slice(0, 120)})`,
          );
        }

        const queja = mensajeDeError(datos);

        if (r.status === 429 || r.status >= 500) {
          if (queja) {
            // Petición mal construida: reintentar no la arregla.
            throw IntegrationError.permanent(
              "MOVERTIS_PETICION",
              `Movertis rechazó la petición a ${ruta}: ${queja}`,
            );
          }
          ultimo = IntegrationError.transient(
            r.status === 429 ? "MOVERTIS_RATE_LIMITED" : "MOVERTIS_UNAVAILABLE",
            r.status === 429
              ? "Movertis está limitando las peticiones (HTTP 429)"
              : `Movertis no disponible (HTTP ${r.status})`,
          );
          if (intento < maxRetries) { await espera(retryAfterMs ?? 2 ** intento * 500); continue; }
          throw ultimo;
        }

        if (!r.ok) {
          throw IntegrationError.permanent(
            "MOVERTIS_HTTP",
            `Movertis respondió HTTP ${r.status}${queja ? `: ${queja}` : ""}`,
          );
        }

        // El 201 que en realidad es un 500. Ver la cabecera de este método.
        if (queja) {
          throw IntegrationError.permanent(
            "MOVERTIS_PETICION",
            `Movertis contestó HTTP ${r.status} con un error dentro: ${queja}`,
          );
        }
        return datos;
      } catch (e) {
        // Un IntegrationError ya clasificado no se reinterpreta.
        if (e instanceof IntegrationError) {
          if (e.retryable && intento < maxRetries) { await espera(2 ** intento * 500); continue; }
          throw e;
        }
        // Fallo de red o timeout: transitorio.
        ultimo = IntegrationError.transient("MOVERTIS_NETWORK", motivoDeRed(e, url));
        if (intento < maxRetries) { await espera(2 ** intento * 500); continue; }
        throw ultimo;
      }
    }
    throw ultimo ?? IntegrationError.transient("MOVERTIS_NETWORK", "No se pudo hablar con Movertis");
  }

  private get rutas(): Required<RutasMovertis> {
    return { ...RUTAS_POR_DEFECTO, ...(this.config.rutas ?? {}) };
  }

  private get opcionesMapeo() {
    return {
      provider: this.info.key,
      accountKey: this.config.accountKey ?? "default",
      // Sin declarar, se propaga `undefined` y la lectura sale sin odómetro:
      // preferimos la ausencia a un kilometraje mil veces menor.
      unidadOdometro: this.config.odometroEn,
      origenOdometro: this.config.origenOdometro,
    };
  }

  // ── Los cuerpos que pide cada ruta ─────────────────────────────────────────

  /**
   * Cuerpo de `showvehicles`.
   *
   * `id: []` significa «toda la flota», y las banderas deciden qué secciones
   * vienen. Solo existen tres —`basicData`, `counters`, `sensors`—; cualquier
   * otro nombre se contesta con «Flag incorrecta» dentro de un 201. Y
   * `basicData` no es opcional: sin él, un 500 con «El flag basicData es
   * obligatorio».
   *
   * `sensors` se pide solo cuando se necesita: con la flota entera esa bandera
   * devolvió 502 de la pasarela —son 32 sensores por vehículo y 751 vehículos—,
   * así que pedirla «por si acaso» es la forma de convertir una consulta que
   * funciona en una que se cae.
   */
  private cuerpoVehiculos(ids: string[], conContadores: boolean, conSensores = false) {
    return {
      flags: { basicData: true, ...(conContadores ? { counters: true } : {}), ...(conSensores ? { sensors: true } : {}) },
      // Los ids son numéricos en Movertis. Lo que no sea un número se descarta
      // antes de preguntar: mandarlo como cadena devuelve la flota entera, y
      // «pregunté por uno y me contestaron por 751» es un fallo silencioso.
      id: ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)),
    };
  }

  /** Cuerpo de `showtrips`: una lista, con las fechas en epoch de milisegundos. */
  private cuerpoTrips(providerVehicleId: string, window: TelemetryWindow) {
    return [
      {
        id: Number(providerVehicleId),
        initial_date: window.from.getTime(),
        end_date: window.to.getTime(),
      },
    ];
  }

  /**
   * Cuerpo de `summarytrips`: varias unidades, una ventana. La API pide rangos
   * de como mucho un mes; quien llame corta por meses, aquí no se comprueba
   * porque la ventana ya llega cortada.
   */
  private cuerpoResumen(providerVehicleIds: string[], window: TelemetryWindow) {
    return {
      units: providerVehicleIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)),
      initial_date: window.from.getTime(),
      end_date: window.to.getTime(),
    };
  }

  /** Unidad de la distancia: la declarada, o la del odómetro. Ver la config. */
  private get unidadDistancia(): UnidadOdometro | undefined {
    return this.config.distanciaEn ?? this.config.odometroEn;
  }

  /**
   * Resumen de distancia de varias unidades en una ventana (`summarytrips`).
   *
   * Una llamada por lote, no por vehículo: es lo que hace viable la flota de
   * 751 sin acercarse al cupo. Devuelve solo las unidades de las que Movertis
   * dijo algo; una que falte es «sin datos en la ventana» para quien llame.
   *
   * Sin unidad de medida declarada no se llama siquiera: se lanza un error de
   * configuración, que es lo único honesto. Guardar metros como kilómetros
   * dejaría un histórico mil veces menor que nadie cuestionaría.
   */
  async getTripSummary(
    ctx: OperationContext,
    providerVehicleIds: string[],
    window: TelemetryWindow,
  ): Promise<TripSummary[]> {
    if (providerVehicleIds.length === 0) return [];
    if (await this.enSimulacion(ctx)) return [];
    const unidad = this.unidadDistancia;
    if (!unidad) {
      throw IntegrationError.validation(
        "MOVERTIS_SIN_UNIDAD",
        "Movertis sin `distanciaEn` ni `odometroEn` en la config: no se puede saber si " +
          "`total_mileage` viene en km o en m, y no se va a adivinar.",
      );
    }

    const datos = await this.postear(ctx, this.rutas.summary, this.cuerpoResumen(providerVehicleIds, window));
    return resumenesDe(datos, providerVehicleIds)
      .map((r): TripSummary | null => {
        const distanceKm = aKilometros(r.total, unidad);
        // Sin total no hay resumen; los odómetros solos no dicen cuánto se movió
        // (podría faltar un tramo) y no se reconstruye restando.
        if (distanceKm === undefined) return null;
        return {
          provider: this.info.key,
          accountKey: this.config.accountKey ?? "default",
          providerVehicleId: r.unit,
          window,
          distanceKm,
          initialOdometerKm: aKilometros(r.inicial, unidad),
          finalOdometerKm: aKilometros(r.final, unidad),
          trips: r.viajes,
          raw: r.raw,
        };
      })
      .filter((r): r is TripSummary => r !== null);
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
      const datos = await this.postear(ctx, this.rutas.vehicles, this.cuerpoVehiculos([], false));
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
    const datos = await this.postear(ctx, this.rutas.vehicles, this.cuerpoVehiculos([], false));
    return filasDe(datos)
      .map((f) => aVehiculoDeFlota(f))
      .filter((v): v is ProviderVehicle => v !== null);
  }

  /**
   * La última lectura conocida: el odómetro de `showvehicles`, fechado con la
   * última posición de `showtrips`.
   *
   * Hacen falta las dos llamadas porque **`showvehicles` no fecha nada**. Da el
   * odómetro y ni un `timestamp`, y `capturedAt` es obligatorio en el modelo
   * —«no es cuándo se preguntó: es cuándo el equipo emitió lo que se está
   * leyendo»—. Poner `now()` sería cómodo y falso: el odómetro de un autobús
   * con el GPS dormido puede ser de hace tres días, y fecharlo ahora haría
   * pasar por reciente lo que no lo es, justo el engaño que la escalera de
   * tolerancia existe para detectar.
   *
   * Así que la fecha sale de la última posición emitida. Si el equipo no ha
   * emitido nada en una semana, se devuelve `null`: hay un número, pero no se
   * puede decir de cuándo, y un kilometraje sin instante no es auditable.
   */
  async getCurrentTelemetry(
    ctx: OperationContext,
    providerVehicleId: string,
  ): Promise<VehicleTelemetry | null> {
    if (await this.enSimulacion(ctx)) return null;

    const hasta = new Date();
    const desde = new Date(hasta.getTime() - VENTANA_ULTIMA_POSICION_H * 3_600_000);
    const [flota, puntos] = await Promise.all([
      this.postear(ctx, this.rutas.vehicles, this.cuerpoVehiculos([providerVehicleId], true)),
      this.postear(ctx, this.rutas.trips, this.cuerpoTrips(providerVehicleId, { from: desde, to: hasta })),
    ]);

    const fila = filasDe(flota)[0];
    if (!fila) return null;

    const ultimo = puntosDeUnidad(puntos, providerVehicleId).at(-1);
    const posicion = ultimo ? aLecturaDePunto(ultimo, this.opcionesMapeo, providerVehicleId) : null;
    if (!posicion) return null;

    const lectura = aLecturaDeFlota(fila, this.opcionesMapeo, providerVehicleId, posicion.capturedAt);
    return {
      ...lectura,
      latitude: posicion.latitude,
      longitude: posicion.longitude,
      positionAt: posicion.positionAt,
      raw: { ...lectura.raw, ...posicion.raw },
    };
  }

  /**
   * El histórico de Movertis: POSICIONES, sin odómetro.
   *
   * No es una carencia del mapeo, es lo que devuelve `showtrips`. Y tiene una
   * consecuencia que conviene saber antes de leer el código de al lado: quien
   * busque un KILOMETRAJE de un instante pasado no lo va a encontrar aquí, y
   * `VehicleOdometerService` —que filtra las lecturas que traen odómetro— dará
   * «sin_lectura» con toda la razón. Para lo que sí sirve es para demostrar que
   * un vehículo NO se ha movido entre dos instantes, que es otra pregunta y
   * resuelve el caso del arco del CheckPoint.
   */
  async getTelemetryHistory(
    ctx: OperationContext,
    providerVehicleId: string,
    window: TelemetryWindow,
  ): Promise<VehicleTelemetry[]> {
    if (await this.enSimulacion(ctx)) return [];
    const datos = await this.postear(ctx, this.rutas.trips, this.cuerpoTrips(providerVehicleId, window));
    return puntosDeUnidad(datos, providerVehicleId)
      .map((punto) => aLecturaDePunto(punto, this.opcionesMapeo, providerVehicleId))
      .filter((l): l is VehicleTelemetry => l !== null)
      // En orden cronológico, como pide el contrato: el proveedor no garantiza
      // devolverlas ordenadas y quien las consuma lo da por hecho.
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  }

  /**
   * La lectura más cercana a `at` dentro de la tolerancia. Sin odómetro, por lo
   * dicho en `getTelemetryHistory`.
   *
   * Pide una ventana de ±tolerancia y elige de ahí. No interpola (regla 3):
   * devuelve una lectura que existió, o null. Un autobús parado en el taller
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

/**
 * El mensaje de error que Movertis mete en el cuerpo, venga con el estado que
 * venga. Ver la cabecera de `postear`.
 */
export function mensajeDeError(datos: unknown): string | null {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return null;
  const d = datos as Record<string, unknown>;
  // `name: "HttpException"` con `status: 500` es el 201 que en realidad falla.
  const esExcepcion = d.name === "HttpException" || Number(d.status) >= 400 || Number(d.statusCode) >= 400;
  if (!esExcepcion) return null;
  for (const k of ["error", "message", "response"]) {
    if (typeof d[k] === "string" && d[k]) return d[k] as string;
  }
  return "error sin mensaje";
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cuánto pide esperar el proveedor en `Retry-After`, en ms, o `undefined`.
 *
 * Acepta segundos (lo habitual) y una fecha HTTP. Se acota a
 * `RETRY_AFTER_MAXIMO_MS`: obedecer es lo correcto, colgarse una hora no.
 */
export function esperaPedida(r: { status: number; headers: { get(n: string): string | null } }): number | undefined {
  if (r.status !== 429 && r.status !== 503) return undefined;
  const v = r.headers.get("retry-after");
  if (!v) return undefined;
  const seg = Number(v);
  let ms: number;
  if (Number.isFinite(seg)) ms = seg * 1000;
  else {
    const fecha = Date.parse(v);
    if (!Number.isFinite(fecha)) return undefined;
    ms = fecha - Date.now();
  }
  if (ms <= 0) return undefined;
  return Math.min(ms, RETRY_AFTER_MAXIMO_MS);
}

/**
 * Por qué no se pudo ni hablar con Movertis, dicho de forma accionable.
 *
 * El `fetch` de Node contesta «fetch failed» a TODO lo que pase por debajo —DNS
 * que no resuelve, conexión rechazada, certificado caducado, timeout— y guarda
 * el motivo de verdad en `cause`. Sin desenvolverlo, el panel enseña tres
 * palabras que no distinguen «la URL está mal escrita» de «su HTTPS está roto»
 * de «el servidor no nos deja salir», que son tres problemas con tres arreglos
 * distintos y ninguno se parece al otro.
 *
 * Se incluye también la URL. No es un secreto —el token va en la cabecera, no
 * aquí— y es la mitad de la respuesta: en esta integración conviven una URL de
 * pruebas y una de producción, y saber contra cuál se ha intentado ahorra la
 * primera media hora de cualquier diagnóstico.
 */
export function motivoDeRed(e: unknown, url: string): string {
  const err = e as { message?: string; name?: string; cause?: unknown };
  const causa = err?.cause as { code?: string; message?: string } | undefined;

  // El timeout de AbortSignal llega como AbortError, sin causa que desenvolver.
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `Movertis no contestó a tiempo (${url}).`;
  }

  const codigo = causa?.code;
  const explicacion: Record<string, string> = {
    ENOTFOUND: "el nombre no resuelve en DNS: revisa que la URL esté bien escrita",
    EAI_AGAIN: "el DNS no responde ahora mismo",
    ECONNREFUSED: "el servidor rechaza la conexión en ese puerto",
    ECONNRESET: "el servidor cortó la conexión",
    ETIMEDOUT: "la conexión no llegó a abrirse",
    CERT_HAS_EXPIRED: "su certificado HTTPS está caducado",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "su certificado HTTPS no se puede verificar",
    DEPTH_ZERO_SELF_SIGNED_CERT: "su certificado HTTPS es autofirmado",
    ERR_TLS_CERT_ALTNAME_INVALID: "su certificado HTTPS no vale para ese dominio",
  };

  const detalle = codigo
    ? `${explicacion[codigo] ?? causa?.message ?? codigo} (${codigo})`
    : (causa?.message ?? err?.message ?? String(e));

  return `No se pudo hablar con Movertis en ${url}: ${detalle}`;
}
