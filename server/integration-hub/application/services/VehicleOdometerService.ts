/**
 * VehicleOdometerService — a qué kilometraje se hizo una operación de neumático.
 *
 * Esta es la pieza por la que existe el Telematics Hub. Las fases anteriores
 * montaron el contrato (3), las credenciales (4, 5) y dos proveedores (6, 7);
 * ninguna respondía todavía a la pregunta que se hace el taller: «este
 * neumático se montó a 512.480 km y se desmontó a 578.864 km», con una fuente
 * verificable y sin que TyreControl sepa de qué proveedor viene el dato.
 *
 * ── La escalera de tolerancia ───────────────────────────────────────────────
 *
 * `telematics.ts` lo deja escrito: «Quien llama decide la tolerancia —la
 * escalera ±5, ±15, ±30, ±60— y guarda, junto al valor, la distancia temporal
 * que hubo. Un kilometraje con "Δ 47 min" merece menos confianza que uno con
 * "Δ 12 s", y esa diferencia tiene que quedar registrada, no perderse».
 *
 * Aquí se sube esa escalera: se prefiere la lectura más próxima, y se informa
 * en qué peldaño cayó. El peldaño NO es un detalle de implementación que se
 * pueda tirar: es lo que permite a quien lo lea decidir si se fía. Un montaje
 * fechado a las 09:40 con una lectura de las 09:39 es otra cosa que el mismo
 * montaje con una lectura de las 10:35, aunque los dos devuelvan un número.
 *
 * ── Una sola llamada, no cuatro ─────────────────────────────────────────────
 *
 * La escalera NO se sube llamando cuatro veces a `getTelemetryAt` con
 * tolerancias crecientes. Se pide UNA ventana de ±60 y se elige dentro. Dos
 * motivos, y el segundo es el que importa:
 *
 *  1. Cuatro llamadas por operación, con un camión de doce ruedas, son
 *     cuarenta y ocho viajes al proveedor para responder una pregunta.
 *
 *  2. `getTelemetryAt` devuelve la lectura más cercana, tenga odómetro o no.
 *     Aquí se busca un KILOMETRAJE, y una lectura sin odómetro no lo es: si la
 *     más cercana no lo trae pero la de dos minutos después sí, el contrato
 *     daría la primera y se perdería el dato que se venía a buscar. Filtrando
 *     nosotros por «lecturas que traen odómetro» eso no pasa.
 *
 * ── Cuatro respuestas, no dos ───────────────────────────────────────────────
 *
 * No basta con «km» o `null`. Un `null` que lo mismo significa «el vehículo no
 * tiene telemática» que «el proveedor está caído» que «se preguntó y el camión
 * no emitió nada» es justo la clase de confusión que este hub evita: la
 * ausencia de dato y la imposibilidad de preguntarlo se parecen en el momento
 * y no se parecen en nada después. Por eso el resultado las distingue.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { VehicleTelemetry } from "../../domain/telematics.ts";
import { findExternalCode } from "../../infrastructure/repositories.ts";
import { resolveTelematicsConnectors } from "../../connectors/ConnectorRegistry.ts";

/**
 * Los peldaños, en minutos. En orden creciente de desconfianza.
 *
 * Salen de `telematics.ts`, no de una elección nueva: ±5, ±15, ±30, ±60.
 */
export const ESCALERA_TOLERANCIA = [5, 15, 30, 60] as const;

/** El peldaño más ancho. Es la ventana que se pide al proveedor. */
export const TOLERANCIA_MAXIMA = ESCALERA_TOLERANCIA[ESCALERA_TOLERANCIA.length - 1];

