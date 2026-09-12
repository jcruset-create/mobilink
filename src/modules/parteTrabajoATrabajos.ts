// De un parte de trabajo (PT) escaneado a trabajos de taller.
//
// El parte lo imprime el ERP y se sube escaneado; de él se sacan la matrícula,
// el cliente y las líneas. Aquí solo vive la traducción: qué línea genera
// trabajo, con qué plantilla, cuánta cantidad y cuántos minutos. La lectura del
// papel (IA) y la asignación de técnico viven fuera.
//
// Lógica pura, sin React ni red, para poder probarla aislada.

import type { IncludedTask } from "./quickTaskSelector";
import type { AreaKey, MaterialTrabajo, QuickTemplate } from "./workshopTypes";

/** Una línea de "Productos y servicios" del parte. */
export type LineaParte = {
  descripcion: string;
  unidades: number;
  precioUnitario?: number | null;
  precioTotal?: number | null;
  /** Columna PVP del parte. Se guarda para imputar; no se enseña en el taller. */
  pvp?: number | null;
  /** Código de artículo del ERP, si el parte lo trae. */
  codigo?: string | null;
};

export type ParteTrabajo = {
  /** "PT Nº" del parte, p. ej. "D2_26/62". */
  numero: string;
  /** Fecha del parte, 'YYYY-MM-DD'. */
  fecha?: string;
  /** Hora de entrada del parte, 'HH:MM' o 'HH:MM:SS'. */
  horaEntrada?: string;
  matricula: string;
  clienteNombre?: string;
  clienteTelefono?: string;
  cif?: string;
  km?: number | null;
  lineas: LineaParte[];
};

/**
 * Marca de "esto es material, no genera trabajo". Se guarda en la misma tabla
 * de correspondencias que las plantillas: así el usuario enseña una vez qué es
 * cada artículo y no vuelve a preguntarse.
 */
export const CLAVE_MATERIAL = "__material__";

/** Correspondencia artículo → plantilla, por clave normalizada del artículo. */
export type MapaArticulos = Record<string, string>;

export type TrabajoPropuesto = {
  /** Índice de la línea principal en el parte, para poder volver a ella. */
  indiceLinea: number;
  templateKey: string;
  label: string;
  area: AreaKey;
  plate: string;
  quantity: number;
  /** Minutos por unidad de la plantilla. */
  unitMinutes: number;
  /** Minutos totales del trabajo (unitMinutes × cantidad si va por unidades). */
  estimatedMinutes: number;
  customerName?: string;
  customerPhone?: string;
  ptNumero: string;
  /** Hora de entrada del parte en ms, no la hora de volcarlo. */
  arrivedAtMs: number | null;
  descripcionOriginal: string;
  /** El resto de servicios del parte, que van dentro de este mismo trabajo. */
  tareasIncluidas: IncludedTask[];
  /** Material del parte: lo que hay que montar. No consume tiempo. */
  materiales: MaterialTrabajo[];
};

export type LineaSinMapear = LineaParte & { indiceLinea: number; clave: string };

export type ResultadoConversion = {
  trabajos: TrabajoPropuesto[];
  /** Líneas marcadas como material: viajan como referencia, no generan tarea. */
  materiales: (LineaParte & { indiceLinea: number })[];
  /** Líneas que nadie ha enseñado todavía: hay que resolverlas a mano. */
  sinMapear: LineaSinMapear[];
  avisos: string[];
};

/**
 * Clave con la que se busca un artículo en el mapa. Se prefiere el código del
 * ERP; si no viene, la descripción normalizada, que es lo único estable que
 * queda en un papel escaneado.
 */
export function claveArticulo(linea: LineaParte): string {
  const codigo = String(linea.codigo || "").trim();

  if (codigo) return `cod:${codigo.toUpperCase()}`;

  return `desc:${normalizaTexto(linea.descripcion)}`;
}

