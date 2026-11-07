/**
 * Resolución de evidencias: de la referencia que cita el modelo al enlace que
 * pulsa la persona.
 *
 * ── Por qué no se construye nada desde el modelo ────────────────────────────
 *
 * El modelo cita referencias cortas (`IV1`, `MT2`…) y nada más. Ni uuids ni
 * rutas: un uuid se inventa con pinta perfectamente creíble y una ruta
 * generada por un modelo puede apuntar a cualquier sitio. Aquí la referencia
 * se busca en el mapa que construyó `datos.ts` a partir de consultas ya
 * filtradas por empresa y por vehículo; si no está en ese mapa, no existe.
 *
 * Esa pertenencia es la garantía de aislamiento: el mapa solo contiene filas
 * que salieron de consultas con `empresa_id` y `vehiculo_id` explícitos, así
 * que una referencia válida es por construcción de esta empresa y de este
 * vehículo. No hay forma de citar la ficha de otro cliente.
 *
 * ── Rutas ───────────────────────────────────────────────────────────────────
 *
 * Solo se usan rutas que existen de verdad en `TyreControlApp.tsx`. Los
 * registros sin pantalla propia —montajes, revisiones, operaciones sueltas,
 * planes— no reciben una ruta inventada: se enlazan a su contexto real (la
 * intervención a la que pertenecen, o la ficha del vehículo).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formato de las referencias que se aceptan del modelo. */
const FORMATO_REF = /^(VH|IV|OP|RV|IN|MT|NM|PL)[0-9]{1,4}$/;

import type { Ref, TipoRef } from "./datos.ts";

export interface Evidencia {
  ref: string;
  tipo: TipoRef;
  id: string;
  etiqueta: string;
  /** Ruta del panel. Siempre de la lista blanca de abajo. */
  ruta: string;
}

export interface Contexto {
  vehiculoId: string;
  /** operación → intervención a la que pertenece, si la tiene. */
  intervencionDeOperacion?: Map<string, string | null>;
}

/**
 * Las únicas rutas que este módulo sabe construir. Comprobadas contra
 * `src/modules/tyrecontrol/TyreControlApp.tsx`.
 */
function rutaDe(r: Ref, ctx: Contexto): string | null {
  const ficha = `/tyrecontrol/vehiculos/${ctx.vehiculoId}`;
  switch (r.tipo) {
    case "vehiculo":
      return ficha;
    case "intervencion":
      return `/tyrecontrol/intervenciones/${r.id}`;
    case "neumatico":
      return `/tyrecontrol/neumaticos/${r.id}`;
    case "incidencia":
      // No hay pantalla de detalle; el listado sí existe.
      return "/tyrecontrol/incidencias";
    case "operacion": {
      const iv = ctx.intervencionDeOperacion?.get(r.id) ?? null;
      return iv && UUID.test(iv) ? `/tyrecontrol/intervenciones/${iv}` : ficha;
    }
    case "revision":
    case "montaje":
    case "plan":
      // Su contexto es la ficha: ahí están las secciones de revisiones y de
      // montajes. No se inventa una pantalla que no existe.
      return ficha;
    default:
      return null;
  }
}

/**
 * Limpia una etiqueta antes de devolverla al panel.
 *
 * Las etiquetas se componen con texto de la base de datos (matrículas,
 * marcas, nombres de plan) y ese texto es dato de cliente: puede traer saltos
 * de línea o longitudes absurdas. No es código, pero tampoco se devuelve en
 * crudo.
 */
function limpiar(texto: string): string {
  return texto
    // eslint-disable-next-line no-control-regex -- quitar caracteres de control es justo el objetivo
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export interface Resueltas {
  evidencias: Evidencia[];
  /** Lo que el modelo citó y no resolvió. Para registro, no para el usuario. */
  descartadas: string[];
}

/**
 * Resuelve las referencias citadas por el modelo.
 *
 * Devuelve solo las que resuelven. Quien llama decide qué hacer con una
 * afirmación que se queda sin evidencias: en `validar.ts` se elimina.
 */
export function resolver(citadas: unknown, refs: Map<string, Ref>, ctx: Contexto): Resueltas {
  const evidencias: Evidencia[] = [];
  const descartadas: string[] = [];
  const vistas = new Set<string>();

  if (!Array.isArray(citadas)) return { evidencias, descartadas };

  for (const bruto of citadas.slice(0, 20)) {
    if (typeof bruto !== "string") { descartadas.push("(no es texto)"); continue; }
    const clave = bruto.trim().toUpperCase();
    if (!FORMATO_REF.test(clave)) { descartadas.push(clave.slice(0, 20)); continue; }

    const r = refs.get(clave);
    if (!r) { descartadas.push(clave); continue; }        // inventada
    if (!UUID.test(r.id)) { descartadas.push(clave); continue; }

    const ruta = rutaDe(r, ctx);
    if (!ruta) { descartadas.push(clave); continue; }

    if (vistas.has(clave)) continue;
    vistas.add(clave);
    evidencias.push({ ref: r.ref, tipo: r.tipo, id: r.id, etiqueta: limpiar(r.etiqueta), ruta });
  }

  return { evidencias, descartadas };
}

/** Las referencias que se le ofrecen al modelo, para incluirlas en el prompt. */
export function listaDeRefs(refs: Map<string, Ref>): string[] {
  return [...refs.keys()];
}
