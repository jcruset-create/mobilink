/**
 * Importa el informe del CheckPoint desde el servidor.
 *
 * El panel ya sabe hacerlo (src/modules/tyrecontrol/services/importCheckpoint.ts),
 * pero lo hace en el navegador y con la sesión del usuario. Un proceso
 * automático no tiene sesión de nadie, así que esta es la misma operación
 * escrita contra el cliente de servicio.
 *
 * Lo que NO se repite es el lector del formato: `leerCheckpoint` y
 * `filtrarNuevas` viven en src/ y se importan tal cual. Son código puro, sin
 * navegador ni base de datos, y tienen sus propias pruebas. Duplicar ahí las
 * tres trampas del formato del arco —que es una foto y no un diario, que la
 * columna "Estado" no sirve de filtro y que emite cuatro huecos por eje
 * trasero— sería garantizar que dentro de un año el panel y el servidor
 * importan cosas distintas.
 */
import * as XLSX from "xlsx";
import { supabase } from "../supabase.ts";
import {
  leerCheckpoint, filtrarNuevas, HOJA_DETALLE,
  type FilaCheckpoint, type VehiculoCheckpoint,
} from "../../src/modules/tyrecontrol/services/checkpoint.ts";
import { medidaCanonica } from "../../src/modules/tyrecontrol/services/medidas.ts";

export interface ResultadoCheckpoint {
  mediciones: number;
  revisiones: number;
  altas: string[];
  yaCargados: string[];
  sinMedir: string[];
  avisos: string[];
  empresaId: string | null;
}

// Mismo criterio que el panel: la configuración que dice el arco casada con
// nuestro catálogo de tipos.
const TIPO_POR_EJES: Record<string, string[]> = {
  "2x2": ["furgoneta", "turismo"],
  "2x4": ["autobus", "camion_2_ejes"],
  "2x4x2": ["autocar"],
  "2x4x4": ["autocar_2x4x4", "tractora"],
};

/** Saca las filas de la hoja del arco de un .xlsx en memoria. */
export function filasDelExcel(buf: Buffer): any[] {
  const wb = XLSX.read(buf, { cellDates: true });
  if (!wb.SheetNames.includes(HOJA_DETALLE)) {
    throw new Error(`El fichero no tiene la hoja "${HOJA_DETALLE}": no parece del CheckPoint`);
  }
  // Las cabeceras están en la segunda fila; la primera es el título con la
  // fecha del informe.
  return XLSX.utils.sheet_to_json(wb.Sheets[HOJA_DETALLE], { range: 1, defval: "" }) as any[];
}

export async function importarCheckpoint(filas: any[]): Promise<ResultadoCheckpoint> {
  const lectura = leerCheckpoint(filas);
  const avisos = [...lectura.avisos];

  const { data: vehsRaw, error: eVeh } = await supabase
    .from("tc_vehiculos")
    .select("id, matricula, empresa_id, tipo_vehiculo_id")
    .eq("activo", true);
  if (eVeh) throw new Error("Vehículos: " + eVeh.message);
  const vehs = (vehsRaw ?? []) as { id: string; matricula: string; empresa_id: string; tipo_vehiculo_id: string | null }[];
  const porMatricula = new Map(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v]));

  // Qué es nuevo. El informe es una foto: cada semana repite la última
  // medición de toda la flota, así que solo entra lo medido después de lo que
  // ya tenemos de ese vehículo.
  const ultima = new Map<string, Date | null>();
  const ids = lectura.vehiculos.map((v) => porMatricula.get(v.matricula)?.id).filter(Boolean) as string[];
  const porId = new Map(vehs.map((v) => [v.id, String(v.matricula).trim().toUpperCase()]));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("revisiones_vehiculo")
      .select("vehiculo_id, medido_at").in("vehiculo_id", ids.slice(i, i + 200))
      .not("medido_at", "is", null);
    for (const r of (data ?? []) as any[]) {
      const k = porId.get(r.vehiculo_id);
      if (!k) continue;
      const d = new Date(r.medido_at);
      const prev = ultima.get(k);
      if (!prev || d > prev) ultima.set(k, d);
    }
  }
  const { nuevas, yaEstaban } = filtrarNuevas(lectura.filas, ultima);

  const empresaId = empresaMayoritaria(lectura.vehiculos, porMatricula);

  // Altas de los que el arco conoce y nosotros no, solo si traen medición.
  const conMedicion = new Set(nuevas.map((f) => f.matricula));
  const faltan = lectura.vehiculos.filter((v) => conMedicion.has(v.matricula) && !porMatricula.has(v.matricula));
  const altas: string[] = [];
  if (faltan.length) {
    if (!empresaId) {
      avisos.push(
        `${faltan.length} vehículos del informe no están dados de alta y no sé de qué empresa son. ` +
        `No se han creado.`);
    } else {
      const { data: tipos } = await supabase
        .from("tc_tipos_vehiculo").select("id, nombre, configuracion_ejes").eq("activo", true);
      for (const v of faltan) {
        const tipoId = tipoPara(v, (tipos ?? []) as any[]);
        if (!tipoId) {
          avisos.push(`${v.matricula}: no hay ningún tipo para "${v.tipoCheckpoint}", no se da de alta`);
          continue;
        }
        const { error } = await supabase.from("tc_vehiculos").insert({
          empresa_id: empresaId, matricula: v.matricula, numero_unidad: v.idFlota,
          tipo_vehiculo_id: tipoId, km_actual: 0, origen_km: "manual", activo: true,
        });
        if (error) { avisos.push(`${v.matricula}: no se ha podido dar de alta (${error.message})`); continue; }
        altas.push(v.matricula);
      }
      if (altas.length) {
        const { data: nuevosVeh } = await supabase
          .from("tc_vehiculos").select("id, matricula, empresa_id, tipo_vehiculo_id").in("matricula", altas);
        for (const v of (nuevosVeh ?? []) as any[]) {
          porMatricula.set(String(v.matricula).trim().toUpperCase(), v);
        }
      }
    }
  }

  const { mediciones, revisiones, avisos: avisosCarga } =
    await cargar(nuevas, porMatricula, lectura.vehiculos);

  return {
    mediciones, revisiones, altas,
    yaCargados: yaEstaban,
    sinMedir: lectura.sinMedir,
    avisos: [...avisos, ...avisosCarga],
    empresaId,
  };
}

