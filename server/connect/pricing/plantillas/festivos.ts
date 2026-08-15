/**
 * Festivos nacionales para el calendario de una central que empieza.
 *
 * Solo los NACIONALES y solo los que no dependen de una decisión del año. Los
 * autonómicos, los locales y los traslados —cuando un festivo cae en domingo y
 * el Gobierno lo mueve— no están: son una decisión que se publica cada año y
 * que además depende de dónde opere la central. Inventarlos daría un
 * calendario que parece completo y no lo está, que es peor que uno corto.
 *
 * El Viernes Santo sí se calcula, porque no es una decisión: es la Pascua, y la
 * Pascua tiene fórmula.
 */

import type { DefDiaCalendario } from "../tarifario.ts";

/** Festivos de fecha fija, por país. */
const FIJOS: Record<string, { mes: number; dia: number; nombre: string; clase?: string }[]> = {
  ES: [
    { mes: 1, dia: 1, nombre: "Año Nuevo", clase: "new_year" },
    { mes: 1, dia: 6, nombre: "Epifanía del Señor" },
    { mes: 5, dia: 1, nombre: "Fiesta del Trabajo" },
    { mes: 8, dia: 15, nombre: "Asunción de la Virgen" },
    { mes: 10, dia: 12, nombre: "Fiesta Nacional de España" },
    { mes: 11, dia: 1, nombre: "Todos los Santos" },
    { mes: 12, dia: 6, nombre: "Día de la Constitución" },
    { mes: 12, dia: 8, nombre: "Inmaculada Concepción" },
    { mes: 12, dia: 25, nombre: "Navidad", clase: "christmas" },
  ],
  PT: [
    { mes: 1, dia: 1, nombre: "Ano Novo", clase: "new_year" },
    { mes: 4, dia: 25, nombre: "Dia da Liberdade" },
    { mes: 5, dia: 1, nombre: "Dia do Trabalhador" },
    { mes: 6, dia: 10, nombre: "Dia de Portugal" },
    { mes: 8, dia: 15, nombre: "Assunção de Nossa Senhora" },
    { mes: 10, dia: 5, nombre: "Implantação da República" },
    { mes: 11, dia: 1, nombre: "Todos os Santos" },
    { mes: 12, dia: 1, nombre: "Restauração da Independência" },
    { mes: 12, dia: 8, nombre: "Imaculada Conceição" },
    { mes: 12, dia: 25, nombre: "Natal", clase: "christmas" },
  ],
};

/**
 * Domingo de Pascua por el algoritmo gregoriano anónimo (Meeus/Jones/Butcher).
 * Devuelve la fecha en UTC a mediodía para que ningún huso la mueva de día.
 */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);      // 3 = marzo, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia, 12));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function menosDias(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

/**
 * Los festivos nacionales de un país y un año.
 *
 * La Navidad y el Año Nuevo salen con su propia clase de día (`christmas`,
 * `new_year`) para que un tarifario pueda cobrarlos distinto del festivo
 * corriente sin tener que mirar la fecha en el código.
 */
export function festivosNacionales(pais: string, anio: number): DefDiaCalendario[] {
  const fijos = FIJOS[pais.toUpperCase()] ?? FIJOS.ES;

  const dias: DefDiaCalendario[] = fijos.map((f) => ({
    fecha: `${anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`,
    // Los que tienen clase propia son "special": tienen que poder ganarle al
    // festivo general en la resolución de reglas.
    ambito: f.clase ? "special" : "national",
    clase: f.clase,
    nombre: f.nombre,
    anual: true,
  }));

  const pascua = domingoDePascua(anio);
  dias.push({
    fecha: iso(menosDias(pascua, 2)),
    ambito: "national",
    nombre: pais.toUpperCase() === "PT" ? "Sexta-feira Santa" : "Viernes Santo",
    anual: false,   // cambia cada año: no se puede repetir sin recalcular
  });
  if (pais.toUpperCase() === "PT") {
    dias.push({ fecha: iso(pascua), ambito: "national", nombre: "Domingo de Páscoa", anual: false });
  }

  return dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
