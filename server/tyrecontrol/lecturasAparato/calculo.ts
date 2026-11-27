/**
 * El histórico diario de los contadores del aparato: qué se guarda y qué se
 * puede restar.
 *
 * ── Por qué hace falta guardar ──────────────────────────────────────────────
 *
 * Lo que Movertis da son CONTADORES ACUMULADOS: «19.267 litros desde que se
 * instaló el equipo», «2.234 horas de motor». Eso, suelto, no contesta ninguna
 * pregunta útil: nadie quiere saber cuánto ha gastado un autobús en cinco
 * años, quiere saber cuánto gastó el mes pasado. Y no hay histórico que pedir:
 * `showvehicles` devuelve el valor de AHORA.
 *
 * Así que se guarda una foto al día y el consumo de un periodo es la RESTA de
 * dos fotos. Es exactamente lo que ya se hace con el odómetro para el
 * kilometraje mensual.
 *
 * ── Lo que una resta puede tener de mentira ─────────────────────────────────
 *
 * Restar dos números es fácil; que el resultado signifique algo, no. Casos
 * reales que hay que descartar en vez de guardar:
 *
 *   · El contador BAJA. Un equipo cambiado, una centralita sustituida o un
 *     reseteo. La resta daría negativo y, peor, una suma mensual con un
 *     negativo dentro pasa por buena.
 *   · Las horas de motor crecen MÁS que el tiempo transcurrido. Imposible: un
 *     motor no puede andar 30 horas en un día. Es el chivato de que las dos
 *     lecturas no son del mismo aparato, o de que una vino mal.
 *   · Un salto absurdo de litros o kilómetros para los días que cubre.
 *
 * Lo que no pasa el filtro NO se guarda como cero: se deja sin dato, que es la
 * verdad. Un cero se suma; un hueco se ve.
 */

/** Una foto de los contadores, tal como se guarda. */
export interface Foto {
  /** Fecha local de la lectura, `YYYY-MM-DD`. */
  fecha: string;
  /** Instante exacto de la lectura. */
  leidoEnMs: number;
  horasMotor: number | null;
  consumidoL: number | null;
  odometroKm: number | null;
}

/** Lo gastado entre dos fotos. `null` en lo que no se pueda asegurar. */
export interface Delta {
  desde: string;
  hasta: string;
  /** Horas de reloj entre las dos lecturas. */
  horasTranscurridas: number;
  horasMotor: number | null;
  litros: number | null;
  km: number | null;
  /** Litros por 100 km del tramo, si hay litros y kilómetros suficientes. */
  l100: number | null;
  /** Por qué se ha descartado algo, para poder enseñarlo. */
  aviso: string | null;
}

/** Un motor no anda más horas que las que han pasado. El margen es por el redondeo. */
export const MARGEN_HORAS = 1.05;
/** Kilómetros por hora de media que ya no son creíbles ni en autopista. */
export const KM_H_MAXIMO = 150;
/** Litros por hora de motor que ya no son creíbles en un vehículo pesado. */
export const LITROS_H_MAXIMO = 120;
/** Kilómetros mínimos de un tramo para que su l/100 km signifique algo. */
export const KM_MINIMOS_L100 = 50;

/** Diferencia de dos contadores, o `null` si no se puede asegurar. */
function sube(antes: number | null, despues: number | null, tope: number): { valor: number | null; aviso: string | null } {
  if (antes == null || despues == null) return { valor: null, aviso: null };
  const d = despues - antes;
  if (d < 0) return { valor: null, aviso: "el contador ha bajado (¿equipo cambiado?)" };
  if (d > tope) return { valor: null, aviso: "salto imposible para el tiempo transcurrido" };
  return { valor: d, aviso: null };
}

/**
 * Lo gastado entre dos fotos consecutivas.
 *
 * Los topes se calculan con el TIEMPO TRANSCURRIDO, no con «un día»: si el
 * servidor estuvo caído dos jornadas, el tramo cubre dos y el tope sube con
 * él. Un tope fijo por día marcaría como imposible lo que solo es un hueco.
 */
