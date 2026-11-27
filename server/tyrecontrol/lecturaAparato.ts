/**
 * Lo que el aparato de Movertis sabe del vehículo, puesto en claro.
 *
 * ── De dónde sale ───────────────────────────────────────────────────────────
 *
 * De los mismos sensores que lista `movertisSensores.ts`. Mirando la respuesta
 * real de la unidad 1807 se vio que el equipo NO es un localizador pelado:
 * está enchufado al bus del vehículo y devuelve gasóleo consumido, peso por
 * eje, horas de motor, revoluciones, depósito y AdBlue. Con Webfleet eso es
 * imposible —sin CAN, el consumo viene siempre a 0—, así que es la única
 * fuente de estos datos que tenemos.
 *
 * ── La trampa de las unidades, otra vez ─────────────────────────────────────
 *
 * Movertis no documenta las unidades, y en este mismo conector ya costó caro
 * una vez: `total_mileage` en metros y `initial_mileage` en kilómetros, con un
 * factor 1000 que nadie veía porque «12.668.080 km de un autobús» pasa por
 * cifra grande mientras nadie la divida. Ver la cabecera de `MovertisConnector`.
 *
 * Así que aquí la regla es: se DERIVA solo lo que se puede comprobar, y lo
 * demás se enseña como viene, con el nombre que le da el aparato.
 *
 *   · El consumo medio se calcula y se comprueba: 19.267 l sobre 78.909 km son
 *     24,4 l/100 km, que es cifra de autobús. Si los litros vinieran en otra
 *     unidad daría 0,24 o 244, y las dos son absurdas. Por eso el resultado
 *     fuera de una ventana creíble se descarta en vez de enseñarse: un número
 *     con unidad equivocada en una pantalla acaba en una factura.
 *   · El depósito y el AdBlue NO se derivan. «DEPOSITO 100» y «DEPOSITOL 550»
 *     pueden ser porcentaje y capacidad, o litros y capacidad: no hay forma de
 *     saberlo desde aquí, y ponerle «%» a un número es inventarse el dato. Se
 *     enseñan tal cual, con su nombre.
 *   · Los pesos por eje van en kilos: 11.388 y 18.405 en un autobús de dos
 *     ejes suman 29,8 t, que es lo que pesa un autobús. En gramos o en libras
 *     no cuadra con nada.
 */

import { type SensorLeido } from "./movertisSensores.ts";

/** Un valor del que no sabemos la unidad: se enseña como viene. */
export interface ValorCrudo {
  nombre: string;
  valor: number | string | boolean;
}

export interface PesoEje {
  eje: number;
  kg: number;
}

export interface LecturaAparato {
  /** Horas de motor acumuladas. El contador de AHORA, no un histórico. */
  horasMotor: number | null;
  /** Gasóleo consumido acumulado, en litros. */
  consumidoL: number | null;
  /** Odómetro del aparato, en kilómetros. */
  odometroKm: number | null;
  /** Litros por 100 km de toda la vida del contador, si la cifra es creíble. */
  consumoMedioL100: number | null;
  /** Revoluciones del motor ahora mismo. */
  rpm: number | null;
  /** Velocidad ahora mismo, en km/h. */
  velocidadKmh: number | null;
  /** Contacto dado. `null` si el aparato no lo informa. */
  contacto: boolean | null;
  /** Peso por eje en kilos, ordenado por eje. */
  ejes: PesoEje[];
  /** Suma de los ejes con lectura. */
  pesoTotalKg: number | null;
  /** Depósito y AdBlue, sin unidad: ver la cabecera. */
  deposito: ValorCrudo[];
  /** Lo demás que trae lectura y no encaja en nada de lo anterior. */
  otros: ValorCrudo[];
}

/** Ventana de consumo creíble para un vehículo pesado, en l/100 km. */
export const CONSUMO_CREIBLE = { min: 5, max: 120 } as const;
/** Kilómetros mínimos para que una media signifique algo. */
const KM_MINIMOS = 100;

