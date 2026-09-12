/**
 * ¿Está este vehículo dentro de una base?
 *
 * La pregunta nace del trabajo, no de la tecnología: si un autobús está ahora
 * en la base, se le puede mirar el neumático sin sacarlo de servicio. No es
 * seguimiento GPS —la posición se compara contra las bases y se tira—, es un
 * «¿a quién puedo revisar hoy sin molestar a nadie?».
 *
 * ── Cinco respuestas, no dos ────────────────────────────────────────────────
 *
 * «Dentro» y «fuera» no cubren la realidad de esta flota. En la medición real
 * de la cuenta de Movertis (751 vehículos, una sola llamada) la antigüedad de
 * la última posición salió con dos jorobas: el 73 % había emitido en el último
 * cuarto de hora y un 21 % llevaba más de un DÍA sin emitir, con el percentil
 * 90 en 16 días y un máximo de 3,6 años. Un equipo desinstalado y un autobús
 * aparcado dan exactamente la misma respuesta si solo se mira la coordenada.
 *
 * Por eso hay cinco estados, y `STALE_POSITION` no se colapsa en «fuera»:
 * decir que un autobús no está en la base cuando lo que pasa es que su equipo
 * calla desde hace un mes sería afirmar algo que no se ha comprobado, y la
 * pantalla de revisiones se llenaría de ausencias falsas.
 *
 * ── Todo aquí es puro ───────────────────────────────────────────────────────
 *
 * Ni red, ni base, ni reloj: el instante de referencia entra por parámetro y
 * la distancia se inyecta, igual que en `inmovilidad.ts` y por el mismo
 * motivo —una tercera copia del haversine en este repositorio sería una de
 * más—.
 */

import type { VehicleTelemetry } from "./telematics.ts";
import { esPosicionValida } from "./telematics.ts";
import type { DistanciaMetros } from "./inmovilidad.ts";

/**
 * Radio por defecto de una base, en metros.
 *
 * 300, el mismo que ya usan el geocerco de Webfleet
 * (`tc_delegaciones.base_radio_m`, `default 300`) y la prueba de
 * inmovilidad del CheckPoint. No es un número elegido aquí: es el que está en
 * producción, y cambiarlo solo para esta funcionalidad haría que un autobús
 * estuviera «en base» para una pantalla y no para la otra.
 */
export const RADIO_BASE_M = 300;

/**
 * A partir de cuántos minutos una posición deja de valer como «ahora».
 *
 * Medido, no supuesto, que era el requisito. En la cuenta real de Movertis, de
 * 751 vehículos: el 40 % había emitido hace menos de 5 minutos, el 33 % entre
 * 5 y 15, y solo el 1,2 % entre 15 y 60. Ese valle es el corte natural: pasados
 * los 15 minutos, quien no ha emitido casi nunca es un vehículo con retraso,
 * es un equipo que se ha callado. Se deja en 60 para no marcar como dudoso al
 * que simplemente emite despacio, y es configurable por si otra flota o otro
 * proveedor tiene otro pulso.
 */
export const ANTIGUEDAD_MAX_MIN = 60;

/**
 * Una base, como geo-zona.
 *
 * Hoy es centro y radio, que es lo que hay configurado en las delegaciones. El
 * `poligono` está declarado y sin usar A PROPÓSITO: cuando una base sea un
 * recinto con forma —el patio largo y estrecho de Reus, por ejemplo—, se
 * rellena y `dentroDeBase` decide con él. Así el contrato no cambia el día que
 * eso llegue.
 */
export interface GeoZonaBase {
  id: string;
  nombre: string;
  /** Empresa a la que pertenece la base. No se cruzan tenants. */
  empresaId: string;
  lat: number;
  lng: number;
  /** Metros. Sin radio, `RADIO_BASE_M`. */
  radioM?: number | null;
  /** Reservado para cuando una base deje de ser un círculo. Ver la cabecera. */
  poligono?: Array<{ lat: number; lng: number }> | null;
}

/**
 * Los cinco estados. El nombre dice lo que se sabe, no lo que se supone.
 *
 *  - `IN_BASE`          — posición reciente y dentro de una base.
 *  - `OUTSIDE_BASES`    — posición reciente y fuera de todas: está por ahí.
 *  - `STALE_POSITION`   — hay posición, pero vieja. NO es «fuera».
 *  - `NO_POSITION`      — el proveedor no dice nada de este vehículo.
 *  - `INVALID_POSITION` — dice algo que no es una posición: `0,0`, un
 *                         centinela, un número fuera de rango.
 */
export const ESTADOS_PRESENCIA = {
  IN_BASE: "IN_BASE",
  OUTSIDE_BASES: "OUTSIDE_BASES",
  STALE_POSITION: "STALE_POSITION",
  NO_POSITION: "NO_POSITION",
  INVALID_POSITION: "INVALID_POSITION",
} as const;

export type EstadoPresencia =
  (typeof ESTADOS_PRESENCIA)[keyof typeof ESTADOS_PRESENCIA];

