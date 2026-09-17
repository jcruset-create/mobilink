/**
 * Las reglas del bloc, sin base de datos delante.
 *
 * Un bloc es un taco de papel con N órdenes de reparación consecutivas —25 en
 * los que usa el taller hoy—, y todo lo que se puede decidir mirando números
 * vive aquí: qué rango cubre, si choca con otro, qué falta, en qué estado está
 * y cuánto lleva archivado.
 *
 * `service.ts` es quien habla con la base; este fichero se prueba con objetos
 * escritos a mano y por eso no importa `db.ts` ni `errors.ts` de la capa de
 * datos (sí el de negocio, que es puro).
 */

import { ErrorOrManuales } from "../errors.ts";
import type { EstadoBloc, EstadoOr } from "./estados.ts";

/** Lo que trae un bloc del taller. Se puede cambiar al crearlo. */
export const OR_POR_BLOC = 25;

/** Ningún bloc real tiene menos de una ni más de esto. El tope es un seguro. */
export const MAX_OR_POR_BLOC = 200;

/* ── El rango ─────────────────────────────────────────────────────────────── */

export type Rango = { orInicial: number; orFinal: number; cantidadOr: number };

/**
 * El rango que sale de una OR inicial y una cantidad: 1126 + 25 → 1126-1150.
 *
 * El «+24» del encargo es esto mismo con la cantidad por defecto, escrito una
 * sola vez: si un día llegan blocs de 50, cambia el parámetro y no hay que
 * buscar sumas de 24 por el código.
 */
export function rangoDesde(orInicial: number, cantidadOr = OR_POR_BLOC): Rango {
  return { orInicial, orFinal: orInicial + cantidadOr - 1, cantidadOr };
}

/** Valida el rango que llega del formulario y lo devuelve normalizado. */
export function validarRango(datos: {
  orInicial: unknown;
  orFinal?: unknown;
  cantidadOr?: unknown;
}): Rango {
  const orInicial = entero(datos.orInicial, "La OR inicial");
  const cantidadPedida = datos.cantidadOr === undefined || datos.cantidadOr === null || datos.cantidadOr === ""
    ? null
    : entero(datos.cantidadOr, "La cantidad de OR");
  const orFinalPedida = datos.orFinal === undefined || datos.orFinal === null || datos.orFinal === ""
    ? null
    : entero(datos.orFinal, "La OR final");

  if (orInicial <= 0) {
    throw new ErrorOrManuales("RANGO_INVALIDO", "La OR inicial tiene que ser un número mayor que cero.");
  }

  // La cantidad manda sobre la OR final: es lo que define un bloc físico. Si
  // llegan las dos y no cuadran, no se elige en silencio ninguna de las dos.
  const cantidad = cantidadPedida ?? (orFinalPedida !== null ? orFinalPedida - orInicial + 1 : OR_POR_BLOC);

  if (cantidad <= 0 || cantidad > MAX_OR_POR_BLOC) {
    throw new ErrorOrManuales(
      "RANGO_INVALIDO",
      `Un bloc tiene entre 1 y ${MAX_OR_POR_BLOC} OR; han llegado ${cantidad}.`
    );
  }

  const rango = rangoDesde(orInicial, cantidad);

  if (orFinalPedida !== null && orFinalPedida !== rango.orFinal) {
    throw new ErrorOrManuales(
      "RANGO_INCOHERENTE",
      `Con OR inicial ${orInicial} y ${cantidad} OR, la final es ${rango.orFinal}, no ${orFinalPedida}.`
    );
  }

  return rango;
}

/** ¿Se pisan dos rangos? Es la regla «una OR pertenece a un solo bloc». */
export function rangosSolapan(a: Rango, b: Rango): boolean {
  return a.orInicial <= b.orFinal && b.orInicial <= a.orFinal;
}

/** Los números de un rango, en orden. */
export function numerosDelRango(rango: Rango): number[] {
  const numeros: number[] = [];
  for (let n = rango.orInicial; n <= rango.orFinal; n += 1) numeros.push(n);
  return numeros;
}

/**
 * El número de bloc que toca, a partir del último que hay.
 *
 * Se conserva el formato del anterior —«002» sigue a «001»— porque los blocs
 * del taller vienen rotulados con ceros delante y una lista mezclando «002» y
 * «3» no se ordena bien ni se busca bien.
 */
export function siguienteNumeroBloc(ultimo: string | null | undefined): string {
  const limpio = (ultimo ?? "").trim();
  const m = /^(\D*?)(\d+)$/.exec(limpio);
  if (!m) return "001";
  const [, prefijo, digitos] = m;
  const siguiente = String(Number(digitos) + 1);
  return `${prefijo}${siguiente.padStart(digitos.length, "0")}`;
}

