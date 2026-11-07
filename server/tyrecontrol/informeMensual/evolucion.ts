/**
 * La evolución mes a mes: las seis bandas de desgaste a lo largo del año.
 *
 * Es el bloque de gráficas del original —cinco páginas de barras apiladas y
 * las tablas de doce columnas al pie de los quesitos—. Aquí solo se calcula
 * la serie; pintarla es cosa de la pantalla.
 *
 * ── Los «niveles de desgaste» son las bandas de siempre ─────────────────────
 *
 * El original llama «Desgaste nivel 1-Cambiar … nivel 6» a lo que en la página
 * del estado de la flota llama «Menos de 4 mm … mayor de 12 mm». Son lo mismo
 * con dos nombres, así que se usa una sola lista (`BANDAS`) y el nivel es su
 * posición. Mantener dos listas sería garantizar que algún día dejen de
 * cuadrar.
 *
 * ── Solo los meses que tienen datos, y dicho desde cuándo ───────────────────
 *
 * Plana empieza a usar TyreControl de verdad en agosto de 2026: antes hay
 * cuatro revisiones sueltas al mes. Doce barras con eso dibujarían una curva
 * descendente espectacular que no habla de neumáticos, habla de cuándo se
 * instaló el programa.
 *
 * Así que la serie se recorta POR DELANTE hasta el primer mes con datos, y se
 * dice desde cuándo. Lo que NO se hace es quitar los huecos de en medio: un
 * mes sin revisiones entre dos que sí las tienen es un mes en el que no se
 * revisó, y eso es justo lo que una gráfica de seguimiento tiene que enseñar.
 *
 * ── Y el problema de verdad no era el que se esperaba ───────────────────────
 *
 * Al medir la serie real de Plana resultó que NINGÚN mes está vacío: diciembre
 * de 2025 ya tiene 390 ruedas. Lo que varía es el volumen, y muchísimo:
 *
 *     MARZO 2026        14 ruedas
 *     JULIO 2026       480
 *     AGOSTO 2026    2.157
 *
 * Catorce ruedas dan porcentajes que saltan de siete en siete. Puestos al lado
 * de un mes de dos mil, invitan a leer una tendencia que no existe. Por eso el
 * aviso que de verdad importa aquí no es el del recorte —que no llega a
 * dispararse— sino el de los meses con menos de cien ruedas.
 *
 * ── Lo que cuesta, medido ───────────────────────────────────────────────────
 *
 * Doce meses son unas 90.000 mediciones, y hay que leerlas: cada mes se
 * deduplica por separado, así que no vale con una pasada sobre el año. Medido
 * contra producción, 26 s por la API de administración. Por PostgREST, que es
 * por donde va de verdad, será bastante menos, pero sigue siendo una lectura
 * cara: por eso va en su propia ruta y no dentro del informe.
 *
 * Si en producción se queda corto, el siguiente paso está claro y tiene su
 * precio: que agregue la base. Eso pondría los cortes de las bandas en SQL
 * además de aquí, que es justo la duplicación que este módulo evita, así que
 * no se hace hasta que haga falta.
 */

import { type Periodo, periodoDeMes } from "./armar.ts";
import { BANDAS, bandaDe, type RuedaCompleta } from "./matrices.ts";

/** Un mes de la serie, con sus seis bandas. */
export interface MesEvolucion {
  mes: string;
  /** `OCTUBRE 2026`, para el eje de la gráfica. */
  etiqueta: string;
  /** Ruedas en cada banda, en el orden de `BANDAS`. */
  porBanda: number[];
  /** Los mismos, en porcentaje sobre el total del mes. */
  pctPorBanda: number[];
  /** Ruedas con profundidad medida: la base de los porcentajes. */
  total: number;
  /** Ruedas revisadas, midieran profundidad o no. */
  ruedas: number;
  recauchutadas: number;
  reesculturadas: number;
}

export interface Evolucion {
  meses: MesEvolucion[];
  /** El primer mes con datos, o `null` si no hay ninguno. */
  desde: string | null;
  /** Cuántos meses se han quitado del principio por no tener nada. */
  mesesVaciosAlPrincipio: number;
  avisos: string[];
}

const pct = (parte: number, total: number): number =>
  total === 0 ? 0 : Math.round((parte / total) * 10000) / 100;

/**
 * Los `n` meses que acaban en `mesFinal`, incluido.
 *
 * Doce es lo que enseña el original. Se calcula hacia atrás con aritmética de
 * meses y no restando días, que es como se acaba perdiendo un 31 de marzo.
 */
