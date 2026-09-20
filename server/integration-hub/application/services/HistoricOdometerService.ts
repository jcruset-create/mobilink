/**
 * El odómetro que marcaba un vehículo en un instante PASADO.
 *
 * ── Por qué no sirve lo que ya había ────────────────────────────────────────
 *
 * `VehicleOdometerService` resuelve dos casos vecinos y ninguno es este:
 *
 *   · `kilometrajeEnOperacion` busca una lectura con odómetro cerca del
 *     instante. Con Movertis no la hay: su histórico (`showtrips`) son
 *     POSICIONES, sin odómetro.
 *   · `kilometrajeSiSigueParado` demuestra que el vehículo no se ha movido
 *     desde entonces y atribuye el odómetro de ahora. Vale para una medición de
 *     anteayer; para una revisión de marzo no, porque el autobús lleva 20.000
 *     km desde entonces.
 *
 * Lo que sí queda es el resumen de viajes: `getTripSummary` de una ventana que
 * TERMINA en el instante pedido devuelve el odómetro al final del último viaje
 * anterior a ese momento. Eso es exactamente el dato que se busca.
 *
 * ── Las tres trampas, todas medidas contra la cuenta real ───────────────────
 *
 * **1. Un cero no es un cero.** Pedido el 15/3/2026 con ventana de ese día, un
 * autobús que marcaba 1.245.311 km devolvió los tres campos a cero: era domingo
 * y no hizo ningún viaje. El conector ya traduce eso a «sin odómetro» (ver
 * `SIN_DATO` en el mapeo de Movertis), pero aquí hay que actuar en consecuencia:
 * **la ventana se ensancha hasta que traiga algún viaje**, en vez de dar el
 * hueco por respuesta.
 *
 * **2. Una consulta de cada nueve miente con cara de dato bueno.** Pidiendo el
 * odómetro del 19/9/2026, una respuesta dio 1.200.870,91 km: 65.000 km por
 * debajo del día anterior, o sea imposible, pero perfectamente plausible a
 * simple vista. No es un error que se pueda detectar mirando un número.
 * Por eso **hacen falta DOS ventanas distintas que coincidan**. Una sola
 * consulta a esta API no es un dato, es una apuesta.
 *
 * **3. El día en curso baila.** El mismo instante de hoy contestó dos valores
 * distintos con diez minutos de diferencia, según incluyera o no los viajes de
 * la mañana. Un día cerrado no baila: el 19/9 dio el mismo número en nueve
 * consultas. Por eso esto **solo acepta instantes de días ya cerrados**.
 *
 * Nada de esto lanza: devuelve el motivo. Quien llama decide, y un kilometraje
 * que falta nunca puede tumbar lo que lo estaba pidiendo.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import { sabeResumirViajes, type TripSummary } from "../../domain/telematics.ts";
import { medianocheDelDiaDe, ZONA_HORARIA_POR_DEFECTO } from "../../domain/meses.ts";
import { findExternalCode } from "../../infrastructure/repositories.ts";
import { resolveTelematicsConnectors } from "../../connectors/ConnectorRegistry.ts";

/**
 * Cuánto pueden diferir dos ventanas y seguir considerándose de acuerdo, en km.
 *
 * Un kilómetro, que cubre el redondeo del proveedor y no se acerca ni de lejos
 * al tipo de discrepancia que se quiere cazar: la respuesta mentirosa medida
 * estaba 65.000 km por debajo.
 */
export const TOLERANCIA_ACUERDO_KM = 1;

/**
 * Margen para dar un día por cerrado. Seis horas, el mismo que `mesCerrado`:
 * el proveedor consolida con retraso y un viaje que acaba de madrugada tiene
 * que haber entrado antes de preguntar.
 */
export const MARGEN_DIA_CERRADO_MS = 6 * 60 * 60 * 1000;

/**
 * Anchuras de ventana que se prueban, en orden, todas terminando en el
 * instante pedido.
 *
 * De menos a más: cuanto más estrecha, menos viajes trae la respuesta y menos
 * probabilidades hay de que la pasarela se caiga (con diez unidades y un mes
 * entero devolvía `upstream request failed`). Se ensancha solo si la estrecha
 * no trajo ningún viaje.
 *
 * El tope es de 28 días porque Movertis no admite rangos mayores de un mes.
 */
export const ANCHURAS_DIAS = [0, 7, 28] as const;

export interface OdometroHistorico {
  odometerKm: number;
  provider: string;
  accountKey: string;
  providerVehicleId: string;
  /** Fin de la ventana que se aceptó: el instante al que se atribuye el número. */
  instante: Date;
  /** Kilómetros que hizo el vehículo dentro de la ventana aceptada. */
  kmEnVentana: number;
  /** Las dos ventanas que coincidieron, para poder reconstruir la consulta. */
  ventanas: string[];
}

