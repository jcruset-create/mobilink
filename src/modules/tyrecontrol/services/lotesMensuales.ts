/**
 * Qué meses del fichero se importan.
 *
 * El histórico se carga en lotes mensuales, cada uno en su transacción, y
 * hasta ahora el botón recorría TODOS los del fichero. Con un Excel de diez
 * meses eso convierte «importar un mes y medirlo» en «importar los diez»: no
 * es que estuviera mal, es que no se podía hacer de otra manera.
 *
 * Aquí vive la cuenta de qué pasaría con cada mes y cuánto se va a escribir
 * de verdad con los que estén marcados. Sin React ni red, para poder
 * probarlo: es el número que sale en el botón y en el «¿seguro?», y
 * equivocarlo es justo lo que no puede pasar.
 */

/** Lo que se sabe de un mes del fichero, antes y después de simular. */
export interface MesDelFichero {
  /** «2026-01». */
  periodo: string;
  /** Albaranes del mes, los importables y los bloqueados juntos. */
  albaranes: number;
  /**
   * Lo que dijo la simulación. `null` mientras no se haya simulado: no es
   * cero, es que todavía no se sabe, y pintar un cero mentiría.
   */
  seCrearian: number | null;
  yaPresentes: number | null;
  bloqueados: number | null;
}

type Estado = "se_crearia" | "creada" | "ya_presente" | "cambiado" | "bloqueado" | "duplicado_probable";

/**
 * Una fila por mes, en orden. `lotes` ya viene ordenado por periodo desde
 * `porPeriodo`, y aquí se respeta: el primero es el más antiguo, que es por
 * donde se empieza.
 */
export function resumenPorMes<T extends { origen_doc: string }>(
  lotes: Map<string, T[]>,
  simulacion: Map<string, { estado: Estado }> | null,
): MesDelFichero[] {
  return [...lotes.entries()].map(([periodo, albs]) => {
    if (!simulacion) {
      return { periodo, albaranes: albs.length, seCrearian: null, yaPresentes: null, bloqueados: null };
    }
    const cuenta = (e: Estado) => albs.filter((a) => simulacion.get(a.origen_doc)?.estado === e).length;
    return {
      periodo,
      albaranes: albs.length,
      seCrearian: cuenta("se_crearia"),
      yaPresentes: cuenta("ya_presente"),
      bloqueados: cuenta("bloqueado"),
    };
  });
}

/**
 * Los meses marcados, en el orden del fichero.
 *
 * `elegidos` a null significa «todos»: es el estado de partida, y así un
 * fichero recién leído se comporta igual que antes de que existiera esta
 * pantalla.
 */
export function mesesElegidos(periodos: string[], elegidos: Set<string> | null): string[] {
  if (!elegidos) return [...periodos];
  return periodos.filter((p) => elegidos.has(p));
}

/**
 * Cuántas intervenciones se van a crear de verdad con lo marcado.
 *
 * `null` si no se ha simulado: el botón no puede prometer un número que
 * nadie ha calculado.
 */
export function totalACrear(meses: MesDelFichero[], elegidos: Set<string> | null): number | null {
  const activos = meses.filter((m) => !elegidos || elegidos.has(m.periodo));
  if (activos.some((m) => m.seCrearian === null)) return null;
  return activos.reduce((s, m) => s + (m.seCrearian ?? 0), 0);
}

/** «2026-01» → «ene 2026». Lo que se lee; el periodo crudo es para la base. */
export function etiquetaPeriodo(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return periodo; // «sin-fecha» y cualquier cosa rara se enseña tal cual
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15))
    .toLocaleDateString("es-ES", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * El texto del «¿seguro?»: qué meses y cuántos albaranes.
 *
 * Con uno o dos se nombran; con más se dice cuántos y el primero y el
 * último, que es lo que una persona puede comprobar de un vistazo antes de
 * darle a aceptar.
 */
export function descripcionDeMeses(periodos: string[]): string {
  if (periodos.length === 0) return "ningún mes";
  if (periodos.length === 1) return etiquetaPeriodo(periodos[0]);
  if (periodos.length === 2) return periodos.map(etiquetaPeriodo).join(" y ");
  return `${periodos.length} meses, de ${etiquetaPeriodo(periodos[0])} a ${etiquetaPeriodo(periodos[periodos.length - 1])}`;
}