/** Crea las revisiones y su detalle. Reimportar actualiza, no duplica. */
async function cargar(
  filas: FilaCheckpoint[],
  porMatricula: Map<string, { id: string; empresa_id: string; tipo_vehiculo_id: string | null }>,
  vehiculos: VehiculoCheckpoint[],
): Promise<{ mediciones: number; revisiones: number; avisos: string[] }> {
  const avisos = new Set<string>();
  if (!filas.length) return { mediciones: 0, revisiones: 0, avisos: [] };

  // Posiciones por tipo, una vez.
  const tiposUsados = [...new Set(
    filas.map((f) => porMatricula.get(f.matricula)?.tipo_vehiculo_id).filter(Boolean),
  )] as string[];
  const posPorTipo = new Map<string, any[]>();
  if (tiposUsados.length) {
    const { data } = await supabase.from("tc_posiciones_vehiculo")
      .select("id, tipo_vehiculo_id, codigo_posicion, eje, lado, interior_exterior, orden_visual")
      .in("tipo_vehiculo_id", tiposUsados).eq("activo", true);
    for (const p of (data ?? []) as any[]) {
      if (!posPorTipo.has(p.tipo_vehiculo_id)) posPorTipo.set(p.tipo_vehiculo_id, []);
      posPorTipo.get(p.tipo_vehiculo_id)!.push(p);
    }
    for (const ps of posPorTipo.values()) ps.sort((a, b) => (a.orden_visual ?? 0) - (b.orden_visual ?? 0));
  }

  const medidaPorVeh = new Map(vehiculos.map((v) => [v.matricula, v.medida]));

  // Una revisión por vehículo y fecha.
  interface Grupo { veh: { id: string; empresa_id: string; tipo_vehiculo_id: string | null }; fecha: string; medido: Date; filas: FilaCheckpoint[] }
  const grupos = new Map<string, Grupo>();
  for (const f of filas) {
    const veh = porMatricula.get(f.matricula);
    if (!veh) continue;
    if (!veh.tipo_vehiculo_id || !posPorTipo.get(veh.tipo_vehiculo_id)?.length) {
      avisos.add(`${f.matricula}: su tipo no tiene posiciones, se salta`);
      continue;
    }
    const fecha = iso(f.medidoAt!);
    const k = `${veh.id}|${fecha}`;
    if (!grupos.has(k)) grupos.set(k, { veh, fecha, medido: f.medidoAt!, filas: [] });
    const g = grupos.get(k)!;
    if (f.medidoAt! > g.medido) g.medido = f.medidoAt!;
    g.filas.push(f);
  }
  if (!grupos.size) return { mediciones: 0, revisiones: 0, avisos: [...avisos] };

  // Las revisiones que ya existen para esos vehículos y fechas.
  const vehIds = [...new Set([...grupos.values()].map((g) => g.veh.id))];
  const mapRev = new Map<string, string>();
  for (let i = 0; i < vehIds.length; i += 200) {
    const { data } = await supabase.from("revisiones_vehiculo")
      .select("id, vehiculo_id, fecha_revision").in("vehiculo_id", vehIds.slice(i, i + 200));
    for (const r of (data ?? []) as any[]) {
      mapRev.set(`${r.vehiculo_id}|${String(r.fecha_revision).slice(0, 10)}`, r.id);
    }
  }

  const porCrear = [...grupos.values()].filter((g) => !mapRev.has(`${g.veh.id}|${g.fecha}`));
  for (let i = 0; i < porCrear.length; i += 200) {
    const parte = porCrear.slice(i, i + 200).map((g) => ({
      empresa_id: g.veh.empresa_id, vehiculo_id: g.veh.id, fecha_revision: g.fecha,
      estado_revision: "completada", medido_at: g.medido.toISOString(),
    }));
    const { data, error } = await supabase.from("revisiones_vehiculo")
      .insert(parte).select("id, vehiculo_id, fecha_revision");
    if (error) throw new Error("Revisiones: " + error.message);
    for (const r of (data ?? []) as any[]) {
      mapRev.set(`${r.vehiculo_id}|${String(r.fecha_revision).slice(0, 10)}`, r.id);
    }
  }

  // Montajes existentes, para colgar cada medición de su neumático si lo hay.
  const mapMontaje = new Map<string, string>();
  for (let i = 0; i < vehIds.length; i += 200) {
    const { data } = await supabase.from("tc_montajes_actuales")
      .select("vehiculo_id, posicion_id, neumatico_id").in("vehiculo_id", vehIds.slice(i, i + 200));
    for (const m of (data ?? []) as any[]) mapMontaje.set(`${m.vehiculo_id}|${m.posicion_id}`, m.neumatico_id);
  }

  const detalles: any[] = [];
  for (const g of grupos.values()) {
    const revId = mapRev.get(`${g.veh.id}|${g.fecha}`);
    if (!revId) continue;
    const ps = posPorTipo.get(g.veh.tipo_vehiculo_id!)!;
    for (const f of g.filas) {
      // Por código y, si el tipo usa otra nomenclatura, por las señas de la
      // rueda: eje, lado e interior/exterior. Los tipos sembrados en la Fase 3
      // llaman DEL_IZQ a lo que aquí es E1_IZQ.
      const p = ps.find((x) => String(x.codigo_posicion).toUpperCase() === f.codigoPosicion)
        ?? ps.find((x) => x.eje === f.eje && String(x.lado ?? "") === f.lado
              && (x.interior_exterior ?? null) === f.interiorExterior);
      if (!p) { avisos.add(`${f.matricula}: su tipo no tiene la posición ${f.codigoPosicion}`); continue; }
      detalles.push({
        revision_id: revId, empresa_id: g.veh.empresa_id, vehiculo_id: g.veh.id, posicion_id: p.id,
        neumatico_id: mapMontaje.get(`${g.veh.id}|${p.id}`) ?? null,
        profundidad_mm: f.profundidadMm, presion_bar: f.presionBar,
        metodo_profundidad: f.profundidadMm != null ? "checkpoint" : null,
        metodo_presion: f.presionBar != null ? "checkpoint" : null,
        medida: medidaCanonica(medidaPorVeh.get(f.matricula) ?? "") || null,
        no_accesible: false, neumatico_ausente: false,
      });
    }
  }

  for (let i = 0; i < detalles.length; i += 400) {
    const { error } = await supabase.from("revisiones_neumaticos_detalle")
      .upsert(detalles.slice(i, i + 400), { onConflict: "revision_id,posicion_id" });
    if (error) throw new Error("Detalle de revisión: " + error.message);
  }

  return { mediciones: detalles.length, revisiones: porCrear.length, avisos: [...avisos] };
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function empresaMayoritaria(
  vehiculos: VehiculoCheckpoint[],
  porMatricula: Map<string, { empresa_id: string }>,
): string | null {
  const cuenta = new Map<string, number>();
  for (const v of vehiculos) {
    const e = porMatricula.get(v.matricula)?.empresa_id;
    if (e) cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
  }
  let mejor: string | null = null; let n = 0;
  for (const [e, c] of cuenta) if (c > n) { mejor = e; n = c; }
  return mejor;
}

function tipoPara(
  v: VehiculoCheckpoint,
  tipos: { id: string; nombre: string; configuracion_ejes?: string | null }[],
): string | null {
  const cfg = v.ejes.join("x");
  if (!cfg) return null;
  const porCfg = tipos.find((t) => (t.configuracion_ejes ?? "").toLowerCase() === cfg);
  if (porCfg) return porCfg.id;
  for (const nombre of TIPO_POR_EJES[cfg] ?? []) {
    const t = tipos.find((x) => x.nombre === nombre);
    if (t) return t.id;
  }
  return null;
}
