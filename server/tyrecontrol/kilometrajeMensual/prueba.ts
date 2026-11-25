/**
 * «Probar con Movertis»: la parte pura de la prueba de UN vehículo.
 *
 * Antes de escribir al proveedor diciendo que algo no funciona hay que estar
 * seguro de qué es lo que no funciona. La prueba pide el resumen de viajes de
 * una sola unidad con varias ventanas —el mes entero, las dos quincenas, una
 * semana, un día, el mes anterior— y la misma petición con otra unidad que sí
 * funciona, y saca una conclusión de lo que contesta cada una.
 *
 * No guarda nada: solo pregunta y enseña.
 */

import { limitesDelMes, mesAnterior, medianocheEn, type Mes } from "../../integration-hub/domain/meses.ts";

export interface Ventana {
  clave: "mes" | "q1" | "q2" | "semana" | "dia" | "anterior" | "control";
  etiqueta: string;
  desde: Date;
  hasta: Date;
}

export type Respuesta =
  | { tipo: "ok"; km: number; odometroInicial: number | null; odometroFinal: number | null; viajes: number | null }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string }
  | { tipo: "sin_turno" };

export interface ResultadoVentana extends Ventana {
  unidad: string;
  respuesta: Respuesta;
  /** Lo que se le mandó a Movertis, tal cual, para poder enseñárselo a ellos. */
  peticion: { units: number[]; initial_date: number; end_date: number };
}

const NOMBRES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dias = (m: Mes) => new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();

/** Las ventanas de la unidad probada (sin la de control). */
export function ventanasDePrueba(mes: Mes, zona: string): Ventana[] {
  const { desde, hasta } = limitesDelMes(mes, zona);
  const dia = (d: number) => medianocheEn(mes.year, mes.month, d, zona);
  const n = NOMBRES[mes.month - 1];
  const ant = mesAnterior(mes);
  const lAnt = limitesDelMes(ant, zona);
  return [
    { clave: "mes", etiqueta: `${n} entero`, desde, hasta },
    { clave: "q1", etiqueta: `1–15 de ${n}`, desde, hasta: dia(16) },
    { clave: "q2", etiqueta: `16–${dias(mes)} de ${n}`, desde: dia(16), hasta },
    { clave: "semana", etiqueta: `1–7 de ${n}`, desde, hasta: dia(8) },
    { clave: "dia", etiqueta: `10 de ${n}`, desde: dia(10), hasta: dia(11) },
    { clave: "anterior", etiqueta: `${NOMBRES[ant.month - 1]} entero (mes anterior)`, desde: lAnt.desde, hasta: lAnt.hasta },
  ];
}

/** Qué dice todo junto, en palabras. */
export function conclusion(resultados: ResultadoVentana[]): string {
  const de = (c: Ventana["clave"]) => resultados.find((r) => r.clave === c)?.respuesta;
  const propias = resultados.filter((r) => r.clave !== "control" && r.clave !== "anterior");
  const sinTurno = resultados.some((r) => r.respuesta.tipo === "sin_turno");
  const ok = (r?: Respuesta) => r?.tipo === "ok";
  const error = (r?: Respuesta) => r?.tipo === "error";
  const control = de("control");
  const partes: string[] = [];

  if (propias.every((r) => ok(r.respuesta))) {
    partes.push("Movertis contesta bien a todas las ventanas ahora mismo: el mes se puede volver a pedir y debería cerrarse.");
  } else if (!ok(de("mes")) && propias.some((r) => ok(r.respuesta))) {
    partes.push("Falla con el mes entero pero funciona con ventanas más cortas: se puede arreglar en nuestro lado pidiendo el mes por partes.");
  } else if (propias.every((r) => error(r.respuesta))) {
    if (ok(control)) {
      partes.push("Falla con TODAS las ventanas para esta unidad, y la misma petición funciona con otra unidad de la misma cuenta: el problema es de Movertis con esta unidad.");
    } else if (error(control)) {
      partes.push("También falla con la unidad de control: parece un fallo general de Movertis en este momento. Conviene repetir la prueba más tarde.");
    } else {
      partes.push("Falla con todas las ventanas para esta unidad. No se ha podido comparar con otra unidad.");
    }
  } else if (propias.every((r) => r.respuesta.tipo === "vacio")) {
    partes.push("Movertis contesta, pero sin datos para esta unidad en ninguna ventana: o no se movió, o Movertis no tiene sus viajes.");
  } else {
    partes.push("Resultado mixto: unas ventanas funcionan y otras no. Mira el detalle de cada una.");
  }

  const ant = de("anterior");
  if (ok(ant) && !ok(de("mes"))) partes.push("El mes anterior entero sí funciona con esta misma unidad.");
  if (error(ant) && error(de("mes"))) partes.push("El mes anterior también falla ahora con esta unidad.");
  if (sinTurno) partes.push("Alguna ventana no se ha podido pedir por el límite de peticiones: repite la prueba en unos minutos.");
  return partes.join(" ");
}
