/**
 * Un parte de servicio leído de varias fotografías.
 *
 * Este módulo NO habla con la IA ni con la base de datos. Recibe lo que el
 * modelo dice haber visto en un puñado de fotos —la matrícula, el
 * cuentakilómetros, los flancos de las gomas— y decide qué se puede sostener.
 * Separado a propósito: aquí están las decisiones que hay que poder probar sin
 * levantar nada, que es donde de verdad se falla.
 *
 * La regla de la casa, otra vez: esto PROPONE. Guardar lo decide el técnico.
 */

import {
  valorFiable, normalizarMedida, normalizarNombre, normalizarDot,
  CONFIANZA_MINIMA, type CampoFlanco,
} from "../flanco/flanco.ts";

/** Un neumático tal y como lo lee el modelo en una foto. */
export interface NeumaticoLeido {
  brand: CampoFlanco;
  model: CampoFlanco;
  serial_number: CampoFlanco;
  dimension: CampoFlanco;
  position: CampoFlanco;
}

/** Lo que la IA dice haber visto en el conjunto de fotos del parte. */
export interface ParteLeido {
  plate: CampoFlanco;
  kilometers: CampoFlanco;
  vehicle: CampoFlanco;
  fleet: CampoFlanco;
  date: CampoFlanco;
  tires: NeumaticoLeido[];
  warnings?: string[];
}

/** Un neumático ya depurado, listo para que el técnico lo confirme. */
export interface NeumaticoParte {
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  dimension: string | null;
  position: string | null;
  /** La más baja de sus lecturas: un neumático vale lo que su peor campo. */
  confidence: number;
  /** Campos que se vieron pero no con bastante seguridad. */
  dudosos: string[];
}

export interface Parte {
  plate: string | null;
  kilometers: string | null;
  vehicle: string | null;
  fleet: string | null;
  date: string | null;
  tires: NeumaticoParte[];
  warnings: string[];
  dudosos: string[];
  /** true cuando hay lo mínimo para seguir: matrícula o algún neumático. */
  utilizable: boolean;
}

/**
 * La matrícula se conserva TAL CUAL salvo los espacios de los extremos.
 *
 * Nada de quitar guiones ni espacios interiores: una matrícula extranjera o de
 * remolque puede llevarlos de verdad, y "normalizarla" es perder el dato que
 * el técnico ha ido a fotografiar. Solo se pasa a mayúsculas, que en una
 * matrícula no cambia nada.
 */
export function normalizarMatricula(t: string | null | undefined): string | null {
  const v = (t ?? "").trim().toUpperCase();
  return v || null;
}

/**
 * Los kilómetros, SIN PERDER CIFRAS.
 *
 * El cuentakilómetros se lee como "245.817", "245 817" o "245817 km": los
 * separadores de millar y la unidad se quitan, los dígitos NO. Si aparece algo
 * que no es un número entero —una coma decimal, dos números sueltos— se
 * devuelve null antes que devolver una cifra a medias: un kilometraje
 * equivocado estropea el cálculo de desgaste de toda la flota.
 */
export function normalizarKm(t: string | null | undefined): string | null {
  const bruto = (t ?? "").trim();
  if (!bruto) return null;
  const sinUnidad = bruto.replace(/\b(km|kms|kilometros|kilómetros)\b/gi, "").trim();
  // Solo dígitos y separadores de millar (punto, coma o espacio) entre grupos.
  if (!/^\d{1,3}([., ]?\d{3})*$/.test(sinUnidad) && !/^\d+$/.test(sinUnidad)) return null;
  const digitos = sinUnidad.replace(/[., ]/g, "");
  if (!/^\d+$/.test(digitos)) return null;
  // Un cuentakilómetros con más de 8 cifras no es un cuentakilómetros.
  if (digitos.length > 8) return null;
  return String(Number(digitos));
}

/** La huella de un neumático, para saber si dos lecturas son el mismo. */
function huella(t: NeumaticoParte): string | null {
  // El número de serie o DOT identifica la unidad: si está, manda.
  if (t.serial_number) return `s:${t.serial_number}`;
  // Sin serie, dos gomas iguales en la MISMA posición son la misma. En
  // posiciones distintas son dos, aunque sean idénticas: un camión lleva ocho
  // ruedas iguales y fusionarlas dejaría el parte con una.
  const señas = [normalizarNombre(t.brand), normalizarNombre(t.model),
                 normalizarMedida(t.dimension), normalizarNombre(t.position)].join("|");
  return señas.replace(/\|/g, "") ? `h:${señas}` : null;
}

const CAMPOS_NEU = ["brand", "model", "serial_number", "dimension", "position"] as const;

