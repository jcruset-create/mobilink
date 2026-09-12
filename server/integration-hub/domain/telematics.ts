/**
 * Modelo normalizado de telemática.
 *
 * TyreControl no debe conocer la forma de la respuesta de Movertis, ni la de
 * Webfleet, ni la del que venga después. Habla con esto y el conector traduce.
 *
 * ── Por qué casi todo es opcional ───────────────────────────────────────────
 *
 * Porque en esta flota casi todo falta alguna vez, y no por culpa de la API.
 * El comentario de `server/index.ts` sobre Webfleet lo dice sin rodeos: «Los
 * equipos de la flota no tienen enlace CAN/FMS, así que Webfleet devuelve
 * fuel_usage y co2 SIEMPRE a 0». Un modelo que exigiera combustible obligaría
 * a inventarse un cero, y un cero inventado es indistinguible de un depósito
 * vacío. Aquí lo que no se sabe es `undefined`, y quien lo lea tiene que
 * decidir qué hacer con esa ausencia.
 *
 * Solo hay tres campos obligatorios, y son los que identifican la lectura:
 * de qué proveedor viene, de qué vehículo suyo, y de cuándo. Sin cualquiera
 * de los tres el dato no es auditable, que es justo lo que se busca.
 */

/**
 * Una lectura de telemetría, ya traducida.
 *
 * Representa lo que el proveedor sabía del vehículo en un instante. NO es «el
 * estado actual»: es una foto con fecha, y la fecha importa tanto como el
 * número, porque una operación de neumático se casa con la lectura más cercana
 * en el tiempo y hay que poder decir a cuánta distancia estaba.
 */
import type { OperationContext } from "./identifiers.ts";

export interface VehicleTelemetry {
  /** Conector que la produjo: `movertis`, `webfleet`… Es el `connector_key`. */
  provider: string;
  /** Cuenta telemática dentro de ese proveedor. Un cliente puede tener varias. */
  accountKey: string;
  /** Identificador del vehículo EN EL PROVEEDOR, tal cual lo devuelve él. */
  providerVehicleId: string;

  /**
   * Instante al que corresponde la lectura, según el proveedor.
   *
   * No es «cuándo se preguntó»: es cuándo el equipo emitió lo que se está
   * leyendo. La diferencia entre este instante y el de la operación es lo que
   * decide si el kilometraje es de fiar.
   */
  capturedAt: Date;

  /**
   * Odómetro total del vehículo, en kilómetros. `undefined` si no lo da.
   *
   * TOTAL, no parcial, y con decimales: `webfleetOdometerKm()` redondea hoy y
   * se pierden los 684.327,4 km. Aquí no se redondea; quien guarde decidirá.
   *
   * Ojo con la procedencia: no todos los proveedores lo sacan del
   * cuentakilómetros del vehículo. Si viene calculado por GPS, es distancia
   * acumulada y no coincide con el salpicadero. Eso se declara en
   * `odometerSource`, no se adivina.
   */
  odometerKm?: number;
  /** De dónde sale el odómetro, si el proveedor lo dice. */
  odometerSource?: "vehicle" | "gps" | "unknown";
  /**
   * Instante del odómetro, si el proveedor lo fecha aparte de la posición.
   *
   * No hay que dar por hecho que coincide con `capturedAt` ni con
   * `positionAt`: son sensores distintos y pueden llegar desacompasados.
   */
  odometerAt?: Date;

  /** Grados decimales. Ausentes si no hay posición válida (ver `esPosicionValida`). */
  latitude?: number;
  longitude?: number;
  /** Instante de la posición, si viene fechada aparte. */
  positionAt?: Date;
  /** Dirección en texto, si el proveedor la resuelve. */
  address?: string;
  /** Velocidad en km/h en el momento de la lectura. */
  speedKmh?: number;

  /** Nivel de depósito en porcentaje (0-100). Ver el aviso de la cabecera. */
  fuelLevelPct?: number;
  /** Litros consumidos en el periodo que el proveedor reporte. */
  fuelConsumedL?: number;

  /**
   * El registro del proveedor que originó esta lectura, acotado.
   *
   * Acotado a propósito: guardar la respuesta íntegra de cada lectura para
   * toda la flota engorda la base deprisa. Con el registro que se usó basta
   * para poder justificar el dato más tarde.
   */
  raw?: Record<string, unknown>;
}

/** Un vehículo tal como lo lista el proveedor, para poder enlazarlo. */
export interface ProviderVehicle {
  /** Identificador en el proveedor. Es lo que se guarda como `external_code`. */
  providerVehicleId: string;
  /** Nombre o alias del vehículo en la plataforma del proveedor. */
  name?: string;
  /**
   * Matrícula, si el proveedor la expone.
   *
   * Opcional por una razón concreta: no está garantizado que la haya. En el
   * ejemplo de Movertis la unidad se llama `TSVETAN2`, que es un alias y no
   * una matrícula. Sin este campo no hay emparejamiento automático posible y
   * la vinculación tiene que ser manual.
   */
  plate?: string;
  /** Bastidor, si lo expone. */
  vin?: string;
  brand?: string;
  model?: string;
  /** Si el proveedor lo marca como activo o dado de baja. */
  active?: boolean;
  /** Última vez que se supo del equipo, si lo dice. */
  lastContactAt?: Date;
}

