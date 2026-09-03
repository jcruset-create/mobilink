/**
 * Estado técnico de un vehículo en TyreControl, tal como lo necesita Assist.
 *
 * ── Cuántas consultas ───────────────────────────────────────────────────────
 *
 * Seis, fijas, sea el vehículo un turismo de 4 ruedas o un semirremolque de
 * 12: ejes, posiciones del tipo, montajes actuales, neumáticos montados,
 * última revisión y su detalle. **Ninguna por rueda.** Un N+1 aquí se notaría
 * justo cuando más molesta, con un camión de doce posiciones y el técnico
 * esperando.
 *
 * Índices que se aprovechan: `idx_tc_posiciones_tipo` (posiciones por tipo) y
 * las claves únicas de `tc_montajes_actuales` —`unique(vehiculo_id,
 * posicion_id)`—. Lo demás va por clave primaria o por `in (...)`.
 *
 * ── Lo que NO se hace ───────────────────────────────────────────────────────
 *
 * No se cachea. TyreControl cambia por su cuenta —alguien mueve una rueda
 * desde su app— y un estado técnico de hace cinco minutos presentado como
 * actual es peor que tardar 300 ms.
 */

import { supabase } from "../supabase.ts";
import { ErrorTyreControl, cargarVehiculo } from "./vehiculos.ts";
import type {
  EjeTc, EstadoVehiculoTc, NeumaticoTc, PosicionTc, RevisionPosicionTc, VehiculoTc,
} from "./types.ts";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fallo(que: string, error: { message: string } | null): void {
  if (!error) return;
  console.error(`[TyreControl] error leyendo ${que}:`, error.message);
  throw new ErrorTyreControl("tc_unavailable", "No se ha podido consultar TyreControl");
}

