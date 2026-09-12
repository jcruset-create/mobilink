/**
 * ¿Se ha movido este vehículo desde tal instante?
 *
 * Es la pregunta que rescata el kilometraje de las revisiones del CheckPoint, y
 * nace de una limitación: el histórico de Movertis son POSICIONES, sin odómetro
 * (`showtrips` devuelve `{time, timeString, pos}` y nada más). Con eso no se
 * puede reconstruir el cuentakilómetros de un instante pasado —y reconstruirlo
 * sumando tramos GPS daría un número que no cuadra con el salpicadero, que es
 * justo el requisito—.
 *
 * Pero sirve para otra cosa que resuelve el caso: **demostrar que un vehículo NO
 * se ha movido**. Y si no se ha movido, el odómetro de ahora ES el odómetro de
 * entonces. El histórico de posiciones es inútil para calcular kilómetros y
 * perfecto para validar que los de hoy siguen siendo los de ayer.
 *
 * ── Por qué esto le sirve al arco del CheckPoint ────────────────────────────
 *
 * El arco de Bridgestone está a la ENTRADA de la base: el autobús lo cruza al
 * terminar servicio y se queda parado. Su informe llega días después por correo,
 * así que cuando se importa, el instante que importa (`medido_at`) ya es pasado.
 * Si entre ese instante y ahora el vehículo no ha salido, el odómetro actual
 * vale para aquella medición. Si ha salido, no vale, y entonces la respuesta
 * honesta es no dar ningún número.
 *
 * ── Todo aquí es puro ───────────────────────────────────────────────────────
 *
 * Ni red ni reloj ni base. Incluso la distancia se inyecta, igual que
 * `clasificarFlota` recibe el normalizador de matrículas: el cálculo bueno ya
 * existe en `server/connect/liteRules.ts` y una tercera copia del haversine en
 * este repositorio sería una de más.
 */

import type { VehicleTelemetry } from "./telematics.ts";

/**
 * Cuánto puede alejarse un vehículo sin que cuente como haberse movido.
 *
 * 300 m, el mismo radio que el geocerco de las bases
 * (`tc_delegaciones.base_radio_m`), y por el mismo motivo: dentro de una
 * base el autobús maniobra, va al lavadero y cambia de calle. Eso no son
 * kilómetros de servicio y no debe invalidar la lectura. Además absorbe la
 * deriva del GPS de un aparato quieto, que en una hora larga inventa cientos de
 * metros sin que el vehículo se haya movido.
 *
 * Lo que NO absorbe es una salida: 300 m se cruzan en cuanto el autobús sale a
 * la carretera.
 */
export const RADIO_QUIETO_M = 300;

/** Cómo se calcula la distancia entre dos posiciones, en metros. */
export type DistanciaMetros = (
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
) => number;

/**
 * Lo que dicen las posiciones. Tres respuestas que NO significan lo mismo.
 *
 *  - `quieto`         — hubo emisiones y ninguna se aleja del radio.
 *  - `se_movio`       — hubo emisiones y alguna se aleja: el vehículo salió.
 *  - `sin_emisiones`  — no hubo ninguna. NO es «no se ha movido»: un equipo
 *                       apagado y un autobús aparcado se parecen mucho desde
 *                       fuera, y confundirlos es lo que esto evita.
 */
export type PruebaInmovilidad =
  | {
      estado: "quieto";
      /** Posiciones que se han mirado. */
      puntos: number;
      /** La más lejana respecto a la primera, en metros. */
      desplazamientoMaxM: number;
      radioM: number;
    }
  | {
      estado: "se_movio";
      puntos: number;
      desplazamientoMaxM: number;
      radioM: number;
      /** Cuándo se detectó la primera posición fuera del radio. */
      primerMovimientoAt: Date;
    }
  | { estado: "sin_emisiones" };

/**
 * Evalúa las posiciones posteriores a `desde`.
 *
 * La referencia es la PRIMERA posición a partir de `desde`, no la última
 * conocida antes: en el caso del arco, esa primera posición es el autobús ya
 * dentro de la base, que es el sitio respecto al cual tiene sentido preguntar
 * si se ha ido.
 *
 * Las posiciones anteriores a `desde` se descartan. Si el vehículo estaba en
 * ruta cinco minutos antes de cruzar el arco da igual: lo que se pregunta es
 * qué ha hecho DESPUÉS.
 */
