/**
 * Resolver una matrícula de Assist contra un vehículo de TyreControl.
 *
 * Es la única puerta de entrada: cualquier consulta a TC empieza aquí, y por
 * eso la regla de comparación vive en un solo sitio.
 *
 * ── Por qué no se coge «el primero» ─────────────────────────────────────────
 *
 * `tc_vehiculos` tiene `unique(empresa_id, matricula)`: la matrícula es única
 * DENTRO de una empresa, no en toda la base. La misma matrícula puede existir
 * en dos empresas de TyreControl y ser dos vehículos distintos.
 *
 * Coger el primero funcionaría casi siempre y fallaría en silencio el día que
 * no —aplicando un trabajo al vehículo de otra empresa—. Así que cuando hay
 * más de uno se dice `AMBIGUOUS` y se devuelven los candidatos, y quien llama
 * decide. Hoy nadie sabe decidirlo automáticamente porque no existe relación
 * entre los clientes de Assist y las empresas de TC (ver §8 del informe).
 */

import { supabase } from "../supabase.ts";
import { coincideMatricula, normalizarMatricula, patronBusquedaMatricula } from "./matricula.ts";
import type { Resolucion, VehiculoTc } from "./types.ts";

export class ErrorTyreControl extends Error {
  constructor(public codigo: string, mensaje: string, public estado = 502) {
    super(mensaje);
  }
}

/** Campos que se leen del vehículo. Lista blanca: TC tiene más y no hacen falta. */
const CAMPOS = "id, empresa_id, matricula, marca, modelo, tipo_vehiculo_id, km_actual, origen_km, activo, updated_at";

function aVehiculo(f: any, empresas: Map<string, string>, tipos: Map<string, string>): VehiculoTc {
  return {
    tcVehicleId: String(f.id),
    empresaId: String(f.empresa_id),
    empresaNombre: empresas.get(String(f.empresa_id)) ?? null,
    matricula: String(f.matricula ?? ""),
    tipoVehiculoId: f.tipo_vehiculo_id == null ? null : String(f.tipo_vehiculo_id),
    tipoVehiculo: f.tipo_vehiculo_id == null ? null : (tipos.get(String(f.tipo_vehiculo_id)) ?? null),
    marca: f.marca ?? null,
    modelo: f.modelo ?? null,
    kmActual: f.km_actual == null ? null : Number(f.km_actual),
    origenKm: f.origen_km ?? null,
    activo: f.activo !== false,
    updatedAt: f.updated_at ?? null,
  };
}

/** Nombres de empresa y tipo, en dos consultas y no una por fila. */
async function etiquetas(filas: any[]): Promise<{ empresas: Map<string, string>; tipos: Map<string, string> }> {
  const idsEmpresa = [...new Set(filas.map((f) => String(f.empresa_id)).filter(Boolean))];
  const idsTipo = [...new Set(filas.map((f) => f.tipo_vehiculo_id).filter(Boolean).map(String))];

  const [emp, tip] = await Promise.all([
    idsEmpresa.length
      ? supabase.from("tc_empresas").select("id, nombre").in("id", idsEmpresa)
      : Promise.resolve({ data: [] as any[] }),
    idsTipo.length
      ? supabase.from("tc_tipos_vehiculo").select("id, nombre").in("id", idsTipo)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return {
    empresas: new Map((emp.data ?? []).map((e: any) => [String(e.id), String(e.nombre ?? "")])),
    tipos: new Map((tip.data ?? []).map((t: any) => [String(t.id), String(t.nombre ?? "")])),
  };
}

export type OpcionesResolucion = {
  /**
   * Empresa de TC con la que desambiguar.
   *
   * Hoy nadie la pasa porque no existe la relación cliente Assist ↔ empresa
   * TC. El parámetro está desde el principio para que, cuando exista, no haya
   * que reescribir nada: entra por aquí y la ambigüedad desaparece.
   */
  empresaId?: string | null;
  /** Incluir vehículos dados de baja. Por defecto no: no se trabaja con ellos. */
  incluirInactivos?: boolean;
};

/**
 * Matrícula → vehículo de TyreControl.
 *
 * Una sola consulta filtrada en el servidor, más dos de etiquetas. No se trae
 * la tabla.
 */
export async function resolverVehiculo(
  matricula: unknown, opciones: OpcionesResolucion = {},
): Promise<Resolucion> {
  const buscada = normalizarMatricula(matricula);
  const patron = patronBusquedaMatricula(buscada);
  if (!patron) return { estado: "NOT_FOUND" };

  let consulta = supabase.from("tc_vehiculos").select(CAMPOS).ilike("matricula", patron);
  if (opciones.empresaId) consulta = consulta.eq("empresa_id", opciones.empresaId);
  if (!opciones.incluirInactivos) consulta = consulta.eq("activo", true);
  // Tope de seguridad, no de negocio: el patrón deja pocas filas. Si alguna vez
  // se llenara, es que el patrón no discrimina y hay que mirarlo, no ampliarlo.
  const { data, error } = await consulta.limit(50);

  if (error) {
    console.error("[TyreControl] error resolviendo matrícula:", error.message);
    throw new ErrorTyreControl("tc_unavailable", "No se ha podido consultar TyreControl");
  }

  // El patrón admite separadores arbitrarios; la igualdad la decide la
  // normalización, no el LIKE.
  const exactos = (data ?? []).filter((f: any) => coincideMatricula(f.matricula, buscada));
  if (exactos.length === 0) return { estado: "NOT_FOUND" };

  const { empresas, tipos } = await etiquetas(exactos);
  const vehiculos = exactos.map((f: any) => aVehiculo(f, empresas, tipos));

  if (vehiculos.length === 1) return { estado: "FOUND", vehiculo: vehiculos[0] };

  console.warn(
    `[TyreControl] matrícula ${buscada} ambigua: ${vehiculos.length} vehículos en ` +
    `${new Set(vehiculos.map((v) => v.empresaId)).size} empresa(s)`,
  );
  return { estado: "AMBIGUOUS", candidatos: vehiculos };
}

/** Un vehículo por su id de TC. Para cuando ya se resolvió antes. */
export async function cargarVehiculo(tcVehicleId: string): Promise<VehiculoTc | null> {
  if (!tcVehicleId) return null;
  const { data, error } = await supabase
    .from("tc_vehiculos").select(CAMPOS).eq("id", tcVehicleId).maybeSingle();
  if (error) {
    console.error("[TyreControl] error cargando vehículo:", error.message);
    throw new ErrorTyreControl("tc_unavailable", "No se ha podido consultar TyreControl");
  }
  if (!data) return null;
  const { empresas, tipos } = await etiquetas([data]);
  return aVehiculo(data, empresas, tipos);
}
