/**
 * Lo que el relleno de kilometraje de revisiones lee y escribe en Supabase.
 *
 * Aparte del resto para que la lógica (`coherencia.ts`) siga siendo pura y
 * probable sin base de datos. Aquí solo hay consultas, y cada una con el
 * cuidado que ya costó aprender en el barrido de presencia: **nada de `.in()`
 * con listas largas**. PostgREST mete esos valores en la URL, y con 751
 * identificadores la pasarela rechaza la petición entera. Se pagina.
 */

import { supabase } from "../../supabase.ts";

/** Cuántas pendientes se traen de golpe para elegir la siguiente. */
const PAGINA_PENDIENTES = 50;

export interface RevisionPendiente {
  id: string;
  vehiculo_id: string;
  fecha_revision: string;
  medido_at: string | null;
}

/**
 * Las revisiones de una empresa sin kilometraje, de la más antigua a la más
 * reciente.
 *
 * El orden importa y no es estético: cada revisión que se escribe se convierte
 * en el suelo de la siguiente (ver `coherencia.ts`), así que procesarlas de
 * antigua a moderna hace que las cotas se aprieten solas. El `id` desempata,
 * porque sin un orden total dos páginas seguidas pueden repetir o saltarse
 * filas con la misma fecha.
 *
 * Va con desplazamiento porque las que se descartan —sin lectura, o rechazadas
 * por incoherentes— siguen con el kilometraje vacío y por tanto siguen
 * saliendo en esta consulta, amontonadas justo al principio. Sin poder pasar
 * de largo, la tarea se quedaría mirando las mismas cincuenta para siempre.
 */
export async function revisionesSinKm(
  empresaId: string,
  desplazamiento = 0,
): Promise<RevisionPendiente[]> {
  const { data, error } = await supabase
    .from("revisiones_vehiculo")
    .select("id, vehiculo_id, fecha_revision, medido_at")
    .eq("empresa_id", empresaId)
    .is("km_vehiculo", null)
    .order("fecha_revision", { ascending: true })
    .order("id", { ascending: true })
    .range(desplazamiento, desplazamiento + PAGINA_PENDIENTES - 1);
  if (error) throw new Error(`No se pudieron leer las revisiones: ${error.message}`);
  return (data ?? []) as RevisionPendiente[];
}

export const TAMANO_PAGINA = PAGINA_PENDIENTES;

/** Cuántas quedan en total. Solo para poder decir «faltan N». */
export async function cuantasSinKm(empresaId: string): Promise<number> {
  const { count, error } = await supabase
    .from("revisiones_vehiculo")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .is("km_vehiculo", null);
  if (error) throw new Error(`No se pudieron contar las revisiones: ${error.message}`);
  return count ?? 0;
}

/**
 * Las revisiones CON kilometraje más cercanas a un instante, por arriba y por
 * abajo, del mismo vehículo. Dos consultas de una fila cada una.
 */
export async function vecinasConKm(
  vehiculoId: string,
  fecha: string,
): Promise<{ anterior: { km: number; fecha: string } | null; siguiente: { km: number; fecha: string } | null }> {
  const base = () =>
    supabase
      .from("revisiones_vehiculo")
      .select("km_vehiculo, fecha_revision")
      .eq("vehiculo_id", vehiculoId)
      .not("km_vehiculo", "is", null);

  const [{ data: antes }, { data: despues }] = await Promise.all([
    base().lt("fecha_revision", fecha).order("fecha_revision", { ascending: false }).limit(1),
    base().gt("fecha_revision", fecha).order("fecha_revision", { ascending: true }).limit(1),
  ]);

  const a = (antes ?? [])[0] as any;
  const d = (despues ?? [])[0] as any;
  return {
    anterior: a ? { km: Number(a.km_vehiculo), fecha: String(a.fecha_revision).slice(0, 10) } : null,
    siguiente: d ? { km: Number(d.km_vehiculo), fecha: String(d.fecha_revision).slice(0, 10) } : null,
  };
}

/**
 * El odómetro al principio y al final del mes de la revisión, del kilometraje
 * mensual ya sincronizado. Es la cota independiente: otra consulta, otro día,
 * otra ventana.
 *
 * El Hub se importa DENTRO por lo de siempre: `db.ts` lanza al importarse sin
 * `DATABASE_URL`, y TyreControl habla por Supabase.
 */
export async function cotasDelMes(
  empresaId: string,
  vehiculoId: string,
  year: number,
  month: number,
): Promise<{ inicial: number; final: number } | null> {
  try {
    const { listMonthlyMileage } = await import("../../integration-hub/infrastructure/repositories.ts");
    const filas = await listMonthlyMileage({ tenantId: empresaId, mobilinkId: vehiculoId });
    const f = filas.find((x: any) => x.year === year && x.month === month && x.sync_status === "ok");
    if (!f) return null;
    const inicial = Number((f as any).initial_odometer_km);
    const final = Number((f as any).final_odometer_km);
    // Sin los dos extremos no hay intervalo que comprobar. Y el cero ya no
    // llega hasta aquí desde que el mapeo lo trata como «sin lectura».
    if (!Number.isFinite(inicial) || !Number.isFinite(final) || inicial <= 0 || final <= 0) return null;
    return { inicial, final };
  } catch {
    // La cota es un extra. Si el Hub no contesta, se decide con las vecinas.
    return null;
  }
}

/**
 * Escribe el kilometraje de una revisión, con su procedencia.
 *
 * Solo si sigue vacío: entre que se eligió y se escribe pueden haber pasado
 * veinte segundos, y un técnico que lo haya puesto a mano manda sobre esto.
 */
export async function guardarKm(params: {
  revisionId: string;
  km: number;
  capturadoAt: Date;
  desfaseMin: number;
}): Promise<boolean> {
  const { error, data } = await supabase
    .from("revisiones_vehiculo")
    .update({
      km_vehiculo: Math.round(params.km),
      origen_km: "telematica",
      km_capturado_at: params.capturadoAt.toISOString(),
      km_desfase_min: params.desfaseMin,
    })
    .eq("id", params.revisionId)
    .is("km_vehiculo", null)
    .select("id");
  if (error) throw new Error(`No se pudo guardar el kilometraje: ${error.message}`);
  return (data ?? []).length > 0;
}
