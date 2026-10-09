import type { Job, QuickTemplate, TemplateKey } from "./workshopTypes";
import { isBuiltInTemplateKey } from "./jobHelpers";
import {
  getTemplateTotalMinutes,
  getTemplateTotalPrice,
  getTemplateUnitMinutes,
  getTemplateUnitPrice,
} from "./quickEntryV2Builder";

/**
 * Cambiar la operación de un trabajo que todavía está en validación.
 *
 * ── Por qué no basta con cambiar la etiqueta ────────────────────────────────
 *
 * La operación de un trabajo no es un texto: es el área, la plantilla, el modo
 * (uno o equipo), los minutos y el precio. Cambiar solo el rótulo deja un
 * trabajo que dice «Revisión Tacógrafo 3.0» y por dentro sigue siendo una
 * «Diagnosis KTS»: cuenta las horas de la otra, pide la competencia de la otra
 * y factura la de la otra.
 *
 * Los minutos y el precio salen de los mismos ayudantes que usa la entrada
 * rápida al crear el trabajo, para que una entrada creada y otra corregida
 * acaben idénticas.
 *
 * Solo en validación, a propósito: una vez autorizado, el técnico ya está
 * trabajando y los minutos han empezado a contar.
 */
export function camposDeOperacion(
  plantilla: QuickTemplate,
  cantidadActual: unknown
): Partial<Job> {
  const cantidad = plantilla.usesQuantity
    ? Math.max(1, Math.round(Number(cantidadActual) || 1))
    : 1;

  return {
    area: plantilla.area,
    template: isBuiltInTemplateKey(plantilla.key)
      ? (plantilla.key as TemplateKey)
      : null,
    quickEntryLabel: plantilla.label,
    quickEntryMode: plantilla.mode,
    quantity: cantidad,
    unitMinutes: getTemplateUnitMinutes(plantilla) || null,
    unitPrice: getTemplateUnitPrice(plantilla) || null,
    standardMinutes: getTemplateTotalMinutes(plantilla, cantidad) || null,
    totalPrice: getTemplateTotalPrice(plantilla, cantidad) || null,
  };
}

/**
 * Los técnicos propuestos que siguen valiendo para la operación nueva.
 *
 * Si alguien estaba propuesto para una diagnosis y la operación pasa a ser de
 * tacógrafo, puede que no tenga esa competencia. Dejarlo propuesto es peor que
 * quitarlo: «Autorizar» no comprueba competencias —ese filtro está en el
 * desplegable— y arrancaría el trabajo con quien no debe.
 */
export function propuestosQueSiguenValiendo(
  asignados: string[],
  sigueValiendo: (nombre: string, indice: number) => boolean
): string[] {
  return asignados.filter((nombre, i) => sigueValiendo(nombre, i));
}
