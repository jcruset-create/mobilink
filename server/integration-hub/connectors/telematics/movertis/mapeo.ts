/**
 * Traducción de lo que devuelve Movertis al modelo normalizado de telemática.
 *
 * Esta es la única pieza del conector que conoce la forma de la respuesta de
 * Movertis. Está aparte, y es pura (sin red, sin reloj, sin estado), por dos
 * razones:
 *
 *  1. `telematics.ts` exige que TyreControl no sepa de qué proveedor viene el
 *     dato. Si el mapeo vive pegado al cliente HTTP, acaba filtrándose.
 *  2. A día de hoy **no conocemos los nombres exactos de los campos**. La sonda
 *     (`scripts/movertis-probe.mjs`) existe justo para averiguarlos, y mientras
 *     el upstream de Movertis siga caído no hay respuesta real que mirar. Con
 *     el mapeo aislado y probado, cerrar esa incógnita es tocar una lista de
 *     nombres y un test, no reescribir el conector.
 *
 * ── Cómo se resuelve el no saber los nombres ────────────────────────────────
 *
 * No se adivina en silencio. Cada campo se busca por una lista de candidatos
 * plausibles (`CANDIDATOS`), y esa lista se puede FIJAR desde la config del
 * tenant (`MovertisConfig.campos`) en cuanto la sonda diga la verdad. Lo que
 * no aparece por ninguno de esos nombres sale `undefined`, nunca cero: la
 * regla 2 del contrato dice que devolver menos es válido e inventar no, y en
 * esta flota un cero de relleno ya significó una vez «no hay CAN».
 *
 * ── La trampa de las unidades ───────────────────────────────────────────────
 *
 * El odómetro es el dato que sostiene la trazabilidad del neumático, y llega
 * en unidades distintas según proveedor (Webfleet ya obliga a dividir entre
 * 1000 o entre 10 según el campo). De Movertis no sabemos la suya, así que NO
 * se adivina por el tamaño del número —un camión con 900.000 km y uno con
 * 900.000 m son indistinguibles por magnitud—: se declara en
 * `MovertisConfig.odometroEn` y por defecto se asume `km`, que es lo que
 * anuncia la mayoría de APIs de flota. Confirmarlo con la sonda antes de dar
 * por bueno un kilometraje es parte del trabajo pendiente.
 */

import {
  esPosicionValida,
  type ProviderVehicle,
  type VehicleTelemetry,
} from "../../../domain/telematics.ts";

/** Unidad en la que Movertis expresa el odómetro. Ver cabecera. */
export type UnidadOdometro = "km" | "m" | "hm";

/** Nombres de campo fijados a mano, cuando ya se sabe cuáles son. */
export interface CamposMovertis {
  vehicleId?: string[];
  name?: string[];
  plate?: string[];
  vin?: string[];
  brand?: string[];
  model?: string[];
  active?: string[];
  lastContactAt?: string[];
  capturedAt?: string[];
  odometer?: string[];
  odometerAt?: string[];
  latitude?: string[];
  longitude?: string[];
  positionAt?: string[];
  address?: string[];
  speed?: string[];
  fuelLevel?: string[];
  fuelConsumed?: string[];
}

/**
 * Candidatos por campo, en orden de preferencia.
 *
 * Mezcla inglés y castellano porque Movertis es un proveedor español y sus
 * APIs suelen alternar ambos. El orden importa: gana el primero que exista y
 * traiga algo utilizable.
 */
const CANDIDATOS: Required<CamposMovertis> = {
  vehicleId: ["id", "vehicleId", "vehicle_id", "idVehiculo", "id_vehiculo", "deviceId", "device_id", "imei"],
  name: ["name", "nombre", "alias", "label", "description", "descripcion"],
  plate: ["plate", "matricula", "matrícula", "licensePlate", "license_plate", "registration"],
  vin: ["vin", "bastidor", "chassis", "chasis"],
  brand: ["brand", "marca", "make"],
  model: ["model", "modelo"],
  active: ["active", "activo", "enabled", "habilitado", "isActive"],
  lastContactAt: ["lastContact", "last_contact", "ultimoContacto", "ultimo_contacto", "lastSeen", "last_seen"],
  capturedAt: [
    "timestamp", "time", "datetime", "fecha", "fechaHora", "fecha_hora",
    "capturedAt", "captured_at", "gpsTime", "gps_time", "deviceTime", "device_time",
  ],
  odometer: [
    "odometer", "odometro", "odómetro", "totalOdometer", "total_odometer",
    "mileage", "kilometraje", "km", "kms", "totalDistance", "total_distance",
  ],
  odometerAt: ["odometerTime", "odometer_time", "odometerAt", "odometer_at", "fechaOdometro"],
  latitude: ["lat", "latitude", "latitud"],
  longitude: ["lon", "lng", "longitude", "longitud"],
  positionAt: ["positionTime", "position_time", "gpsTime", "gps_time", "fechaPosicion"],
  address: ["address", "direccion", "dirección", "location", "ubicacion", "ubicación"],
  speed: ["speed", "velocidad", "speedKmh", "speed_kmh"],
  fuelLevel: ["fuelLevel", "fuel_level", "nivelCombustible", "nivel_combustible", "fuelPct", "fuel_percent"],
  fuelConsumed: ["fuelConsumed", "fuel_consumed", "combustibleConsumido", "fuelUsage", "fuel_usage", "litros"],
};