/** Lo que se sabe de un vehículo respecto a las bases, en un instante. */
export interface Presencia {
  estado: EstadoPresencia;
  /** La base donde está, si está en alguna. */
  baseId?: string;
  baseNombre?: string;
  /**
   * Si esa base es la delegación asignada al vehículo.
   *
   * Se informa en vez de inventar un estado `OTRA_BASE`: para revisar un
   * neumático da igual en qué base esté —se le puede mirar allí igual—, pero
   * quien organice el taller quiere saber si el autobús está en su casa o de
   * paso. Es un matiz de la presentación, no del hecho.
   */
  esSuBase?: boolean;
  /** Distancia al centro de la base detectada, o a la más cercana. */
  distanciaM?: number;
  /** Antigüedad de la posición en minutos, si hay posición fechada. */
  antiguedadMin?: number;
  lat?: number;
  lng?: number;
  velocidadKmh?: number;
  /** Instante de la posición, según el proveedor. */
  posicionAt?: Date;
}

/**
 * ¿Cae esta coordenada dentro de la base?
 *
 * Mismo criterio que `baseContiene` de la sincronización Webfleet —haversine
 * al centro, radio o 300— para que las dos pantallas no discrepen sobre si un
 * autobús está en el taller. Cuando haya polígonos, este es el único sitio que
 * hay que tocar.
 */
export function dentroDeBase(
  base: GeoZonaBase,
  lat: number,
  lng: number,
  distanciaMetros: DistanciaMetros,
): { dentro: boolean; distanciaM: number } {
  const distanciaM = distanciaMetros(lat, lng, base.lat, base.lng);
  return { dentro: distanciaM <= (base.radioM ?? RADIO_BASE_M), distanciaM };
}

/**
 * Clasifica una lectura contra las bases de su empresa.
 *
 * `lectura` a `null` es «el proveedor no lo mencionó», que es un caso normal:
 * en la flota real 26 de 751 vehículos no traían posición ninguna.
 *
 * El orden de las comprobaciones no es casual. Primero la ausencia, luego la
 * validez de la coordenada y solo al final la antigüedad: una posición `0,0`
 * de hace dos minutos es tan inútil como una de hace dos años, y llamarla
 * «reciente» sería quedarse con lo de menos.
 *
 * La antigüedad se mide contra las bases DESPUÉS de localizar el vehículo, no
 * antes, para poder decir dónde se le vio por última vez: un autobús con la
 * última posición dentro de la base y el equipo dormido sigue seguramente ahí,
 * y ese dato vale aunque el estado sea `STALE_POSITION`. Quien lo lea decide;
 * aquí no se le asciende a presente.
 */
export function evaluarPresencia(params: {
  lectura: VehicleTelemetry | null;
  bases: GeoZonaBase[];
  /** Delegación asignada al vehículo en TyreControl, si tiene. */
  delegacionId?: string | null;
  ahora: Date;
  antiguedadMaxMin?: number;
  distanciaMetros: DistanciaMetros;
}): Presencia {
  const { lectura, bases, ahora, distanciaMetros } = params;
  const antiguedadMaxMin = params.antiguedadMaxMin ?? ANTIGUEDAD_MAX_MIN;

  if (!lectura) return { estado: ESTADOS_PRESENCIA.NO_POSITION };

  const lat = lectura.latitude;
  const lng = lectura.longitude;
  const posicionAt = lectura.positionAt ?? lectura.capturedAt;
  const antiguedadMin = posicionAt
    ? Math.max(0, Math.round((ahora.getTime() - posicionAt.getTime()) / 60000))
    : undefined;

  if (!esPosicionValida(lat, lng)) {
    return {
      estado: ESTADOS_PRESENCIA.INVALID_POSITION,
      antiguedadMin,
      posicionAt,
    };
  }

  const comun = {
    lat: lat as number,
    lng: lng as number,
    velocidadKmh: lectura.speedKmh,
    antiguedadMin,
    posicionAt,
  };

  // ¿En alguna base? Se busca primero en la suya: con bases a kilómetros unas
  // de otras no puede haber empate, pero si algún día dos geo-zonas se solapan,
  // que gane la asignada es lo que espera quien mira la pantalla.
  let detectada: GeoZonaBase | null = null;
  let distanciaDetectada = Infinity;
  let distanciaMinima = Infinity;
  for (const b of bases) {
    const { dentro, distanciaM } = dentroDeBase(b, comun.lat, comun.lng, distanciaMetros);
    if (distanciaM < distanciaMinima) distanciaMinima = distanciaM;
    if (!dentro) continue;
    const esSuya = params.delegacionId != null && b.id === params.delegacionId;
    if (esSuya) {
      detectada = b;
      distanciaDetectada = distanciaM;
      break;
    }
    if (!detectada || distanciaM < distanciaDetectada) {
      detectada = b;
      distanciaDetectada = distanciaM;
    }
  }

  const vieja = antiguedadMin === undefined || antiguedadMin > antiguedadMaxMin;

  if (detectada) {
    const dondeEstaba = {
      ...comun,
      baseId: detectada.id,
      baseNombre: detectada.nombre,
      esSuBase: params.delegacionId != null && detectada.id === params.delegacionId,
      distanciaM: distanciaDetectada,
    };
    return vieja
      ? { ...dondeEstaba, estado: ESTADOS_PRESENCIA.STALE_POSITION }
      : { ...dondeEstaba, estado: ESTADOS_PRESENCIA.IN_BASE };
  }

  return {
    ...comun,
    estado: vieja ? ESTADOS_PRESENCIA.STALE_POSITION : ESTADOS_PRESENCIA.OUTSIDE_BASES,
    distanciaM: Number.isFinite(distanciaMinima) ? distanciaMinima : undefined,
  };
}
