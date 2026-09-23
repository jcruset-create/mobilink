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
import {
  limitesDelMes, medianocheDelDiaDe, mesDe, ZONA_HORARIA_POR_DEFECTO, type Mes,
} from "../../domain/meses.ts";
import { findExternalCode, listVehicleMappings } from "../../infrastructure/repositories.ts";
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

// ── Hasta dónde llega el histórico del proveedor ─────────────────────────────

/**
 * Cuántos meses hacia atrás se busca como mucho. Tres años: más allá, ningún
 * proveedor de esta casa guarda resúmenes de viajes.
 */
export const MESES_ATRAS_MAXIMO = 36;

/**
 * Cuántos vehículos se prueban en cada mes candidato antes de darlo por vacío.
 *
 * Más de uno porque un vehículo solo no sirve de testigo: su equipo pudo
 * instalarse el año pasado, o pudo pasarse un mes entero en el taller. Basta
 * con que UNO se haya movido para saber que ese mes existe.
 */
export const VEHICULOS_DE_SONDEO = 3;

/**
 * El mes más antiguo del que el proveedor sabe algo, buscado a tientas.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 *
 * El relleno de kilometraje de revisiones va de la más antigua a la más
 * moderna, y en Autocares Plana la más antigua es de 2021. Medido contra la
 * cuenta real, Movertis no tiene NADA anterior a agosto de 2025: julio de 2025
 * devuelve ceros y cero viajes; agosto, 1.467 km y 66 viajes.
 *
 * Sin este suelo, la tarea se pasaba horas preguntando por años que el
 * proveedor no puede contestar. Y lo hacía de la forma más cara posible: una
 * revisión irrellenable ensancha la ventana tres veces antes de rendirse, así
 * que gasta TRES peticiones, frente a las dos de una que sí funciona.
 *
 * ── Búsqueda binaria, no barrido ────────────────────────────────────────────
 *
 * Treinta y seis meses a ciegas son treinta y seis rondas; en binaria son
 * seis. El supuesto que la permite es que el histórico no tiene agujeros por
 * delante: si un mes tiene datos, los siguientes también. Es cierto por
 * construcción —el proveedor empieza a guardar cuando se instala el equipo— y
 * el sondeo con varios vehículos cubre el caso de uno instalado tarde.
 *
 * Esto cuesta como mucho 18 peticiones, UNA vez al arrancar la tarea. Frente a
 * las 16.000 que se ahorra, no hay discusión.
 */
export async function buscarHorizonte(
  hayDatos: (mesesAtras: number) => Promise<boolean>,
  maxMesesAtras = MESES_ATRAS_MAXIMO,
): Promise<number | null> {
  // Sin datos ni en el mes pasado, no hay histórico que acotar.
  if (!(await hayDatos(1))) return null;

  // Invariante: `conDatos` los tiene, `vacio` no. Se estrecha hasta tocarse.
  let conDatos = 1;
  let vacio = maxMesesAtras + 1;
  if (await hayDatos(maxMesesAtras)) return maxMesesAtras;

  while (vacio - conDatos > 1) {
    const medio = Math.floor((conDatos + vacio) / 2);
    if (await hayDatos(medio)) conDatos = medio;
    else vacio = medio;
  }
  return conDatos;
}

export type ResultadoHorizonte =
  | { estado: "encontrado"; mes: Mes; mesesAtras: number; peticiones: number }
  /** Ni el mes pasado tiene datos: o no hay enlaces, o el proveedor está mudo. */
  | { estado: "sin_historico"; peticiones: number }
  | { estado: "no_disponible"; motivo: string };

/**
 * El horizonte de una cuenta, preguntándole al proveedor de verdad.
 *
 * Se prueban hasta `VEHICULOS_DE_SONDEO` vehículos enlazados por mes
 * candidato, y se para en el primero que se haya movido: con eso ya se sabe
 * que ese mes existe.
 */
export async function horizonteDelProveedor(
  ctx: OperationContext,
  opciones: { ahora?: Date; zonaHoraria?: string; maxMesesAtras?: number } = {},
): Promise<ResultadoHorizonte> {
  const ahora = opciones.ahora ?? new Date();
  const zona = opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO;
  let peticiones = 0;

  try {
    const cuentas = await resolveTelematicsConnectors(ctx.tenantId);
    for (const cuenta of cuentas) {
      const conector = cuenta.connector;
      if (!sabeResumirViajes(conector)) continue;

      const enlaces = await listVehicleMappings({
        tenantId: ctx.tenantId, system: cuenta.key, accountKey: cuenta.accountKey,
      });
      const testigos = enlaces
        .filter((e) => e.active !== false)
        .slice(0, VEHICULOS_DE_SONDEO)
        .map((e) => String(e.external_code));
      if (testigos.length === 0) continue;

      const hayDatos = async (mesesAtras: number): Promise<boolean> => {
        const mes = restarMeses(mesDe(ahora, zona), mesesAtras);
        const { desde, hasta } = limitesDelMes(mes, zona);
        for (const unidad of testigos) {
          peticiones += 1;
          const [r] = await conector.getTripSummary(ctx, [unidad], { from: desde, to: hasta });
          // Un mes «existe» si alguien se movió. Cero kilómetros y cero viajes
          // es indistinguible de no tener histórico, y con varios testigos la
          // probabilidad de que TODOS estuvieran parados es despreciable.
          if (r && (r.distanceKm > 0 || (r.trips ?? 0) > 0)) return true;
        }
        return false;
      };

      const mesesAtras = await buscarHorizonte(hayDatos, opciones.maxMesesAtras);
      if (mesesAtras === null) return { estado: "sin_historico", peticiones };
      return {
        estado: "encontrado",
        mes: restarMeses(mesDe(ahora, zona), mesesAtras),
        mesesAtras,
        peticiones,
      };
    }
    return { estado: "sin_historico", peticiones };
  } catch (e) {
    return { estado: "no_disponible", motivo: (e as Error)?.message ?? String(e) };
  }
}

function restarMeses(m: Mes, n: number): Mes {
  const total = m.year * 12 + (m.month - 1) - n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