export function deltaEntre(antes: Foto, despues: Foto): Delta {
  const horas = Math.max(0, (despues.leidoEnMs - antes.leidoEnMs) / 3_600_000);
  const avisos: string[] = [];

  const h = sube(antes.horasMotor, despues.horasMotor, Math.max(1, horas * MARGEN_HORAS));
  if (h.aviso) avisos.push(`horas de motor: ${h.aviso}`);

  const km = sube(antes.odometroKm, despues.odometroKm, Math.max(1, horas * KM_H_MAXIMO));
  if (km.aviso) avisos.push(`kilómetros: ${km.aviso}`);

  // El tope de litros se ata a las horas de MOTOR cuando se saben —un motor
  // parado no gasta—, y al reloj cuando no.
  const horasParaLitros = h.valor ?? horas;
  const l = sube(antes.consumidoL, despues.consumidoL, Math.max(10, horasParaLitros * LITROS_H_MAXIMO));
  if (l.aviso) avisos.push(`litros: ${l.aviso}`);

  return {
    desde: antes.fecha,
    hasta: despues.fecha,
    horasTranscurridas: Math.round(horas * 10) / 10,
    horasMotor: h.valor == null ? null : Math.round(h.valor * 10) / 10,
    litros: l.valor == null ? null : Math.round(l.valor * 10) / 10,
    km: km.valor == null ? null : Math.round(km.valor * 10) / 10,
    l100: l.valor != null && km.valor != null && km.valor >= KM_MINIMOS_L100
      ? Math.round(((100 * l.valor) / km.valor) * 10) / 10
      : null,
    aviso: avisos.length ? avisos.join(" · ") : null,
  };
}

/** Todos los tramos de una serie de fotos, en orden. */
export function tramos(fotos: Foto[]): Delta[] {
  const orden = [...fotos].sort((a, b) => a.leidoEnMs - b.leidoEnMs);
  const salida: Delta[] = [];
  for (let i = 1; i < orden.length; i++) salida.push(deltaEntre(orden[i - 1], orden[i]));
  return salida;
}

export interface Resumen {
  /** Tramos que han entrado en la suma. */
  tramos: number;
  /** Tramos con algo descartado: la suma es de menos. */
  conAviso: number;
  horasMotor: number | null;
  litros: number | null;
  km: number | null;
  l100: number | null;
  /** Días que cubren los tramos sumados. */
  horasCubiertas: number;
}

/**
 * La suma de un periodo.
 *
 * Suma solo lo que hay. Si de diez tramos tres no tienen litros, los litros
 * del mes son los de siete tramos y `conAviso` lo dice: una suma incompleta
 * que se presenta como completa es peor que no dar la suma, porque nadie
 * puede saber que le falta algo.
 */
export function resumen(ts: Delta[]): Resumen {
  const suma = (f: (d: Delta) => number | null) => {
    const vs = ts.map(f).filter((v): v is number => v != null);
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };
  const litros = suma((d) => d.litros);
  const km = suma((d) => d.km);
  return {
    tramos: ts.length,
    conAviso: ts.filter((d) => d.aviso).length,
    horasMotor: suma((d) => d.horasMotor),
    litros,
    km,
    l100: litros != null && km != null && km >= KM_MINIMOS_L100
      ? Math.round(((100 * litros) / km) * 10) / 10
      : null,
    horasCubiertas: Math.round(ts.reduce((t, d) => t + d.horasTranscurridas, 0)),
  };
}

/**
 * Partir una lista en tandas, para pedirle los sensores a Movertis.
 *
 * La flota entera con la bandera `sensors` devolvió 502 —son unos 32 sensores
 * por vehículo y 751 vehículos—, así que hay que ir por tandas. El tamaño
 * sale de la misma idea que `UNIDADES_POR_PETICION` en el conector: un punto
 * de partida sobrio, no un óptimo medido, y quien lo suba que lo haya visto
 * aguantar.
 */
export function enTandas<T>(lista: T[], tamano: number): T[][] {
  const n = Math.max(1, Math.floor(tamano));
  const salida: T[][] = [];
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n));
  return salida;
}

/**
 * Partir una tanda que ha fallado en dos mitades.
 *
 * Una tanda que falla puede ser por tamaño (la pasarela se ahoga) o por UN
 * vehículo que su servidor no sabe procesar —que es justo lo que pasa con
 * `summarytrips`, ver `partesDelMes.ts`—. Partiendo por la mitad hasta llegar
 * a uno solo se salvan todos menos el que de verdad falla, en vez de perder
 * la tanda entera.
 */
export function mitades<T>(tanda: T[]): [T[], T[]] | null {
  if (tanda.length < 2) return null;
  const corte = Math.ceil(tanda.length / 2);
  return [tanda.slice(0, corte), tanda.slice(corte)];
}
