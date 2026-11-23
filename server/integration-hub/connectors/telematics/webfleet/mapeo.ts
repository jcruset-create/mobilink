/**
 * Traducción de las respuestas de Webfleet al modelo normalizado de telemática.
 *
 * A diferencia del mapeo de Movertis, aquí **sí sabemos** cómo responde la API:
 * lleva años en producción y `server/index.ts` la lee desde hace tiempo. Por eso
 * este mapeo no tantea candidatos, sino que nombra los campos uno a uno. Lo que
 * se traía de allí no se copia sin más: se corrigen tres cosas que el modelo
 * normalizado prohíbe expresamente.
 *
 * ── 1. Aquí no se redondea ──────────────────────────────────────────────────
 *
 * `webfleetOdometerKm()` de `index.ts` hace `Math.round()`, y el propio
 * `telematics.ts` lo señala con nombre y apellidos: «redondea hoy y se pierden
 * los 684.327,4 km». Para enseñar un número en pantalla da igual; para decir a
 * qué kilometraje se montó un neumático, no. `odometerKm` sale con sus
 * decimales y quien lo guarde decidirá.
 *
 * ── 2. Las unidades cambian según la acción, y el nombre engaña ─────────────
 *
 * Esta es la trampa de verdad de Webfleet, y no está documentada en ningún
 * sitio del repositorio:
 *
 *   showObjectReportExtern → `latitude_mdeg` en MICROGRADOS (÷1e6)
 *                            `latitude`      en GRADOS
 *   showTracks             → `latitude`      en MICROGRADOS (÷1e6)
 *   showTripReportExtern   → `start_latitude`/`end_latitude` en MICROGRADOS
 *
 * O sea: el campo `latitude` significa una cosa en una acción y otra distinta
 * en la de al lado, con un factor de un millón entre ambas. Confundirlas no da
 * un error, da una coordenada en mitad del océano. Por eso cada acción tiene
 * aquí su propia función y no hay un mapeo genérico que las unifique: lo que
 * las diferencia es justo lo que no se puede perder.
 *
 * Con el odómetro pasa lo mismo: `odometer_long` viene en metros y `odometer`
 * en hectómetros.
 *
 * ── 3. El combustible de esta flota NO se mapea ─────────────────────────────
 *
 * Lo dice la cabecera de `telematics.ts` citando a `index.ts`: «Los equipos de
 * la flota no tienen enlace CAN/FMS, así que Webfleet devuelve fuel_usage y
 * co2 SIEMPRE a 0». Ese cero no es un depósito vacío, es la ausencia de
 * sensor, y son indistinguibles una vez guardados. Así que no se traduce, y el
 * conector tampoco anuncia la capacidad FUEL.
 */

import {
  esPosicionValida,
  type ProviderVehicle,
  type TelemetryWindow,
  type TripSummary,
  type VehicleTelemetry,
} from "../../../domain/telematics.ts";