export async function estadoDeVehiculo(entrada: VehiculoTc | string): Promise<EstadoVehiculoTc | null> {
  const vehiculo = typeof entrada === "string" ? await cargarVehiculo(entrada) : entrada;
  if (!vehiculo) return null;

  /*
   * Las posiciones cuelgan del TIPO de vehículo, no del vehículo. Sin tipo no
   * hay plano de ruedas que pintar, y eso no es un error: es un vehículo que
   * en TC está sin configurar. Se devuelve el vehículo con la lista vacía para
   * que la pantalla pueda decirlo.
   */
  const [ejesR, posicionesR, montajesR] = await Promise.all([
    supabase.from("tc_vehiculo_ejes")
      .select("eje, ruedas, medida_id, tipo_llanta_id")
      .eq("vehiculo_id", vehiculo.tcVehicleId).order("eje"),
    vehiculo.tipoVehiculoId
      ? supabase.from("tc_posiciones_vehiculo")
          .select("id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual, activo")
          .eq("tipo_vehiculo_id", vehiculo.tipoVehiculoId).order("orden_visual")
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase.from("tc_montajes_actuales")
      .select("id, neumatico_id, posicion_id, fecha_montaje, km_montaje")
      .eq("vehiculo_id", vehiculo.tcVehicleId),
  ]);
  fallo("ejes", ejesR.error as any);
  fallo("posiciones", posicionesR.error as any);
  fallo("montajes", montajesR.error as any);

  const montajes = montajesR.data ?? [];
  const idsNeumatico = montajes.map((m: any) => String(m.neumatico_id)).filter(Boolean);

  /* Medidas de los ejes y neumáticos montados: dos consultas, no una por rueda. */
  const idsMedida = [...new Set((ejesR.data ?? []).map((e: any) => e.medida_id).filter(Boolean).map(String))];
  const [neumaticosR, medidasR] = await Promise.all([
    idsNeumatico.length
      ? supabase.from("tc_neumaticos")
          .select("id, marca, modelo, medida, dot, numero_serie, rfid_epc, estado, " +
                  "profundidad_actual_mm, reesculturado, girado_en_llanta")
          .in("id", idsNeumatico)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsMedida.length
      ? supabase.from("tc_cat_medidas_neumatico").select("id, nombre").in("id", idsMedida)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  fallo("neumáticos", neumaticosR.error as any);

  const porNeumatico = new Map<string, NeumaticoTc>(
    (neumaticosR.data ?? []).map((n: any) => [String(n.id), {
      neumaticoId: String(n.id),
      marca: n.marca ?? null,
      modelo: n.modelo ?? null,
      medida: n.medida ?? null,
      dot: n.dot ?? null,
      numeroSerie: n.numero_serie ?? null,
      rfid: n.rfid_epc ?? null,
      estado: String(n.estado ?? ""),
      profundidadActualMm: num(n.profundidad_actual_mm),
      reesculturado: n.reesculturado ?? null,
      giradoEnLlanta: n.girado_en_llanta ?? null,
    }]),
  );
  const nombreMedida = new Map<string, string>(
    (medidasR.data ?? []).map((m: any) => [String(m.id), String(m.nombre ?? "")]),
  );

  /*
   * La última revisión terminada, y solo ésa. Un borrador es lo que alguien
   * está rellenando ahora mismo: enseñarlo como estado del vehículo daría
   * datos a medio medir.
   */
  const revisionR = await supabase.from("revisiones_vehiculo")
    .select("id, fecha_revision, km_vehiculo")
    .eq("vehiculo_id", vehiculo.tcVehicleId)
    .in("estado_revision", ["completada", "enviada"])
    .order("fecha_revision", { ascending: false })
    .limit(1);
  fallo("revisiones", revisionR.error as any);
  const revision = revisionR.data?.[0] ?? null;

  const detalleR = revision
    ? await supabase.from("revisiones_neumaticos_detalle")
        .select("posicion_id, profundidad_mm, presion_bar, estado_visual, alerta_generada, " +
                "no_accesible, neumatico_ausente, foto_url")
        .eq("revision_id", revision.id)
    : { data: [] as any[], error: null };
  fallo("detalle de revisión", (detalleR as any).error);

  const porPosicionRevision = new Map<string, RevisionPosicionTc>(
    ((detalleR as any).data ?? []).map((d: any) => [String(d.posicion_id), {
      fecha: revision?.fecha_revision ?? null,
      profundidadMm: num(d.profundidad_mm),
      ultimaPresionBar: num(d.presion_bar),
      estadoVisual: d.estado_visual ?? null,
      alertaGenerada: d.alerta_generada === true,
      noAccesible: d.no_accesible === true,
      neumaticoAusente: d.neumatico_ausente === true,
      fotoUrl: d.foto_url ?? null,
    }]),
  );

  const porPosicionMontaje = new Map<string, any>(
    montajes.map((m: any) => [String(m.posicion_id), m]),
  );

  const posiciones: PosicionTc[] = (posicionesR.data ?? [])
    .filter((p: any) => p.activo !== false)
    .map((p: any) => {
      const montaje = porPosicionMontaje.get(String(p.id)) ?? null;
      return {
        posicionId: String(p.id),
        codigoPosicion: String(p.codigo_posicion ?? ""),
        nombre: p.nombre ?? null,
        eje: p.eje == null ? null : Number(p.eje),
        lado: p.lado ?? null,
        interiorExterior: p.interior_exterior ?? null,
        ordenVisual: Number(p.orden_visual ?? 0),
        montajeActualId: montaje ? String(montaje.id) : null,
        neumatico: montaje ? (porNeumatico.get(String(montaje.neumatico_id)) ?? null) : null,
        fechaMontaje: montaje?.fecha_montaje ?? null,
        kmMontaje: montaje ? num(montaje.km_montaje) : null,
        ultimaRevision: porPosicionRevision.get(String(p.id)) ?? null,
      };
    });

  const ejes: EjeTc[] = (ejesR.data ?? []).map((e: any) => ({
    eje: Number(e.eje),
    ruedas: num(e.ruedas),
    medida: e.medida_id ? (nombreMedida.get(String(e.medida_id)) ?? null) : null,
    tipoLlanta: e.tipo_llanta_id ? String(e.tipo_llanta_id) : null,
  }));

  const profundidades = posiciones
    .map((p) => p.neumatico?.profundidadActualMm)
    .filter((v): v is number => v != null);

  return {
    vehiculo,
    ejes,
    posiciones,
    resumen: {
      posiciones: posiciones.length,
      montados: posiciones.filter((p) => p.montajeActualId != null).length,
      alertas: posiciones.filter((p) => p.ultimaRevision?.alertaGenerada).length,
      profundidadMinimaMm: profundidades.length ? Math.min(...profundidades) : null,
      ultimaRevisionFecha: revision?.fecha_revision ?? null,
    },
  };
}