/** Lee el primer candidato presente y no vacío. */
function leer(registro: Record<string, unknown>, candidatos: string[]): unknown {
  for (const c of candidatos) {
    const v = registro[c];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Candidatos efectivos: los fijados en config mandan sobre los de la lista. */
function candidatos(campo: keyof CamposMovertis, fijados?: CamposMovertis): string[] {
  const propios = fijados?.[campo];
  return propios && propios.length ? propios : CANDIDATOS[campo];
}

/** Número finito, o `undefined`. Nunca 0 de relleno. */
export function numero(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Fecha del proveedor a `Date`, o `undefined`.
 *
 * Acepta ISO 8601 y epoch (segundos o milisegundos). El corte entre ambos está
 * en 10^11: por debajo son segundos (10^11 s serían el año 5138) y por encima,
 * milisegundos. Una fecha inválida se descarta en vez de propagarse como
 * `Invalid Date`, que envenena cualquier comparación posterior sin avisar.
 */
export function fecha(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN;
  if (Number.isFinite(n)) {
    const ms = Math.abs(n) < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Pasa el odómetro a kilómetros según la unidad declarada. Sin redondear. */
export function aKilometros(valor: number | undefined, unidad: UnidadOdometro): number | undefined {
  if (valor === undefined) return undefined;
  if (unidad === "m") return valor / 1000;
  if (unidad === "hm") return valor / 10;
  return valor;
}

/** Booleano tolerante: acepta true/false, 1/0 y "true"/"si"/"activo". */
function booleano(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "si", "sí", "activo", "enabled", "y", "yes"].includes(s)) return true;
  if (["0", "false", "no", "inactivo", "disabled", "n"].includes(s)) return false;
  return undefined;
}

export interface OpcionesMapeo {
  /** `connector_key`. Va tal cual a `VehicleTelemetry.provider`. */
  provider: string;
  /** Cuenta telemática dentro del proveedor. */
  accountKey: string;
  unidadOdometro: UnidadOdometro;
  campos?: CamposMovertis;
  /**
   * De dónde sale el odómetro, si se sabe. Se declara, no se adivina: un
   * odómetro por GPS es distancia acumulada y no cuadra con el salpicadero.
   */
  origenOdometro?: "vehicle" | "gps" | "unknown";
}

/**
 * Un registro de vehículo de Movertis → `ProviderVehicle`.
 *
 * Devuelve `null` si no hay identificador: sin él la ficha no se puede enlazar
 * con nada y colarla solo ensucia la lista.
 */
export function aProviderVehicle(
  registro: Record<string, unknown>,
  campos?: CamposMovertis,
): ProviderVehicle | null {
  const id = leer(registro, candidatos("vehicleId", campos));
  if (id === undefined) return null;

  const texto = (campo: keyof CamposMovertis): string | undefined => {
    const v = leer(registro, candidatos(campo, campos));
    return v === undefined ? undefined : String(v).trim() || undefined;
  };

  return {
    providerVehicleId: String(id),
    name: texto("name"),
    // La matrícula puede no venir: en el ejemplo de Movertis la unidad se
    // llama `TSVETAN2`, que es un alias. Sin ella no hay emparejamiento
    // automático y la vinculación tendrá que ser manual.
    plate: texto("plate"),
    vin: texto("vin"),
    brand: texto("brand"),
    model: texto("model"),
    active: booleano(leer(registro, candidatos("active", campos))),
    lastContactAt: fecha(leer(registro, candidatos("lastContactAt", campos))),
  };
}

/**
 * Un registro de lectura de Movertis → `VehicleTelemetry`.
 *
 * Devuelve `null` cuando falta alguno de los tres campos que identifican la
 * lectura (proveedor, vehículo, instante). El contrato los exige porque sin
 * los tres el dato no es auditable, que es justo lo que se busca: una lectura
 * sin fecha no se puede casar con el momento de una operación de neumático.
 */
export function aVehicleTelemetry(
  registro: Record<string, unknown>,
  opciones: OpcionesMapeo,
  vehicleIdPorDefecto?: string,
): VehicleTelemetry | null {
  const { provider, accountKey, unidadOdometro, campos } = opciones;

  const idCrudo = leer(registro, candidatos("vehicleId", campos));
  const providerVehicleId = idCrudo !== undefined ? String(idCrudo) : vehicleIdPorDefecto;
  if (!providerVehicleId) return null;

  const capturedAt = fecha(leer(registro, candidatos("capturedAt", campos)));
  if (!capturedAt) return null;

  const lat = leer(registro, candidatos("latitude", campos));
  const lng = leer(registro, candidatos("longitude", campos));
  // `0,0` es válido en el Golfo de Guinea y, en telemática, casi siempre
  // significa «sin fijación GPS». `esPosicionValida` es quien decide.
  const hayPosicion = esPosicionValida(lat, lng);

  const odometerKm = aKilometros(
    numero(leer(registro, candidatos("odometer", campos))),
    unidadOdometro,
  );

  const direccion = leer(registro, candidatos("address", campos));

  const lectura: VehicleTelemetry = {
    provider,
    accountKey,
    providerVehicleId,
    capturedAt,
    // `raw` acotado a propósito: guardar la respuesta íntegra de cada lectura
    // para toda la flota engorda la base deprisa.
    raw: registro,
  };

  if (odometerKm !== undefined) {
    lectura.odometerKm = odometerKm;
    lectura.odometerSource = opciones.origenOdometro ?? "unknown";
    const odoAt = fecha(leer(registro, candidatos("odometerAt", campos)));
    // Solo se rellena si Movertis lo fecha aparte: no se da por hecho que
    // coincida con `capturedAt`, son sensores distintos.
    if (odoAt) lectura.odometerAt = odoAt;
  }

  if (hayPosicion) {
    lectura.latitude = Number(lat);
    lectura.longitude = Number(lng);
    const posAt = fecha(leer(registro, candidatos("positionAt", campos)));
    if (posAt) lectura.positionAt = posAt;
  }

  if (direccion !== undefined) lectura.address = String(direccion).trim() || undefined;

  const velocidad = numero(leer(registro, candidatos("speed", campos)));
  if (velocidad !== undefined) lectura.speedKmh = velocidad;

  const nivel = numero(leer(registro, candidatos("fuelLevel", campos)));
  if (nivel !== undefined) lectura.fuelLevelPct = nivel;

  const consumido = numero(leer(registro, candidatos("fuelConsumed", campos)));
  if (consumido !== undefined) lectura.fuelConsumedL = consumido;

  return lectura;
}

/**
 * Saca la lista de registros de una respuesta, venga como venga.
 *
 * Una API puede devolver el array pelado o envuelto en `data`/`items`/
 * `results`/`vehicles`. Mientras la sonda no confirme cuál usa Movertis, se
 * aceptan todas y se deja de ser frágil a ese detalle.
 */
export function filasDe(respuesta: unknown): Record<string, unknown>[] {
  if (Array.isArray(respuesta)) return respuesta as Record<string, unknown>[];
  if (respuesta && typeof respuesta === "object") {
    const o = respuesta as Record<string, unknown>;
    for (const clave of ["data", "items", "results", "vehicles", "vehiculos", "positions", "records"]) {
      if (Array.isArray(o[clave])) return o[clave] as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * La lectura más cercana a un instante dentro de la tolerancia, o `null`.
 *
 * No interpola: devuelve una lectura que existió o nada, tal y como exige la
 * regla 3 del contrato. Fabricar un valor intermedio produce un número que no
 * está en ninguna fuente, que es lo contrario de lo que se busca.
 */
export function masCercana(
  lecturas: VehicleTelemetry[],
  at: Date,
  toleranceMinutes: number,
): VehicleTelemetry | null {
  const limite = Math.abs(toleranceMinutes) * 60_000;
  const objetivo = at.getTime();
  let mejor: VehicleTelemetry | null = null;
  let mejorDelta = Infinity;
  for (const l of lecturas) {
    const delta = Math.abs(l.capturedAt.getTime() - objetivo);
    if (delta <= limite && delta < mejorDelta) {
      mejor = l;
      mejorDelta = delta;
    }
  }
  return mejor;
}