export type ResultadoOdometroHistorico =
  | { estado: "encontrado"; odometro: OdometroHistorico }
  /** Dos ventanas dieron números distintos: no se escribe ninguno. */
  | { estado: "discrepancia"; motivo: string }
  /** Se preguntó y no hubo odómetro en ninguna anchura. */
  | { estado: "sin_lectura"; cuentasConsultadas: string[] }
  | { estado: "sin_telematica" }
  /** El instante es de hoy o del futuro: todavía no es un dato estable. */
  | { estado: "dia_abierto"; motivo: string }
  | { estado: "no_disponible"; motivo: string };

/** Las ventanas que se van a probar, de la más estrecha a la más ancha. */
export function ventanasParaInstante(
  instante: Date,
  zona = ZONA_HORARIA_POR_DEFECTO,
): Array<{ from: Date; to: Date; etiqueta: string }> {
  const dia = medianocheDelDiaDe(instante, zona);
  return ANCHURAS_DIAS.map((dias) => {
    if (dias === 0) return { from: dia, to: instante, etiqueta: "día" };
    return {
      from: new Date(instante.getTime() - dias * 24 * 60 * 60 * 1000),
      to: instante,
      etiqueta: `${dias} días`,
    };
  });
}

/** ¿Ha terminado ya el día de ese instante, con margen? */
export function diaCerrado(instante: Date, ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO): boolean {
  const finDelDia = medianocheDelDiaDe(instante, zona).getTime() + 24 * 60 * 60 * 1000;
  return ahora.getTime() >= finDelDia + MARGEN_DIA_CERRADO_MS;
}

/** ¿Coinciden dos lecturas dentro de la tolerancia? */
export function deAcuerdo(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA_ACUERDO_KM;
}

/**
 * El odómetro en un instante pasado, o el motivo por el que no se puede dar.
 *
 * Gasta DOS peticiones cuando va bien —las dos ventanas que tienen que
 * coincidir— y hasta cuatro si las estrechas salen vacías. Quien lo llame en
 * bucle tiene que contarlas.
 */
export async function odometroEnInstante(
  ctx: OperationContext,
  vehiculoMobilinkId: string,
  instante: Date,
  opciones: { ahora?: Date; zonaHoraria?: string } = {},
): Promise<ResultadoOdometroHistorico> {
  const ahora = opciones.ahora ?? new Date();
  const zona = opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO;

  if (!diaCerrado(instante, ahora, zona)) {
    return {
      estado: "dia_abierto",
      motivo:
        "El día de esa revisión todavía no ha cerrado. El proveedor da valores distintos " +
        "para el mismo instante mientras consolida, así que se deja para mañana.",
    };
  }

  const cuentas = await resolveTelematicsConnectors(ctx.tenantId);
  if (cuentas.length === 0) return { estado: "sin_telematica" };

  const consultadas: string[] = [];
  const fallos: string[] = [];

  for (const cuenta of cuentas) {
    const conector = cuenta.connector;
    if (!sabeResumirViajes(conector)) continue;

    const providerVehicleId = await findExternalCode({
      tenantId: ctx.tenantId,
      entityType: "vehicle",
      system: cuenta.key,
      mobilinkId: vehiculoMobilinkId,
      accountKey: cuenta.accountKey,
    });
    if (!providerVehicleId) continue;

    const etiqueta = `${cuenta.key}/${cuenta.accountKey}`;
    consultadas.push(etiqueta);

    try {
      const ventanas = ventanasParaInstante(instante, zona);
      const aceptadas: Array<{ v: string; resumen: TripSummary }> = [];

      for (const ventana of ventanas) {
        const [resumen] = await conector.getTripSummary(ctx, [providerVehicleId], ventana);
        // Sin viajes en la ventana el proveedor no da odómetro: se ensancha.
        if (!resumen || resumen.finalOdometerKm === undefined) continue;
        aceptadas.push({ v: ventana.etiqueta, resumen });
        // Con dos ya se puede decidir; una tercera solo gastaría cupo.
        if (aceptadas.length === 2) break;
      }

      if (aceptadas.length < 2) continue;

      const [a, b] = aceptadas;
      const kmA = a.resumen.finalOdometerKm!;
      const kmB = b.resumen.finalOdometerKm!;
      if (!deAcuerdo(kmA, kmB)) {
        return {
          estado: "discrepancia",
          motivo:
            `${etiqueta} dio dos odómetros distintos para el mismo instante: ` +
            `${kmA} km (ventana de ${a.v}) y ${kmB} km (ventana de ${b.v}). ` +
            "No se escribe ninguno.",
        };
      }

      return {
        estado: "encontrado",
        odometro: {
          // La ventana estrecha es la que menos viajes agrega, así que es la
          // que menos ocasiones tiene de arrastrar un error del proveedor.
          odometerKm: kmA,
          provider: a.resumen.provider,
          accountKey: a.resumen.accountKey,
          providerVehicleId,
          instante,
          kmEnVentana: a.resumen.distanceKm,
          ventanas: [a.v, b.v],
        },
      };
    } catch (e) {
      fallos.push(`${etiqueta}: ${(e as Error)?.message ?? e}`);
    }
  }

  if (fallos.length > 0) return { estado: "no_disponible", motivo: fallos.join("; ") };
  if (consultadas.length === 0) return { estado: "sin_telematica" };
  return { estado: "sin_lectura", cuentasConsultadas: consultadas };
}