/** Ventana temporal para pedir lecturas históricas. */
export interface TelemetryWindow {
  from: Date;
  to: Date;
}

/**
 * Lo que un conector de telemática dice saber hacer de verdad.
 *
 * Van en `ConnectorInfo.capabilities`, que el propio contrato define como
 * «las funciones que implementa REALMENTE esta versión». Con esto el panel
 * puede enseñar solo lo que la cuenta soporta, en vez de repartir condicionales
 * por nombre de proveedor. Que un proveedor dé posición pero no odómetro es el
 * caso normal, no la excepción.
 */
export const TELEMATICS_CAPABILITIES = {
  /** Sabe listar los vehículos de la cuenta. */
  LIST_VEHICLES: "telematics:list-vehicles",
  /** Sabe dar la última lectura conocida de un vehículo. */
  CURRENT_TELEMETRY: "telematics:current",
  /** Sabe dar lecturas de una ventana pasada. Sin esto no hay trazabilidad. */
  HISTORY: "telematics:history",
  /** Sus lecturas traen odómetro. */
  ODOMETER: "telematics:odometer",
  /** Sus lecturas traen posición. */
  POSITION: "telematics:position",
  /** Sus lecturas traen combustible. */
  FUEL: "telematics:fuel",
  /**
   * Sabe resumir la distancia recorrida en una ventana, sin bajar a posiciones.
   *
   * Es lo que hace falta para el kilometraje mensual: pedir «cuánto se movió
   * este vehículo en septiembre» y recibir un número, no 40.000 puntos GPS.
   */
  TRIP_SUMMARY: "telematics:trip-summary",
} as const;

export type TelematicsCapability =
  (typeof TELEMATICS_CAPABILITIES)[keyof typeof TELEMATICS_CAPABILITIES];

/**
 * ¿Es esta una posición real?
 *
 * `0,0` es una coordenada válida en el Golfo de Guinea y, en telemática, casi
 * siempre significa «el equipo no tenía fijación GPS». Tratarla como buena
 * pone camiones de Tarragona en mitad del Atlántico. `Number.isFinite()` por
 * sí solo deja pasar el cero, así que hace falta comprobarlo aparte.
 *
 * Se descarta también lo que no es un número y lo que se sale del rango, que
 * es como suelen llegar los centinelas de «sin dato».
 */
export function esPosicionValida(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false;
  return la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

/**
 * Distancia recorrida por un vehículo en una ventana, según el proveedor.
 *
 * Es un RESUMEN que calcula el proveedor, no una lectura del equipo: por eso
 * no lleva `capturedAt` ni entra en `VehicleTelemetry`. El odómetro inicial y
 * final se conservan cuando vienen, porque permiten comprobar el total
 * (`final - initial` debería cuadrar) y detectar un resumen roto sin volver a
 * preguntar.
 */
export interface TripSummary {
  provider: string;
  accountKey: string;
  providerVehicleId: string;
  window: TelemetryWindow;
  /** Kilómetros recorridos en la ventana. Ya en km, con la unidad resuelta. */
  distanceKm: number;
  /** Odómetro al inicio y al final de la ventana, en km, si el proveedor los da. */
  initialOdometerKm?: number;
  finalOdometerKm?: number;
  /** Número de viajes contados por el proveedor, si lo dice. */
  trips?: number;
  raw?: Record<string, unknown>;
}

/**
 * Proveedores que saben resumir distancias.
 *
 * Es una interfaz APARTE de `ITelematicsConnector`, no un método opcional
 * dentro: así Webfleet, que no lo implementa, ni se entera de que existe, y
 * quien lo necesite comprueba `TRIP_SUMMARY` en las capacidades y hace el
 * cast, en vez de encontrarse un `undefined` a mitad de una sincronización.
 */
export interface ITripSummaryProvider {
  /**
   * Resumen de VARIOS vehículos en UNA llamada.
   *
   * Que acepte una lista es deliberado: el proveedor limita las peticiones,
   * no los vehículos por petición, así que agruparlos es la diferencia entre
   * 30 llamadas y 750. Devuelve una entrada por vehículo con datos; los que
   * el proveedor no menciona simplemente no aparecen, y quien llama decide
   * qué significa esa ausencia.
   */
  getTripSummary(
    ctx: OperationContext,
    providerVehicleIds: string[],
    window: TelemetryWindow,
  ): Promise<TripSummary[]>;
}

/** Comprueba en tiempo de ejecución si un conector sabe resumir distancias. */
export function sabeResumirViajes(c: unknown): c is ITripSummaryProvider {
  return !!c && typeof (c as ITripSummaryProvider).getTripSummary === "function";
}
