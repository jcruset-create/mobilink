import { supabase } from "./supabase";
import { listarVehiculos, listarPosiciones } from "./data";
import type { PosicionVehiculo, Vehiculo } from "../types";
import { medidaCanonica } from "./medidas";

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
// Medida en forma canónica, la misma que impone el disparador de la base de
// datos: si no, "295/80R22,5" y "295/80R22.5" salen como dos medidas
// distintas en el informe.
const medN = (v: any) => medidaCanonica(String(v ?? "")) || null;

interface Grupo { matricula: string; fecha: string; rows: any[]; }

/** El momento de la medición del grupo, si las filas lo traen. */
function momentoDeGrupo(g: Grupo): string | null {
  const t = g.rows.map((r) => r._medidoAt).filter((d) => d instanceof Date) as Date[];
  if (!t.length) return null;
  return new Date(Math.max(...t.map((d) => d.getTime()))).toISOString();
}

// Importa (o simula) revisiones desde la plantilla. Agrupa por matrícula+fecha,
// resuelve posiciones por el tipo del vehículo, crea un neumático genérico por
// posición si no hay montaje, y registra el detalle de cada rueda.
export interface OpcionesRev {
  /**
   * De dónde vienen las mediciones. Cambia el método que se apunta en cada
   * rueda, para poder comparar luego el arco contra la sonda.
   */
  origen?: "importacion_excel" | "checkpoint";
}

