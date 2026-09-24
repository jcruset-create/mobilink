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

// ════════════════════════════════════════════════════════════════════════════
// El kilometraje de un instante PASADO, cuando el proveedor no lo tiene
// ════════════════════════════════════════════════════════════════════════════
//
// `kilometrajeEnOperacion` pregunta por una ventana de ±60 min alrededor del
// instante y se queda con la lectura que traiga odómetro. Con Webfleet funciona:
// su histórico (`showLogbook`) trae odómetro. Con Movertis NO, y no por falta de
// mapeo: `showtrips` devuelve posiciones y nada más, así que para un instante de
// hace tres días no hay ningún kilometraje que elegir y la respuesta correcta es
// `sin_lectura`.
//
// Eso deja sin kilometraje justo el caso que lo necesita: las revisiones del
// CheckPoint. El arco de Bridgestone mide presión y profundidad al entrar en la
// base y su informe llega días después por correo, así que cuando se importa, el
// instante que importa ya es pasado.
//
// La salida es la de `domain/inmovilidad.ts`: si el vehículo NO se ha movido
// desde entonces, el odómetro de ahora es el de entonces. Y eso sí se puede
// demostrar con posiciones.

import {
  decidirLecturaEnReposo,
  evaluarInmovilidad,
  type PruebaInmovilidad,
} from "../../domain/inmovilidad.ts";
// El haversine bueno ya existe y es puro: `liteRules.ts` no importa nada y se
// anuncia como compartible. Una tercera copia de la fórmula en este repositorio
// sería una de más.
import { haversineMeters } from "../../../connect/liteRules.ts";

/** Un kilometraje atribuido a un instante pasado, con la prueba que lo sostiene. */
export interface KilometrajeEnReposo {
  /** Odómetro en kilómetros, sin redondear. */
  odometerKm: number;
  provider: string;
  accountKey: string;
  providerVehicleId: string;
  /** Instante de la lectura, según el proveedor. */
  capturedAt: Date;
  /** Minutos entre la lectura y el instante pedido, con signo. */
  deltaMinutos: number;
  odometerSource?: "vehicle" | "gps" | "unknown";
  /** Qué dijeron las posiciones. Es lo que justifica atribuir el número. */
  prueba: PruebaInmovilidad;
}

/**
 * Lo que se pudo averiguar. Cinco casos, y el segundo es nuevo.
 *
 *  - `encontrado`     — hay odómetro y está respaldado.
 *  - `se_movio`       — hay odómetro y NO vale: el vehículo salió después. No es
 *                       un fallo ni una ausencia, es una negativa razonada, y
 *                       merece decirse distinto para que quien lo lea no crea
 *                       que la telemática no contestó.
 *  - `sin_lectura`    — se preguntó y no había odómetro que ofrecer.
 *  - `sin_telematica` — el vehículo no está enlazado con ninguna cuenta.
 *  - `no_disponible`  — no se pudo preguntar. Esto sí merece reintento.
 */
export type ResultadoReposo =
  | { estado: "encontrado"; kilometraje: KilometrajeEnReposo }
  | { estado: "se_movio"; motivo: string; cuentasConsultadas: string[] }
  | { estado: "sin_lectura"; cuentasConsultadas: string[] }
  | { estado: "sin_telematica" }
  | { estado: "no_disponible"; motivo: string };

/**
 * Kilometraje de un instante pasado, si se puede demostrar que el vehículo no
 * se ha movido desde entonces.
 *
 * Dos llamadas por cuenta, y las dos hacen falta: la lectura actual trae el
 * odómetro y las posiciones traen la prueba. Con Movertis, además, la lectura
 * actual YA hace por dentro esas dos llamadas —`showvehicles` no fecha nada y su
 * `capturedAt` sale de la última posición—, así que esto no añade una ronda
 * gratuita: añade la ventana que va del instante pedido hasta ahora.
 *
 * Si varias cuentas responden con un número aceptable, gana la de menor desfase.
 * Y si ninguna lo acepta pero alguna vio movimiento, eso es lo que se cuenta:
 * «se movió» explica el null, y `sin_lectura` no lo explicaría.
 */
