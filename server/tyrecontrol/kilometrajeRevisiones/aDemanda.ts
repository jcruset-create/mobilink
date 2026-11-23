/**
 * Km de una revisión o del montaje, pedidos desde la ficha del neumático.
 *
 * Mismo origen y mismas cotas que el relleno nocturno (`worker.ts`), pero a
 * demanda y para UNA revisión: se propone, una persona lo ve y lo guarda. El km
 * de una revisión vale para TODA ella (todos los neumáticos medidos ese día).
 *
 * El km del montaje no se escribe en tc_montajes_actuales (no se toca): va a
 * tc_km_montaje_complemento, que es de donde lo lee tc_neumatico_recorrido().
 * Nunca se pisa un km que ya estaba.
 */

import { supabase } from "../../supabase.ts";
import { ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";
import { instanteDeRevision, type Cotas } from "./coherencia.ts";
import { cotasDelMes, vecinasConKm } from "./datos.ts";
import { proponer, validarManual, type LecturaHub, type Propuesta } from "./propuesta.ts";

/** Un fallo que la pantalla enseña tal cual. */
export class ErrorKm extends Error {
  constructor(mensaje: string, public estado = 400) { super(mensaje); }
}

export interface Quien { empresaPropia: string; esSuperadmin: boolean; usuarioId: string }

function exigirEmpresa(quien: Quien, empresaId: string) {
  if (!quien.esSuperadmin && quien.empresaPropia !== empresaId) {
    throw new ErrorKm("No existe en tu empresa.", 404);
  }
}

async function lecturaDelHub(empresaId: string, vehiculoId: string, instante: Date, etiqueta: string): Promise<LecturaHub> {
  const { odometroEnInstante } = await import("../../integration-hub/application/services/HistoricOdometerService.ts");
  return (await odometroEnInstante(
    { tenantId: empresaId, correlationId: `km-ficha-${etiqueta}` },
    vehiculoId, instante, { zonaHoraria: ZONA_HORARIA_POR_DEFECTO },
  )) as LecturaHub;
}

async function cotasPara(empresaId: string, vehiculoId: string, fecha: string, instante: Date): Promise<Cotas> {
  const [vecinas, mes] = await Promise.all([
    vecinasConKm(vehiculoId, fecha),
    cotasDelMes(empresaId, vehiculoId, instante.getUTCFullYear(), instante.getUTCMonth() + 1),
  ]);
  let hoy: { km: number } | null = null;
  try {
    const { odometroDeHoy } = await import("../../integration-hub/application/services/VehicleOdometerService.ts");
    const h = await odometroDeHoy({ tenantId: empresaId, correlationId: `km-ficha-hoy-${vehiculoId}` }, vehiculoId);
    if (h) hoy = { km: h.km };
  } catch { /* una cota menos, no un fallo */ }
  return { ...vecinas, mes, hoy };
}

// ── Revisión ────────────────────────────────────────────────────────────────

interface FilaRevision {
  id: string; empresa_id: string; vehiculo_id: string; fecha_revision: string;
  medido_at: string | null; km_vehiculo: number | null; estado_revision: string | null;
}

async function revision(quien: Quien, revisionId: string): Promise<FilaRevision> {
  const { data, error } = await supabase.from("revisiones_vehiculo")
    .select("id, empresa_id, vehiculo_id, fecha_revision, medido_at, km_vehiculo, estado_revision")
    .eq("id", revisionId).maybeSingle();
  if (error || !data) throw new ErrorKm("La revisión no existe.", 404);
  const r = data as FilaRevision;
  exigirEmpresa(quien, r.empresa_id);
  if (r.estado_revision === "anulada") throw new ErrorKm("La revisión está anulada.");
  return r;
}

async function neumaticosDe(revisionId: string): Promise<number> {
  const { count } = await supabase.from("revisiones_neumaticos_detalle")
    .select("id", { count: "exact", head: true }).eq("revision_id", revisionId);
  return count ?? 0;
}

async function proponerParaRevision(r: FilaRevision): Promise<{ propuesta: Propuesta; cotas: Cotas }> {
  const fecha = String(r.fecha_revision).slice(0, 10);
  const cuando = instanteDeRevision(r);
  if (!cuando) return { propuesta: { estado: "no", motivo: "La fecha de la revisión no se puede leer." }, cotas: {} };
  const cotas = await cotasPara(r.empresa_id, r.vehiculo_id, fecha, cuando.instante);
  const lectura = await lecturaDelHub(r.empresa_id, r.vehiculo_id, cuando.instante, r.id);
  return { propuesta: proponer(lectura, cotas), cotas };
}

export async function proponerRevision(quien: Quien, revisionId: string) {
  const r = await revision(quien, revisionId);
  if (r.km_vehiculo != null) throw new ErrorKm(`Esta revisión ya tiene ${r.km_vehiculo} km.`, 409);
  const [{ propuesta, cotas }, n] = await Promise.all([proponerParaRevision(r), neumaticosDe(r.id)]);
  return { propuesta, neumaticos: n, anterior: cotas.anterior ?? null, siguiente: cotas.siguiente ?? null };
}

/** Guarda el km de la revisión (para toda ella). Telemática: se vuelve a calcular aquí. */
export async function guardarRevision(quien: Quien, revisionId: string, datos: { origen: "telematica" | "manual"; km?: unknown }) {
  const r = await revision(quien, revisionId);
  if (r.km_vehiculo != null) throw new ErrorKm(`Esta revisión ya tiene ${r.km_vehiculo} km.`, 409);

  let km: number; let extra: Record<string, unknown> = {};
  if (datos.origen === "telematica") {
    const { propuesta } = await proponerParaRevision(r);
    if (propuesta.estado !== "ok") throw new ErrorKm(propuesta.motivo, 409);
    km = propuesta.km;
    extra = { km_capturado_at: propuesta.capturadoAt };
  } else {
    const fecha = String(r.fecha_revision).slice(0, 10);
    const v = validarManual(datos.km, await vecinasConKm(r.vehiculo_id, fecha));
    if (v.estado !== "ok") throw new ErrorKm(v.motivo);
    km = v.km;
  }
  const { data, error } = await supabase.from("revisiones_vehiculo")
    .update({ km_vehiculo: km, origen_km: datos.origen, ...extra })
    .eq("id", r.id).is("km_vehiculo", null).select("id");
  if (error) throw new ErrorKm(`No se pudo guardar: ${error.message}`, 500);
  if (!(data ?? []).length) throw new ErrorKm("Alguien acaba de ponerle km a esta revisión.", 409);
  return { km, origen: datos.origen, neumaticos: await neumaticosDe(r.id) };
}

/**
 * Todas las revisiones sin km de un vehículo, de la más antigua a la más
 * reciente: cada una que se guarda es cota de la siguiente. Solo se guardan las
 * fiables; las demás se devuelven con su motivo.
 */
export async function pedirTodasDelVehiculo(quien: Quien, vehiculoId: string) {
  const { data: v } = await supabase.from("tc_vehiculos").select("id, empresa_id").eq("id", vehiculoId).maybeSingle();
  if (!v) throw new ErrorKm("El vehículo no existe.", 404);
  exigirEmpresa(quien, String((v as { empresa_id: string }).empresa_id));
  const { data, error } = await supabase.from("revisiones_vehiculo")
    .select("id, empresa_id, vehiculo_id, fecha_revision, medido_at, km_vehiculo, estado_revision")
    .eq("vehiculo_id", vehiculoId).is("km_vehiculo", null)
    .order("fecha_revision", { ascending: true }).limit(50);
  if (error) throw new ErrorKm(error.message, 500);

  const resultado: Array<{ fecha: string; km?: number; motivo?: string }> = [];
  for (const r of (data ?? []) as FilaRevision[]) {
    if (r.estado_revision === "anulada") continue;
    const fecha = String(r.fecha_revision).slice(0, 10);
    const { propuesta } = await proponerParaRevision(r);
    if (propuesta.estado !== "ok") { resultado.push({ fecha, motivo: propuesta.motivo }); continue; }
    const { data: hecho } = await supabase.from("revisiones_vehiculo")
      .update({ km_vehiculo: propuesta.km, origen_km: "telematica", km_capturado_at: propuesta.capturadoAt })
      .eq("id", r.id).is("km_vehiculo", null).select("id");
    resultado.push((hecho ?? []).length ? { fecha, km: propuesta.km } : { fecha, motivo: "ya tenía km" });
  }
  return { revisiones: resultado };
}

// ── Montaje actual ──────────────────────────────────────────────────────────

interface FilaMontaje { empresa_id: string; vehiculo_id: string; neumatico_id: string; fecha_montaje: string; km_montaje: number | null }

async function montaje(quien: Quien, neumaticoId: string): Promise<FilaMontaje> {
  const { data, error } = await supabase.from("tc_montajes_actuales")
    .select("empresa_id, vehiculo_id, neumatico_id, fecha_montaje, km_montaje")
    .eq("neumatico_id", neumaticoId).maybeSingle();
  if (error || !data) throw new ErrorKm("Este neumático no está montado.", 404);
  const m = data as FilaMontaje;
  exigirEmpresa(quien, m.empresa_id);
  if (Number(m.km_montaje) > 0) throw new ErrorKm(`El montaje ya tiene ${m.km_montaje} km.`, 409);
  const { data: c } = await supabase.from("tc_km_montaje_complemento").select("km")
    .eq("neumatico_id", m.neumatico_id).eq("vehiculo_id", m.vehiculo_id).eq("fecha_montaje", m.fecha_montaje).maybeSingle();
  if (c) throw new ErrorKm(`El montaje ya tiene ${(c as { km: number }).km} km.`, 409);
  return m;
}

async function proponerParaMontaje(m: FilaMontaje): Promise<{ propuesta: Propuesta; cotas: Cotas }> {
  const fecha = String(m.fecha_montaje).slice(0, 10);
  // Sin hora: al empezar el día (cota inferior; no regala km a la goma).
  const cuando = instanteDeRevision({ fecha_revision: fecha });
  if (!cuando) return { propuesta: { estado: "no", motivo: "La fecha del montaje no se puede leer." }, cotas: {} };
  const cotas = await cotasPara(m.empresa_id, m.vehiculo_id, fecha, cuando.instante);
  const lectura = await lecturaDelHub(m.empresa_id, m.vehiculo_id, cuando.instante, `montaje-${m.neumatico_id}`);
  return { propuesta: proponer(lectura, cotas), cotas };
}

export async function proponerMontaje(quien: Quien, neumaticoId: string) {
  const m = await montaje(quien, neumaticoId);
  const { propuesta, cotas } = await proponerParaMontaje(m);
  return { propuesta, fecha: m.fecha_montaje, anterior: cotas.anterior ?? null, siguiente: cotas.siguiente ?? null };
}

export async function guardarMontaje(quien: Quien, neumaticoId: string, datos: { origen: "telematica" | "manual"; km?: unknown }) {
  const m = await montaje(quien, neumaticoId);
  let km: number; let capturado: string | null = null;
  if (datos.origen === "telematica") {
    const { propuesta } = await proponerParaMontaje(m);
    if (propuesta.estado !== "ok") throw new ErrorKm(propuesta.motivo, 409);
    km = propuesta.km; capturado = propuesta.capturadoAt;
  } else {
    const v = validarManual(datos.km, await vecinasConKm(m.vehiculo_id, String(m.fecha_montaje).slice(0, 10)));
    if (v.estado !== "ok") throw new ErrorKm(v.motivo);
    km = v.km;
  }
  const { error } = await supabase.from("tc_km_montaje_complemento").insert({
    neumatico_id: m.neumatico_id, vehiculo_id: m.vehiculo_id, fecha_montaje: m.fecha_montaje,
    km, origen: datos.origen, capturado_at: capturado, creado_por: quien.usuarioId,
  });
  if (error) throw new ErrorKm(`No se pudo guardar: ${error.message}`, 500);
  return { km, origen: datos.origen };
}
