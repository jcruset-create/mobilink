/**
 * La flota de TyreControl, vista por la conciliación.
 *
 * Es el adaptador del puerto `LectorFlotaInterna` del Telematics Hub. Existe
 * aquí, y no dentro del Hub, porque el Hub no conoce `tc_vehiculos` y no debe
 * empezar a conocerlo: hoy no importa Supabase en ninguna parte, y mantenerlo
 * así es lo que permite probar toda la lógica de conciliación sin base de datos.
 *
 * Se leen los vehículos ACTIVOS E INACTIVOS a propósito. Un vehículo dado de
 * baja que vuelve a aparecer en el proveedor es información —alguien lo dio de
 * baja por error, o ha vuelto al servicio—, y esconderlo lo convertiría en un
 * «solo en el proveedor» que invitaría a crearlo otra vez, duplicándolo.
 */

import { supabase } from "../../supabase.ts";
import type { VehiculoInterno } from "../../integration-hub/domain/reconciliation.ts";

/** Lista blanca: `tc_vehiculos` tiene muchas más columnas y no hacen falta. */
const CAMPOS = "id, matricula, numero_unidad, bastidor, marca, modelo, activo";

/**
 * Cuántos neumáticos lleva montados cada vehículo de la empresa.
 *
 * Se cuenta aquí porque es el dato que se enseña justo al lado del botón de
 * dar de baja: la baja NO desmonta nada, y quien la pulse tiene que saber
 * cuántas gomas se quedan vigentes en un vehículo que va a dejar de verse en
 * la tablet.
 *
 * Se agrupa en memoria en vez de con un `group by` porque el cliente de
 * Supabase no lo expone, y una flota son miles de filas como mucho.
 */
async function neumaticosPorVehiculo(empresaId: string): Promise<Map<string, number>> {
  const cuenta = new Map<string, number>();
  const TAMANO = 1000;
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await supabase
      .from("tc_montajes_actuales")
      .select("vehiculo_id")
      .eq("empresa_id", empresaId)
      .range(desde, desde + TAMANO - 1);
    if (error) throw new Error(`No se pudieron contar los montajes: ${error.message}`);
    const filas = data ?? [];
    for (const f of filas) {
      const id = String((f as any).vehiculo_id ?? "");
      if (id) cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
    }
    // Página incompleta: no hay más. Con `filas.length === TAMANO` se pide otra
    // vuelta, que como mucho vendrá vacía.
    if (filas.length < TAMANO) break;
  }
  return cuenta;
}

/** Los vehículos de una empresa de TyreControl, con sus montajes contados. */
export async function leerFlotaInterna(empresaId: string): Promise<VehiculoInterno[]> {
  const [{ data, error }, montajes] = await Promise.all([
    supabase.from("tc_vehiculos").select(CAMPOS).eq("empresa_id", empresaId).order("matricula"),
    neumaticosPorVehiculo(empresaId),
  ]);
  if (error) throw new Error(`No se pudo leer la flota: ${error.message}`);

  return (data ?? []).map((f: any) => ({
    id: String(f.id),
    matricula: String(f.matricula ?? ""),
    numeroUnidad: f.numero_unidad ?? null,
    bastidor: f.bastidor ?? null,
    marca: f.marca ?? null,
    modelo: f.modelo ?? null,
    activo: f.activo !== false,
    neumaticosMontados: montajes.get(String(f.id)) ?? 0,
  }));
}

/**
 * ¿Es este vehículo de esta empresa?
 *
 * La comprobación que impide que un vehículo externo de la empresa A acabe
 * enlazado con un `tc_vehiculos` de la empresa B. Va contra la base, no contra
 * lo que diga quien llama, y devuelve el vehículo para no tener que releerlo.
 */
export async function vehiculoDeLaEmpresa(
  vehiculoId: string,
  empresaId: string,
): Promise<{ id: string; matricula: string; activo: boolean } | null> {
  const { data, error } = await supabase
    .from("tc_vehiculos")
    .select("id, matricula, activo, empresa_id")
    .eq("id", vehiculoId)
    .maybeSingle();
  if (error || !data) return null;
  if (String((data as any).empresa_id) !== empresaId) return null;
  return {
    id: String((data as any).id),
    matricula: String((data as any).matricula ?? ""),
    activo: (data as any).activo !== false,
  };
}
