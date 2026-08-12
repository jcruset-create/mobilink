import { supabase } from "./supabase";
import { listarVehiculos, listarTiposVehiculo, crearVehiculo } from "./data";
import { importRevisiones, type ReporteRev } from "./importRevisiones";
import { leerCheckpoint, filtrarNuevas, type VehiculoCheckpoint } from "./checkpoint";
import { medidaCanonica } from "./medidas";
import type { VehiculoInput } from "../types";

export interface ReporteCheckpoint {
  rev: ReporteRev;
  /** Vehículos del informe que no estaban y se han dado de alta. */
  altas: string[];
  /** Los que no han cruzado el arco todavía. */
  sinMedir: string[];
  /** Los que traen la misma medición que ya teníamos: se saltan. */
  yaCargados: string[];
  /** Cuántas ruedas se van a cargar de verdad. */
  mediciones: number;
  avisos: string[];
}

// El nombre del tipo del CheckPoint dice la configuración; la nuestra la dice
// el catálogo. Se casan por ahí: "2x4x2" es nuestro Autocar.
const TIPO_POR_EJES: Record<string, string[]> = {
  "2x2": ["furgoneta", "turismo"],
  "2x4": ["autobus", "camion_2_ejes"],
  "2x4x2": ["autocar"],
  "2x4x4": ["autocar_2x4x4", "tractora"],
};

/**
 * Importa (o simula) el informe semanal del CheckPoint.
 *
 * `filas` es la hoja "Neumáticos Detalle" leída con las cabeceras de su
 * segunda fila. Todo el trabajo de verdad —buscar el vehículo, resolver las
 * posiciones, crear el neumático genérico que falte y no duplicar la
 * revisión— lo hace importRevisiones, que es el que ya está rodado; aquí solo
 * se traduce el formato y se decide qué es nuevo.
 */
export async function importCheckpoint(filas: any[], ejecutar: boolean): Promise<ReporteCheckpoint> {
  const lectura = leerCheckpoint(filas);
  const avisos = [...lectura.avisos];

  // Qué es nuevo: se compara con la última medición guardada de cada
  // vehículo. El informe es una foto y cada semana repite casi toda la flota.
  const vehs = await listarVehiculos();
  const porMatricula = new Map(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v]));
  const ids = lectura.vehiculos
    .map((v) => porMatricula.get(v.matricula)?.id)
    .filter(Boolean) as string[];

  const ultima = new Map<string, Date | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("revisiones_vehiculo")
      .select("vehiculo_id, medido_at").in("vehiculo_id", ids.slice(i, i + 200))
      .not("medido_at", "is", null);
    for (const r of (data ?? []) as any[]) {
      const v = vehs.find((x) => x.id === r.vehiculo_id);
      if (!v) continue;
      const k = String(v.matricula).trim().toUpperCase();
      const d = new Date(r.medido_at);
      const p = ultima.get(k);
      if (!p || d > p) ultima.set(k, d);
    }
  }

  const { nuevas, yaEstaban } = filtrarNuevas(lectura.filas, ultima);

  // Altas: los que el arco conoce y nosotros no. Solo los que traen medición;
  // dar de alta un vehículo del que no se sabe nada no aporta.
  const conMedicion = new Set(nuevas.map((f) => f.matricula));
  const faltan = lectura.vehiculos.filter((v) => conMedicion.has(v.matricula) && !porMatricula.has(v.matricula));
  const altas: string[] = [];
  if (faltan.length) {
    const empresaId = empresaMayoritaria(lectura.vehiculos, porMatricula);
    if (!empresaId) {
      avisos.push(
        `${faltan.length} vehículos del informe no están dados de alta y no sé de qué empresa son ` +
        `(ninguno de los del fichero existe todavía). Impórtalos antes con la plantilla de Vehículos.`);
    } else {
      const tipos = await listarTiposVehiculo();
      for (const v of faltan) {
        const tipoId = tipoPara(v, tipos);
        if (!tipoId) {
          avisos.push(`${v.matricula}: no hay ningún tipo de vehículo para "${v.tipoCheckpoint}", no se da de alta`);
          continue;
        }
        altas.push(v.matricula);
        if (!ejecutar) continue;
        const input: Partial<VehiculoInput> = {
          empresa_id: empresaId,
          matricula: v.matricula,
          numero_unidad: v.idFlota,
          tipo_vehiculo_id: tipoId,
          // El arco no lee kilómetros: no hay km que apuntar ni origen que
          // presumir. Los pondrá un técnico o la plataforma de telemática.
          km_actual: 0,
          origen_km: "manual",
          activo: true,
        };
        await crearVehiculo(input as VehiculoInput);
      }
    }
  }

  // Del formato del arco al de la plantilla de revisiones. La posición va por
  // código y no por número: el código no depende de en qué orden tenga el
  // tipo sus posiciones.
  const porMedida = new Map(lectura.vehiculos.map((v) => [v.matricula, v.medida]));
  const rows = nuevas
    .filter((f) => !altas.length || ejecutar || porMatricula.has(f.matricula))
    .map((f) => ({
      matricula: f.matricula,
      fecha_revision: f.medidoAt,
      codigo_posicion: f.codigoPosicion,
      // Las señas de la posición, por si el tipo la llama de otra manera.
      _eje: f.eje, _lado: f.lado, _io: f.interiorExterior,
      profundidad_mm: f.profundidadMm,
      presion_bar: f.presionBar,
      medida: medidaCanonica(porMedida.get(f.matricula) ?? "") || null,
      _medidoAt: f.medidoAt,
    }));

  const rev = await importRevisiones(rows, ejecutar, { origen: "checkpoint" });

  return {
    rev,
    altas,
    sinMedir: lectura.sinMedir,
    yaCargados: yaEstaban,
    mediciones: rows.length,
    avisos: [...avisos, ...rev.avisos],
  };
}

/** La empresa de los vehículos del informe que sí conocemos. */
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

/** El tipo de nuestro catálogo que case con la configuración del arco. */
function tipoPara(v: VehiculoCheckpoint, tipos: { id: string; nombre: string; configuracion_ejes?: string | null }[]): string | null {
  const cfg = v.ejes.join("x");
  if (!cfg) return null;
  // Primero por configuración declarada, que es lo exacto.
  const porCfg = tipos.find((t) => (t.configuracion_ejes ?? "").toLowerCase() === cfg);
  if (porCfg) return porCfg.id;
  for (const nombre of TIPO_POR_EJES[cfg] ?? []) {
    const t = tipos.find((x) => x.nombre === nombre);
    if (t) return t.id;
  }
  return null;
}