export function evaluarInmovilidad(params: {
  posiciones: VehicleTelemetry[];
  desde: Date;
  radioM?: number;
  distanciaMetros: DistanciaMetros;
}): PruebaInmovilidad {
  const radioM = params.radioM ?? RADIO_QUIETO_M;
  const limite = params.desde.getTime();

  const puntos = params.posiciones
    .filter(
      (p) =>
        p.latitude !== undefined &&
        p.longitude !== undefined &&
        p.capturedAt.getTime() >= limite,
    )
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  if (puntos.length === 0) return { estado: "sin_emisiones" };

  const ref = puntos[0];
  let maxM = 0;
  let primerMovimientoAt: Date | null = null;

  for (const p of puntos) {
    const d = params.distanciaMetros(
      ref.latitude as number,
      ref.longitude as number,
      p.latitude as number,
      p.longitude as number,
    );
    if (d > maxM) maxM = d;
    if (d > radioM && !primerMovimientoAt) primerMovimientoAt = p.capturedAt;
  }

  if (primerMovimientoAt) {
    return {
      estado: "se_movio",
      puntos: puntos.length,
      desplazamientoMaxM: maxM,
      radioM,
      primerMovimientoAt,
    };
  }
  return { estado: "quieto", puntos: puntos.length, desplazamientoMaxM: maxM, radioM };
}

/** Por qué una lectura no se puede atribuir al instante pedido. */
export const MOTIVOS_RECHAZO = {
  /** El vehículo salió después del instante: el odómetro de ahora lleva km de más. */
  SE_MOVIO: "se_movio",
  /**
   * No hay emisiones que lo respalden y la lectura es POSTERIOR al instante.
   *
   * Sin posiciones no se puede afirmar que esté quieto, y con una lectura
   * posterior al instante, los kilómetros de en medio podrían estar dentro. Dar
   * el número sería colar como exacto algo que no se ha comprobado.
   */
  SIN_PRUEBA: "sin_prueba",
} as const;

export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[keyof typeof MOTIVOS_RECHAZO];

export type Veredicto =
  | { aceptado: true; deltaMinutos: number }
  | { aceptado: false; motivo: MotivoRechazo };

/**
 * ¿Vale esta lectura como el kilometraje del instante pedido?
 *
 * ── Los tres casos, y por qué el tercero se acepta ──────────────────────────
 *
 * 1. `se_movio` → NO. El odómetro de ahora incluye los kilómetros de la salida,
 *    y atribuírselos a la medición del arco sería falsear el dato: el neumático
 *    no había hecho esos kilómetros cuando se le midió la profundidad.
 *
 * 2. `quieto` → SÍ. No ha salido de la base, así que su cuentakilómetros no se
 *    ha movido y el de ahora es el de entonces.
 *
 * 3. `sin_emisiones` → SÍ, pero SOLO si la lectura es anterior o simultánea al
 *    instante. Parece contradictorio aceptar el caso sin prueba, y no lo es: una
 *    lectura ANTERIOR al paso por el arco no puede contener kilómetros
 *    POSTERIORES a él, haya emitido lo que haya emitido después. Es el caso del
 *    equipo que se durmió al aparcar, que en esta flota es lo normal y no la
 *    excepción.
 *
 *    Lo que sí queda es un desfase, que puede ser de días si el aparato está
 *    muerto, y por eso se devuelve con signo: quien lo lea decide si un «leído
 *    8 días antes» le sirve. La escalera de tolerancia del kilometraje existe
 *    para esto, y aquí no se toma esa decisión por nadie.
 */
export function decidirLecturaEnReposo(params: {
  /** Instante de la lectura del odómetro, según el proveedor. */
  capturedAt: Date;
  /** Instante al que se le quiere atribuir. */
  desde: Date;
  prueba: PruebaInmovilidad;
}): Veredicto {
  const { capturedAt, desde, prueba } = params;

  if (prueba.estado === "se_movio") {
    return { aceptado: false, motivo: MOTIVOS_RECHAZO.SE_MOVIO };
  }
  if (prueba.estado === "sin_emisiones" && capturedAt.getTime() > desde.getTime()) {
    return { aceptado: false, motivo: MOTIVOS_RECHAZO.SIN_PRUEBA };
  }

  // Minuto con signo, negativo si la lectura es anterior. El `=== 0` evita el
  // -0 que da Math.round con desfases de segundos: un «Δ -0 min» en un registro
  // de auditoría no significa nada, y -0 !== 0 bajo Object.is.
  const minutos = Math.round((capturedAt.getTime() - desde.getTime()) / 60_000);
  return { aceptado: true, deltaMinutos: minutos === 0 ? 0 : minutos };
}
