// Qué enseña la tarjeta de un trabajo: mano de obra y material.
//
// Lógica pura, sin React, para poder probarla aislada. La usan la pantalla de
// TV del taller y, a través del mismo contrato, la tablet del técnico.
//
// Decisión deliberada: aquí NO se calculan ni se devuelven importes. El técnico
// necesita saber qué montar y cuánto se tarda; los precios se guardan para
// imputar y se enseñan en el panel de oficina, que es quien factura.

import type { IncludedTask } from "./quickTaskSelector";
import type { MaterialTrabajo } from "./workshopTypes";

export type LineaManoDeObra = {
  id: string;
  label: string;
  cantidad: number;
  minutos: number;
  /** La operación por la que se creó el trabajo, frente a las incluidas. */
  principal: boolean;
};

export type LineaMaterial = {
  id: string;
  descripcion: string;
  unidades: number;
};

export type ResumenTarjeta = {
  manoDeObra: LineaManoDeObra[];
  minutosTotales: number;
  materiales: LineaMaterial[];
};

/** Cantidad válida de una línea. Lo que no sea un entero positivo, no cuenta. */
function cantidadValida(valor: unknown): number {
  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) return 0;

  return Math.round(numero);
}

function minutosValidos(valor: unknown): number {
  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) return 0;

  return Math.round(numero);
}

/**
 * Arma los bloques de la tarjeta.
 *
 * `includedTasks` y `materiales` llegan de una columna JSONB alimentada por una
 * lectura con IA, así que pueden venir a null, vacías o con basura. Nada de eso
 * puede tumbar la pantalla del taller, que está puesta en una tele y nadie
 * mira hasta que falta trabajo.
 */
export function resumenTarjeta({
  operacionPrincipal,
  cantidadPrincipal,
  minutosPrincipal,
  includedTasks,
  materiales,
}: {
  operacionPrincipal: string;
  cantidadPrincipal?: unknown;
  minutosPrincipal?: unknown;
  includedTasks?: IncludedTask[] | null;
  materiales?: MaterialTrabajo[] | null;
}): ResumenTarjeta {
  const manoDeObra: LineaManoDeObra[] = [];

  const cantidad = cantidadValida(cantidadPrincipal) || 1;
  const minutos = minutosValidos(minutosPrincipal);

  const etiquetaPrincipal = String(operacionPrincipal || "").trim();

  if (etiquetaPrincipal) {
    manoDeObra.push({
      id: "principal",
      label: etiquetaPrincipal,
      cantidad,
      minutos,
      principal: true,
    });
  }

  const tareas = Array.isArray(includedTasks) ? includedTasks : [];

  tareas.forEach((tarea, indice) => {
    const label = String(tarea?.label || "").trim();

    if (!label) return;

    manoDeObra.push({
      id: String(tarea?.id || `incluida-${indice}`),
      label,
      cantidad: cantidadValida(tarea?.quantity) || 1,
      minutos: minutosValidos(tarea?.standardMinutes),
      principal: false,
    });
  });

  const lineasMaterial = Array.isArray(materiales) ? materiales : [];

  const materialesLimpios: LineaMaterial[] = [];

  lineasMaterial.forEach((material, indice) => {
    const descripcion = String(material?.descripcion || "").trim();

    if (!descripcion) return;

    const unidades = cantidadValida(material?.unidades);

    // Una línea de material sin unidades no dice nada útil al técnico.
    if (unidades === 0) return;

    materialesLimpios.push({
      id: `material-${indice}`,
      descripcion,
      unidades,
    });
  });

  return {
    manoDeObra,
    minutosTotales: manoDeObra.reduce((suma, linea) => suma + linea.minutos, 0),
    materiales: materialesLimpios,
  };
}