/** Un kilometraje con su procedencia y su distancia temporal. */
export interface KilometrajeTrazable {
  /** Odómetro en kilómetros, sin redondear. */
  odometerKm: number;
  /** Conector del que salió: `movertis`, `webfleet`… */
  provider: string;
  /** Cuenta dentro de ese proveedor. */
  accountKey: string;
  /** Identificador del vehículo EN EL PROVEEDOR. */
  providerVehicleId: string;
  /** Instante de la lectura, según el proveedor. */
  capturedAt: Date;
  /**
   * Minutos entre la lectura y la operación, con signo: negativo si la lectura
   * es anterior. El signo importa —una lectura posterior al desmontaje puede
   * incluir kilómetros que el neumático ya no hizo— y perderlo con un valor
   * absoluto haría indistinguibles dos situaciones distintas.
   */
  deltaMinutos: number;
  /** Peldaño de la escalera en que cayó: 5, 15, 30 o 60. */
  toleranciaMin: number;
  /** De dónde saca el proveedor ese odómetro, si lo declara. */
  odometerSource?: "vehicle" | "gps" | "unknown";
}

/**
 * Lo que se pudo averiguar. Cuatro casos que NO significan lo mismo.
 *
 *  - `encontrado`      — hay lectura con odómetro dentro de la escalera.
 *  - `sin_lectura`     — se preguntó y no había nada en ±60. Pasa a diario: un
 *                        autobús parado en el taller no emite, y el taller es
 *                        justo donde se le cambian los neumáticos.
 *  - `sin_telematica`  — el vehículo no está enlazado con ninguna cuenta, o el
 *                        cliente no tiene telemática. No es un fallo.
 *  - `no_disponible`   — no se pudo preguntar (proveedor caído, credenciales).
 *                        Esto sí merece reintento; los dos anteriores no.
 */
export type ResultadoKilometraje =
  | { estado: "encontrado"; kilometraje: KilometrajeTrazable }
  | { estado: "sin_lectura"; cuentasConsultadas: string[] }
  | { estado: "sin_telematica" }
  | { estado: "no_disponible"; motivo: string };

/**
 * Elige la mejor lectura para un instante. Función pura.
 *
 * Descarta las que no traen odómetro —no son un kilometraje— y de las que
 * quedan se queda con la más próxima. No interpola: devuelve una lectura que
 * existió o nada, como exige la regla 3 del contrato.
 *
 * Ante un empate exacto (dos lecturas a la misma distancia, una antes y otra
 * después) gana la ANTERIOR. Es deliberado: en un desmontaje, la lectura
 * posterior puede incluir kilómetros recorridos ya sin ese neumático, así que
 * ante la duda se prefiere no atribuírselos.
 */
export function elegirKilometraje(
  lecturas: VehicleTelemetry[],
  at: Date,
): { lectura: VehicleTelemetry; deltaMinutos: number; toleranciaMin: number } | null {
  const objetivo = at.getTime();
  const limite = TOLERANCIA_MAXIMA * 60_000;

  let mejor: VehicleTelemetry | null = null;
  let mejorDistancia = Infinity;

  for (const l of lecturas) {
    if (l.odometerKm === undefined) continue;
    const desfase = l.capturedAt.getTime() - objetivo;
    const distancia = Math.abs(desfase);
    if (distancia > limite) continue;

    // `<` y no `<=` para que, empatando, sobreviva la primera que gane el
    // desempate de abajo en vez de pisarla la última vista.
    if (distancia < mejorDistancia) {
      mejor = l;
      mejorDistancia = distancia;
    } else if (distancia === mejorDistancia && mejor && desfase < 0 && mejor.capturedAt.getTime() - objetivo > 0) {
      // Empate: la anterior gana a la posterior.
      mejor = l;
    }
  }

  if (!mejor) return null;

  const deltaMs = mejor.capturedAt.getTime() - objetivo;
  const peldaño =
    ESCALERA_TOLERANCIA.find((min) => Math.abs(deltaMs) <= min * 60_000) ?? TOLERANCIA_MAXIMA;

  // Se redondea a minuto para poder guardarlo y leerlo, pero NO se pierde el
  // signo. Una lectura a 20 s se queda en 0 minutos, que es lo que significa.
  //
  // El `=== 0` no es cosmético: `Math.round(-20000 / 60000)` da -0, y un «Δ -0
  // minutos» en un registro de auditoría no significa nada. Además -0 !== 0
  // bajo Object.is, así que se colaría en cualquier comparación posterior.
  const minutos = Math.round(deltaMs / 60_000);

  return {
    lectura: mejor,
    deltaMinutos: minutos === 0 ? 0 : minutos,
    toleranciaMin: peldaño,
  };
}

