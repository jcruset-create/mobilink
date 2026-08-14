/**
 * Clases de día: qué es un día concreto a efectos de tarifa.
 *
 * No basta con "es festivo". El 25 de diciembre es festivo nacional Y es
 * Navidad, y un tarifario puede cobrar una cosa por lo primero y otra por lo
 * segundo. Por eso el resolutor devuelve una LISTA de clases aplicables, de la
 * más específica a la más general, y es la prioridad de las reglas la que
 * decide cuál gana. Así "en Navidad manda la tarifa de Navidad" es
 * configuración y no un `if` en el código.
 *
 * El ámbito importa: un festivo local de Polinyà no lo es en Vigo. Si no se
 * sabe dónde ocurre el servicio, los festivos de ámbito local o provincial NO
 * se aplican y se avisa. Aplicarlos por si acaso encarecería servicios que no
 * corresponde, y no aplicarlos en silencio escondería el problema.
 */

import { diaSemanaDe } from "./time.ts";

export type AmbitoCalendario = "national" | "regional" | "provincial" | "local" | "special";

export interface DiaCalendario {
  date: string;                 // AAAA-MM-DD
  scope: AmbitoCalendario;
  regionCode?: string | null;
  provinceCode?: string | null;
  municipality?: string | null;
  /** 'holiday' por defecto; 'christmas', 'new_year'… para reglas propias. */
  dayClass: string;
  name?: string | null;
  /** Se repite cada año en el mismo día y mes. */
  yearly?: boolean | null;
  active?: boolean | null;
}

/** Dónde ocurre el servicio, para decidir qué festivos le afectan. */
export interface LugarServicio {
  regionCode?: string | null;
  provinceCode?: string | null;
  municipality?: string | null;
}

export interface ClasesDeDia {
  /** De la más específica a la más general. */
  clases: string[];
  /** Festivos que han decidido la clasificación, para la explicación. */
  festivos: DiaCalendario[];
  avisos: string[];
}

const ORDEN_AMBITO: Record<AmbitoCalendario, number> = {
  special: 5, local: 4, provincial: 3, regional: 2, national: 1,
};

function normalizar(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

/** ¿Este día del calendario afecta al lugar donde ocurre el servicio? */
function afectaAlLugar(d: DiaCalendario, lugar: LugarServicio): boolean | "desconocido" {
  switch (d.scope) {
    case "national":
    case "special":
      return true;
    case "regional":
      if (!d.regionCode) return true;
      if (!lugar.regionCode) return "desconocido";
      return normalizar(lugar.regionCode) === normalizar(d.regionCode);
    case "provincial":
      if (!d.provinceCode) return true;
      if (!lugar.provinceCode) return "desconocido";
      return normalizar(lugar.provinceCode) === normalizar(d.provinceCode);
    case "local":
      if (!d.municipality) return true;
      if (!lugar.municipality) return "desconocido";
      return normalizar(lugar.municipality) === normalizar(d.municipality);
  }
}

/** ¿Coincide la fecha, teniendo en cuenta los festivos que se repiten? */
function coincideFecha(d: DiaCalendario, fecha: string): boolean {
  if (d.date === fecha) return true;
  return !!d.yearly && d.date.slice(5) === fecha.slice(5);
}

/**
 * Clases aplicables a una fecha y un lugar.
 *
 * Siempre incluye la clase del día de la semana (`workday`, `saturday`,
 * `sunday`), para que un tarifario pueda tener reglas de sábado sin depender
 * de ningún calendario.
 */
export function clasesDeDia(
  fecha: string,
  dias: DiaCalendario[],
  lugar: LugarServicio = {},
): ClasesDeDia {
  const avisos: string[] = [];
  const festivos: DiaCalendario[] = [];
  let ambitoDesconocido = false;

  for (const d of dias) {
    if (d.active === false) continue;
    if (!coincideFecha(d, fecha)) continue;
    const afecta = afectaAlLugar(d, lugar);
    if (afecta === "desconocido") {
      ambitoDesconocido = true;
      continue;
    }
    if (afecta) festivos.push(d);
  }

  if (ambitoDesconocido) {
    // No se aplica lo que no se puede confirmar, pero se deja constancia: el
    // servicio podría estar en un municipio con festivo local propio.
    avisos.push("HOLIDAY_SCOPE_UNKNOWN");
  }

  // Más específico primero: primero el ámbito, y a igualdad, la clase propia
  // antes que el genérico 'holiday'.
  const ordenados = [...festivos].sort((a, b) => {
    const porAmbito = ORDEN_AMBITO[b.scope] - ORDEN_AMBITO[a.scope];
    if (porAmbito !== 0) return porAmbito;
    const propioA = a.dayClass === "holiday" ? 1 : 0;
    const propioB = b.dayClass === "holiday" ? 1 : 0;
    return propioA - propioB;
  });

  const clases: string[] = [];
  const anadir = (c: string) => { if (c && !clases.includes(c)) clases.push(c); };

  for (const d of ordenados) {
    // El genérico va al final: si se añadiera aquí, "holiday" adelantaría a
    // "holiday_local" y una regla de festivo local dejaría de ser la más
    // específica, que es justo lo contrario de lo que se busca.
    if (d.dayClass !== "holiday") anadir(d.dayClass);
    anadir(`holiday_${d.scope}`);
  }
  if (ordenados.length > 0) anadir("holiday");

  const diaSemana = diaSemanaDe(fecha);
  if (diaSemana === 6) anadir("saturday");
  else if (diaSemana === 7) anadir("sunday");
  else if (ordenados.length === 0) anadir("workday");

  return { clases, festivos: ordenados, avisos };
}

/** Texto para la explicación: "Navidad (festivo nacional)" o "Laborable". */
export function describirDia(r: ClasesDeDia): string {
  const principal = r.festivos[0];
  if (!principal) return r.clases.includes("saturday") ? "Sábado"
    : r.clases.includes("sunday") ? "Domingo" : "Laborable";
  const ambito = {
    national: "festivo nacional", regional: "festivo autonómico",
    provincial: "festivo provincial", local: "festivo local", special: "día especial",
  }[principal.scope];
  return principal.name ? `${principal.name} (${ambito})` : ambito;
}
