/**
 * Las consultas a TyreControl para el cambio de neumáticos de una OTF, y el
 * montaje al finalizar el trabajo.
 *
 * LEER se hace con la clave de servicio (como el resto de lecturas de TC desde
 * el servidor). ESCRIBIR —dar de alta el vehículo y montar— pasa por los RPC
 * de TyreControl con el usuario de integración, nunca escribiendo en las
 * tablas: los RPC validan la medida, escriben el historial y las operaciones.
 * Y solo con las dos llaves puestas (ver `montajeOtfActivo`).
 */

import db from "../db.ts";
import { supabase } from "../supabase.ts";
import { clienteTyreControl } from "../tyrecontrol/sesion.ts";
import { resolverVehiculoDeCliente } from "../tyrecontrol/vehiculos.ts";
import {
  etiquetaOtf, montajeOtfActivo, planMontaje,
  type MontajeActual, type NeumaticosTrabajo, type PosicionPlano,
} from "./neumaticosTc.ts";

export type TipoTc = { id: string; nombre: string; config: string | null; imagenUrl: string | null };

export type Plano = {
  tipo: TipoTc;
  imagenUrl: string | null;
  posiciones: PosicionPlano[];
};

/** Tipos de vehículo activos de TyreControl, para dar de alta uno nuevo. */
export async function tiposTc(): Promise<TipoTc[]> {
  const { data, error } = await supabase
    .from("tc_tipos_vehiculo").select("id, nombre, configuracion_ejes, imagen_chasis_url, activo")
    .eq("activo", true).order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: any) => ({
    id: String(t.id), nombre: String(t.nombre), config: t.configuracion_ejes ?? null, imagenUrl: t.imagen_chasis_url ?? null,
  }));
}

function textoMontado(n: any): string | null {
  if (!n) return null;
  const nombre = [n.marca, n.modelo].filter(Boolean).join(" ") || "Neumático";
  const mm = n.profundidad_actual_mm != null ? ` · ${Number(n.profundidad_actual_mm)} mm` : "";
  return `${nombre}${n.medida ? ` ${n.medida}` : ""}${mm}`;
}

/**
 * El plano de un tipo: sus posiciones calibradas y la imagen. La imagen, en el
 * mismo orden que la tablet de TyreControl: la de la configuración de ejes del
 * vehículo, si no la del tipo. Con vehículo, cada posición lleva lo montado.
 */
