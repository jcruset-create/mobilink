/**
 * Las bases y la flota de TyreControl, vistas por el barrido de presencia.
 *
 * Son los adaptadores de los puertos de `BasePresenceService`. Viven aquí, y no
 * dentro del Hub, por lo mismo que `conciliacion/flota.ts`: el Hub no conoce
 * `tc_delegaciones` ni `tc_vehiculos` y no debe empezar a conocerlos.
 *
 * ── Las geo-zonas se reutilizan, no se duplican ─────────────────────────────
 *
 * El centro y el radio de cada base están en `tc_delegaciones.base_lat`,
 * `base_lng` y `base_radio_m`. Nacieron en la fase 0 de Webfleet llamándose
 * `webfleet_*` y se renombraron cuando dejó de ser cosa de un solo proveedor
 * (`tyrecontrol_bases_geozona_renombrado.sql`): el dato no es de Webfleet, es
 * de la base. Aquí se traducen al modelo del Hub (`GeoZonaBase`), que es el
 * único que conoce el dominio.
 */

import { supabase } from "../../supabase.ts";
import type {
  FilaPresencia,
  VehiculoConBase,
} from "../../integration-hub/application/services/BasePresenceService.ts";
import type { GeoZonaBase } from "../../integration-hub/domain/presencia.ts";

/**
 * Las bases de la empresa: delegaciones CON geo-zona definida.
 *
 * Una delegación sin coordenadas no es una base: es una oficina. Se filtra por
 * `base_lat` no nulo, igual que hace la sincronización Webfleet, para que
 * las dos pantallas consideren base a lo mismo.
 */
export async function leerBases(empresaId: string): Promise<GeoZonaBase[]> {
  const { data, error } = await supabase
    .from("tc_delegaciones")
    .select("id, empresa_id, nombre, base_lat, base_lng, base_radio_m")
    .eq("empresa_id", empresaId)
    .not("base_lat", "is", null)
    .not("base_lng", "is", null);
  if (error) throw new Error(`No se pudieron leer las bases: ${error.message}`);

  return (data ?? [])
    .map((f: any) => ({
      id: String(f.id),
      nombre: String(f.nombre ?? ""),
      empresaId: String(f.empresa_id),
      lat: Number(f.base_lat),
      lng: Number(f.base_lng),
      radioM: f.base_radio_m == null ? null : Number(f.base_radio_m),
    }))
    // Una coordenada que no es número se descarta aquí y no más adelante: una
    // base en `NaN` haría que el haversine devolviera `NaN`, que no es mayor
    // ni menor que el radio, y el vehículo saldría silenciosamente fuera.
    .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
}

/** La flota de la empresa, con su delegación asignada. */
export async function leerFlota(empresaId: string): Promise<VehiculoConBase[]> {
  const { data, error } = await supabase
    .from("tc_vehiculos")
    .select("id, matricula, delegacion_id, activo")
    .eq("empresa_id", empresaId)
    .order("matricula");
  if (error) throw new Error(`No se pudo leer la flota: ${error.message}`);

  return (data ?? []).map((f: any) => ({
    id: String(f.id),
    matricula: String(f.matricula ?? ""),
    delegacionId: f.delegacion_id ? String(f.delegacion_id) : null,
    activo: f.activo !== false,
  }));
}

/** Lo que hacía falta saber de la fila anterior para no perder la estancia. */
interface Anterior {
  estado: string;
  delegacion_id: string | null;
  entrada_base_at: string | null;
}

/**
 * Guarda el resultado del barrido.
 *
 * ── `entrada_base_at`: desde cuándo lleva ahí ───────────────────────────────
 *
 * Se conserva mientras el vehículo siga en la MISMA base. Es lo que contesta
 * «¿cuánto lleva parado aquí?», y es el dato que necesita el arco del
 * CheckPoint: si el autobús entró antes de la medición y no se ha ido, el
 * odómetro de ahora vale para entonces.
 *
 * `STALE_POSITION` dentro de una base cuenta como seguir en la misma estancia:
 * un equipo que se duerme al aparcar es lo normal en esta flota, y reiniciar la
 * entrada cada vez que se calla convertiría «lleva tres días en la base» en
 * «acaba de llegar», que es justo lo contrario de la verdad.
 *
 * Lo que no se hace es inventar el instante: si no hay posición fechada,
 * `entrada_base_at` se queda nula en vez de apuntar la hora del barrido, que
 * sería la hora de la consulta y no la de la llegada.
 */
export async function guardarPresencia(filas: FilaPresencia[]): Promise<void> {
  if (filas.length === 0) return;

  const { data: previos, error: errPrev } = await supabase
    .from("tc_vehiculo_presencia_base")
    .select("vehiculo_id, estado, delegacion_id, entrada_base_at")
    .in(
      "vehiculo_id",
      filas.map((f) => f.vehiculoId),
    );
  if (errPrev) throw new Error(`No se pudo leer la presencia anterior: ${errPrev.message}`);

  const anterior = new Map<string, Anterior>();
  for (const p of previos ?? []) anterior.set(String((p as any).vehiculo_id), p as any);

  const ahora = new Date().toISOString();
  const upsert = filas.map((f) => {
    const prev = anterior.get(f.vehiculoId);
    const mismaEstancia =
      !!f.baseId &&
      !!prev &&
      prev.delegacion_id === f.baseId &&
      (prev.estado === "IN_BASE" || prev.estado === "STALE_POSITION");
    const posicionAt = f.posicionAt ? f.posicionAt.toISOString() : null;

    return {
      vehiculo_id: f.vehiculoId,
      empresa_id: f.tenantId,
      estado: f.estado,
      delegacion_id: f.baseId ?? null,
      es_su_base: f.baseId ? f.esSuBase === true : null,
      distancia_m: f.distanciaM == null ? null : Math.round(f.distanciaM),
      antiguedad_min: f.antiguedadMin ?? null,
      lat: f.lat ?? null,
      lng: f.lng ?? null,
      velocidad_kmh: f.velocidadKmh ?? null,
      posicion_at: posicionAt,
      entrada_base_at: !f.baseId
        ? null
        : mismaEstancia
          ? (prev?.entrada_base_at ?? posicionAt)
          : posicionAt,
      proveedor: f.proveedor || null,
      cuenta: f.cuenta || null,
      externo: f.externo,
      motivo: f.motivo ?? null,
      calculado_at: f.calculadoAt.toISOString(),
      updated_at: ahora,
    };
  });

  const { error } = await supabase
    .from("tc_vehiculo_presencia_base")
    .upsert(upsert, { onConflict: "vehiculo_id" });
  if (error) throw new Error(`No se pudo guardar la presencia: ${error.message}`);
}