/**
 * El kilometraje de un vehículo de Mobilink en el instante de una operación.
 *
 * Pregunta a TODAS las cuentas de telemática del cliente que tengan enlazado
 * ese vehículo, no solo a la primera: un cliente puede tener la flota de
 * autobuses y la auxiliar en cuentas distintas, y quién tiene a este vehículo
 * no se sabe hasta mirarlo. Si varias responden, gana la lectura más próxima.
 *
 * Que una cuenta falle no cancela las demás —si la auxiliar está caída pero la
 * de autobuses contesta, hay respuesta—, pero si fallan TODAS se devuelve
 * `no_disponible` y no `sin_lectura`: no es lo mismo no haber encontrado nada
 * que no haber podido mirar.
 */
export async function kilometrajeEnOperacion(
  ctx: OperationContext,
  vehiculoMobilinkId: string,
  at: Date,
): Promise<ResultadoKilometraje> {
  const cuentas = await resolveTelematicsConnectors(ctx.tenantId);
  if (cuentas.length === 0) return { estado: "sin_telematica" };

  const margen = TOLERANCIA_MAXIMA * 60_000;
  const ventana = { from: new Date(at.getTime() - margen), to: new Date(at.getTime() + margen) };

  const consultadas: string[] = [];
  const fallos: string[] = [];
  let mejor: KilometrajeTrazable | null = null;

  for (const cuenta of cuentas) {
    const providerVehicleId = await findExternalCode({
      tenantId: ctx.tenantId,
      entityType: "vehicle",
      system: cuenta.key,
      mobilinkId: vehiculoMobilinkId,
      accountKey: cuenta.accountKey,
    });
    // Sin enlace, esta cuenta no sabe de este vehículo. No es un fallo suyo.
    if (!providerVehicleId) continue;

    const etiqueta = `${cuenta.key}/${cuenta.accountKey}`;
    try {
      const lecturas = await cuenta.connector.getTelemetryHistory(ctx, providerVehicleId, ventana);
      consultadas.push(etiqueta);

      const elegida = elegirKilometraje(lecturas, at);
      if (!elegida) continue;

      const candidato: KilometrajeTrazable = {
        odometerKm: elegida.lectura.odometerKm as number,
        provider: elegida.lectura.provider,
        accountKey: elegida.lectura.accountKey,
        providerVehicleId,
        capturedAt: elegida.lectura.capturedAt,
        deltaMinutos: elegida.deltaMinutos,
        toleranciaMin: elegida.toleranciaMin,
        odometerSource: elegida.lectura.odometerSource,
      };
      if (!mejor || Math.abs(candidato.deltaMinutos) < Math.abs(mejor.deltaMinutos)) {
        mejor = candidato;
      }
    } catch (e) {
      // Se anota y se sigue: otra cuenta puede tener la respuesta.
      fallos.push(`${etiqueta}: ${(e as Error)?.message ?? e}`);
    }
  }

  if (mejor) return { estado: "encontrado", kilometraje: mejor };

  // Ninguna cuenta enlazada: el vehículo no está en la telemática del cliente.
  if (consultadas.length === 0 && fallos.length === 0) return { estado: "sin_telematica" };

  // Se intentó preguntar y NADIE contestó: no se sabe si había dato o no.
  if (consultadas.length === 0) {
    return { estado: "no_disponible", motivo: fallos.join(" · ") };
  }

  return { estado: "sin_lectura", cuentasConsultadas: consultadas };
}
