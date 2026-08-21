/**
 * Tesorería predictiva: cuánto efectivo va a hacer falta y cuándo.
 *
 * El roadmap enuncia esta fase en una línea, así que se acota aquí: predecir
 * **cuándo se queda sin cambio cada caja** y **cuánto hay que llevarle**, con la
 * antelación suficiente para que alguien pase por el banco antes de que el
 * problema exista.
 *
 * ## Sin modelo de lenguaje, por la misma razón de siempre
 *
 * `cash/domain/restock.ts` ya lo dejó dicho y aquí se mantiene: el libro mayor
 * registra cada moneda que ha salido, así que el consumo **es un dato, no una
 * estimación**. Una fórmula da siempre la misma respuesta para los mismos
 * datos, se prueba y se audita. Un modelo daría respuestas distintas para el
 * mismo caso, y en dinero eso es un defecto.
 *
 * ## Lo que sí hay que modelar: el día de la semana
 *
 * Una caja de taller no gasta igual el martes que el sábado. La media plana
 * —sumar catorce días y dividir— predice mal justo el día que importa: si el
 * sábado se gasta el triple, la media dice que aguanta y el sábado a mediodía
 * no hay cambio.
 *
 * Así que el consumo se calcula **por día de la semana**, y solo se cae en la
 * media general cuando de ese día no hay historia suficiente. Es la diferencia
 * entre una predicción que sirve y una que se equivoca los sábados.
 *
 * ## Y lo que no se predice
 *
 * Con pocos días de historia **no se predice**: se dice que no hay datos. Es la
 * regla que ya rige el resto del módulo —un número inventado es peor que un
 * hueco declarado— y aquí importa más que en ningún sitio, porque una
 * predicción con dos días detrás parece igual de firme que una con dos meses.
 */

import { formatearEuros } from "../../cash/domain/money.ts";

/** Consumo de efectivo de una jornada concreta. */
export type JornadaConsumo = {
  fecha: string;
  /** Céntimos que salieron de la caja ese día (positivo). */
  salidaCentimos: number;
  /** De esos, cuántos eran monedas. Es lo que de verdad se agota. */
  calderillaCentimos: number;
};

export type Prediccion = {
  /** Consumo esperado por día, ya con el día de la semana en cuenta. */
  porDia: { fecha: string; diaSemana: number; esperadoCentimos: number; base: "DIA" | "MEDIA" }[];
  /** Días que aguanta la calderilla actual antes de agotarse. */
  diasDeAutonomia: number | null;
  /** Céntimos en monedas que habría que llevar para cubrir el horizonte. */
  faltaCentimos: number;
  /** Cuándo conviene ir al banco: el día anterior a quedarse sin. */
  irAlBancoAntesDe: string | null;
  confianza: "ALTA" | "MEDIA" | "SIN_DATOS";
  /** El porqué, en una frase. Una propuesta que no se entiende se ignora. */
  explicacion: string;
};

/*
 * El formateo de euros se reutiliza del motor de caja en vez de escribir otro
 * `toFixed(2)`: aquel pone coma decimal y punto de miles, que es como se leen
 * los euros aquí. Un `toFixed` da «10.00 €», y una explicación con el número
 * escrito a la inglesa se lee dos veces antes de entenderse.
 */

/** Jornadas mínimas para decir algo, y para decirlo con confianza. */
export const MINIMO_JORNADAS = 5;
export const JORNADAS_PARA_CONFIANZA = 20;
/** Repeticiones de un mismo día de la semana para fiarse de su propio patrón. */
export const MINIMO_POR_DIA = 3;

const euros = (c: number) => `${formatearEuros(c)} €`;

const diaSemana = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

const media = (xs: number[]) =>
  xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/** Fecha ISO + n días, sin tocar husos horarios. */
function sumarDias(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Predice el consumo de calderilla de los próximos días.
 *
 * `desde` es el primer día a predecir; normalmente mañana.
 */
export function predecir(
  historial: readonly JornadaConsumo[],
  calderillaActualCentimos: number,
  desde: string,
  horizonteDias = 7
): Prediccion {
  if (historial.length < MINIMO_JORNADAS) {
    return {
      porDia: [],
      diasDeAutonomia: null,
      faltaCentimos: 0,
      irAlBancoAntesDe: null,
      confianza: "SIN_DATOS",
      explicacion: `Hacen falta al menos ${MINIMO_JORNADAS} jornadas cerradas para predecir; hay ${historial.length}.`,
    };
  }

  const todos = historial.map((j) => j.calderillaCentimos);
  const mediaGeneral = media(todos);

  // Consumo por día de la semana, con su propia media.
  const porDiaSemana = new Map<number, number[]>();
  for (const j of historial) {
    const d = diaSemana(j.fecha);
    porDiaSemana.set(d, [...(porDiaSemana.get(d) ?? []), j.calderillaCentimos]);
  }

  const porDia: Prediccion["porDia"] = [];
  for (let i = 0; i < horizonteDias; i++) {
    const fecha = sumarDias(desde, i);
    const d = diaSemana(fecha);
    const muestras = porDiaSemana.get(d) ?? [];

    /*
     * Solo se usa el patrón del día si ese día se ha repetido lo suficiente.
     * Con una sola muestra, «los sábados se gastan 80 €» no es un patrón: es
     * un sábado.
     */
    const usaDia = muestras.length >= MINIMO_POR_DIA;
    porDia.push({
      fecha,
      diaSemana: d,
      esperadoCentimos: usaDia ? media(muestras) : mediaGeneral,
      base: usaDia ? "DIA" : "MEDIA",
    });
  }

  /*
   * Autonomía: cuántos días completos aguanta lo que hay, gastando lo previsto
   * cada día. Se cuentan días ENTEROS —quedarse sin cambio a media tarde ya es
   * quedarse sin cambio— y por eso el día en el que el saldo se agota no suma.
   */
  let restante = calderillaActualCentimos;
  let dias = 0;
  for (const d of porDia) {
    if (restante < d.esperadoCentimos) break;
    restante -= d.esperadoCentimos;
    dias++;
  }

  const necesario = porDia.reduce((a, d) => a + d.esperadoCentimos, 0);
  const falta = Math.max(0, necesario - calderillaActualCentimos);

  /*
   * Ir al banco el día ANTES de quedarse sin, no el mismo día: el banco tiene
   * horario y la caja también, y avisar el mismo día es avisar tarde.
   */
  const irAlBancoAntesDe =
    falta > 0 && dias < horizonteDias ? sumarDias(desde, Math.max(0, dias - 1)) : null;

  const confianza =
    historial.length >= JORNADAS_PARA_CONFIANZA ? ("ALTA" as const) : ("MEDIA" as const);

  const conPatron = porDia.filter((d) => d.base === "DIA").length;
  const explicacion =
    falta > 0
      ? `Gasta unos ${euros(mediaGeneral)} de calderilla al día y le quedan ${euros(calderillaActualCentimos)}: aguanta ${dias} día(s) de los ${horizonteDias} previstos.`
      : `Con ${euros(calderillaActualCentimos)} en monedas cubre los ${horizonteDias} días previstos.`;

  return {
    porDia,
    diasDeAutonomia: dias,
    faltaCentimos: falta,
    irAlBancoAntesDe,
    confianza,
    explicacion:
      conPatron > 0
        ? `${explicacion} ${conPatron} de los ${horizonteDias} días usan el patrón de su día de la semana.`
        : explicacion,
  };
}