export async function kilometrajeSiSigueParado(
  ctx: OperationContext,
  vehiculoMobilinkId: string,
  desde: Date,
  opciones: { radioM?: number; ahora?: Date } = {},
): Promise<ResultadoReposo> {
  const cuentas = await resolveTelematicsConnectors(ctx.tenantId);
  if (cuentas.length === 0) return { estado: "sin_telematica" };

  const ahora = opciones.ahora ?? new Date();
  const consultadas: string[] = [];
  const fallos: string[] = [];
  let mejor: KilometrajeEnReposo | null = null;
  let movimiento: string | null = null;

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
      const [actual, posiciones] = await Promise.all([
        cuenta.connector.getCurrentTelemetry(ctx, providerVehicleId),
        cuenta.connector.getTelemetryHistory(ctx, providerVehicleId, { from: desde, to: ahora }),
      ]);
      consultadas.push(etiqueta);

      // Sin odómetro no hay kilometraje que atribuir, por mucha prueba que haya.
      if (!actual || actual.odometerKm === undefined) continue;

      const prueba = evaluarInmovilidad({
        posiciones,
        desde,
        radioM: opciones.radioM,
        distanciaMetros: haversineMeters,
      });
      const veredicto = decidirLecturaEnReposo({
        capturedAt: actual.capturedAt,
        desde,
        prueba,
      });

      if (!veredicto.aceptado) {
        // Solo el rechazo por movimiento merece contarse: es el único que
        // explica el null con algo que se ha visto, y no con una ausencia.
        if (prueba.estado === "se_movio") {
          movimiento =
            `${etiqueta}: el vehículo salió de donde estaba ` +
            `(${Math.round(prueba.desplazamientoMaxM)} m, primera salida a las ` +
            `${prueba.primerMovimientoAt.toISOString()})`;
        }
        continue;
      }

      const candidato: KilometrajeEnReposo = {
        odometerKm: actual.odometerKm,
        provider: actual.provider,
        accountKey: actual.accountKey,
        providerVehicleId,
        capturedAt: actual.capturedAt,
        deltaMinutos: veredicto.deltaMinutos,
        odometerSource: actual.odometerSource,
        prueba,
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
  // Una negativa razonada manda sobre una ausencia: si se vio al vehículo salir,
  // eso explica el null mucho mejor que «no había lectura».
  if (movimiento) return { estado: "se_movio", motivo: movimiento, cuentasConsultadas: consultadas };
  if (consultadas.length === 0 && fallos.length === 0) return { estado: "sin_telematica" };
  if (consultadas.length === 0) return { estado: "no_disponible", motivo: fallos.join(" · ") };
  return { estado: "sin_lectura", cuentasConsultadas: consultadas };
}

// ── El odómetro de AHORA ─────────────────────────────────────────────────────
//
// `kilometrajeEnOperacion` busca en una ventana de ±60 min del histórico. Para
// un instante pasado es lo correcto, pero para «¿cuántos kilómetros lleva este
// camión ahora mismo?» deja fuera a Movertis, y no por un fallo de mapeo: su
// histórico (`showtrips`) devuelve posiciones y punto. El odómetro de Movertis
// está en `counters.odometer`, que es lo que sirve su endpoint de flota, y a
// eso se llega por `getCurrentTelemetry`.
//
// Por eso el parte guiado enseñaba «su equipo no está dando el cuentakilómetros
// ahora mismo» en una flota que sí lo está dando.
//
// Se pregunta primero el estado actual y solo si nadie contesta se cae al
// histórico, que es el camino que ya funcionaba con Webfleet.
//
// No confundir con `odometroDeHoy`, aquí debajo: aquél trae un número suelto
// para usarlo como TECHO de otra cuenta, y aquí se devuelve un kilometraje
// trazable —con su proveedor, su instante y su desfase— porque va a la
// pantalla del técnico y tiene que poder decir de dónde sale.

/** Peldaño de la escalera en que cae un desfase. El más ancho si se pasa. */
function peldañoDe(minutos: number): number {
  const d = Math.abs(minutos);
  return ESCALERA_TOLERANCIA.find((p) => d <= p) ?? TOLERANCIA_MAXIMA;
}

/**
 * El kilometraje de ahora mismo, preguntando el estado actual del vehículo.
 *
 * Mismos cuatro estados y mismas reglas de reparto entre cuentas que
 * `kilometrajeEnOperacion`: gana la lectura MÁS RECIENTE, que aquí es la buena
 * —no la más próxima a un instante—, y que una cuenta falle no cancela a las
 * demás.
 *
 * La antigüedad no se juzga aquí: de eso ya se ocupa `clasificarLectura` con
 * el umbral de frescura de la cuenta, que para un odómetro es ancho a
 * propósito (lo que no se ha movido no suma kilómetros).
 */
export async function kilometrajeAhora(
  ctx: OperationContext,
  vehiculoMobilinkId: string,
  ahora: Date = new Date(),
): Promise<ResultadoKilometraje> {
  const cuentas = await resolveTelematicsConnectors(ctx.tenantId);
  if (cuentas.length === 0) return { estado: "sin_telematica" };

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
    if (!providerVehicleId) continue;

    const etiqueta = `${cuenta.key}/${cuenta.accountKey}`;
    try {
      const lectura = await cuenta.connector.getCurrentTelemetry(ctx, providerVehicleId);
      consultadas.push(etiqueta);
      if (!lectura || lectura.odometerKm === undefined) continue;

      const deltaMs = lectura.capturedAt.getTime() - ahora.getTime();
      const minutos = Math.round(deltaMs / 60_000);
      const candidato: KilometrajeTrazable = {
        odometerKm: lectura.odometerKm,
        provider: lectura.provider,
        accountKey: lectura.accountKey,
        providerVehicleId,
        capturedAt: lectura.capturedAt,
        deltaMinutos: minutos === 0 ? 0 : minutos,
        toleranciaMin: peldañoDe(minutos),
        odometerSource: lectura.odometerSource,
      };
      if (!mejor || candidato.capturedAt.getTime() > mejor.capturedAt.getTime()) {
        mejor = candidato;
      }
    } catch (e) {
      fallos.push(`${etiqueta}: ${(e as Error)?.message ?? e}`);
    }
  }

  if (mejor) return { estado: "encontrado", kilometraje: mejor };

  // Nadie enlazado: el vehículo no está en la telemática de este cliente.
  if (consultadas.length === 0 && fallos.length === 0) return { estado: "sin_telematica" };

  // El estado actual no lo ha dado nadie. Queda el histórico, que es de donde
  // sale con Webfleet.
  const porVentana = await kilometrajeEnOperacion(ctx, vehiculoMobilinkId, ahora);
  if (porVentana.estado === "encontrado") return porVentana;

  if (consultadas.length === 0) return { estado: "no_disponible", motivo: fallos.join(" · ") };
  return { estado: "sin_lectura", cuentasConsultadas: consultadas };
}