export async function planoTc(tipoId: string, opciones: { configEjesId?: string | null; vehiculoId?: string | null } = {}): Promise<Plano> {
  const [tipoR, posR, cfgR, montR] = await Promise.all([
    supabase.from("tc_tipos_vehiculo").select("id, nombre, configuracion_ejes, imagen_chasis_url").eq("id", tipoId).maybeSingle(),
    supabase.from("tc_posiciones_vehiculo")
      .select("id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual, pos_x, pos_y, pos_w, pos_h")
      .eq("tipo_vehiculo_id", tipoId).eq("activo", true).order("orden_visual"),
    opciones.configEjesId
      ? supabase.from("tc_config_ejes").select("imagen_chasis_url").eq("id", opciones.configEjesId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    opciones.vehiculoId
      ? supabase.from("tc_montajes_actuales")
          .select("posicion_id, neumatico:tc_neumaticos(marca, modelo, medida, profundidad_actual_mm)")
          .eq("vehiculo_id", opciones.vehiculoId)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (tipoR.error) throw new Error(tipoR.error.message);
  if (!tipoR.data) throw new Error("Tipo de vehículo no encontrado en TyreControl");
  if (posR.error) throw new Error(posR.error.message);
  const montado = new Map<string, string | null>(
    ((montR as any).data ?? []).map((m: any) => [String(m.posicion_id), textoMontado(m.neumatico)]),
  );
  const t: any = tipoR.data;
  const tipo: TipoTc = { id: String(t.id), nombre: String(t.nombre), config: t.configuracion_ejes ?? null, imagenUrl: t.imagen_chasis_url ?? null };
  return {
    tipo,
    imagenUrl: (cfgR as any).data?.imagen_chasis_url ?? tipo.imagenUrl,
    posiciones: (posR.data ?? []).map((p: any) => ({
      id: String(p.id), codigo: String(p.codigo_posicion), nombre: p.nombre ?? String(p.codigo_posicion),
      eje: p.eje ?? null, lado: p.lado ?? null, interiorExterior: p.interior_exterior ?? null,
      x: p.pos_x ?? null, y: p.pos_y ?? null, w: p.pos_w ?? null, h: p.pos_h ?? null,
      montado: montado.get(String(p.id)) ?? null,
    })),
  };
}

export type VehiculoParaOtf = {
  estado: "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "MAPPING_ERROR" | "SIN_MATRICULA";
  motivo?: string;
  tcEmpresaId: string | null;
  empresaNombre: string | null;
  vehiculo: { id: string; tipoId: string | null; tipoNombre: string | null; medida: string | null } | null;
  plano: Plano | null;
  tipos: TipoTc[];
};

/** La medida más repetida entre lo montado: la que se propone para el cambio. */
function medidaHabitual(posiciones: PosicionPlano[]): string | null {
  const cuenta = new Map<string, number>();
  for (const p of posiciones) {
    const m = String(p.montado ?? "").match(/\b\d{3}\/\d{2}\s?R\s?\d{2}(?:[.,]\d)?\b/i)?.[0];
    if (m) cuenta.set(m.replace(/\s/g, "").toUpperCase(), (cuenta.get(m) ?? 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** ¿Está esta matrícula en TyreControl para el cliente de la OTF? */
export async function vehiculoParaOtf(otfId: number, plate: unknown): Promise<VehiculoParaOtf> {
  const mat = String(plate ?? "").toUpperCase().replace(/\s+/g, "");
  const tipos = await tiposTc();
  const base = { tcEmpresaId: null, empresaNombre: null, vehiculo: null, plano: null, tipos };
  if (!mat) return { ...base, estado: "SIN_MATRICULA" };

  const otf = (await db.query(`SELECT "clientId" FROM otf WHERE id = $1`, [otfId])).rows[0];
  const clienteId = otf?.clientId == null ? null : Number(otf.clientId);
  const { empresaDeCliente, comprobarEmpresa } = await import("../tyrecontrol/empresas.ts");
  const mapeo = await empresaDeCliente(clienteId).catch(() => null);
  const empresa = mapeo?.tcEmpresaId ? await comprobarEmpresa(mapeo.tcEmpresaId).catch(() => null) : null;

  const res = await resolverVehiculoDeCliente(mat, clienteId);
  if (res.estado === "FOUND") {
    const v = res.vehiculo;
    const fila = (await supabase.from("tc_vehiculos").select("config_ejes_id").eq("id", v.tcVehicleId).maybeSingle()).data as any;
    const plano = v.tipoVehiculoId
      ? await planoTc(v.tipoVehiculoId, { configEjesId: fila?.config_ejes_id ?? null, vehiculoId: v.tcVehicleId })
      : null;
    return {
      ...base, estado: "FOUND", tcEmpresaId: v.empresaId, empresaNombre: v.empresaNombre,
      vehiculo: { id: v.tcVehicleId, tipoId: v.tipoVehiculoId, tipoNombre: v.tipoVehiculo, medida: plano ? medidaHabitual(plano.posiciones) : null },
      plano,
    };
  }
  if (res.estado === "MAPPING_ERROR") {
    return { ...base, estado: "MAPPING_ERROR", motivo: res.motivo, tcEmpresaId: res.tcEmpresaId };
  }
  if (res.estado === "AMBIGUOUS") {
    return { ...base, estado: "AMBIGUOUS", motivo: `La matrícula está en ${res.candidatos.length} empresas de TyreControl` };
  }
  return {
    ...base, estado: "NOT_FOUND",
    tcEmpresaId: empresa?.activa ? mapeo!.tcEmpresaId : null,
    empresaNombre: empresa?.activa ? empresa.nombre : null,
    motivo: empresa?.activa ? undefined : "El cliente de la OTF no tiene empresa de TyreControl asignada: no se podrá dar de alta",
  };
}

export type ReferenciaTc = { id: string; marca: string; modelo: string; medida: string; eje: string | null; texto: string };

/** Referencias del catálogo de TyreControl de una medida, filtradas por marca o modelo. */
export async function catalogoTc(medida: unknown, q: unknown): Promise<ReferenciaTc[]> {
  const m = String(medida ?? "").toUpperCase().replace(/\s+/g, "");
  if (m.length < 5) return [];
  const { data, error } = await supabase
    .from("tc_referencias_neumatico")
    .select("id, modelo:tc_cat_modelos_neumatico!inner(nombre, eje_recomendado, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes!inner(medida)")
    .eq("activo", true)
    .ilike("tyre_size.medida", `%${m.replace(/[%_]/g, "")}%`)
    .limit(300);
  if (error) throw new Error(error.message);
  const busca = String(q ?? "").trim().toLowerCase();
  const vistas = new Set<string>();
  return (data ?? [])
    .map((r: any) => {
      const marca = String(r.modelo?.marca?.nombre ?? "");
      const modelo = String(r.modelo?.nombre ?? "");
      const med = String(r.tyre_size?.medida ?? "");
      return { id: String(r.id), marca, modelo, medida: med, eje: r.modelo?.eje_recomendado ?? null, texto: `${marca} ${modelo} ${med}`.trim() };
    })
    .filter((r) => !busca || r.texto.toLowerCase().includes(busca))
    .filter((r) => (vistas.has(r.texto) ? false : (vistas.add(r.texto), true)))
    .sort((a, b) => a.texto.localeCompare(b.texto))
    .slice(0, 60);
}

// ── El montaje ────────────────────────────────────────────────────────────

export type ResultadoMontaje = {
  estado: "hecho" | "error" | "desactivado" | "en_curso";
  motivo: string | null;
  atMs: number;
  vehiculoCreado?: boolean;
  ruedas?: { codigo: string; ok: boolean; error?: string }[];
};

async function guardar(tid: number, r: ResultadoMontaje, neumaticos?: NeumaticosTrabajo): Promise<void> {
  await db.query(
    `UPDATE otf_trabajos SET "tcMontaje" = $2::jsonb${neumaticos ? `, neumaticos = $3::jsonb` : ""} WHERE id = $1`,
    neumaticos ? [tid, JSON.stringify(r), JSON.stringify(neumaticos)] : [tid, JSON.stringify(r)],
  );
}

function hoyMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

/**
 * Registra en TyreControl el cambio de neumáticos de un trabajo finalizado:
 * da de alta el vehículo si no estaba y monta cada rueda marcada con la
 * referencia del catálogo (si la rueda está ocupada, es una sustitución).
 *
 * Nunca lanza: un fallo en TyreControl no puede romper el cierre del trabajo.
 * Deja el resultado en el trabajo para que la oficina lo vea y lo reintente.
 * Reintentar es seguro: cada rueda montada lleva la marca del trabajo y no se
 * vuelve a montar.
 */
export async function montarTrabajoEnTc(tid: number): Promise<ResultadoMontaje | null> {
  try {
    // Uno a la vez por trabajo: si hay otro en curso (de hace menos de 10 min), no se entra.
    const ahora = Date.now();
    const r = await db.query(
      `UPDATE otf_trabajos SET "tcMontaje" = $2::jsonb
        WHERE id = $1 AND neumaticos IS NOT NULL AND status = 'finalizado'
          AND ("tcMontaje" IS NULL OR "tcMontaje"->>'estado' <> 'en_curso'
               OR COALESCE(("tcMontaje"->>'atMs')::bigint, 0) < $3)
        RETURNING *`,
      [tid, JSON.stringify({ estado: "en_curso", motivo: null, atMs: ahora }), ahora - 10 * 60_000],
    );
    const fila = r.rows[0];
    if (!fila) return null;
    const n = fila.neumaticos as NeumaticosTrabajo;

    if (!montajeOtfActivo()) {
      const res: ResultadoMontaje = {
        estado: "desactivado", atMs: ahora,
        motivo: "La escritura en TyreControl desde las OTF está apagada (TYRE_CONTROL_WRITE_ENABLED y TYRE_CONTROL_OTF_MOUNT_ENABLED).",
      };
      await guardar(tid, res);
      return res;
    }
    if (!n.referenciaId) {
      const res: ResultadoMontaje = { estado: "error", atMs: ahora, motivo: "El neumático no es del catálogo de TyreControl: no se puede registrar el montaje." };
      await guardar(tid, res);
      return res;
    }

    const cliente = await clienteTyreControl();
    let vehiculoId = n.tcVehiculoId;
    let vehiculoCreado = false;
    if (!vehiculoId) {
      if (!n.tcEmpresaId) {
        const res: ResultadoMontaje = { estado: "error", atMs: ahora, motivo: "El cliente no tiene empresa de TyreControl: no se puede dar de alta el vehículo." };
        await guardar(tid, res);
        return res;
      }
      const alta = await cliente.rpc("tc_alta_vehiculo_desde_parte", {
        p_empresa: n.tcEmpresaId, p_matricula: fila.plate, p_tipo: n.tcTipoVehiculoId,
      });
      if (alta.error) throw new Error(`Alta del vehículo: ${alta.error.message}`);
      vehiculoId = String((alta.data as any)?.vehiculo_id ?? "");
      if (!vehiculoId) throw new Error("Alta del vehículo: TyreControl no devolvió el vehículo");
      vehiculoCreado = (alta.data as any)?.ya_existia !== true;
      n.tcVehiculoId = vehiculoId;
      // Se guarda YA: si lo siguiente falla, el reintento no vuelve a darlo de alta.
      await db.query(`UPDATE otf_trabajos SET neumaticos = $2::jsonb WHERE id = $1`, [tid, JSON.stringify(n)]);
    }

    // El tipo del vehículo tiene que ser el del plano: las posiciones cuelgan de él.
    const veh = (await supabase.from("tc_vehiculos").select("tipo_vehiculo_id").eq("id", vehiculoId).maybeSingle()).data as any;
    if (veh && String(veh.tipo_vehiculo_id ?? "") !== n.tcTipoVehiculoId) {
      const res: ResultadoMontaje = {
        estado: "error", atMs: ahora, vehiculoCreado,
        motivo: "En TyreControl el vehículo tiene otro tipo de vehículo que el del plano del trabajo: revísalo allí.",
      };
      await guardar(tid, res, n);
      return res;
    }

    const actualesR = await supabase.from("tc_montajes_actuales").select("id, posicion_id, observaciones").eq("vehiculo_id", vehiculoId);
    if (actualesR.error) throw new Error(actualesR.error.message);
    const actuales = new Map<string, MontajeActual>(
      (actualesR.data ?? []).map((m: any) => [String(m.posicion_id), { id: String(m.id), observaciones: m.observaciones ?? null }]),
    );
    const etiqueta = etiquetaOtf(Number(fila.otfId), tid);
    const obs = `${etiqueta} OTF #${fila.otfId} · ${String(fila.trabajo ?? "").slice(0, 160)}`.trim();

    const ruedas: { codigo: string; ok: boolean; error?: string }[] = [];
    for (const paso of planMontaje(n, actuales, etiqueta)) {
      if (paso.hecho) { ruedas.push({ codigo: paso.codigo, ok: true }); continue; }
      const m = await cliente.rpc("tc_montar_desde_catalogo", {
        p_vehiculo: vehiculoId, p_posicion: paso.posicionId, p_referencia: n.referenciaId,
        p_control_individual: false, p_datos: {}, p_km: null, p_fecha: hoyMadrid(), p_obs: obs,
        p_forzar_medida: false, p_condicion: n.condicion,
        p_montaje_actual: paso.montajeActualId,
        p_motivo_desmontaje: "desgaste", p_destino_retirado: n.destinoRetirado,
      });
      ruedas.push(m.error ? { codigo: paso.codigo, ok: false, error: m.error.message } : { codigo: paso.codigo, ok: true });
    }
    const fallos = ruedas.filter((x) => !x.ok);
    const res: ResultadoMontaje = {
      estado: fallos.length ? "error" : "hecho", atMs: Date.now(), vehiculoCreado, ruedas,
      motivo: fallos.length ? `${fallos.length} de ${ruedas.length} ruedas sin registrar: ${fallos[0].error}` : null,
    };
    await guardar(tid, res, n);
    return res;
  } catch (e: any) {
    const res: ResultadoMontaje = { estado: "error", atMs: Date.now(), motivo: String(e?.message ?? e).slice(0, 300) };
    await guardar(tid, res).catch(() => {});
    console.error(`[OTF] montaje en TyreControl del trabajo ${tid}:`, res.motivo);
    return res;
  }
}
