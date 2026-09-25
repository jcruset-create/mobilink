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
import { filaDePresencia, type Anterior } from "./filas.ts";
import { decidirEstancia, filaNueva, type EstanciaAbierta } from "./historico.ts";
import { INTERVALO_MIN } from "./cadencia.ts";

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

/**
 * La flota de la empresa, con su delegación asignada.
 *
 * Paginada, porque Supabase devuelve como mucho mil filas por consulta y esta
 * flota ya va por 751: el día que pase de mil, sin paginar, los vehículos de
 * más desaparecerían del barrido sin un solo error. Una flota que se encoge
 * sola es peor que una consulta que falla.
 */
export async function leerFlota(empresaId: string): Promise<VehiculoConBase[]> {
  const out: VehiculoConBase[] = [];
  const TAMANO = 1000;
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await supabase
      .from("tc_vehiculos")
      .select("id, matricula, delegacion_id, activo, webfleet_vehicle_id")
      .eq("empresa_id", empresaId)
      .order("matricula")
      .range(desde, desde + TAMANO - 1);
    if (error) throw new Error(`No se pudo leer la flota: ${error.message}`);
    const pagina = data ?? [];
    for (const f of pagina as any[]) {
      // El vínculo de Webfleet de toda la vida. Se pasa como enlace heredado
      // para que un cliente de Webfleet aparezca en la pantalla sin tener que
      // conciliar su flota otra vez: ese trabajo ya está hecho desde antes de
      // que existiera el Hub, y la sincronización de siempre lo usa cada cinco
      // minutos. Si además hay enlace en el Hub, manda el del Hub.
      const wf = String(f.webfleet_vehicle_id ?? "").trim();
      out.push({
        id: String(f.id),
        matricula: String(f.matricula ?? ""),
        delegacionId: f.delegacion_id ? String(f.delegacion_id) : null,
        activo: f.activo !== false,
        enlaceHeredado: wf ? { connectorKey: "webfleet", externo: wf } : null,
      });
    }
    if (pagina.length < TAMANO) break;
  }
  return out;
}


/**
 * Cuántas filas se escriben por llamada.
 *
 * No es una optimización: es el límite. Un barrido de esta flota son 751
 * filas, y mandarlas de una sola vez deja un cuerpo de cientos de kilobytes
 * que la pasarela puede rechazar sin que nadie lo vea venir.
 */
const LOTE = 500;

export async function guardarPresencia(filas: FilaPresencia[]): Promise<void> {
  if (filas.length === 0) return;

  /*
   * La presencia anterior se lee POR EMPRESA, no por lista de vehículos.
   *
   * La primera versión hacía `.in("vehiculo_id", [...751 uuids])`, y ahí se
   * rompía el barrido entero en producción: eso viaja en la URL, son casi 28
   * KB de query string, y la pasarela de Supabase la rechaza. El error subía,
   * `barrerBases` lo devolvía como nota y la tabla se quedaba vacía —con la
   * pantalla diciendo, con razón, que no se había barrido nunca—. Filtrar por
   * la empresa es una condición corta y devuelve exactamente las mismas filas,
   * porque un barrido es siempre de una sola empresa.
   */
  const empresaId = filas[0].tenantId;
  const anterior = new Map<string, Anterior>();
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await supabase
      .from("tc_vehiculo_presencia_base")
      .select("vehiculo_id, estado, delegacion_id, entrada_base_at")
      .eq("empresa_id", empresaId)
      .range(desde, desde + LOTE - 1);
    if (error) throw new Error(`No se pudo leer la presencia anterior: ${error.message}`);
    const pagina = data ?? [];
    for (const p of pagina) anterior.set(String((p as any).vehiculo_id), p as any);
    // Página incompleta: no hay más. Con `=== LOTE` se pide otra vuelta, que
    // como mucho vendrá vacía.
    if (pagina.length < LOTE) break;
  }

  const ahora = new Date().toISOString();
  const upsert = filas.map((f) => filaDePresencia(f, anterior.get(f.vehiculoId), ahora));

  for (let i = 0; i < upsert.length; i += LOTE) {
    const { error } = await supabase
      .from("tc_vehiculo_presencia_base")
      .upsert(upsert.slice(i, i + LOTE), { onConflict: "vehiculo_id" });
    if (error) throw new Error(`No se pudo guardar la presencia: ${error.message}`);
  }

  // Y el histórico. Aparte y detrás, para que un fallo aquí no se lleve por
  // delante la pantalla del ahora, que es la que alguien está mirando.
  try {
    await guardarHistorico(empresaId, filas, ahora);
  } catch (e: any) {
    console.warn("[presencia-bases] no se pudo guardar el histórico:", e?.message ?? e);
  }
}