/**
 * El odómetro de ahora, reducido a lo que necesita un TECHO.
 *
 * Envoltorio de `kilometrajeAhora` a propósito y no una segunda manera de
 * preguntar lo mismo: aquella ya reparte entre cuentas, se queda con la
 * lectura más reciente y cae al histórico cuando el estado actual no da
 * odómetro —que es como sale con Webfleet—. Repetir ese reparto aquí habría
 * sido mantener dos versiones de la misma consulta hasta que dijeran cosas
 * distintas.
 *
 * Lo que añade es la traducción a cota: de los cinco estados, cuatro son «no
 * hay techo» y solo uno es un número. Quien pone cotas no necesita saber en
 * cuál de los cuatro cayó.
 *
 * Un odómetro no retrocede, así que lo que marcaba el autobús en una revisión
 * de marzo no puede ser más de lo que marca hoy. Y como techo vale aunque la
 * lectura envejezca: el odómetro solo sube, así que un valor guardado al
 * arrancar es una cota MÁS ESTRICTA que la de ahora, nunca más laxa. Por eso
 * quien llame puede cachearla sin refrescarla.
 *
 * No sirve para atribuirle kilómetros a nada. Solo para descartar imposibles.
 */
export async function odometroDeHoy(
  ctx: OperationContext,
  vehiculoMobilinkId: string,
): Promise<{ km: number; provider: string; capturedAt: Date } | null> {
  const r = await kilometrajeAhora(ctx, vehiculoMobilinkId);
  if (r.estado !== "encontrado") return null;
  return {
    km: r.kilometraje.odometerKm,
    provider: r.kilometraje.provider,
    capturedAt: r.kilometraje.capturedAt,
  };
}
