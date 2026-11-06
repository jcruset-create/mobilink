/**
 * Lo que el informe mensual lee de la base. Solo lee.
 *
 * Está aparte de `armar.ts` para que el cálculo se pueda probar entero sin
 * levantar nada, y para que la respuesta a «¿qué toca este informe?» quepa en
 * una línea: `tc_vehiculos`, `tc_delegaciones`, `tc_posiciones_vehiculo`,
 * `revisiones_vehiculo` y `revisiones_neumaticos_detalle`, todas de lectura.
 *
 * ── Todo pagina, y con orden fijo ───────────────────────────────────────────
 *
 * PostgREST corta en su tope de mil filas y no lo dice. Aquí hay lecturas de
 * 807 vehículos y de más de veinte mil mediciones: sin paginar, el informe
 * saldría a medias y con buena cara. Y el orden tiene que ser fijo, o dos
 * páginas pueden repetir filas y saltarse otras.
 *
 * ── Las mediciones se piden POR MES, no enteras ─────────────────────────────
 *
 * Son 65.957 filas en total y las de un mes son unas 23.000. Se filtran por
 * los `revision_id` del mes en lugar de leerlas todas y descartar: son dos
 * tercios menos de tráfico y de memoria, y la lista de revisiones ya se tiene.
 */

import { supabase } from "../../supabase.ts";
import { PAGINA, paginar } from "../informes/paginar.ts";
import type { MedicionRef, RevisionRef, VehiculoRef } from "./armar.ts";

/**
 * Tope de páginas para las mediciones.
 *
 * El de por defecto son 20.000 filas y un mes bueno de Plana pasa de ahí. 200
 * páginas son 100.000 filas: por encima de cualquier mes imaginable y sigue
 * siendo un seguro contra un bucle, que es para lo que está.
 */
const PAGINAS_MEDICIONES = 200;

/** Los vehículos de la empresa, con su base. */
export async function leerVehiculos(empresa: string): Promise<VehiculoRef[]> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_vehiculos")
      .select("id, matricula, numero_unidad, activo, tipo_vehiculo_id, "
            + "delegacion_id, delegacion:tc_delegaciones(nombre)")
      .eq("empresa_id", empresa)
      .order("id", { ascending: true })
      .range(desde, hasta));

  return filas.map((v) => {
    const rel: any = v.delegacion;
    return {
      id: String(v.id),
      matricula: v.matricula ?? null,
      numeroUnidad: v.numero_unidad ?? null,
      activo: v.activo !== false,
      tipoId: v.tipo_vehiculo_id ? String(v.tipo_vehiculo_id) : null,
      baseId: v.delegacion_id ? String(v.delegacion_id) : null,
      base: (Array.isArray(rel) ? rel[0]?.nombre : rel?.nombre) ?? null,
    };
  });
}

/** Las revisiones de la empresa dentro del mes, de cualquier estado. */
export async function leerRevisiones(
  empresa: string, desde: string, hasta: string,
): Promise<RevisionRef[]> {
  const filas = await paginar<any>((d, h) =>
    supabase
      .from("revisiones_vehiculo")
      .select("id, vehiculo_id, fecha_revision, estado_revision")
      .eq("empresa_id", empresa)
      .gte("fecha_revision", desde)
      .lte("fecha_revision", hasta)
      .order("id", { ascending: true })
      .range(d, h));

  // Se devuelven TODAS, incluidos borradores y anuladas: quién cuenta y quién
  // no lo decide `revisionCuenta` en `armar.ts`, que es donde está escrito el
  // criterio y donde hay pruebas que lo fijan.
  return filas.map((r) => ({
    id: String(r.id),
    vehiculoId: String(r.vehiculo_id),
    fecha: r.fecha_revision ? String(r.fecha_revision).slice(0, 10) : null,
    estado: r.estado_revision ?? null,
  }));
}

/**
 * El número de orden de cada posición, y cuántas lo comparten.
 *
 * El informe tiene una rejilla de «Posición 1…10» para toda la flota, y la
 * columna de un autobús de seis ruedas tiene que ser la misma que la del
 * autocar de diez. Eso es `orden_visual`.
 *
 * `repetidas` cuenta las que comparten número dentro de su propio tipo —hoy
 * `tractora_2x2x4` tiene dos en el 3 y dos en el 4—. No se arregla aquí: se
 * cuenta para poder avisar, porque dos ruedas sumadas en una celda son dos
 * ruedas que nadie encuentra cuando repasa el número.
 */
export async function leerOrdenDePosiciones(): Promise<{
  orden: Map<string, number>;
  repetidas: number;
}> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_posiciones_vehiculo")
      .select("id, tipo_vehiculo_id, orden_visual, activo")
      .order("id", { ascending: true })
      .range(desde, hasta));

  const orden = new Map<string, number>();
  const vistas = new Set<string>();
  let repetidas = 0;
  for (const p of filas) {
    if (p.activo === false) continue;
    const n = Number(p.orden_visual);
    if (!Number.isFinite(n) || n <= 0) continue;
    orden.set(String(p.id), n);
    const clave = `${p.tipo_vehiculo_id}#${n}`;
    if (vistas.has(clave)) repetidas += 1;
    else vistas.add(clave);
  }
  return { orden, repetidas };
}

/**
 * Las mediciones de un conjunto de revisiones.
 *
 * Se pide por tandas de `id` y no de una en una: una revisión por consulta
 * serían casi cuatro mil consultas para un mes de Plana.
 */
export async function leerMediciones(
  empresa: string,
  revisionIds: string[],
  orden: Map<string, number>,
): Promise<MedicionRef[]> {
  if (revisionIds.length === 0) return [];

  const out: MedicionRef[] = [];
  // Tandas de ids por consulta. Pasarse hace una URL que el servidor rechaza.
  const TANDA = 200;
  for (let i = 0; i < revisionIds.length; i += TANDA) {
    const tanda = revisionIds.slice(i, i + TANDA);
    const filas = await paginar<any>((desde, hasta) =>
      supabase
        .from("revisiones_neumaticos_detalle")
        .select("revision_id, vehiculo_id, posicion_id, profundidad_mm, "
              + "neumatico_ausente, no_accesible")
        .eq("empresa_id", empresa)
        .in("revision_id", tanda)
        .order("id", { ascending: true })
        .range(desde, hasta),
      PAGINAS_MEDICIONES);

    for (const m of filas) {
      out.push({
        revisionId: String(m.revision_id),
        vehiculoId: String(m.vehiculo_id),
        posicion: m.posicion_id ? (orden.get(String(m.posicion_id)) ?? null) : null,
        profundidadMm: m.profundidad_mm == null ? null : Number(m.profundidad_mm),
        // Las dos cuentan como «aquí no se ha medido una rueda»: una porque no
        // la hay y otra porque no se pudo llegar. Para un recuento de
        // neumáticos revisados, las dos son lo mismo.
        ausente: m.neumatico_ausente === true || m.no_accesible === true,
      });
    }
  }
  return out;
}

/** El nombre de la empresa, para el título. */
export async function leerNombreEmpresa(empresa: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("tc_empresas").select("nombre").eq("id", empresa).maybeSingle();
  if (error) throw new Error(`No se ha podido leer la empresa: ${error.message}`);
  return (data as any)?.nombre ?? null;
}

export { PAGINA };