/** Número finito o `undefined`. Nunca 0 de relleno. */
function numero(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Fecha ISO de Webfleet (se pide con `useISO8601=true`) a `Date`. */
function fecha(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Microgrados → grados. Webfleet los da como enteros ×1e6. */
function microgrados(v: unknown): number | undefined {
  const n = numero(v);
  return n === undefined ? undefined : n / 1e6;
}

/**
 * Odómetro TOTAL en kilómetros, con decimales.
 *
 * Orden de preferencia por precisión, que es el mismo que ya usaba `index.ts`:
 * metros primero, hectómetros después. Lo que cambia es que aquí NO se
 * redondea (ver la cabecera) y que el `> 0` de allí se mantiene por una razón
 * concreta: Webfleet manda 0 cuando el equipo no reporta odómetro, y ese cero
 * es ausencia de dato, no un vehículo recién matriculado.
 */
export function odometroKm(o: Record<string, unknown>): number | undefined {
  const metros = numero(o.odometer_long);
  if (metros !== undefined && metros > 0) return metros / 1000;

  const hectometros = numero(o.odometer);
  if (hectometros !== undefined && hectometros > 0) return hectometros / 10;

  // Cuentakilómetros del salpicadero por CAN, cuando el equipo lo tiene.
  const can = numero(o.can_odometer ?? o.dashboard_odometer ?? o.mileage ?? o.milage);
  if (can !== undefined && can > 0) {
    // `index.ts` decide metros o km por un umbral de 200.000, y se conserva:
    // es la heurística que lleva años en producción con esta flota. Un autobús
    // con más de 200.000 en este campo está dando metros, porque 200.000 km es
    // kilometraje normal aquí y 200.000 m son 200 km, que no lo es.
    return can > 200000 ? can / 1000 : can;
  }
  return undefined;
}

/**
 * Posición de `showObjectReportExtern`.
 *
 * Prefiere los microgrados —son los que Webfleet da siempre— y cae a los
 * grados llanos solo si no están. Devuelve `null` si la posición no es válida:
 * `0,0` significa «sin fijación GPS», no el Golfo de Guinea.
 */
function posicionDeObjeto(o: Record<string, unknown>): { lat: number; lng: number } | null {
  const lat = o.latitude_mdeg != null ? microgrados(o.latitude_mdeg) : numero(o.latitude);
  const lng = o.longitude_mdeg != null ? microgrados(o.longitude_mdeg) : numero(o.longitude);
  return esPosicionValida(lat, lng) ? { lat: lat as number, lng: lng as number } : null;
}

/**
 * Matrícula de una fila de `showVehicleReportExtern`, normalizada como la
 * guarda TyreControl (sin espacios ni guiones, en mayúsculas).
 *
 * `showObjectReportExtern` —la acción de posiciones— no trae matrícula; la
 * ficha del vehículo sí, en `licenseplatenumber`, que es lo que se rellena en
 * Webfleet en «Vehículos → Matrícula». Si está vacía no se inventa: se queda
 * sin matrícula y la conciliación cae al nº de equipo de la ficha.
 */
export function matriculaDeFicha(f: Record<string, unknown>): string | undefined {
  const v = f.licenseplatenumber ?? f.licenseplate ?? f.licenceplatenumber;
  if (v === undefined || v === null) return undefined;
  const limpia = String(v).replace(/[\s-]+/g, "").toUpperCase();
  return limpia || undefined;
}

/** Un objeto de `showObjectReportExtern` → ficha de vehículo del proveedor. */
export function objetoAVehiculo(o: Record<string, unknown>, matricula?: string): ProviderVehicle | null {
  const id = o.objectno;
  if (id === undefined || id === null || id === "") return null;

  const texto = (v: unknown): string | undefined =>
    v === undefined || v === null ? undefined : String(v).trim() || undefined;

  return {
    providerVehicleId: String(id),
    name: texto(o.objectname) ?? String(id),
    // Esta acción no trae matrícula, y `objectname` a menudo lo es pero no
    // está garantizado, así que no se deduce de ahí. La da la ficha del
    // vehículo (`showVehicleReportExtern`), que el conector cruza por objectno.
    plate: matricula,
    lastContactAt: fecha(o.pos_time),
  };
}

export interface OpcionesMapeo {
  /** `connector_key`. Va tal cual a `VehicleTelemetry.provider`. */
  provider: string;
  /** Cuenta telemática dentro del proveedor. */
  accountKey: string;
}

/**
 * Un objeto de `showObjectReportExtern` → lectura de telemetría.
 *
 * Es la «última lectura conocida»: Webfleet devuelve aquí el estado actual del
 * equipo, fechado en `pos_time`. Sin `pos_time` no hay lectura, porque una
 * lectura sin fecha no se puede casar con el momento de una operación y el
 * contrato la considera no auditable.
 */
export function objetoALectura(
  o: Record<string, unknown>,
  opciones: OpcionesMapeo,
  vehicleIdPorDefecto?: string,
): VehicleTelemetry | null {
  const id = o.objectno != null && o.objectno !== "" ? String(o.objectno) : vehicleIdPorDefecto;
  if (!id) return null;

  const capturedAt = fecha(o.pos_time);
  if (!capturedAt) return null;

  const lectura: VehicleTelemetry = {
    provider: opciones.provider,
    accountKey: opciones.accountKey,
    providerVehicleId: id,
    capturedAt,
    raw: o,
  };

  const km = odometroKm(o);
  if (km !== undefined) {
    lectura.odometerKm = km;
    // Webfleet da el cuentakilómetros del propio vehículo, no distancia
    // acumulada por GPS. Por eso se puede declarar, en vez de dejarlo en
    // "unknown" como hace el conector de Movertis mientras no se sepa.
    lectura.odometerSource = "vehicle";
  }

  const pos = posicionDeObjeto(o);
  if (pos) {
    lectura.latitude = pos.lat;
    lectura.longitude = pos.lng;
    // `pos_time` fecha la posición, que es lo mismo que fecha la lectura.
    lectura.positionAt = capturedAt;
  }

  const direccion = o.postext ?? o.postext_short;
  if (direccion != null) lectura.address = String(direccion).trim() || undefined;

  const velocidad = numero(o.speed);
  if (velocidad !== undefined) lectura.speedKmh = velocidad;

  // Combustible: deliberadamente ausente. Ver la cabecera.

  return lectura;
}

/**
 * Un viaje de `showTripReportExtern` → lectura al FINAL del viaje.
 *
 * Se toma el final y no el principio porque es el instante del que Webfleet
 * sabe más: el equipo ha estado emitiendo todo el trayecto. Cada viaje produce
 * como mucho una lectura; el histórico de un vehículo es la sucesión de los
 * finales de sus viajes.
 *
 * Ojo con las coordenadas: aquí vienen en MICROGRADOS, al revés que en
 * `showObjectReportExtern`. Ver la cabecera.
 */
export function viajeALectura(
  t: Record<string, unknown>,
  opciones: OpcionesMapeo,
  providerVehicleId: string,
): VehicleTelemetry | null {
  const capturedAt = fecha(t.end_time);
  if (!capturedAt) return null;

  const lectura: VehicleTelemetry = {
    provider: opciones.provider,
    accountKey: opciones.accountKey,
    providerVehicleId,
    capturedAt,
    raw: t,
  };

  // El libro de ruta (showLogbook) trae odómetro; showTripReportExtern solo
  // distancia. Se lee si está y se calla si no: la distancia de un viaje NO es
  // un odómetro y convertirla en uno sería inventar el dato que este hub
  // existe para no inventar.
  const odoFin = numero(t.end_odometer ?? t.odometer_end ?? t.end_odo);
  if (odoFin !== undefined && odoFin > 0) {
    // El libro de ruta da el odómetro en metros, igual que `odometer_long`.
    lectura.odometerKm = odoFin / 1000;
    lectura.odometerSource = "vehicle";
  }

  const lat = microgrados(t.end_latitude);
  const lng = microgrados(t.end_longitude);
  if (esPosicionValida(lat, lng)) {
    lectura.latitude = lat;
    lectura.longitude = lng;
    lectura.positionAt = capturedAt;
  }

  if (t.end_postext != null) lectura.address = String(t.end_postext).trim() || undefined;

  return lectura;
}

/**
 * Filas de una respuesta de Webfleet.
 *
 * Webfleet devuelve el array pelado, pero algunas acciones lo envuelven en
 * `data`. Ambas formas se aceptan, como ya hacía `index.ts`.
 */
export function filasDe(respuesta: unknown): Record<string, unknown>[] {
  if (Array.isArray(respuesta)) return respuesta as Record<string, unknown>[];
  if (respuesta && typeof respuesta === "object") {
    const d = (respuesta as Record<string, unknown>).data;
    if (Array.isArray(d)) return d as Record<string, unknown>[];
  }
  return [];
}

/**
 * La lectura más cercana a un instante dentro de la tolerancia, o `null`.
 *
 * No interpola: devuelve una lectura que existió o nada (regla 3 del
 * contrato).
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

/**
 * Filas de `showTripSummaryReportExtern` → un resumen por vehículo.
 *
 * Webfleet da el resumen POR DÍA (una fila por objeto y día con actividad), así
 * que el mes es la suma de sus días. `distance` viene en METROS, como en
 * `showTripReportExtern` (es lo que ya suma `/webfleet/conduccion`). `tours`
 * son los viajes del día.
 *
 * Un vehículo sin ninguna fila no sale: «sin datos en la ventana», y quien
 * llama decide. Uno con filas pero distancia 0 sí sale con 0 km: estuvo
 * parado, y eso es un dato.
 *
 * Una distancia imposible para la ventana (más de 150 km/h de media las 24 h)
 * se descarta en vez de guardarse: es un dato roto, no un vehículo veloz.
 */
export function resumenesDeViajes(
  filas: Record<string, unknown>[],
  ids: string[],
  window: TelemetryWindow,
  opciones: OpcionesMapeo,
): TripSummary[] {
  const pedidos = new Set(ids.map(String));
  const acc = new Map<string, { metros: number; viajes: number; filas: number }>();
  for (const f of filas) {
    const id = f.objectno == null ? "" : String(f.objectno);
    if (!id || !pedidos.has(id)) continue;
    const a = acc.get(id) ?? { metros: 0, viajes: 0, filas: 0 };
    const m = numero(f.distance);
    if (m !== undefined && m > 0) a.metros += m;
    const t = numero(f.tours);
    if (t !== undefined && t > 0) a.viajes += t;
    a.filas += 1;
    acc.set(id, a);
  }

  const horas = Math.max(1, (window.to.getTime() - window.from.getTime()) / 3_600_000);
  const maximoKm = horas * 150;
  const salida: TripSummary[] = [];
  for (const [id, a] of acc) {
    const distanceKm = a.metros / 1000;
    if (distanceKm > maximoKm) {
      console.warn(`[webfleet] distancia imposible descartada: ${id} ${Math.round(distanceKm)} km en ${Math.round(horas)} h`);
      continue;
    }
    salida.push({
      provider: opciones.provider,
      accountKey: opciones.accountKey,
      providerVehicleId: id,
      window,
      distanceKm,
      trips: a.viajes,
      raw: { dias: a.filas, metros: a.metros },
    });
  }
  return salida;
}