function depurarNeumatico(n: NeumaticoLeido): NeumaticoParte {
  const dudosos: string[] = [];
  for (const c of CAMPOS_NEU) {
    const campo = n[c];
    if (campo && (campo.valor ?? "").trim() && valorFiable(campo) === null) dudosos.push(c);
  }
  const confianzas = CAMPOS_NEU
    .map((c) => n[c]?.confianza)
    .filter((x): x is number => typeof x === "number");
  return {
    brand: valorFiable(n.brand),
    model: valorFiable(n.model),
    // La serie se deja tal cual salvo mayúsculas: no es un DOT y recortarla a
    // cuatro cifras destrozaría un número de serie de fábrica.
    serial_number: valorFiable(n.serial_number)?.toUpperCase() ?? null,
    dimension: valorFiable(n.dimension) ? normalizarMedida(valorFiable(n.dimension)) : null,
    position: valorFiable(n.position)?.toUpperCase() ?? null,
    // Sin ninguna confianza declarada se asume 1: el modelo no siempre la da y
    // penalizarlo por callar marcaría como dudoso lo que se leyó bien.
    confidence: confianzas.length ? Math.min(...confianzas) : 1,
    dudosos,
  };
}

/**
 * Junta dos lecturas del mismo neumático quedándose con lo mejor de cada una.
 *
 * El encargo pide justo esto: varias fotos de la misma goma para afinar. Gana
 * el campo que venga relleno; si vienen los dos, el de más confianza.
 */
function fundir(a: NeumaticoParte, b: NeumaticoParte): NeumaticoParte {
  const mejor = (x: string | null, y: string | null) => x ?? y;
  return {
    brand: mejor(a.brand, b.brand),
    model: mejor(a.model, b.model),
    serial_number: mejor(a.serial_number, b.serial_number),
    dimension: mejor(a.dimension, b.dimension),
    position: mejor(a.position, b.position),
    confidence: Math.max(a.confidence, b.confidence),
    // Deja de ser dudoso lo que la otra foto sí resolvió.
    dudosos: a.dudosos.filter((c) => b.dudosos.includes(c)),
  };
}

/** Convierte lo leído en el parte que se le enseña al técnico. */
export function prepararParte(l: ParteLeido | null | undefined): Parte {
  const vacio: Parte = {
    plate: null, kilometers: null, vehicle: null, fleet: null, date: null,
    tires: [], warnings: ["No se ha podido leer nada de las fotografías"],
    dudosos: [], utilizable: false,
  };
  if (!l) return vacio;

  const dudosos: string[] = [];
  for (const c of ["plate", "kilometers", "vehicle", "fleet", "date"] as const) {
    const campo = l[c];
    if (campo && (campo.valor ?? "").trim() && valorFiable(campo) === null) dudosos.push(c);
  }

  const avisos = [...(l.warnings ?? [])].filter((w) => !!w?.trim());

  // Depurar y fundir los repetidos.
  const porHuella = new Map<string, NeumaticoParte>();
  const sueltos: NeumaticoParte[] = [];
  for (const bruto of l.tires ?? []) {
    const t = depurarNeumatico(bruto);
    // Un neumático del que no se ha leído NADA no es un neumático.
    if (!t.brand && !t.model && !t.serial_number && !t.dimension) continue;
    const h = huella(t);
    if (!h) { sueltos.push(t); continue; }
    const ya = porHuella.get(h);
    porHuella.set(h, ya ? fundir(ya, t) : t);
  }
  const tires = [...porHuella.values(), ...sueltos];

  const km = normalizarKm(valorFiable(l.kilometers));
  if (valorFiable(l.kilometers) && km === null) {
    avisos.push("Los kilómetros no se han podido leer con seguridad: escríbelos a mano");
  }
  const plate = normalizarMatricula(valorFiable(l.plate));
  if (!plate) avisos.push("No se ha leído la matrícula: hará falta indicarla");
  if (tires.length === 0) avisos.push("No se ha leído ningún neumático");

  return {
    plate,
    kilometers: km,
    vehicle: valorFiable(l.vehicle),
    fleet: valorFiable(l.fleet),
    date: valorFiable(l.date),
    tires,
    warnings: avisos,
    dudosos,
    // Con matrícula O con algún neumático ya hay algo que revisar. Sin nada de
    // lo dos, el parte no sirve y es mejor decirlo que abrir un formulario en
    // blanco que el técnico rellenará entero a mano sin saber por qué.
    utilizable: !!plate || tires.length > 0,
  };
}

export { CONFIANZA_MINIMA, normalizarDot };