/* ── El recuento ──────────────────────────────────────────────────────────── */

export type ResumenOr = { numeroOr: number; estado: EstadoOr };

export type Progreso = {
  total: number;
  archivadas: number;
  pendientes: number;
  enRevision: number;
  duplicadas: number;
  conError: number;
  faltan: number[];
  porcentaje: number;
};

/**
 * Qué hay archivado y qué falta.
 *
 * Se calcula a partir de las filas de OR, no de un contador guardado: un
 * contador que se actualiza por su cuenta es un contador que algún día miente,
 * y aquí el dato que importa —«faltan la 1032 y la 1047»— hay que sacarlo de
 * las filas de todas formas.
 *
 * Una OR en REVISAR cuenta como archivada —tiene papel— pero además marca el
 * bloc para que alguien lo mire: ver `estadoCalculado`.
 */
export function progresoDeBloc(ors: readonly ResumenOr[]): Progreso {
  const total = ors.length;
  const faltan = ors.filter((o) => o.estado === "PENDIENTE" || o.estado === "ERROR").map((o) => o.numeroOr).sort((a, b) => a - b);
  const enRevision = ors.filter((o) => o.estado === "REVISAR").length;
  const duplicadas = ors.filter((o) => o.estado === "DUPLICADA").length;
  const conError = ors.filter((o) => o.estado === "ERROR").length;
  const archivadas = total - faltan.length;
  return {
    total,
    archivadas,
    pendientes: faltan.length,
    enRevision,
    duplicadas,
    conError,
    faltan,
    porcentaje: total === 0 ? 0 : Math.round((archivadas / total) * 100),
  };
}

/**
 * El estado que le toca al bloc según lo archivado.
 *
 * Devuelve `null` cuando no hay que tocar nada, y eso pasa en dos casos que
 * importan:
 *
 *   · **CERRADO no se recalcula.** Cerrar es una decisión de una persona con
 *     su traza; que un documento tardío lo reabriera solo borraría esa
 *     decisión sin que nadie se enterara.
 *   · **Un bloc entregado que aún no ha vuelto tampoco.** Mientras el taller
 *     lo tiene, «faltan 20 OR» no es una anomalía: es que todavía se están
 *     rellenando. Sólo se marca INCOMPLETO si ya llegó algún documento suyo,
 *     porque entonces sí se está escaneando a medias.
 */
export function estadoCalculado(actual: EstadoBloc, progreso: Progreso): EstadoBloc | null {
  if (actual === "CERRADO") return null;

  const completo = progreso.pendientes === 0 && progreso.total > 0;
  const hayRevision = progreso.enRevision > 0 || progreso.duplicadas > 0;

  if (completo) return hayRevision ? "REVISAR" : "COMPLETO";

  if (actual === "DISPONIBLE" || actual === "ENTREGADO") {
    // Nada archivado todavía: sigue su curso normal.
    if (progreso.archivadas === 0) return null;
    return hayRevision ? "REVISAR" : "INCOMPLETO";
  }

  if (hayRevision) return "REVISAR";
  // Devuelto y sin una sola página escaneada: lo que falta es escanear.
  if (progreso.archivadas === 0) return "PENDIENTE_ESCANEO";
  return "INCOMPLETO";
}

/**
 * ¿Se puede cerrar? Sólo un bloc con las 25 y sin nada que revisar.
 *
 * Lanza en vez de devolver un booleano porque el motivo es lo que hay que
 * enseñarle a quien pulsa el botón: «faltan la 1032 y la 1047» sirve, «no se
 * puede» no.
 */
export function comprobarCierre(estado: EstadoBloc, progreso: Progreso): void {
  if (estado === "CERRADO") {
    throw new ErrorOrManuales("BLOC_YA_CERRADO", "Este bloc ya está cerrado.", 409);
  }
  if (progreso.pendientes > 0) {
    const faltan = progreso.faltan.join(", ");
    throw new ErrorOrManuales(
      "BLOC_INCOMPLETO",
      `Faltan ${progreso.pendientes} OR por archivar: ${faltan}.`,
      409,
      { faltan: progreso.faltan }
    );
  }
  if (progreso.enRevision > 0 || progreso.duplicadas > 0) {
    throw new ErrorOrManuales(
      "BLOC_CON_REVISIONES",
      "Hay documentos pendientes de revisar en este bloc. Revísalos antes de cerrarlo.",
      409
    );
  }
}

/* ── Utilidades ───────────────────────────────────────────────────────────── */

function entero(valor: unknown, que: string): number {
  const n = typeof valor === "number" ? valor : Number(String(valor ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ErrorOrManuales("RANGO_INVALIDO", `${que} tiene que ser un número entero.`);
  }
  return n;
}
