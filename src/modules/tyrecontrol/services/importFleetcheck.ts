/**
 * Importa (o simula) un «Fleetcheck Report» de TIRETASK.
 *
 * El trabajo de verdad lo hace `importRevisiones`, el mismo motor del Excel y
 * del CheckPoint. Aquí se decide CÓMO se le pide, que para un informe de un
 * tercero es más estrecho que para lo nuestro:
 *
 *  - Solo se mide lo que ya está montado en TyreControl. El informe dice qué
 *    profundidad tiene la rueda de una posición; no es quién para crear
 *    neumáticos ni montajes. Lo que no tenga neumático se devuelve en una
 *    lista, sin importar.
 *  - Si el vehículo ya tiene una revisión ese día, no se toca.
 *  - Los kilómetros NO se cogen del informe (los trae uno de cada cinco, a
 *    mano): la revisión nace sin ellos y el relleno diario se los pide a la
 *    telemática, como a las del CheckPoint. El del informe se deja apuntado
 *    en la nota de la revisión, para poder compararlo.
 */
import { listarVehiculos } from "./data";
import {
  filasDeFleetcheck, medidaDeNeumatico, type LecturaFleetcheck,
} from "./fleetcheck";
import { importRevisiones, type ReporteRev } from "./importRevisiones";
import { medidaCanonica } from "./medidas";
import { supabase } from "./supabase";

export interface ReporteFleetcheck {
  rev: ReporteRev;
  vehiculos: number;
  mediciones: number;
  /** Ruedas cuya medida en el informe no es la del neumático que tenemos montado. */
  medidasDistintas: string[];
  avisos: string[];
}

/** El servidor: el mismo origen en producción, el puerto del back en local. */
const API = import.meta.env.PROD ? "" : "http://localhost:4000";

export const ORIGEN_FLEETCHECK = "Importada del Fleetcheck Report de TIRETASK";

/** Manda el PDF al servidor, que es quien sabe abrirlo, y devuelve su lectura. */
export async function leerFleetcheckPdf(file: File): Promise<LecturaFleetcheck> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Sesión no válida");
  const cuerpo = new FormData();
  cuerpo.append("archivo", file);
  const r = await fetch(`${API}/api/tyrecontrol/fleetcheck/leer`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: cuerpo,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || "No se ha podido leer el PDF");
  return j as LecturaFleetcheck;
}

/**
 * Qué ruedas del informe no llevan la medida que tenemos montada.
 *
 * No impide importar: la profundidad se guarda igual. Pero una medida distinta
 * quiere decir que el neumático de esa posición no es el que TyreControl cree,
 * y eso alguien tiene que mirarlo.
 */
async function compararMedidas(lectura: LecturaFleetcheck): Promise<string[]> {
  const vehs = await listarVehiculos();
  const porMatricula = new Map(vehs.map((v) => [String(v.matricula).trim().toUpperCase(), v.id]));
  const ids = lectura.vehiculos.map((v) => porMatricula.get(v.matricula)).filter(Boolean) as string[];
  if (!ids.length) return [];

  type Montaje = {
    vehiculo_id: string;
    posicion: { eje: number | null; lado: string | null; interior_exterior: string | null } | null;
    neumatico: { medida: string | null } | null;
  };
  const montados = new Map<string, string>(); // vehiculo|eje|lado|io -> medida
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("tc_montajes_actuales")
      .select("vehiculo_id, posicion:tc_posiciones_vehiculo(eje, lado, interior_exterior), neumatico:tc_neumaticos(medida)")
      .in("vehiculo_id", ids.slice(i, i + 100));
    if (error) throw new Error("Montajes: " + error.message);
    for (const m of (data ?? []) as unknown as Montaje[]) {
      if (!m.posicion || !m.neumatico?.medida) continue;
      montados.set(`${m.vehiculo_id}|${m.posicion.eje}|${m.posicion.lado}|${m.posicion.interior_exterior ?? ""}`, m.neumatico.medida);
    }
  }

  const distintas: string[] = [];
  for (const v of lectura.vehiculos) {
    const id = porMatricula.get(v.matricula);
    if (!id) continue;
    const dobles = new Set(v.ruedas.filter((r) => r.dentroFuera === "int").map((r) => r.eje));
    for (const r of v.ruedas) {
      const delInforme = medidaDeNeumatico(r.neumatico);
      const nuestra = montados.get(`${id}|${r.eje}|${r.lado}|${dobles.has(r.eje) ? r.dentroFuera : ""}`);
      if (!delInforme || !nuestra) continue;
      if (medidaCanonica(delInforme) !== medidaCanonica(nuestra)) {
        distintas.push(`${v.matricula} ${r.posicion}: el informe dice ${delInforme} y tenemos montado ${nuestra}`);
      }
    }
  }
  return distintas;
}

export async function importFleetcheck(
  lectura: LecturaFleetcheck, fecha: string, ejecutar: boolean,
): Promise<ReporteFleetcheck> {
  const filas = filasDeFleetcheck(lectura, fecha);
  const conPresion = filas.some((f) => f.presion_bar != null);
  const notaPorMatricula = new Map(
    lectura.vehiculos.filter((v) => v.km != null)
      .map((v) => [v.matricula, `Km apuntados en el informe: ${v.km!.toLocaleString("es-ES")}`]),
  );

  const rev = await importRevisiones(filas, ejecutar, {
    origen: "importacion_excel",
    soloMontados: true,
    respetarExistentes: true,
    tipoRevision: conPresion ? "profundidades_presiones" : "solo_profundidades",
    observaciones: ORIGEN_FLEETCHECK,
    notaPorMatricula,
  });

  // La comparación de medidas es informativa: si falla, la importación no.
  const medidasDistintas = await compararMedidas(lectura).catch(() => [] as string[]);

  return {
    rev,
    vehiculos: lectura.vehiculos.length,
    mediciones: filas.length,
    medidasDistintas,
    avisos: [...lectura.avisos, ...rev.avisos],
  };
}