function texto(s: SensorLeido): string {
  return s.nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** El primer sensor con lectura numérica que case con el patrón. */
function numero(sensores: SensorLeido[], casa: (n: string, s: SensorLeido) => boolean): number | null {
  for (const s of sensores) {
    if (!s.conLectura || typeof s.valor !== "number") continue;
    if (casa(texto(s), s)) return s.valor;
  }
  return null;
}

/**
 * El peso de cada eje.
 *
 * El número del eje sale del propio nombre («PESOEJE 1»), no del orden en que
 * vengan: un eje sin sensor dejaría los demás corridos y el eje 3 pasaría por
 * eje 2, que en un camión es la diferencia entre ir cargado y ir en falta.
 */
export function pesosPorEje(sensores: SensorLeido[]): PesoEje[] {
  const salida: PesoEje[] = [];
  for (const s of sensores) {
    if (!s.conLectura || typeof s.valor !== "number") continue;
    const m = /^peso(?:de)?eje(\d+)$/.exec(texto(s));
    if (!m) continue;
    salida.push({ eje: Number(m[1]), kg: s.valor });
  }
  return salida.sort((a, b) => a.eje - b.eje);
}

/**
 * Litros por 100 km, solo si el número resultante es creíble.
 *
 * Fuera de la ventana no se devuelve nada: significa que una de las dos
 * unidades no es la que creemos, y enseñar «0,2 l/100 km» o «2.400» sería
 * peor que no enseñar nada.
 */
export function consumoMedioL100(consumidoL: number | null, odometroKm: number | null): number | null {
  if (consumidoL == null || odometroKm == null) return null;
  if (!(odometroKm >= KM_MINIMOS) || !(consumidoL > 0)) return null;
  const v = (100 * consumidoL) / odometroKm;
  if (v < CONSUMO_CREIBLE.min || v > CONSUMO_CREIBLE.max) return null;
  return Math.round(v * 10) / 10;
}

/** Lo que el aparato dice del vehículo, ordenado para una pantalla. */
export function lecturaDeAparato(sensores: SensorLeido[]): LecturaAparato {
  const horasMotor = numero(sensores, (_n, s) => s.interes === "horas_motor");
  const consumidoL = numero(sensores, (n) => /consumid/.test(n) && !/inst/.test(n));
  const odometroKm = numero(sensores, (n) => /^tachoodo$|^odo$|^km$|kilometr/.test(n));
  const rpm = numero(sensores, (n) => n === "rpm");
  const velocidadKmh = numero(sensores, (n) => /^velocidad$|^speed$/.test(n));

  const contactoSensor = sensores.find((s) => s.interes === "contacto" && s.conLectura);
  const contacto = contactoSensor
    ? typeof contactoSensor.valor === "boolean" ? contactoSensor.valor : Number(contactoSensor.valor) > 0
    : null;

  const ejes = pesosPorEje(sensores);
  const pesoTotalKg = ejes.length ? ejes.reduce((t, e) => t + e.kg, 0) : null;

  const usados = new Set<string>();
  for (const s of sensores) {
    const n = texto(s);
    const esUsado =
      s.interes === "horas_motor" && s.valor === horasMotor
      || (/consumid/.test(n) && !/inst/.test(n))
      || /^tachoodo$|^odo$|^km$|kilometr/.test(n)
      || n === "rpm"
      || /^velocidad$|^speed$/.test(n)
      || s === contactoSensor
      || /^peso(?:de)?eje\d+$/.test(n);
    if (esUsado) usados.add(s.nombre);
  }

  const conLectura = sensores.filter((s) => s.conLectura && s.valor !== null && !usados.has(s.nombre));
  const esDeposito = (s: SensorLeido) => /deposito|adblue|fuel|combustible/.test(texto(s));
  const aCrudo = (s: SensorLeido): ValorCrudo => ({ nombre: s.nombre, valor: s.valor as number | string | boolean });

  return {
    horasMotor,
    consumidoL,
    odometroKm,
    consumoMedioL100: consumoMedioL100(consumidoL, odometroKm),
    rpm,
    velocidadKmh,
    contacto,
    ejes,
    pesoTotalKg,
    deposito: conLectura.filter(esDeposito).map(aCrudo),
    otros: conLectura.filter((s) => !esDeposito(s)).map(aCrudo),
  };
}

/** ¿Merece la pena enseñar el bloque? Sin nada de esto, no. */
export function hayAlgoQueEnsenar(l: LecturaAparato): boolean {
  return l.horasMotor != null || l.consumidoL != null || l.ejes.length > 0
    || l.rpm != null || l.contacto != null || l.deposito.length > 0;
}