export function normalizaTexto(valor: string): string {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matrícula del parte.
 *
 * La captura del ERP la trae con el tipo de vehículo delante
 * ("CAMION-8072MNC", "REMOLQUE-R1234BCD"): se queda con lo de después del
 * guion, que es la matrícula de verdad. Sin guion, se devuelve tal cual.
 */
export function normalizaMatricula(valor: string): string {
  const limpio = normalizaTexto(valor).replace(/\s+/g, "");

  if (!limpio.includes("-")) return limpio;

  const ultimo = limpio.split("-").filter(Boolean).pop() ?? "";

  // Si lo de después del guion no parece matrícula, mejor dejar el original:
  // es preferible un dato raro y visible que uno recortado a medias.
  return /\d/.test(ultimo) ? ultimo : limpio;
}

/** Unidades de una línea: solo cuenta una cantidad positiva y finita. */
export function unidadesDeLinea(linea: LineaParte): number {
  const valor = Number(linea?.unidades);

  if (!Number.isFinite(valor) || valor <= 0) return 0;

  // El parte imprime "4,00": las fracciones de montaje no existen.
  return Math.round(valor);
}

/** Minutos que cuesta UNA unidad de la plantilla. */
export function minutosPorUnidad(plantilla: QuickTemplate): number {
  const porUnidad = Number(
    plantilla.usesQuantity ? plantilla.unitMinutes : plantilla.standardMinutes
  );

  if (Number.isFinite(porUnidad) && porUnidad > 0) return porUnidad;

  const estandar = Number(plantilla.standardMinutes);

  return Number.isFinite(estandar) && estandar > 0 ? estandar : 0;
}

/** Minutos de una plantilla para una cantidad dada. */
export function minutosDePlantilla(
  plantilla: QuickTemplate,
  cantidad: number
): number {
  const porUnidad = Number(
    plantilla.usesQuantity ? plantilla.unitMinutes : plantilla.standardMinutes
  );

  if (!Number.isFinite(porUnidad) || porUnidad <= 0) {
    const estandar = Number(plantilla.standardMinutes);
    return Number.isFinite(estandar) && estandar > 0 ? estandar : 0;
  }

  return plantilla.usesQuantity ? porUnidad * cantidad : porUnidad;
}

/** Hora de entrada del parte en ms. Null si el parte no la trae o no es válida. */
export function entradaEnMs(parte: ParteTrabajo): number | null {
  const fecha = String(parte.fecha || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;

  const hora = String(parte.horaEntrada || "").trim();
  const conSegundos = /^\d{2}:\d{2}:\d{2}$/.test(hora)
    ? hora
    : /^\d{2}:\d{2}$/.test(hora)
      ? `${hora}:00`
      : "00:00:00";

  const ms = new Date(`${fecha}T${conSegundos}`).getTime();

  return Number.isNaN(ms) ? null : ms;
}

/**
 * Convierte un parte en UN trabajo.
 *
 * El vehículo entra una vez y sale una vez: montar cuatro ruedas y apretarles
 * la fijación no son dos entradas al taller, son un trabajo con dos cosas
 * dentro. Se elige como operación principal la de más tiempo —que es la que
 * manda para asignar técnico y hueco— y el resto de servicios viajan como
 * tareas incluidas, que es el mecanismo que ya usan las entradas rápidas.
 *
 * Nada se descarta en silencio. Una línea que nadie ha enseñado sale en
 * `sinMapear` para que el usuario diga si es un servicio (y cuál) o material.
 */
export function parteATrabajos({
  parte,
  mapa,
  quickTemplates,
}: {
  parte: ParteTrabajo;
  mapa: MapaArticulos;
  quickTemplates: QuickTemplate[];
}): ResultadoConversion {
  const trabajos: TrabajoPropuesto[] = [];
  const materiales: (LineaParte & { indiceLinea: number })[] = [];
  const sinMapear: LineaSinMapear[] = [];
  const avisos: string[] = [];

  const matricula = normalizaMatricula(parte.matricula);

  if (!matricula) avisos.push("El parte no trae matrícula.");

  const arrivedAtMs = entradaEnMs(parte);

  if (arrivedAtMs == null) {
    avisos.push(
      "El parte no trae fecha y hora de entrada legibles: se usará la hora de volcado."
    );
  }

  const lineas = Array.isArray(parte.lineas) ? parte.lineas : [];

  /** Líneas de servicio ya resueltas, antes de juntarlas en un solo trabajo. */
  const servicios: {
    linea: LineaParte;
    indiceLinea: number;
    plantilla: QuickTemplate;
    cantidad: number;
  }[] = [];

  lineas.forEach((linea, indiceLinea) => {
    const clave = claveArticulo(linea);
    const destino = mapa[clave];

    if (!destino) {
      sinMapear.push({ ...linea, indiceLinea, clave });
      return;
    }

    if (destino === CLAVE_MATERIAL) {
      materiales.push({ ...linea, indiceLinea });
      return;
    }

    const plantilla = quickTemplates.find((item) => item.key === destino);

    if (!plantilla) {
      // La plantilla se borró después de enseñar la correspondencia.
      sinMapear.push({ ...linea, indiceLinea, clave });

      avisos.push(
        `La entrada rápida "${destino}" de "${linea.descripcion}" ya no existe.`
      );

      return;
    }

    const cantidad = unidadesDeLinea(linea);

    if (cantidad === 0) {
      avisos.push(
        `"${linea.descripcion}" viene con ${linea.unidades} unidades: no se crea trabajo.`
      );

      return;
    }

    servicios.push({ linea, indiceLinea, plantilla, cantidad });
  });

  // Un parte, un trabajo. Manda la operación de más tiempo: es la que decide
  // qué técnico hace falta y cuánto hueco ocupa.
  if (servicios.length > 0) {
    const principal = servicios.reduce((mejor, actual) =>
      minutosDePlantilla(actual.plantilla, actual.cantidad) >
      minutosDePlantilla(mejor.plantilla, mejor.cantidad)
        ? actual
        : mejor
    );

    const resto = servicios.filter((s) => s !== principal);

    const tareasIncluidas: IncludedTask[] = resto.map((s) => ({
      id: `parte-${s.indiceLinea}-${s.plantilla.key}`,
      label: s.plantilla.label,
      area: s.plantilla.area,
      source: "quickTemplate",
      templateKey: s.plantilla.key,
      standardMinutes: minutosDePlantilla(s.plantilla, s.cantidad),
      usesQuantity: s.plantilla.usesQuantity,
      quantity: s.cantidad,
      unitMinutes: minutosPorUnidad(s.plantilla),
      unitPrice: s.plantilla.unitPrice ?? null,
    }));

    const minutosTotales = servicios.reduce(
      (suma, s) => suma + minutosDePlantilla(s.plantilla, s.cantidad),
      0
    );

    trabajos.push({
      indiceLinea: principal.indiceLinea,
      templateKey: principal.plantilla.key,
      label: principal.plantilla.label,
      area: principal.plantilla.area,
      plate: matricula,
      quantity: principal.cantidad,
      unitMinutes: minutosPorUnidad(principal.plantilla),
      estimatedMinutes: minutosTotales,
      customerName: parte.clienteNombre?.trim() || undefined,
      customerPhone: parte.clienteTelefono?.trim() || undefined,
      ptNumero: String(parte.numero || "").trim(),
      arrivedAtMs,
      descripcionOriginal: principal.linea.descripcion,
      tareasIncluidas,
      materiales: materiales.map((m) => ({
        descripcion: m.descripcion,
        unidades: unidadesDeLinea(m),
        precioUnitario: m.precioUnitario ?? null,
        precioTotal: m.precioTotal ?? null,
        pvp: m.pvp ?? null,
      })),
    });
  }

  if (trabajos.length === 0 && sinMapear.length === 0) {
    avisos.push("El parte no tiene ninguna línea de servicio: no hay trabajo que crear.");
  }

  return { trabajos, materiales, sinMapear, avisos };
}

/** Texto de referencia del material, para que el técnico sepa qué montar. */
export function resumenMateriales(
  materiales: (LineaParte & { indiceLinea: number })[]
): string {
  if (materiales.length === 0) return "";

  return materiales
    .map((m) => {
      const unidades = unidadesDeLinea(m);
      return unidades > 1 ? `${m.descripcion} ×${unidades}` : m.descripcion;
    })
    .join(" · ");
}