/**
 * Anota el barrido en el histórico de estancias.
 *
 * Una fila por ESTANCIA, no por barrido: mientras el vehículo siga en el mismo
 * sitio y en el mismo estado se alarga la abierta. El porqué de cada regla
 * está en `historico.ts` y en la migración.
 *
 * Las lecturas van por empresa y paginadas, igual que la presencia: un `.in()`
 * con 751 identificadores viaja en la URL y la pasarela lo rechaza. Esa lección
 * ya costó un barrido entero en producción.
 */
export async function guardarHistorico(
  empresaId: string,
  filas: FilaPresencia[],
  ahora: string,
): Promise<void> {
  if (filas.length === 0) return;

  const abiertas = new Map<string, EstanciaAbierta>();
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await supabase
      .from("tc_vehiculo_presencia_historico")
      .select("id, vehiculo_id, estado, delegacion_id, visto_at")
      .eq("empresa_id", empresaId)
      .is("hasta", null)
      .range(desde, desde + LOTE - 1);
    if (error) throw new Error(`No se pudo leer el histórico: ${error.message}`);
    const pagina = data ?? [];
    for (const p of pagina) abiertas.set(String((p as any).vehiculo_id), p as any);
    if (pagina.length < LOTE) break;
  }

  const extender: string[] = [];
  const cerrar: string[] = [];
  const abrir: Array<ReturnType<typeof filaNueva>> = [];

  for (const f of filas) {
    const visto = {
      vehiculoId: f.vehiculoId,
      empresaId,
      estado: f.estado,
      delegacionId: f.baseId ?? null,
    };
    const d = decidirEstancia(visto, abiertas.get(f.vehiculoId), ahora, INTERVALO_MIN);
    if (d.accion === "extender") extender.push(d.id);
    else if (d.accion === "abrir") abrir.push(filaNueva(visto, ahora));
    else {
      cerrar.push(d.cerrar);
      abrir.push(filaNueva(visto, ahora));
    }
  }

  // En un barrido normal casi todos siguen donde estaban, así que `extender`
  // trae ~700 identificadores. Van en UNA llamada, no en 700: los arrays de
  // una RPC viajan en el cuerpo, no en la URL, y eso aquí ya importa.
  for (let i = 0; i < cerrar.length; i += LOTE) {
    const { error } = await supabase.rpc("tc_presencia_hist_cerrar", {
      p_ids: cerrar.slice(i, i + LOTE), p_ahora: ahora,
    });
    if (error) throw new Error(`No se pudo cerrar una estancia: ${error.message}`);
  }

  // Cerrar ANTES de abrir: el índice único deja una sola estancia abierta por
  // vehículo, así que abrir primero fallaría. Que la base lo impida es
  // deliberado; ver la migración.
  for (let i = 0; i < abrir.length; i += LOTE) {
    const { error } = await supabase
      .from("tc_vehiculo_presencia_historico")
      .insert(abrir.slice(i, i + LOTE));
    if (error) throw new Error(`No se pudo abrir una estancia: ${error.message}`);
  }

  for (let i = 0; i < extender.length; i += LOTE) {
    const { error } = await supabase.rpc("tc_presencia_hist_extender", {
      p_ids: extender.slice(i, i + LOTE), p_visto_at: ahora,
    });
    if (error) throw new Error(`No se pudo alargar una estancia: ${error.message}`);
  }
}
