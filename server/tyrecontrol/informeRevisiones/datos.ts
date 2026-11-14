/**
 * Los datos del informe de revisiones.
 *
 * ── Por qué esto va paginado y por lotes ────────────────────────────────────
 *
 * La primera versión pedía las revisiones con un `.limit(5000)` y después
 * mandaba TODOS sus identificadores en una sola llamada. Las dos cosas
 * fallan, y fallan en silencio, que es lo peor:
 *
 *   · PostgREST corta la respuesta en su tope de filas. Una semana de Plana
 *     son 5.599 mediciones; con el tope, el informe recibía las primeras y
 *     el resto de las revisiones salían impresas como «sin mediciones de
 *     neumático guardadas». No faltaba el dato: faltaba la petición.
 *   · Un array de cientos de UUID viaja en el cuerpo de la llamada. Con
 *     16.799 revisiones —un año de Plana— eso es una petición enorme.
 *
 * El repositorio ya tenía la lección escrita en `kilometrajeMensual`: «nada
 * de traerla de golpe ni de meter 751 identificadores en un filtro: eso
 * viaja en la URL y ya rompió una vez el barrido de presencia en
 * producción». Aquí se aplica lo mismo.
 *
 * El UMBRAL de cada rueda lo resuelve `tc_informe_revisiones_mediciones`,
 * con la misma cadena que los informes: medida → categoría → empresa → 1,6.
 */

import { supabase } from "../../supabase.ts";
import type { MedicionFila, RevisionFila } from "./armar.ts";

/** Filas por página. Por debajo de cualquier tope razonable de PostgREST. */
const PAGINA = 500;
/** Cuántas revisiones se preguntan de una vez en la RPC de mediciones. */
const LOTE_REVISIONES = 200;
/**
 * Tope duro de revisiones por informe. Un año entero de Plana son casi
 * 17.000: eso no es un PDF, es un volcado, y el navegador que lo pidió
 * lleva veinte minutos esperando. Se corta y se dice.
 */
export const MAX_REVISIONES = 4000;

export interface Consulta {
  empresa: string;
  desde: string;
  hasta: string;
}

const SELECT_REVISION =
  "id, fecha_revision, km_vehiculo, estado_revision, observaciones, tipo_revision, "
  + "tecnico:tc_usuarios!revisiones_vehiculo_tecnico_id_fkey(nombre), "
  + "vehiculo:tc_vehiculos!revisiones_vehiculo_vehiculo_id_fkey(matricula, numero_unidad)";

/** Lo que se devuelve además de las filas: si se ha cortado, y por dónde. */
export interface Revisiones {
  filas: RevisionFila[];
  /** true si se ha llegado al tope y hay más en el periodo. */
  truncado: boolean;
}

/** Las revisiones del periodo, paginadas, con el técnico ya resuelto. */
export async function leerRevisiones(c: Consulta): Promise<Revisiones> {
  const filas: RevisionFila[] = [];
  for (let desde = 0; desde < MAX_REVISIONES; desde += PAGINA) {
    const { data, error } = await supabase
      .from("revisiones_vehiculo")
      .select(SELECT_REVISION)
      .eq("empresa_id", c.empresa)
      .gte("fecha_revision", c.desde)
      .lte("fecha_revision", c.hasta)
      .order("fecha_revision", { ascending: true })
      .order("id", { ascending: true })   // desempate estable: sin esto una
      .range(desde, desde + PAGINA - 1);  // página puede repetir o saltarse filas
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    for (const r of pagina as any[]) {
      filas.push({
        id: String(r.id),
        fecha: String(r.fecha_revision ?? "").slice(0, 10),
        matricula: r.vehiculo?.matricula ?? null,
        numero_unidad: r.vehiculo?.numero_unidad ?? null,
        km_vehiculo: r.km_vehiculo == null ? null : Number(r.km_vehiculo),
        estado: String(r.estado_revision ?? ""),
        tecnico: r.tecnico?.nombre ?? null,
        tipo_revision: r.tipo_revision ?? null,
        observaciones: r.observaciones ?? null,
      });
    }
    if (pagina.length < PAGINA) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

/**
 * Las mediciones de esas revisiones, con su umbral.
 *
 * Por lotes de revisiones y, dentro de cada lote, por páginas: un vehículo
 * de seis ruedas por 200 revisiones son 1.200 filas, más de lo que cabe en
 * una respuesta.
 */
export async function leerMediciones(c: Consulta, revisionIds: string[]): Promise<MedicionFila[]> {
  const salida: MedicionFila[] = [];
  for (let i = 0; i < revisionIds.length; i += LOTE_REVISIONES) {
    const lote = revisionIds.slice(i, i + LOTE_REVISIONES);
    for (let desde = 0; ; desde += PAGINA) {
      const { data, error } = await supabase
        .rpc("tc_informe_revisiones_mediciones", { p_empresa: c.empresa, p_revisiones: lote })
        .range(desde, desde + PAGINA - 1);
      if (error) throw new Error(error.message);
      const pagina = (data ?? []) as any[];
      for (const m of pagina) {
        salida.push({
          revision_id: String(m.revision_id),
          posicion: m.posicion ?? null,
          orden: m.orden == null ? null : Number(m.orden),
          profundidad_mm: m.profundidad_mm == null ? null : Number(m.profundidad_mm),
          presion_bar: m.presion_bar == null ? null : Number(m.presion_bar),
          minimo_mm: m.minimo_mm == null ? null : Number(m.minimo_mm),
          aviso_mm: m.aviso_mm == null ? null : Number(m.aviso_mm),
          no_accesible: m.no_accesible ?? false,
          neumatico_ausente: m.neumatico_ausente ?? false,
          marca: m.marca ?? null,
          medida: m.medida ?? null,
          codigo_interno: m.codigo_interno ?? null,
        });
      }
      if (pagina.length < PAGINA) break;
    }
  }
  return salida;
}

/** El nombre de la empresa, para la portada. */
export async function nombreEmpresa(empresaId: string): Promise<string> {
  const { data } = await supabase.from("tc_empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return String((data as any)?.nombre ?? "");
}