export async function importRevisiones(
  rows: any[], ejecutar: boolean, opciones: OpcionesRev = {},
): Promise<ReporteRev> {
  const metodo = opciones.origen ?? "importacion_excel";
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
    grupos.get(key)!.rows.push({
      ...r, _fila: i + 2, posN: parseInt(String(r.posicion).trim(), 10),
      // El CheckPoint no numera las ruedas: las nombra (E3_IZQ). Es más
      // seguro, porque el número depende de que el tipo tenga las posiciones
      // en el mismo orden y el código no.
      _codigo: String(r.codigo_posicion ?? "").trim().toUpperCase() || null,
    });
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
  const neuMontados = new Set<string>();        // neumáticos que ya están puestos en algún sitio
  for (const m of montajes as any[]) {
    mapMontaje.set(`${m.vehiculo_id}|${m.posicion_id}`, m.neumatico_id);
    neuMontados.add(m.neumatico_id);
  }

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
      let posId: string | undefined;
      let n = row.posN;
      if (row._codigo) {
        // Por código primero; si el tipo usa otra nomenclatura (los sembrados
        // en la Fase 3 llaman DEL_IZQ a lo que aquí es E1_IZQ), por las señas
        // de la rueda, que son las mismas se llame como se llame.
        const p = ps.find((x) => String(x.codigo_posicion).toUpperCase() === row._codigo)
          ?? (row._eje ? ps.find((x) =>
                x.eje === row._eje
                && String(x.lado ?? "") === String(row._lado ?? "")
                && (x.interior_exterior ?? null) === (row._io ?? null)) : undefined);
        if (!p) { avisos.add(`${g.matricula}: su tipo no tiene la posición ${row._codigo}`); continue; }
        posId = p.id;
        n = ps.indexOf(p) + 1;
        row.posN = n;
      } else {
        if (!n || n < 1 || n > ps.length) { avisos.add(`${g.matricula}: posición ${row.posicion} fuera de rango (el tipo tiene ${ps.length})`); continue; }
        posId = ps[n - 1].id;
      }
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
  // 6a. Neumáticos genéricos (lote) y sus montajes.
  //
  // El número interno se construye a partir de la matrícula y la posición
  // (IMP-1234ABC-P3) y tiene un índice único GLOBAL (uq_tc_neu_numero_interno,
  // fase8): global de verdad, no por empresa. Si una importación se quedó a
  // medias —o se repite el mismo Excel— esas fichas YA existen, y volver a
  // insertarlas rompía todo con "duplicate key value violates unique
  // constraint".
  //
  // Mirar antes qué hay no basta: tc_neumaticos filtra por empresa (política
  // tc_neu_select, fase4), así que una ficha del mismo número interno creada
  // bajo OTRA empresa —una duplicada por un import anterior con el nombre de
  // cliente mal escrito, por ejemplo— no se ve en el select pero sí choca
  // contra el índice. Por eso el alta va con "no hagas nada si ya existe" y
  // los ids se releen después: lo que no aparezca es que pertenece a otro,
  // y eso se avisa y se salta, sin tumbar el resto de la importación.
  if (neuCrear.length) {
    const chunk = 200;
    const nuevoNeuId = new Map<string, string>(); // codigo_interno -> id

    const numeroDe = (codigo: string) => `IMP-${codigo}`;
    const leerExistentes = async (codigos: string[]) => {
      for (let i = 0; i < codigos.length; i += chunk) {
        const { data, error } = await supabase.from("tc_neumaticos")
          .select("id, codigo_interno").in("numero_interno", codigos.slice(i, i + chunk).map(numeroDe));
        if (error) throw new Error("Neumáticos existentes: " + error.message);
        for (const d of data as any[]) nuevoNeuId.set(d.codigo_interno, d.id);
      }
    };

    // Lo que ya existe de importaciones anteriores: se reutiliza.
    await leerExistentes(neuCrear.map((n) => n.codigo_interno));
    const yaEstaban = nuevoNeuId.size;
    if (yaEstaban) avisos.add(`${yaEstaban} neumáticos ya existían de una importación anterior: se reutilizan en vez de duplicarlos.`);

    const porCrear = neuCrear.filter((n) => !nuevoNeuId.has(n.codigo_interno));
    for (let i = 0; i < porCrear.length; i += chunk) {
      const parte = porCrear.slice(i, i + chunk).map((n) => ({
        empresa_id: n.empresa_id, numero_interno: numeroDe(n.codigo_interno), codigo_interno: n.codigo_interno,
        marca: n.marca, modelo: n.modelo, medida: n.medida, estado: n.estado, activo: n.activo,
      }));
      const { data, error } = await supabase.from("tc_neumaticos")
        .upsert(parte, { onConflict: "numero_interno", ignoreDuplicates: true })
        .select("id, codigo_interno");
      if (error) throw new Error("Alta de neumáticos: " + error.message);
      for (const d of data as any[]) nuevoNeuId.set(d.codigo_interno, d.id);
    }

    // Las que el alta se saltó por chocar con una ficha ajena no vuelven en el
    // select del upsert: se releen por si eran visibles y simplemente se
    // habían creado entre medias.
    const sinResolver = porCrear.filter((n) => !nuevoNeuId.has(n.codigo_interno));
    if (sinResolver.length) {
      await leerExistentes(sinResolver.map((n) => n.codigo_interno));
      const ajenas = sinResolver.filter((n) => !nuevoNeuId.has(n.codigo_interno));
      if (ajenas.length) {
        const mats = [...new Set(ajenas.map((n) => n.codigo_interno.split("-P")[0]))];
        avisos.add(
          `${ajenas.length} neumáticos no se han podido dar de alta: su número interno ya existe en otra empresa ` +
          `(seguramente una empresa duplicada de un import anterior). Sus mediciones se guardan igual, pero sin ficha ` +
          `de neumático. Vehículos afectados: ${mats.slice(0, 10).join(", ")}${mats.length > 10 ? ` y ${mats.length - 10} más` : ""}.`,
        );
      }
    }

    // Los montajes tienen sus propios índices únicos —uno por neumático y uno
    // por vehículo+posición (fase4)—, así que se salta lo que ya está puesto.
    const montajesNuevos = neuCrear
      .map((n) => ({
        empresa_id: n.empresa_id, vehiculo_id: n.vehiculo_id,
        neumatico_id: nuevoNeuId.get(n.codigo_interno)!, posicion_id: n.posicion_id,
      }))
      // Además del único por vehículo+posición, tc_montajes_actuales tiene uno
      // por neumático: una goma reutilizada que ya esté puesta en otra posición
      // no se puede montar otra vez sin desmontarla antes.
      .filter((m) => m.neumatico_id
        && !mapMontaje.has(`${m.vehiculo_id}|${m.posicion_id}`)
        && !neuMontados.has(m.neumatico_id));
    for (let i = 0; i < montajesNuevos.length; i += chunk) {
      const parte = montajesNuevos.slice(i, i + chunk);
      const { error } = await supabase.from("tc_montajes_actuales")
        .upsert(parte, { onConflict: "vehiculo_id,posicion_id", ignoreDuplicates: true });
      if (error) throw new Error("Montajes: " + error.message);
      for (const m of parte) mapMontaje.set(`${m.vehiculo_id}|${m.posicion_id}`, m.neumatico_id);
    }
  }

  // 6b. Crear revisiones que falten (lote) y mapear ids
  const gruposSinRev = planes.filter((p) => !mapRevExist.has(`${p.vehiculo.id}|${p.grupo.fecha}`));
  if (gruposSinRev.length) {
    const nuevas = gruposSinRev.map((p) => ({
      empresa_id: p.vehiculo.empresa_id, vehiculo_id: p.vehiculo.id, fecha_revision: p.grupo.fecha,
      tecnico_id: mapTec.get(String(p.grupo.rows[0].tecnico ?? "").trim()) ?? null, estado_revision: "completada",
      // Cuándo se midió de verdad, no cuándo se graba esto. Es lo que evita
      // reimportar la misma pasada por el arco la semana que viene.
      medido_at: momentoDeGrupo(p.grupo),
    }));
    const chunk = 200;
    for (let i = 0; i < nuevas.length; i += chunk) {
      const { data, error } = await supabase.from("revisiones_vehiculo").insert(nuevas.slice(i, i + chunk)).select("id, vehiculo_id, fecha_revision");
      if (error) throw new Error("Revisiones: " + error.message);
      for (const r of data as any[]) mapRevExist.set(`${r.vehiculo_id}|${String(r.fecha_revision).slice(0, 10)}`, r.id);
    }
  }

  // 6b bis. La revisión de ese día ya existía y no sabía a qué hora se midió.
  // Pasa al reimportar y cuando el arco mide un vehículo que ese mismo día ya
  // tenía revisión. Solo se rellena si está vacía: si ya hay una hora, la puso
  // alguien que sabía más.
  const conMomento = planes
    .map((p) => ({ id: mapRevExist.get(`${p.vehiculo.id}|${p.grupo.fecha}`), momento: momentoDeGrupo(p.grupo) }))
    .filter((x) => x.id && x.momento && !gruposSinRev.some((g) => mapRevExist.get(`${g.vehiculo.id}|${g.grupo.fecha}`) === x.id));
  for (const x of conMomento) {
    await supabase.from("revisiones_vehiculo")
      .update({ medido_at: x.momento }).eq("id", x.id!).is("medido_at", null);
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
        metodo_profundidad: prof != null ? metodo : null,
        metodo_presion: pres != null ? metodo : null,
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
