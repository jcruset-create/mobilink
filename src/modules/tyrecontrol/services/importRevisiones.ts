import { supabase } from "./supabase";
import { listarVehiculos, listarPosiciones } from "./data";
import type { PosicionVehiculo, Vehiculo } from "../types";

export interface ReporteRev {
  resumen: { filas: number; revisiones: number; detalles: number; neumaticosNuevos: number; errores: number };
  avisos: string[];
  errores: { fila: number; matricula: string; error: string }[];
  noEncontrados: string[];
  sinPosiciones: string[];
  empresa: string | null;
}

function fechaISO(v: any): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) { const s = String(v).trim(); return s ? s.slice(0, 10) : null; }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const numOrNull = (v: any) => { const s = String(v ?? "").trim().replace(",", "."); return s && !isNaN(Number(s)) ? Number(s) : null; };
const txt = (v: any) => { const s = String(v ?? "").trim(); return s || null; };
const medN = (v: any) => { const s = String(v ?? "").trim().replace(/\s+/g, "").toUpperCase(); return s || null; }; // medida sin espacios

interface Grupo { matricula: string; fecha: string; rows: any[]; }

// Importa (o simula) revisiones desde la plantilla. Agrupa por matrícula+fecha,
// resuelve posiciones por el tipo del vehículo, crea un neumático genérico por
// posición si no hay montaje, y registra el detalle de cada rueda.
export async function importRevisiones(rows: any[], ejecutar: boolean): Promise<ReporteRev> {
  const errores: ReporteRev["errores"] = [];
  const avisos = new Set<string>();
  const hoy = fechaISO(new Date())!;
  let sinFecha = 0;

  // 1. Agrupar por matrícula + fecha (las filas sin fecha usan la de hoy)
  const grupos = new Map<string, Grupo>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const mat = String(r.matricula ?? "").trim().toUpperCase();
    if (!mat) { errores.push({ fila: i + 2, matricula: "", error: "Falta matrícula" }); continue; }
    let fecha = fechaISO(r.fecha_revision);
    if (!fecha) { fecha = hoy; sinFecha++; }
    const key = `${mat}||${fecha}`;
    if (!grupos.has(key)) grupos.set(key, { matricula: mat, fecha, rows: [] });
    grupos.get(key)!.rows.push({ ...r, _fila: i + 2, posN: parseInt(String(r.posicion).trim(), 10) });
  }
  if (sinFecha > 0) avisos.add(`${sinFecha} filas sin fecha: se usó la fecha de hoy (${hoy}). Cámbiala luego si conoces la real.`);

  // 2. Vehículos por matrícula
  const vehs = await listarVehiculos();
  const mapVeh = new Map<string, Vehiculo>(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v]));
  const matched = [...grupos.values()].map((g) => mapVeh.get(g.matricula)).filter(Boolean) as Vehiculo[];
  const empresaNombre = matched[0]?.empresa?.nombre ?? null;
  const vehIds = [...new Set(matched.map((v) => v.id))];

  // 3. Posiciones por tipo (ordenadas)
  const tipos = [...new Set(matched.map((v) => v.tipo_vehiculo_id).filter(Boolean))] as string[];
  const posByTipo = new Map<string, PosicionVehiculo[]>();
  for (const t of tipos) {
    const ps = (await listarPosiciones(t)).sort((a, b) => (a.orden_visual ?? 0) - (b.orden_visual ?? 0));
    posByTipo.set(t, ps);
  }

  // 4. Montajes actuales y revisiones existentes (lotes)
  const montajes = vehIds.length
    ? (await supabase.from("tc_montajes_actuales").select("vehiculo_id, posicion_id, neumatico_id").in("vehiculo_id", vehIds)).data ?? []
    : [];
  const mapMontaje = new Map<string, string>(); // vehiculo|posicion -> neumatico
  for (const m of montajes as any[]) mapMontaje.set(`${m.vehiculo_id}|${m.posicion_id}`, m.neumatico_id);

  const revsExist = vehIds.length
    ? (await supabase.from("revisiones_vehiculo").select("id, vehiculo_id, fecha_revision").in("vehiculo_id", vehIds)).data ?? []
    : [];
  const mapRevExist = new Map<string, string>(); // vehiculo|fecha -> revision_id
  for (const r of revsExist as any[]) mapRevExist.set(`${r.vehiculo_id}|${String(r.fecha_revision).slice(0, 10)}`, r.id);

  // Técnico (por nombre) — best effort
  const tecNombres = [...new Set(rows.map((r) => String(r.tecnico ?? "").trim()).filter(Boolean))];
  const mapTec = new Map<string, string>();
  if (tecNombres.length) {
    const us = (await supabase.from("tc_usuarios").select("id, nombre")).data ?? [];
    for (const t of tecNombres) {
      const u = (us as any[]).find((x) => String(x.nombre).trim().toLowerCase() === t.toLowerCase());
      if (u) mapTec.set(t, u.id);
    }
  }

  // 5. Resolver por grupo: posiciones válidas + neumáticos a crear
  interface PlanRev { grupo: Grupo; vehiculo: Vehiculo; posiciones: Map<number, string>; }
  const planes: PlanRev[] = [];
  const noEnc = new Set<string>();
  const sinPos = new Set<string>();
  const neuCrear: { empresa_id: string; codigo_interno: string; marca: string | null; modelo: string | null; medida: string | null; estado: string; activo: boolean; vehiculo_id: string; posicion_id: string }[] = [];

  for (const g of grupos.values()) {
    const v = mapVeh.get(g.matricula);
    if (!v) { noEnc.add(g.matricula); continue; }
    if (!v.tipo_vehiculo_id || !posByTipo.get(v.tipo_vehiculo_id)?.length) { sinPos.add(g.matricula); continue; }
    const ps = posByTipo.get(v.tipo_vehiculo_id)!;
    const posMap = new Map<number, string>();
    for (const row of g.rows) {
      const n = row.posN;
      if (!n || n < 1 || n > ps.length) { avisos.add(`${g.matricula}: posición ${row.posicion} fuera de rango (el tipo tiene ${ps.length})`); continue; }
      const posId = ps[n - 1].id;
      posMap.set(n, posId);
      // ¿hay que crear neumático genérico?
      const mk = `${v.id}|${posId}`;
      if (!mapMontaje.has(mk) && !neuCrear.some((x) => x.vehiculo_id === v.id && x.posicion_id === posId)) {
        neuCrear.push({
          empresa_id: v.empresa_id, codigo_interno: `${g.matricula}-P${n}`,
          marca: txt(row.marca_neumatico), modelo: txt(row.modelo_neumatico), medida: medN(row.medida),
          estado: "montado", activo: true, vehiculo_id: v.id, posicion_id: posId,
        });
      }
    }
    planes.push({ grupo: g, vehiculo: v, posiciones: posMap });
  }

  const totalDetalles = planes.reduce((s, p) => s + [...p.grupo.rows].filter((r) => p.posiciones.has(r.posN)).length, 0);
  const revisionesACrear = planes.filter((p) => !mapRevExist.has(`${p.vehiculo.id}|${p.grupo.fecha}`)).length;

  if (!ejecutar) {
    return {
      resumen: { filas: rows.length, revisiones: revisionesACrear, detalles: totalDetalles, neumaticosNuevos: neuCrear.length, errores: errores.length + noEnc.size + sinPos.size },
      avisos: [...avisos], errores, noEncontrados: [...noEnc], sinPosiciones: [...sinPos], empresa: empresaNombre,
    };
  }

  // 6. EJECUTAR
  // 6a. Crear neumáticos genéricos (lote) y sus montajes
  if (neuCrear.length) {
    const chunk = 200;
    const nuevoNeuId = new Map<string, string>(); // codigo_interno -> id
    for (let i = 0; i < neuCrear.length; i += chunk) {
      const parte = neuCrear.slice(i, i + chunk).map((n) => ({
        empresa_id: n.empresa_id, numero_interno: `IMP-${n.codigo_interno}`, codigo_interno: n.codigo_interno,
        marca: n.marca, modelo: n.modelo, medida: n.medida, estado: n.estado, activo: n.activo,
      }));
      const { data, error } = await supabase.from("tc_neumaticos").insert(parte).select("id, codigo_interno");
      if (error) throw new Error("Alta de neumáticos: " + error.message);
      for (const d of data as any[]) nuevoNeuId.set(d.codigo_interno, d.id);
    }
    const montajesNuevos = neuCrear.map((n) => ({
      empresa_id: n.empresa_id, vehiculo_id: n.vehiculo_id, neumatico_id: nuevoNeuId.get(n.codigo_interno)!, posicion_id: n.posicion_id,
    })).filter((m) => m.neumatico_id);
    for (let i = 0; i < montajesNuevos.length; i += chunk) {
      const { error } = await supabase.from("tc_montajes_actuales").insert(montajesNuevos.slice(i, i + chunk));
      if (error) throw new Error("Montajes: " + error.message);
      for (const m of montajesNuevos.slice(i, i + chunk)) mapMontaje.set(`${m.vehiculo_id}|${m.posicion_id}`, m.neumatico_id);
    }
  }

  // 6b. Crear revisiones que falten (lote) y mapear ids
  const gruposSinRev = planes.filter((p) => !mapRevExist.has(`${p.vehiculo.id}|${p.grupo.fecha}`));
  if (gruposSinRev.length) {
    const nuevas = gruposSinRev.map((p) => ({
      empresa_id: p.vehiculo.empresa_id, vehiculo_id: p.vehiculo.id, fecha_revision: p.grupo.fecha,
      tecnico_id: mapTec.get(String(p.grupo.rows[0].tecnico ?? "").trim()) ?? null, estado_revision: "completada",
    }));
    const chunk = 200;
    for (let i = 0; i < nuevas.length; i += chunk) {
      const { data, error } = await supabase.from("revisiones_vehiculo").insert(nuevas.slice(i, i + chunk)).select("id, vehiculo_id, fecha_revision");
      if (error) throw new Error("Revisiones: " + error.message);
      for (const r of data as any[]) mapRevExist.set(`${r.vehiculo_id}|${String(r.fecha_revision).slice(0, 10)}`, r.id);
    }
  }

  // 6c. Detalles (upsert por revision+posicion)
  const detalles: any[] = [];
  for (const p of planes) {
    const revId = mapRevExist.get(`${p.vehiculo.id}|${p.grupo.fecha}`);
    if (!revId) continue;
    for (const row of p.grupo.rows) {
      const posId = p.posiciones.get(row.posN);
      if (!posId) continue;
      const prof = numOrNull(row.profundidad_mm);
      const pres = numOrNull(row.presion_bar);
      detalles.push({
        revision_id: revId, empresa_id: p.vehiculo.empresa_id, vehiculo_id: p.vehiculo.id, posicion_id: posId,
        neumatico_id: mapMontaje.get(`${p.vehiculo.id}|${posId}`) ?? null,
        profundidad_mm: prof, presion_bar: pres, temperatura: numOrNull(row.temperatura_c),
        metodo_profundidad: prof != null ? "importacion_excel" : null,
        metodo_presion: pres != null ? "importacion_excel" : null,
        estado_visual: txt(row.estado_visual), observaciones: txt(row.observaciones),
        no_accesible: false, neumatico_ausente: false,
      });
    }
  }
  const chunk = 400;
  for (let i = 0; i < detalles.length; i += chunk) {
    const { error } = await supabase.from("revisiones_neumaticos_detalle").upsert(detalles.slice(i, i + chunk), { onConflict: "revision_id,posicion_id" });
    if (error) throw new Error("Detalle de revisión: " + error.message);
  }

  return {
    resumen: { filas: rows.length, revisiones: gruposSinRev.length, detalles: detalles.length, neumaticosNuevos: neuCrear.length, errores: errores.length + noEnc.size + sinPos.size },
    avisos: [...avisos], errores, noEncontrados: [...noEnc], sinPosiciones: [...sinPos], empresa: empresaNombre,
  };
}