export function mesesHasta(mesFinal: string, n = 12): Periodo[] {
  const fin = periodoDeMes(mesFinal);
  const [anyo, mes] = fin.mes.split("-").map(Number);
  const out: Periodo[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(anyo, mes - 1 - i, 1));
    out.push(periodoDeMes(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`));
  }
  return out;
}

/**
 * La serie, a partir de las ruedas ya elegidas de cada mes.
 *
 * Recibe las ruedas de TODO el periodo juntas y las reparte por mes. Es
 * importante que vengan ya deduplicadas **por mes** —una rueda medida once
 * veces en octubre es una rueda de octubre, y la misma rueda medida en
 * noviembre es otra de noviembre—: por eso el que llama tiene que haber
 * pasado cada mes por `ruedasDelMes`, y no el año entero de una vez, que
 * dejaría una sola medición por rueda en los doce meses.
 */
export function serieMensual(
  periodos: Periodo[],
  ruedasPorMes: Map<string, RuedaCompleta[]>,
): MesEvolucion[] {
  return periodos.map((p) => {
    const ruedas = ruedasPorMes.get(p.mes) ?? [];
    const porBanda = BANDAS.map(() => 0);
    let total = 0;
    for (const r of ruedas) {
      const b = bandaDe(r.profundidadMm);
      if (!b) continue;
      porBanda[BANDAS.indexOf(b)] += 1;
      total += 1;
    }
    return {
      mes: p.mes,
      etiqueta: p.etiqueta,
      porBanda,
      pctPorBanda: porBanda.map((v) => pct(v, total)),
      total,
      ruedas: ruedas.length,
      recauchutadas: ruedas.filter((r) => r.recauchutada).length,
      reesculturadas: ruedas.filter((r) => r.reesculturada).length,
    };
  });
}

/**
 * Recorta la serie hasta el primer mes con datos y explica el recorte.
 *
 * Solo por delante. Un hueco en medio se queda: es un mes en el que no se
 * revisó, y esconderlo convertiría la gráfica en una lista de meses buenos.
 */
export function recortar(meses: MesEvolucion[]): Evolucion {
  const primero = meses.findIndex((m) => m.ruedas > 0);
  if (primero === -1) {
    return {
      meses: [],
      desde: null,
      mesesVaciosAlPrincipio: meses.length,
      avisos: ["No hay ninguna revisión en los meses pedidos, así que no hay evolución que enseñar."],
    };
  }

  const serie = meses.slice(primero);
  const avisos: string[] = [];
  if (primero > 0) {
    avisos.push(
      `La serie empieza en ${serie[0].etiqueta} porque antes no hay revisiones: los `
      + `${primero} mes(es) anteriores están vacíos y dibujarlos daría una caída que `
      + "no es de los neumáticos, sino de cuándo se empezó a usar TyreControl.",
    );
  }

  const huecos = serie.filter((m) => m.ruedas === 0);
  if (huecos.length > 0) {
    avisos.push(
      `${huecos.length} mes(es) de la serie no tienen ninguna revisión `
      + `(${huecos.map((m) => m.etiqueta).join(", ")}). Se dejan a cero a propósito: `
      + "es un mes en el que no se revisó, no un mes que falte.",
    );
  }

  const conPocas = serie.filter((m) => m.ruedas > 0 && m.ruedas < 100);
  if (conPocas.length > 0) {
    avisos.push(
      `${conPocas.length} mes(es) tienen menos de 100 ruedas revisadas, así que sus `
      + "porcentajes se mueven mucho con pocas gomas y no son comparables con los demás.",
    );
  }

  return { meses: serie, desde: serie[0].mes, mesesVaciosAlPrincipio: primero, avisos };
}

// ── Los quesitos ───────────────────────────────────────────────────────────

export interface Porcion {
  etiqueta: string;
  valor: number;
  pct: number;
}

/**
 * El quesito del estado del banco de goma: las seis bandas del mes.
 *
 * Es el mismo reparto que la rejilla de profundidades por posición, sumado.
 * No se recalcula desde las ruedas para que no puedan discrepar: si un día la
 * rejilla cambia de criterio, el quesito cambia con ella.
 */
export function quesitoDeBandas(ultimo: MesEvolucion): Porcion[] {
  return BANDAS.map((b, i) => ({
    etiqueta: b,
    valor: ultimo.porBanda[i],
    pct: ultimo.pctPorBanda[i],
  }));
}

/**
 * El quesito de recauchutadas y reesculturadas.
 *
 * Lleva una tercera porción, «el resto», que el original no dibuja y aquí sí:
 * sin ella, dos porciones de 0 y 2 harían un círculo entero de reesculturadas
 * y el informe diría que toda la flota lo está.
 */
export function quesitoDeCondicion(ultimo: MesEvolucion): Porcion[] {
  const total = ultimo.ruedas;
  const resto = Math.max(0, total - ultimo.recauchutadas - ultimo.reesculturadas);
  return [
    { etiqueta: "Recauchutadas", valor: ultimo.recauchutadas, pct: pct(ultimo.recauchutadas, total) },
    { etiqueta: "Reesculturadas", valor: ultimo.reesculturadas, pct: pct(ultimo.reesculturadas, total) },
    { etiqueta: "Resto", valor: resto, pct: pct(resto, total) },
  ];
}
