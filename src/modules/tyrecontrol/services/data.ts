import { supabase } from "./supabase";
import type {
  Delegacion, DelegacionInput, Empresa, EmpresaInput, Perfil, Rol,
  TipoVehiculo, PosicionVehiculo, Vehiculo, VehiculoInput,
  Neumatico, NeumaticoInput, MontajeActual, HistorialMontaje, DestinoDesmontaje, MotivoDesmontaje,
  ClienteAlmacen, ProductoAlmacen, OperacionNeumatico, TipoOperacion, FichaGenerica,
  RevisionVehiculo, RevisionDetalle, AutorizacionOperacion,
  MarcaNeumatico, ModeloNeumatico, MedidaNeumatico, IndiceCarga, IndiceVelocidad, MotivoFueraAlmacen,
  TipoIncidencia, TipoIncidenciaInput, MotivoPendiente, MotivoPendienteInput,
  Fabricante, MarcaContadores, TyreSize, TyreSizeInput, ReferenciaNeumatico,
  ConfigEjes, TipoLlanta, VehiculoEje, UmbralesEmpresa, UmbralMedida, UmbralCategoria, PrecioMedida, WebfleetConfig,
  VehiculoWebfleetEstado, WebfleetSyncConfig, RevisionEstado, RevisionFlag, WebfleetAlerta,
  OperacionMantenimiento, PlanMantenimiento, PlanMantenimientoInput, PlanEstado, MantenimientoRealizada,
  PlantillaMantenimiento, PlantillaItem, LoteRevision, LoteVehiculo,
  CatTipoOperacion, CatMotivo, CatDestino, CatTipoReparacion, CatResultadoReparacion, OperacionAdjunto, ReservaNeumatico, OperacionMovimiento,
} from "../types";

function clean<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" ? (v.trim() || null) : v;
  return out;
}

// Deja solo las columnas permitidas (descarta joins anidados, id, timestamps…)
function pick<T extends Record<string, any>>(obj: T, cols: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of cols) if (c in obj) out[c] = obj[c];
  return clean(out);
}

const COLS_EMPRESA = ["nombre", "cif", "codigo_cliente", "telefono", "email", "direccion", "ciudad", "provincia", "codigo_postal", "pais", "activo"] as const;
const COLS_DELEGACION = ["empresa_id", "nombre", "direccion", "ciudad", "provincia", "codigo_postal", "pais", "responsable", "telefono", "email", "activo", "webfleet_lat", "webfleet_lng", "webfleet_radio_m", "webfleet_zona_nombre", "webfleet_genera_avisos"] as const;
const COLS_VEHICULO = ["empresa_id", "delegacion_id", "tipo_vehiculo_id", "matricula", "numero_unidad", "marca", "modelo", "bastidor", "fecha_matriculacion", "webfleet_vehicle_id", "km_actual", "origen_km", "activo", "config_ejes_id", "medida_id", "tipo_llanta_id", "medidas_por_eje", "revision_intervalo_dias", "revision_intervalo_km"] as const;
const COLS_NEUMATICO = ["empresa_id", "codigo_interno", "numero_serie", "dot", "marca", "modelo", "medida", "indice_carga", "indice_velocidad", "rfid_epc", "estado", "fecha_compra", "coste_compra", "proveedor", "referencia_almacen", "activo", "almacen_producto_id"] as const;

// ── Empresas ─────────────────────────────────────────────────
export async function listarEmpresas(): Promise<Empresa[]> {
  const { data, error } = await supabase.from("tc_empresas").select("*").order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Empresa[];
}

export async function obtenerEmpresa(id: string): Promise<Empresa | null> {
  const { data, error } = await supabase.from("tc_empresas").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Empresa) ?? null;
}

export async function crearEmpresa(input: EmpresaInput): Promise<Empresa> {
  const { data, error } = await supabase.from("tc_empresas").insert(pick(input, COLS_EMPRESA)).select("*").single();
  if (error) throw new Error(error.message);
  return data as Empresa;
}

export async function actualizarEmpresa(id: string, patch: Partial<EmpresaInput>): Promise<void> {
  const { error } = await supabase.from("tc_empresas").update({ ...pick(patch, COLS_EMPRESA), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Enlace con almacén (clientes) ───────────────────────────────
export async function listarClientesAlmacen(q?: string): Promise<ClienteAlmacen[]> {
  let query = supabase.from("tc_clientes_almacen").select("*").order("nombre");
  if (q) query = query.ilike("nombre", `%${q}%`);
  const { data, error } = await query.limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteAlmacen[];
}

export async function enlazarClienteAlmacen(empresaId: string, clienteAlmacenId: string | null): Promise<void> {
  const { error } = await supabase.from("tc_empresas").update({ cliente_almacen_id: clienteAlmacenId, updated_at: new Date().toISOString() }).eq("id", empresaId);
  if (error) throw new Error(error.message);
}

export async function listarProductosAlmacen(q?: string): Promise<ProductoAlmacen[]> {
  let query = supabase.from("tc_productos_almacen").select("*").order("marca").order("medida");
  if (q) query = query.or(`marca.ilike.%${q}%,medida.ilike.%${q}%,modelo.ilike.%${q}%`);
  const { data, error } = await query.limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductoAlmacen[];
}

// ── Delegaciones ─────────────────────────────────────────────
export async function listarDelegaciones(empresaId?: string): Promise<Delegacion[]> {
  let q = supabase.from("tc_delegaciones").select("*, empresa:tc_empresas(*)").order("nombre");
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Delegacion[];
}

export async function crearDelegacion(input: DelegacionInput): Promise<void> {
  const { error } = await supabase.from("tc_delegaciones").insert(pick(input, COLS_DELEGACION));
  if (error) throw new Error(error.message);
}

export async function actualizarDelegacion(id: string, patch: Partial<DelegacionInput>): Promise<void> {
  const { error } = await supabase.from("tc_delegaciones").update({ ...pick(patch, COLS_DELEGACION), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Usuarios ─────────────────────────────────────────────────
export async function listarUsuarios(empresaId?: string): Promise<Perfil[]> {
  let q = supabase.from("tc_usuarios").select("*, empresa:tc_empresas!tc_usuarios_empresa_id_fkey(*), delegacion:tc_delegaciones(*)").order("nombre");
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Perfil[];
}

export type NuevoUsuario = {
  nombre: string;
  email: string;
  password: string;
  rol: Rol;
  acceso_apk: boolean;
  acceso_panel: boolean;
  empresa_id?: string;
  delegacion_id?: string | null;
};

export async function crearUsuario(input: NuevoUsuario): Promise<void> {
  const { data, error } = await supabase.functions.invoke("crear-usuario", { body: input });
  if (error) throw new Error(error.message);
  if (data && (data as any).error) throw new Error((data as any).error);
}

// ── Catálogo: tipos y posiciones ─────────────────────────────
export async function listarTiposVehiculo(): Promise<TipoVehiculo[]> {
  const { data, error } = await supabase.from("tc_tipos_vehiculo").select("*").eq("activo", true).order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as TipoVehiculo[];
}

export async function actualizarConfiguracionEjes(tipoId: string, configuracionEjes: string | null): Promise<void> {
  const { error } = await supabase.from("tc_tipos_vehiculo").update({ configuracion_ejes: configuracionEjes }).eq("id", tipoId);
  if (error) throw new Error(error.message);
}

export async function listarPosiciones(tipoId: string): Promise<PosicionVehiculo[]> {
  const { data, error } = await supabase
    .from("tc_posiciones_vehiculo")
    .select("*").eq("tipo_vehiculo_id", tipoId).eq("activo", true)
    .order("orden_visual");
  if (error) throw new Error(error.message);
  return (data ?? []) as PosicionVehiculo[];
}

export async function actualizarImagenChasis(tipoId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("tc_tipos_vehiculo").update({ imagen_chasis_url: url }).eq("id", tipoId);
  if (error) throw new Error(error.message);
}

export async function guardarOrdenRevisionPosicion(id: string, orden: number | null): Promise<void> {
  const { error } = await supabase.from("tc_posiciones_vehiculo").update({ orden_revision: orden }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function guardarCoordenadasPosicion(id: string, coords: { pos_x: number; pos_y: number; pos_w: number; pos_h: number }): Promise<void> {
  const { error } = await supabase.from("tc_posiciones_vehiculo").update(coords).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Vehículos ────────────────────────────────────────────────
const VEHICULO_SELECT = "*, empresa:tc_empresas(*), delegacion:tc_delegaciones(*), tipo:tc_tipos_vehiculo(*), config_ejes:tc_config_ejes(*)";

export async function listarVehiculos(filtros?: { empresaId?: string }): Promise<Vehiculo[]> {
  let q = supabase.from("tc_vehiculos").select(VEHICULO_SELECT).order("matricula");
  if (filtros?.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Vehiculo[];
}

export async function obtenerVehiculo(id: string): Promise<Vehiculo | null> {
  const { data, error } = await supabase.from("tc_vehiculos").select(VEHICULO_SELECT).eq("id", id).maybeSingle();
  if (error) return null;
  return (data as unknown as Vehiculo) ?? null;
}

export async function crearVehiculo(input: VehiculoInput): Promise<string> {
  const payload = pick(input, COLS_VEHICULO);
  payload.matricula = String(input.matricula ?? "").trim().toUpperCase();
  const { data, error } = await supabase.from("tc_vehiculos").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function actualizarVehiculo(id: string, patch: Partial<VehiculoInput>): Promise<void> {
  const next: any = { ...pick(patch, COLS_VEHICULO), updated_at: new Date().toISOString() };
  if (patch.matricula != null) next.matricula = String(patch.matricula).trim().toUpperCase();
  const { error } = await supabase.from("tc_vehiculos").update(next).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function actualizarUsuario(id: string, patch: Partial<Perfil>): Promise<void> {
  const { error } = await supabase
    .from("tc_usuarios")
    .update({
      nombre: patch.nombre,
      rol: patch.rol,
      activo: patch.activo,
      acceso_apk: patch.acceso_apk,
      acceso_panel: patch.acceso_panel,
      delegacion_id: patch.delegacion_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Histórico de revisiones realizadas (filtros en servidor) ───
export async function listarRevisionesHistorico(filtros: {
  desde?: string | null;   // yyyy-MM-dd
  hasta?: string | null;
  empresaId?: string | null;
  tecnicoId?: string | null;
  limite?: number;
}): Promise<any[]> {
  let q = supabase
    .from("revisiones_vehiculo")
    .select(
      "id, fecha_revision, created_at, estado_revision, km_vehiculo, empresa_id, tecnico_id, " +
      "vehiculo:tc_vehiculos(matricula, numero_unidad, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), " +
      "tecnico:tc_usuarios(nombre), incidencias:tc_incidencias(id, estado)"
    )
    .in("estado_revision", ["completada", "completada_con_incidencias", "completada_incidencia_pendiente"]);
  if (filtros.desde) q = q.gte("fecha_revision", filtros.desde);
  if (filtros.hasta) q = q.lte("fecha_revision", filtros.hasta);
  if (filtros.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  if (filtros.tecnicoId) q = q.eq("tecnico_id", filtros.tecnicoId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(filtros.limite ?? 200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Empresas visibles por usuario (ficha de usuario) ───────────
export async function listarEmpresasDeUsuario(usuarioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("tc_operador_empresas")
    .select("empresa_id")
    .eq("usuario_id", usuarioId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.empresa_id as string);
}

/// empresaIds = null → modo automático (ve todas, incluidas las futuras);
/// array → asignación manual exacta (el login/trigger no la tocan).
export async function guardarEmpresasUsuario(usuarioId: string, empresaIds: string[] | null): Promise<void> {
  if (empresaIds === null) {
    const { error: e1 } = await supabase.from("tc_usuarios")
      .update({ empresas_manual: false, updated_at: new Date().toISOString() }).eq("id", usuarioId);
    if (e1) throw new Error(e1.message);
    const { data: empresas, error: e2 } = await supabase.from("tc_empresas").select("id").eq("activo", true);
    if (e2) throw new Error(e2.message);
    if (empresas && empresas.length > 0) {
      const { error: e3 } = await supabase.from("tc_operador_empresas").upsert(
        empresas.map((e: any) => ({ usuario_id: usuarioId, empresa_id: e.id })),
        { onConflict: "usuario_id,empresa_id" }
      );
      if (e3) throw new Error(e3.message);
    }
    return;
  }
  const { error: e1 } = await supabase.from("tc_usuarios")
    .update({ empresas_manual: true, updated_at: new Date().toISOString() }).eq("id", usuarioId);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase.from("tc_operador_empresas").delete().eq("usuario_id", usuarioId);
  if (e2) throw new Error(e2.message);
  if (empresaIds.length > 0) {
    const { error: e3 } = await supabase.from("tc_operador_empresas")
      .insert(empresaIds.map((id) => ({ usuario_id: usuarioId, empresa_id: id })));
    if (e3) throw new Error(e3.message);
  }
}

/// Elimina el usuario del todo (perfil + auth) vía backend. Si tiene
/// historial, el servidor responde 409 recomendando desactivarlo.
export async function eliminarUsuario(id: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Sesión no válida");
  const r = await fetch(`${WF_API_BASE}/api/tyrecontrol/usuarios/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || "Error eliminando usuario");
}

// ── Neumáticos ───────────────────────────────────────────────
const NEU_SELECT = "*, empresa:tc_empresas(*)";

export async function listarNeumaticos(filtros?: { empresaId?: string }): Promise<Neumatico[]> {
  let q = supabase.from("tc_neumaticos").select(NEU_SELECT).order("codigo_interno");
  if (filtros?.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Neumatico[];
}

export async function obtenerNeumatico(id: string): Promise<Neumatico | null> {
  const { data, error } = await supabase.from("tc_neumaticos").select(NEU_SELECT).eq("id", id).maybeSingle();
  if (error) return null;
  return (data as unknown as Neumatico) ?? null;
}

// Búsqueda de neumáticos por nº de serie, código interno o RFID (para informes).
export async function buscarNeumaticos(texto: string, empresaId?: string | null): Promise<Neumatico[]> {
  const t = texto.trim();
  if (t.length < 2) return [];
  let q = supabase.from("tc_neumaticos").select(NEU_SELECT)
    .or(`numero_serie.ilike.%${t}%,codigo_interno.ilike.%${t}%,numero_interno.ilike.%${t}%,rfid_epc.ilike.%${t}%`)
    .order("codigo_interno").limit(20);
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Neumatico[];
}

// Búsqueda de vehículos por matrícula o nº de unidad (para informes).
export async function buscarVehiculos(texto: string, empresaId?: string | null): Promise<Vehiculo[]> {
  const t = texto.trim();
  if (t.length < 2) return [];
  let q = supabase.from("tc_vehiculos").select(VEHICULO_SELECT)
    .or(`matricula.ilike.%${t}%,numero_unidad.ilike.%${t}%`)
    .order("matricula").limit(20);
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Vehiculo[];
}

export async function crearNeumatico(input: NeumaticoInput): Promise<void> {
  const { error } = await supabase.from("tc_neumaticos").insert(pick(input, COLS_NEUMATICO));
  if (error) throw new Error(error.message);
}

export async function actualizarNeumatico(id: string, patch: Partial<NeumaticoInput>): Promise<void> {
  const { error } = await supabase.from("tc_neumaticos")
    .update({ ...pick(patch, COLS_NEUMATICO), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Neumáticos disponibles para montar (en almacén/reservado, activos, de una empresa)
export async function listarNeumaticosDisponibles(empresaId: string): Promise<Neumatico[]> {
  const { data, error } = await supabase.from("tc_neumaticos").select("*")
    .eq("empresa_id", empresaId).eq("activo", true).in("estado", ["almacen", "reservado"]).order("codigo_interno");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Neumatico[];
}

// ── Montajes ─────────────────────────────────────────────────
export async function listarMontajesVehiculo(vehiculoId: string): Promise<MontajeActual[]> {
  const { data, error } = await supabase.from("tc_montajes_actuales")
    .select("*, neumatico:tc_neumaticos(*, producto_almacen:productos_neumaticos(referencia:tc_referencias_neumatico(presion_maxima_bar))), posicion:tc_posiciones_vehiculo(*)")
    .eq("vehiculo_id", vehiculoId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MontajeActual[];
}

// Última medición de profundidad/presión registrada en una revisión completada
// para cada neumático de este vehículo (para mostrarla en el plano en vez del
// dato de alta, que solo vale como referencia inicial).
export async function listarUltimasMedicionesVehiculo(vehiculoId: string): Promise<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>> {
  const { data: revs, error: e1 } = await supabase.from("revisiones_vehiculo")
    .select("id").eq("vehiculo_id", vehiculoId).neq("estado_revision", "anulada")
    .order("fecha_revision", { ascending: false }).order("created_at", { ascending: false });
  if (e1) throw new Error(e1.message);
  const ids = (revs ?? []).map((r) => r.id);
  if (ids.length === 0) return {};

  const { data: dets, error: e2 } = await supabase.from("revisiones_neumaticos_detalle")
    .select("neumatico_id, posicion_id, profundidad_mm, presion_bar, revision_id").in("revision_id", ids);
  if (e2) throw new Error(e2.message);

  // Detalles guardados sin neumatico_id (p. ej. la posición aún no tenía
  // montaje al crear la revisión): se atribuyen por posición al neumático
  // montado actualmente en ella, para no perder la medición en el plano.
  const { data: mons } = await supabase.from("tc_montajes_actuales")
    .select("posicion_id, neumatico_id").eq("vehiculo_id", vehiculoId);
  const neuPorPosicion = new Map((mons ?? []).map((m) => [m.posicion_id as string, m.neumatico_id as string]));

  const ordenRevision = new Map(ids.map((id, i) => [id, i]));
  const detsOrdenados = [...(dets ?? [])].sort((a, b) => (ordenRevision.get(a.revision_id) ?? 0) - (ordenRevision.get(b.revision_id) ?? 0));

  const mapa: Record<string, { profundidad_mm: number | null; presion_bar: number | null }> = {};
  for (const d of detsOrdenados) {
    const nid = d.neumatico_id ?? (d.posicion_id ? neuPorPosicion.get(d.posicion_id) : null);
    if (!nid) continue;
    const actual = mapa[nid] ?? { profundidad_mm: null, presion_bar: null };
    if (actual.profundidad_mm == null && d.profundidad_mm != null) actual.profundidad_mm = d.profundidad_mm;
    if (actual.presion_bar == null && d.presion_bar != null) actual.presion_bar = d.presion_bar;
    mapa[nid] = actual;
  }
  return mapa;
}

// Presión recomendada del catálogo por marca+modelo+medida, para neumáticos
// que no están enlazados a un producto de almacén (ej. dados de alta como
// stock manual o "fuera de almacén") pero sí corresponden a un modelo del
// catálogo de TyreControl.
export async function listarPresionesCatalogoPorModelo(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("tc_referencias_neumatico")
    .select("presion_maxima_bar, modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes(medida)")
    .eq("activo", true).not("presion_maxima_bar", "is", null);
  if (error) throw new Error(error.message);
  const mapa: Record<string, number> = {};
  for (const r of ((data ?? []) as any[])) {
    const marca = r.modelo?.marca?.nombre; const modelo = r.modelo?.nombre; const medida = r.tyre_size?.medida;
    if (!marca || !modelo || !medida || r.presion_maxima_bar == null) continue;
    const clave = `${marca}|${modelo}|${medida}`.toLowerCase().replace(/\s+/g, "");
    if (mapa[clave] == null) mapa[clave] = r.presion_maxima_bar;
  }
  return mapa;
}

export async function montarNeumatico(params: {
  vehiculoId: string; neumaticoId: string; posicionId: string; km?: number | null; fecha?: string | null; observaciones?: string | null;
  forzarMedida?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc("tc_montar_neumatico", {
    p_vehiculo: params.vehiculoId, p_neumatico: params.neumaticoId, p_posicion: params.posicionId,
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
    p_forzar_medida: params.forzarMedida ?? false,
  });
  if (error) throw new Error(error.message);
}

// Detecta el error especial "MEDIDA_INCOMPATIBLE: ..." que lanzan las RPC
// de montaje cuando la medida no está homologada para el tipo de vehículo.
export function esErrorMedidaIncompatible(mensaje: string): boolean {
  return mensaje.includes("MEDIDA_INCOMPATIBLE");
}

export async function desmontarNeumatico(params: {
  montajeId: string; km?: number | null; motivo: MotivoDesmontaje; destino: DestinoDesmontaje; observaciones?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("tc_desmontar_neumatico", {
    p_montaje: params.montajeId, p_km: params.km ?? null, p_motivo: params.motivo,
    p_nuevo_estado: params.destino, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function rotarNeumatico(params: { montajeOrigenId: string; posicionDestinoId: string }): Promise<void> {
  const { error } = await supabase.rpc("tc_rotar_neumatico", {
    p_montaje_origen: params.montajeOrigenId, p_posicion_destino: params.posicionDestinoId,
  });
  if (error) throw new Error(error.message);
}

// ── Operaciones Fase 3: cambio de posición, intercambio, correcciones ─
export async function cambiarPosicion(params: { montajeId: string; posicionDestinoId: string; km?: number | null; observaciones?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("tc_cambiar_posicion", {
    p_montaje: params.montajeId, p_posicion_destino: params.posicionDestinoId, p_km: params.km ?? null, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function intercambiarPosiciones(params: { montajeAId: string; montajeBId: string; km?: number | null; observaciones?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("tc_intercambiar_posiciones", {
    p_montaje_a: params.montajeAId, p_montaje_b: params.montajeBId, p_km: params.km ?? null, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function corregirPosicion(params: { montajeId: string; posicionCorrectaId: string; observaciones?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("tc_corregir_posicion", {
    p_montaje: params.montajeId, p_posicion_correcta: params.posicionCorrectaId, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function corregirMontado(params: { montajeId: string; neumaticoCorrectoId: string; observaciones?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("tc_corregir_montado", {
    p_montaje: params.montajeId, p_neumatico_correcto: params.neumaticoCorrectoId, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function historialNeumatico(neumaticoId: string): Promise<HistorialMontaje[]> {
  const { data, error } = await supabase.from("tc_historial_montajes").select("*")
    .eq("neumatico_id", neumaticoId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HistorialMontaje[];
}

// Mediciones (profundidad/presión) registradas para un neumático en las
// revisiones de vehículo, con la fecha de cada revisión, para la línea
// temporal del neumático.
export interface MedicionNeumatico {
  fecha_revision: string;
  created_at?: string | null;
  profundidad_mm: number | null;
  presion_bar: number | null;
  estado_visual: string | null;
  km_vehiculo: number | null;
  posicion?: string | null;
  estado_revision?: string | null;
}

export async function medicionesNeumatico(neumaticoId: string): Promise<MedicionNeumatico[]> {
  const { data, error } = await supabase.from("revisiones_neumaticos_detalle")
    .select("profundidad_mm, presion_bar, estado_visual, posicion:tc_posiciones_vehiculo(codigo_posicion), revision:revisiones_vehiculo(fecha_revision, created_at, km_vehiculo, estado_revision)")
    .eq("neumatico_id", neumaticoId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((d: any): MedicionNeumatico => ({
      fecha_revision: d.revision?.fecha_revision ?? "",
      created_at: d.revision?.created_at ?? null,
      profundidad_mm: d.profundidad_mm ?? null,
      presion_bar: d.presion_bar ?? null,
      estado_visual: d.estado_visual ?? null,
      km_vehiculo: d.revision?.km_vehiculo ?? null,
      posicion: d.posicion?.codigo_posicion ?? null,
      estado_revision: d.revision?.estado_revision ?? null,
    }))
    .filter((m) => m.estado_revision !== "anulada" && (m.profundidad_mm != null || m.presion_bar != null));
}

export async function montajeActualDeNeumatico(neumaticoId: string): Promise<MontajeActual | null> {
  const { data, error } = await supabase.from("tc_montajes_actuales")
    .select("*, posicion:tc_posiciones_vehiculo(*)").eq("neumatico_id", neumaticoId).maybeSingle();
  if (error) return null;
  return (data as unknown as MontajeActual) ?? null;
}

// ── Fase 8: Fichas genéricas de almacén ────────────────────────
export async function listarFichasGenericas(q?: string): Promise<FichaGenerica[]> {
  let query = supabase.from("tc_fichas_genericas_neumaticos").select("*").eq("activo", true).order("marca");
  if (q) query = query.or(`marca.ilike.%${q}%,medida.ilike.%${q}%,modelo.ilike.%${q}%`);
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as FichaGenerica[];
}

export async function crearFichaGenerica(input: Omit<FichaGenerica, "id">): Promise<void> {
  const { error } = await supabase.from("tc_fichas_genericas_neumaticos").insert(input);
  if (error) throw new Error(error.message);
}

// ── Fase 8/12: Montaje desde almacén (genérico/individual) y fuera de almacén ─
// Lee directamente el catálogo real del almacén (productos_neumaticos, via
// tc_productos_almacen) — sin tabla intermedia de "ficha genérica".
export async function montarDesdeAlmacen(params: {
  vehiculoId: string; posicionId: string; productoAlmacenId: string; controlIndividual: boolean;
  datos?: Record<string, string>; km?: number | null; fecha?: string | null; observaciones?: string | null;
  forzarMedida?: boolean; condicion?: "nuevo" | "usado";
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_montar_desde_almacen", {
    p_vehiculo: params.vehiculoId, p_posicion: params.posicionId, p_producto_almacen: params.productoAlmacenId,
    p_control_individual: params.controlIndividual, p_datos: params.datos ?? {},
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
    p_forzar_medida: params.forzarMedida ?? false, p_condicion: params.condicion ?? "nuevo",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Profundidad de dibujo (mm) de la ficha del catálogo, por producto de almacén.
// null = ese modelo no tiene la profundidad informada en el catálogo.
export async function profundidadDibujoPorProducto(): Promise<Record<string, number | null>> {
  const { data, error } = await supabase.from("productos_neumaticos")
    .select("id, referencia:tc_referencias_neumatico(profundidad_dibujo_mm)");
  if (error) throw new Error(error.message);
  const mapa: Record<string, number | null> = {};
  for (const r of (data ?? []) as any[]) mapa[r.id] = r.referencia?.profundidad_dibujo_mm ?? null;
  return mapa;
}

// Stock del cliente de almacén enlazado, por producto (nuevo vs usado).
export interface StockAlmacenLinea { producto_id: string; marca: string; modelo: string | null; medida: string; nuevo: number; usado: number; }
export async function stockAlmacenEmpresa(empresaId: string): Promise<StockAlmacenLinea[]> {
  const { data, error } = await supabase.rpc("tc_stock_almacen_empresa", { p_empresa: empresaId });
  if (error) throw new Error(error.message);
  return (data ?? []) as StockAlmacenLinea[];
}

// Montar desde el catálogo (sin stock de almacén). Si viene montajeActualId
// es una sustitución (desmonta el actual, lo devuelve como usado si procede).
export async function montarDesdeCatalogo(params: {
  vehiculoId: string; posicionId: string; referenciaId: string; controlIndividual: boolean;
  datos?: Record<string, string>; km?: number | null; fecha?: string | null; observaciones?: string | null;
  forzarMedida?: boolean; condicion?: "nuevo" | "usado";
  montajeActualId?: string | null; motivoDesmontaje?: string; destinoRetirado?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_montar_desde_catalogo", {
    p_vehiculo: params.vehiculoId, p_posicion: params.posicionId, p_referencia: params.referenciaId,
    p_control_individual: params.controlIndividual, p_datos: params.datos ?? {},
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
    p_forzar_medida: params.forzarMedida ?? false, p_condicion: params.condicion ?? "nuevo",
    p_montaje_actual: params.montajeActualId ?? null,
    p_motivo_desmontaje: params.motivoDesmontaje ?? "desgaste", p_destino_retirado: params.destinoRetirado ?? "almacen",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function montarFueraAlmacen(params: {
  vehiculoId: string; posicionId: string; controlIndividual: boolean; datos?: Record<string, string>;
  motivo: string; km?: number | null; fecha?: string | null; observaciones?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_montar_fuera_almacen", {
    p_vehiculo: params.vehiculoId, p_posicion: params.posicionId, p_control_individual: params.controlIndividual,
    p_datos: params.datos ?? {}, p_motivo: params.motivo, p_km: params.km ?? null,
    p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function sustituirNeumatico(params: {
  montajeActualId: string; productoAlmacenId: string; controlIndividual: boolean; datos?: Record<string, string>;
  motivoDesmontaje: MotivoDesmontaje; destinoRetirado: DestinoDesmontaje;
  km?: number | null; fecha?: string | null; observaciones?: string | null;
  forzarMedida?: boolean; condicion?: "nuevo" | "usado";
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_sustituir_neumatico", {
    p_montaje_actual: params.montajeActualId, p_producto_almacen: params.productoAlmacenId,
    p_control_individual: params.controlIndividual, p_datos: params.datos ?? {},
    p_motivo_desmontaje: params.motivoDesmontaje, p_destino_retirado: params.destinoRetirado,
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
    p_forzar_medida: params.forzarMedida ?? false, p_condicion: params.condicion ?? "nuevo",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// ── Incidencias de neumático (Fase 2/3) ───────────────────────
const INCIDENCIA_SELECT =
  "*, vehiculo:tc_vehiculos(id, matricula, empresa:tc_empresas(nombre), delegacion:tc_delegaciones(nombre)), posicion:tc_posiciones_vehiculo(nombre, codigo_posicion, eje), problemas:tc_incidencia_problemas(id, tipo, estado), revision:revisiones_vehiculo(id, fecha_revision, created_at, estado_revision, tecnico:tc_usuarios(nombre))";

export async function listarIncidencias(): Promise<any[]> {
  const { data, error } = await supabase
    .from("tc_incidencias")
    .select(INCIDENCIA_SELECT)
    .order("detectada_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function resolverIncidencia(params: {
  incidenciaId: string;
  problemaIds: string[];
  tipo: string;
  medicionFinal?: Record<string, unknown> | null;
  material?: string | null;
  resultado?: string | null;
  observaciones?: string | null;
  fotoUrl?: string | null;
  tiempoSeg?: number | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_resolver_incidencia_parcial", {
    p_incidencia_id: params.incidenciaId,
    p_problema_ids: params.problemaIds,
    p_tipo: params.tipo,
    p_medicion_final: params.medicionFinal ?? null,
    p_material: params.material ?? null,
    p_resultado: params.resultado ?? null,
    p_observaciones: params.observaciones ?? null,
    p_foto_url: params.fotoUrl ?? null,
    p_tiempo_seg: params.tiempoSeg ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function repararNeumatico(neumaticoId: string, motivo: string, observaciones?: string | null): Promise<void> {
  const { error } = await supabase.rpc("tc_reparar_neumatico", { p_neumatico: neumaticoId, p_motivo: motivo, p_obs: observaciones ?? null });
  if (error) throw new Error(error.message);
}

export async function descartarNeumaticoStd(neumaticoId: string, motivo: string, observaciones?: string | null): Promise<void> {
  const { error } = await supabase.rpc("tc_descartar_neumatico", { p_neumatico: neumaticoId, p_motivo: motivo, p_obs: observaciones ?? null });
  if (error) throw new Error(error.message);
}

// ── Operaciones Fase 4: reparación con tipo/resultado, proveedor, coste ─
export async function registrarReparacion(params: {
  neumaticoId: string; tipoReparacion: string; resultado: string;
  proveedor?: string | null; coste?: number | null; km?: number | null; observaciones?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_registrar_reparacion", {
    p_neumatico: params.neumaticoId, p_tipo_reparacion: params.tipoReparacion, p_resultado: params.resultado,
    p_proveedor: params.proveedor ?? null, p_coste: params.coste ?? null, p_km: params.km ?? null, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

const BUCKET_OPERACIONES = "tc-operaciones";
export async function subirAdjuntoOperacion(operacionId: string, file: File, descripcion?: string | null): Promise<OperacionAdjunto> {
  const extension = file.name.split(".").pop() || "jpg";
  const ruta = `${operacionId}/${Date.now()}.${extension}`;
  const { error: upErr } = await supabase.storage.from(BUCKET_OPERACIONES).upload(ruta, file, { upsert: true });
  if (upErr) throw new Error(upErr.message);
  const url = supabase.storage.from(BUCKET_OPERACIONES).getPublicUrl(ruta).data.publicUrl;
  const { data, error } = await supabase.from("tc_operacion_adjuntos")
    .insert({ operacion_id: operacionId, file_url: url, storage_path: ruta, file_type: file.type, descripcion: descripcion ?? null })
    .select("*").single();
  if (error) throw new Error(error.message);
  return data as unknown as OperacionAdjunto;
}

export async function listarAdjuntosOperacion(operacionId: string): Promise<OperacionAdjunto[]> {
  const { data, error } = await supabase.from("tc_operacion_adjuntos").select("*").eq("operacion_id", operacionId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OperacionAdjunto[];
}

// ── Operaciones Fase 5: pendientes / planificación + reservas ──
export async function planificarOperacion(params: {
  empresaId: string; tipoOperacion: string; vehiculoId?: string | null; neumaticoId?: string | null;
  posicionDestinoId?: string | null; fechaPrevista?: string | null; prioridad?: string;
  motivo?: string | null; tecnicoId?: string | null; observaciones?: string | null; reservar?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_planificar_operacion", {
    p_empresa: params.empresaId, p_tipo_operacion: params.tipoOperacion,
    p_vehiculo: params.vehiculoId ?? null, p_neumatico: params.neumaticoId ?? null,
    p_posicion_destino: params.posicionDestinoId ?? null, p_fecha_prevista: params.fechaPrevista ?? null,
    p_prioridad: params.prioridad ?? "normal", p_motivo: params.motivo ?? null,
    p_tecnico: params.tecnicoId ?? null, p_obs: params.observaciones ?? null, p_reservar: params.reservar ?? false,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function cambiarEstadoOperacion(params: { operacionId: string; nuevoEstado: string; tecnicoId?: string | null; motivo?: string | null }): Promise<void> {
  const { error } = await supabase.rpc("tc_cambiar_estado_operacion", {
    p_operacion: params.operacionId, p_nuevo_estado: params.nuevoEstado, p_tecnico: params.tecnicoId ?? null, p_motivo: params.motivo ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function reservarNeumatico(params: { neumaticoId: string; operacionId?: string | null; vehiculoId?: string | null; posicionId?: string | null; fechaPrevista?: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc("tc_reservar_neumatico", {
    p_neumatico: params.neumaticoId, p_operacion: params.operacionId ?? null, p_vehiculo: params.vehiculoId ?? null,
    p_posicion: params.posicionId ?? null, p_fecha_prevista: params.fechaPrevista ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function liberarReserva(reservaId: string, motivo?: string | null): Promise<void> {
  const { error } = await supabase.rpc("tc_liberar_reserva", { p_reserva: reservaId, p_motivo: motivo ?? null });
  if (error) throw new Error(error.message);
}

// ── Operaciones Fase 6: anulación, auditoría, detalle ─────────
export async function anularOperacion(operacionId: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("tc_anular_operacion", { p_operacion: operacionId, p_motivo: motivo });
  if (error) throw new Error(error.message);
}

export interface EstadoHistorialEntry { id: string; estado_anterior: string | null; estado_nuevo: string; motivo: string | null; created_at: string; }
export async function listarHistorialEstados(operacionId: string): Promise<EstadoHistorialEntry[]> {
  const { data, error } = await supabase.from("tc_operacion_estado_historial").select("*").eq("operacion_id", operacionId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EstadoHistorialEntry[];
}

export interface AuditoriaEntry { id: string; accion: string; motivo: string | null; datos_anteriores?: any; datos_nuevos?: any; created_at: string; }
export async function listarAuditoriaOperacion(operacionId: string): Promise<AuditoriaEntry[]> {
  const { data, error } = await supabase.from("tc_operacion_auditoria").select("*").eq("operacion_id", operacionId).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AuditoriaEntry[];
}

export async function listarMovimientosOperacion(operacionId: string): Promise<OperacionMovimiento[]> {
  const { data, error } = await supabase.from("tc_operacion_movimientos")
    .select("*, neumatico:tc_neumaticos(numero_interno, codigo_interno, marca, medida)")
    .eq("operacion_id", operacionId).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OperacionMovimiento[];
}

const RESERVA_SELECT = "*, neumatico:tc_neumaticos(id, numero_interno, codigo_interno, marca, modelo, medida, estado), vehiculo:tc_vehiculos(matricula), empresa:tc_empresas(nombre)";
export async function listarReservas(filtros?: { empresaId?: string; status?: string }): Promise<ReservaNeumatico[]> {
  let q = supabase.from("tc_reservas_neumatico").select(RESERVA_SELECT).order("reservado_at", { ascending: false }).limit(500);
  if (filtros?.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  q = q.eq("status", filtros?.status ?? "activa");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReservaNeumatico[];
}

// ── Fase 8: Operaciones (listado/filtros) ──────────────────────
const OPERACION_SELECT = "*, empresa:tc_empresas(*), vehiculo:tc_vehiculos(*), neumatico:tc_neumaticos(*), posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(*), posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(*)";

export interface Intervencion {
  id: string; empresa_id: string; vehiculo_id: string | null; fecha: string;
  resumen: string | null; resumen_ia: string | null; n_operaciones: number; created_at?: string;
}
export async function listarIntervenciones(vehiculoId: string): Promise<Intervencion[]> {
  const { data, error } = await supabase.from("tc_intervenciones").select("*").eq("vehiculo_id", vehiculoId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Intervencion[];
}

export async function listarOperaciones(filtros?: {
  empresaId?: string; vehiculoId?: string; neumaticoId?: string; tipo?: TipoOperacion; estado?: string; intervencionId?: string; desde?: string; hasta?: string;
}): Promise<OperacionNeumatico[]> {
  let q = supabase.from("operaciones_neumaticos").select(OPERACION_SELECT).order("created_at", { ascending: false }).limit(200);
  if (filtros?.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  if (filtros?.vehiculoId) q = q.eq("vehiculo_id", filtros.vehiculoId);
  if (filtros?.neumaticoId) q = q.eq("neumatico_id", filtros.neumaticoId);
  if (filtros?.tipo) q = q.eq("tipo_operacion", filtros.tipo);
  if (filtros?.estado) q = q.eq("status", filtros.estado);
  if (filtros?.intervencionId) q = q.eq("intervencion_id", filtros.intervencionId);
  if (filtros?.desde) q = q.gte("fecha_operacion", filtros.desde);
  if (filtros?.hasta) q = q.lte("fecha_operacion", filtros.hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OperacionNeumatico[];
}

// ── Módulo Operaciones: catálogos configurables ────────────────
export async function listarCatOperaciones(): Promise<{
  tipos: CatTipoOperacion[]; motivos: CatMotivo[]; destinos: CatDestino[];
  tiposReparacion: CatTipoReparacion[]; resultadosReparacion: CatResultadoReparacion[];
}> {
  const [t, m, d, tr, rr] = await Promise.all([
    supabase.from("tc_cat_tipos_operacion").select("*").eq("activo", true).order("orden"),
    supabase.from("tc_cat_motivos").select("*").eq("activo", true).order("orden"),
    supabase.from("tc_cat_destinos").select("*").eq("activo", true).order("orden"),
    supabase.from("tc_cat_tipos_reparacion").select("*").eq("activo", true).order("orden"),
    supabase.from("tc_cat_resultados_reparacion").select("*").eq("activo", true).order("orden"),
  ]);
  const err = t.error || m.error || d.error || tr.error || rr.error;
  if (err) throw new Error(err.message);
  return {
    tipos: (t.data ?? []) as CatTipoOperacion[], motivos: (m.data ?? []) as CatMotivo[],
    destinos: (d.data ?? []) as CatDestino[], tiposReparacion: (tr.data ?? []) as CatTipoReparacion[],
    resultadosReparacion: (rr.data ?? []) as CatResultadoReparacion[],
  };
}

// ── Fase 8: Revisión de vehículo ────────────────────────────────
export async function crearRevision(input: { empresaId: string; vehiculoId: string; kmVehiculo?: number | null; tecnicoId?: string | null }): Promise<RevisionVehiculo> {
  const { data, error } = await supabase.from("revisiones_vehiculo").insert({
    empresa_id: input.empresaId, vehiculo_id: input.vehiculoId, km_vehiculo: input.kmVehiculo ?? null, tecnico_id: input.tecnicoId ?? null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as RevisionVehiculo;
}

export async function guardarDetalleRevision(input: Partial<RevisionDetalle> & { revision_id: string; empresa_id: string; vehiculo_id: string; posicion_id: string }): Promise<void> {
  const { error } = await supabase.from("revisiones_neumaticos_detalle")
    .upsert(input, { onConflict: "revision_id,posicion_id" });
  if (error) throw new Error(error.message);
}

export async function eliminarRevision(id: string): Promise<void> {
  const { error } = await supabase.from("revisiones_vehiculo").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listarDetalleRevision(revisionId: string): Promise<RevisionDetalle[]> {
  const { data, error } = await supabase.from("revisiones_neumaticos_detalle")
    .select("*, neumatico:tc_neumaticos(*), posicion:tc_posiciones_vehiculo(*)").eq("revision_id", revisionId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RevisionDetalle[];
}

export async function completarRevision(revisionId: string): Promise<void> {
  const { error } = await supabase.rpc("tc_completar_revision", { p_revision: revisionId });
  if (error) throw new Error(error.message);
}

export async function listarRevisiones(vehiculoId?: string): Promise<RevisionVehiculo[]> {
  let q = supabase.from("revisiones_vehiculo").select("*, vehiculo:tc_vehiculos(*)")
    .order("fecha_revision", { ascending: false }).order("created_at", { ascending: false });
  if (vehiculoId) q = q.eq("vehiculo_id", vehiculoId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const revisiones = (data ?? []) as unknown as RevisionVehiculo[];

  // Nombre del técnico: consulta aparte (no join embebido, que puede fallar
  // por RLS/relaciones). Best-effort: si no se puede leer, queda sin nombre.
  const tecnicoIds = [...new Set(revisiones.map((r) => r.tecnico_id).filter(Boolean))] as string[];
  if (tecnicoIds.length > 0) {
    const { data: tecnicos } = await supabase.from("tc_usuarios").select("id, nombre").in("id", tecnicoIds);
    const mapa = new Map((tecnicos ?? []).map((t: any) => [t.id as string, t.nombre as string]));
    for (const r of revisiones) r.tecnico_nombre = r.tecnico_id ? (mapa.get(r.tecnico_id) ?? null) : null;
  }
  return revisiones;
}

// ── Fase 8: Autorizaciones ──────────────────────────────────────
export async function listarAutorizacionesPendientes(): Promise<AutorizacionOperacion[]> {
  const { data, error } = await supabase.from("autorizaciones_operaciones")
    .select("*, operacion:operaciones_neumaticos(*)").eq("estado", "pendiente").order("fecha_solicitud", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AutorizacionOperacion[];
}

export async function resolverAutorizacion(id: string, aprobar: boolean): Promise<void> {
  const { error } = await supabase.from("autorizaciones_operaciones")
    .update({ estado: aprobar ? "aprobada" : "rechazada", autorizado_por: (await supabase.auth.getUser()).data.user?.id, fecha_autorizacion: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Fase 9: Catálogos de marca / modelo / medida ────────────────
export async function listarMarcas(): Promise<MarcaNeumatico[]> {
  const { data, error } = await supabase.from("tc_cat_marcas_neumatico").select("*").eq("activo", true).order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as MarcaNeumatico[];
}
export async function crearMarca(nombre: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_marcas_neumatico").insert({ nombre: nombre.trim() });
  if (error) throw new Error(error.message);
}
export async function actualizarMarca(id: string, patch: {
  nombre?: string; logo_url?: string | null; fabricante_id?: string | null;
  pais_origen?: string | null; segmento?: string | null; tipo_principal?: string | null; observaciones?: string | null;
}): Promise<void> {
  const payload: Record<string, any> = {};
  if (patch.nombre != null) payload.nombre = patch.nombre.trim();
  if (patch.logo_url !== undefined) payload.logo_url = patch.logo_url;
  if (patch.fabricante_id !== undefined) payload.fabricante_id = patch.fabricante_id;
  if (patch.pais_origen !== undefined) payload.pais_origen = patch.pais_origen;
  if (patch.segmento !== undefined) payload.segmento = patch.segmento;
  if (patch.tipo_principal !== undefined) payload.tipo_principal = patch.tipo_principal;
  if (patch.observaciones !== undefined) payload.observaciones = patch.observaciones;
  const { error } = await supabase.from("tc_cat_marcas_neumatico").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarMarca(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_marcas_neumatico").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listarContadoresMarcas(): Promise<MarcaContadores[]> {
  const { data, error } = await supabase.from("tc_marcas_contadores").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as MarcaContadores[];
}

// ── Fabricantes ──────────────────────────────────────────────
export async function listarFabricantes(): Promise<Fabricante[]> {
  const { data, error } = await supabase.from("tc_cat_fabricantes").select("*").eq("activo", true).order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Fabricante[];
}
export async function crearFabricante(nombre: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_fabricantes").insert({ nombre: nombre.trim() });
  if (error) throw new Error(error.message);
}
export async function actualizarFabricante(id: string, patch: Partial<Omit<Fabricante, "id">>): Promise<void> {
  const { error } = await supabase.from("tc_cat_fabricantes").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarFabricante(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_fabricantes").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

const BUCKET_MARCAS = "tc-marcas";
export async function subirLogoMarca(marcaId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop() || "png";
  const ruta = `${marcaId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET_MARCAS).upload(ruta, file, { upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET_MARCAS).getPublicUrl(ruta).data.publicUrl;
}

export async function listarModelos(marcaId?: string): Promise<ModeloNeumatico[]> {
  let q = supabase.from("tc_cat_modelos_neumatico").select("*").eq("activo", true).order("nombre");
  if (marcaId) q = q.eq("marca_id", marcaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ModeloNeumatico[];
}
export async function crearModelo(marcaId: string | null, nombre: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_modelos_neumatico").insert({ marca_id: marcaId, nombre: nombre.trim() });
  if (error) throw new Error(error.message);
}
export async function actualizarModelo(id: string, nombre: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_modelos_neumatico").update({ nombre: nombre.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarModelo(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_modelos_neumatico").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listarMedidas(): Promise<MedidaNeumatico[]> {
  const { data, error } = await supabase.from("tc_cat_medidas_neumatico").select("*").eq("activo", true).order("valor");
  if (error) throw new Error(error.message);
  return (data ?? []) as MedidaNeumatico[];
}

// Medidas homologadas para un tipo de vehículo. Si el tipo no tiene
// ninguna configurada todavía, devuelve todas (comportamiento "abierto").
export async function listarMedidasCompatibles(tipoVehiculoId: string | null | undefined): Promise<MedidaNeumatico[]> {
  if (!tipoVehiculoId) return listarMedidas();
  const { data: vinculos, error: e1 } = await supabase
    .from("tc_medidas_tipo_vehiculo").select("medida_id").eq("tipo_vehiculo_id", tipoVehiculoId);
  if (e1) throw new Error(e1.message);
  if (!vinculos || vinculos.length === 0) return listarMedidas();
  const ids = vinculos.map((v) => v.medida_id);
  const { data, error } = await supabase.from("tc_cat_medidas_neumatico").select("*").eq("activo", true).in("id", ids).order("valor");
  if (error) throw new Error(error.message);
  return (data ?? []) as MedidaNeumatico[];
}

export async function listarTiposDeMedida(medidaId: string): Promise<string[]> {
  const { data, error } = await supabase.from("tc_medidas_tipo_vehiculo").select("tipo_vehiculo_id").eq("medida_id", medidaId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.tipo_vehiculo_id);
}

export async function fijarTiposDeMedida(medidaId: string, tipoVehiculoIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from("tc_medidas_tipo_vehiculo").delete().eq("medida_id", medidaId);
  if (delErr) throw new Error(delErr.message);
  if (tipoVehiculoIds.length === 0) return;
  const { error } = await supabase.from("tc_medidas_tipo_vehiculo")
    .insert(tipoVehiculoIds.map((tipo_vehiculo_id) => ({ medida_id: medidaId, tipo_vehiculo_id })));
  if (error) throw new Error(error.message);
}
export async function crearMedida(valor: string): Promise<string> {
  const v = valor.trim();
  // Reutiliza si ya existe (evita duplicados por unique).
  const { data: ya } = await supabase.from("tc_cat_medidas_neumatico").select("id").eq("valor", v).limit(1).maybeSingle();
  if (ya) return (ya as { id: string }).id;
  const { data, error } = await supabase.from("tc_cat_medidas_neumatico").insert({ valor: v }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

// ── Configuración de ejes (catálogo editable) ────────────────
export async function listarConfigEjes(): Promise<ConfigEjes[]> {
  const { data, error } = await supabase.from("tc_config_ejes").select("*").eq("activo", true).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as ConfigEjes[];
}
export async function crearConfigEjes(nombre: string, descripcion?: string): Promise<void> {
  const { error } = await supabase.from("tc_config_ejes").insert({ nombre: nombre.trim(), descripcion: descripcion?.trim() || null });
  if (error) throw new Error(error.message);
}
export async function desactivarConfigEjes(id: string): Promise<void> {
  const { error } = await supabase.from("tc_config_ejes").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Umbrales de profundidad por empresa ──────────────────────
export async function obtenerUmbralesEmpresa(empresaId: string): Promise<UmbralesEmpresa | null> {
  const { data, error } = await supabase.from("tc_config_umbrales").select("*").eq("empresa_id", empresaId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as UmbralesEmpresa) ?? null;
}

export async function guardarUmbralesEmpresa(empresaId: string, patch: {
  profundidad_minima_mm: number; profundidad_aviso_mm: number; presion_tolerancia_bar: number;
}): Promise<void> {
  const { error } = await supabase.from("tc_config_umbrales")
    .upsert({ empresa_id: empresaId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "empresa_id" });
  if (error) throw new Error(error.message);
}

// Overrides de umbrales por medida dentro de una empresa
export async function listarUmbralesMedida(empresaId: string): Promise<UmbralMedida[]> {
  const { data, error } = await supabase.from("tc_config_umbrales_medida").select("*").eq("empresa_id", empresaId).order("medida");
  if (error) throw new Error(error.message);
  return (data ?? []) as UmbralMedida[];
}

export async function guardarUmbralMedida(empresaId: string, medida: string, patch: {
  profundidad_minima_mm: number; profundidad_aviso_mm: number;
}): Promise<void> {
  const { error } = await supabase.from("tc_config_umbrales_medida")
    .upsert({ empresa_id: empresaId, medida, ...patch, updated_at: new Date().toISOString() }, { onConflict: "empresa_id,medida" });
  if (error) throw new Error(error.message);
}

export async function eliminarUmbralMedida(empresaId: string, medida: string): Promise<void> {
  const { error } = await supabase.from("tc_config_umbrales_medida").delete().eq("empresa_id", empresaId).eq("medida", medida);
  if (error) throw new Error(error.message);
}

// Categoría de una medida del catálogo (turismo/4x4/furgoneta/camion/otros)
export async function actualizarMedidaCategoria(medidaId: string, categoria: string | null): Promise<void> {
  const { error } = await supabase.from("tc_cat_medidas_neumatico").update({ categoria }).eq("id", medidaId);
  if (error) throw new Error(error.message);
}

// Overrides de umbrales por categoría dentro de una empresa
export async function listarUmbralesCategoria(empresaId: string): Promise<UmbralCategoria[]> {
  const { data, error } = await supabase.from("tc_config_umbrales_categoria").select("*").eq("empresa_id", empresaId);
  if (error) throw new Error(error.message);
  return (data ?? []) as UmbralCategoria[];
}

export async function guardarUmbralCategoria(empresaId: string, categoria: string, patch: {
  profundidad_minima_mm: number; profundidad_aviso_mm: number;
}): Promise<void> {
  const { error } = await supabase.from("tc_config_umbrales_categoria")
    .upsert({ empresa_id: empresaId, categoria, ...patch, updated_at: new Date().toISOString() }, { onConflict: "empresa_id,categoria" });
  if (error) throw new Error(error.message);
}

export async function eliminarUmbralCategoria(empresaId: string, categoria: string): Promise<void> {
  const { error } = await supabase.from("tc_config_umbrales_categoria").delete().eq("empresa_id", empresaId).eq("categoria", categoria);
  if (error) throw new Error(error.message);
}

// ── Precios de referencia por medida (para ahorros) ──────────
export async function listarPreciosMedida(empresaId: string): Promise<PrecioMedida[]> {
  const { data, error } = await supabase.from("tc_precios_medida").select("*").eq("empresa_id", empresaId).order("medida");
  if (error) throw new Error(error.message);
  return (data ?? []) as PrecioMedida[];
}

export async function guardarPrecioMedida(empresaId: string, medida: string, patch: {
  precio_nuevo: number | null; precio_recauchutado: number | null;
}): Promise<void> {
  const { error } = await supabase.from("tc_precios_medida")
    .upsert({ empresa_id: empresaId, medida, ...patch, updated_at: new Date().toISOString() }, { onConflict: "empresa_id,medida" });
  if (error) throw new Error(error.message);
}

export async function eliminarPrecioMedida(empresaId: string, medida: string): Promise<void> {
  const { error } = await supabase.from("tc_precios_medida").delete().eq("empresa_id", empresaId).eq("medida", medida);
  if (error) throw new Error(error.message);
}

// Coste de una operación (material + mano de obra)
export async function actualizarCosteOperacion(id: string, patch: {
  coste_material: number | null; coste_mano_obra: number | null;
}): Promise<void> {
  const { error } = await supabase.from("operaciones_neumaticos").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Webfleet: credenciales por empresa (cliente) ─────────────
export async function obtenerWebfleetConfig(empresaId: string): Promise<WebfleetConfig | null> {
  const { data, error } = await supabase.from("tc_webfleet_config").select("*").eq("empresa_id", empresaId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WebfleetConfig) ?? null;
}

export async function guardarWebfleetConfig(empresaId: string, patch: Partial<Omit<WebfleetConfig, "empresa_id">>): Promise<void> {
  const { error } = await supabase.from("tc_webfleet_config")
    .upsert({ empresa_id: empresaId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "empresa_id" });
  if (error) throw new Error(error.message);
}

// ── Webfleet: vehículos en base ─────────────────────────────────
const WF_API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

export async function listarEstadoWebfleet(): Promise<VehiculoWebfleetEstado[]> {
  const { data, error } = await supabase
    .from("tc_vehiculo_webfleet_estado")
    .select("*, delegacion:tc_delegaciones(id, nombre)");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as VehiculoWebfleetEstado[];
}

// Lanza un ciclo de sincronización en el backend y devuelve nº actualizados.
export async function sincronizarWebfleet(): Promise<{ actualizados?: number; error?: string }> {
  const r = await fetch(`${WF_API_BASE}/api/tyrecontrol/webfleet/sync`, { method: "POST" });
  try { return await r.json(); } catch { return { error: `HTTP ${r.status}` }; }
}

// Estado de revisión (periodicidad) por vehículo.
export async function listarRevisionEstado(): Promise<RevisionEstado[]> {
  const { data, error } = await supabase.rpc("tc_revision_estado");
  if (error) throw new Error(error.message);
  return (data ?? []) as RevisionEstado[];
}

export async function actualizarIntervaloRevisionTipo(tipoId: string, dias: number | null): Promise<void> {
  const { error } = await supabase.from("tc_tipos_vehiculo").update({ revision_intervalo_dias: dias }).eq("id", tipoId);
  if (error) throw new Error(error.message);
}

export async function listarRevisionFlags(): Promise<RevisionFlag[]> {
  const { data, error } = await supabase.from("tc_vehiculo_revision_flag").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as RevisionFlag[];
}

export async function guardarRevisionFlag(vehiculoId: string, empresaId: string, patch: Partial<Omit<RevisionFlag, "vehiculo_id" | "empresa_id">>): Promise<void> {
  const { error } = await supabase.from("tc_vehiculo_revision_flag")
    .upsert({ vehiculo_id: vehiculoId, empresa_id: empresaId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "vehiculo_id" });
  if (error) throw new Error(error.message);
}

// ── Planificación de revisiones periódicas (mantenimiento) ──────
const COLS_PLAN = [
  "empresa_id", "vehiculo_id", "operacion_id", "nombre", "descripcion",
  "frecuencia_dias", "frecuencia_meses", "frecuencia_km", "frecuencia_horas", "fecha_fija",
  "ultima_fecha", "ultima_km", "ultima_horas", "proxima_fecha", "proxima_km", "proxima_horas",
  "ajuste_manual", "margen_aviso_dias", "prioridad_manual", "estado_manual",
  "delegacion_id", "tecnico_id", "observaciones", "activo",
] as const;

export async function listarOperacionesMantenimiento(): Promise<OperacionMantenimiento[]> {
  const { data, error } = await supabase.from("tc_operaciones_mantenimiento").select("*").eq("activo", true).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as OperacionMantenimiento[];
}

export async function listarPlanesMantenimiento(vehiculoId?: string): Promise<PlanMantenimiento[]> {
  let q = supabase.from("tc_planes_mantenimiento").select("*, operacion:tc_operaciones_mantenimiento(*)").eq("activo", true);
  if (vehiculoId) q = q.eq("vehiculo_id", vehiculoId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlanMantenimiento[];
}

export async function listarPlanEstado(): Promise<PlanEstado[]> {
  const { data, error } = await supabase.rpc("tc_plan_estado");
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanEstado[];
}

// ── Presiones objetivo (para incidencias de presión) ───────────
export interface PresionObjetivo {
  id: string;
  empresa_id?: string | null;
  tipo_vehiculo_id?: string | null;
  vehiculo_id?: string | null;
  eje?: number | null;
  presion_objetivo_bar: number;
  margen_bar: number;
}

export async function listarPresionesObjetivo(): Promise<PresionObjetivo[]> {
  const { data, error } = await supabase
    .from("tc_presiones_objetivo")
    .select("*")
    .order("tipo_vehiculo_id")
    .order("eje", { nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PresionObjetivo[];
}

export async function guardarPresionObjetivo(input: {
  tipo_vehiculo_id?: string | null;
  vehiculo_id?: string | null;
  eje?: number | null;
  presion_objetivo_bar: number;
  margen_bar?: number;
  empresa_id?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("tc_presiones_objetivo").insert({
    tipo_vehiculo_id: input.tipo_vehiculo_id ?? null,
    vehiculo_id: input.vehiculo_id ?? null,
    eje: input.eje ?? null,
    presion_objetivo_bar: input.presion_objetivo_bar,
    margen_bar: input.margen_bar ?? 0.5,
    empresa_id: input.empresa_id ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function eliminarPresionObjetivo(id: string): Promise<void> {
  const { error } = await supabase.from("tc_presiones_objetivo").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function guardarPlanMantenimiento(plan: Partial<PlanMantenimientoInput> & { id?: string }): Promise<void> {
  const payload = pick(plan as any, COLS_PLAN);
  const { error } = plan.id
    ? await supabase.from("tc_planes_mantenimiento").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", plan.id)
    : await supabase.from("tc_planes_mantenimiento").insert(payload);
  if (error) throw new Error(error.message);
}

export async function eliminarPlanMantenimiento(id: string): Promise<void> {
  const { error } = await supabase.from("tc_planes_mantenimiento").update({ activo: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Acción masiva sobre varios planes (asignar técnico, activar/desactivar…).
export async function actualizarPlanesMasivo(ids: string[], patch: { tecnico_id?: string | null; activo?: boolean; delegacion_id?: string | null }): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from("tc_planes_mantenimiento").update({ ...patch, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) throw new Error(error.message);
}

// Registra una revisión realizada y actualiza el plan (última fecha/km/horas;
// se recalcula la próxima quitando el ajuste manual).
export async function registrarMantenimiento(input: {
  plan: PlanMantenimiento;
  fecha: string; tecnicoId?: string | null; km?: number | null; horas?: number | null;
  resultado?: string | null; observaciones?: string | null;
}): Promise<void> {
  const { plan } = input;
  const ins = await supabase.from("tc_mantenimiento_realizadas").insert({
    empresa_id: plan.empresa_id, vehiculo_id: plan.vehiculo_id, plan_id: plan.id, operacion_id: plan.operacion_id,
    fecha: input.fecha, tecnico_id: input.tecnicoId ?? null, km: input.km ?? null, horas: input.horas ?? null,
    resultado: input.resultado ?? null, observaciones: input.observaciones ?? null,
  });
  if (ins.error) throw new Error(ins.error.message);
  const upd = await supabase.from("tc_planes_mantenimiento").update({
    ultima_fecha: input.fecha, ultima_km: input.km ?? plan.ultima_km, ultima_horas: input.horas ?? plan.ultima_horas,
    ajuste_manual: false, estado_manual: null, updated_at: new Date().toISOString(),
  }).eq("id", plan.id);
  if (upd.error) throw new Error(upd.error.message);
}

// ── Plantillas de mantenimiento ────────────────────────────────
export async function listarPlantillas(): Promise<PlantillaMantenimiento[]> {
  const { data, error } = await supabase.from("tc_plantillas_mantenimiento")
    .select("*, items:tc_plantilla_items(*, operacion:tc_operaciones_mantenimiento(*))").eq("activo", true).order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlantillaMantenimiento[];
}

export async function guardarPlantilla(p: { id?: string; nombre: string; descripcion?: string | null; tipo_vehiculo_id?: string | null }): Promise<string> {
  if (p.id) {
    const { error } = await supabase.from("tc_plantillas_mantenimiento").update({ nombre: p.nombre, descripcion: p.descripcion ?? null, tipo_vehiculo_id: p.tipo_vehiculo_id ?? null }).eq("id", p.id);
    if (error) throw new Error(error.message);
    return p.id;
  }
  const { data, error } = await supabase.from("tc_plantillas_mantenimiento").insert({ nombre: p.nombre, descripcion: p.descripcion ?? null, tipo_vehiculo_id: p.tipo_vehiculo_id ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as any).id;
}

export async function eliminarPlantilla(id: string): Promise<void> {
  const { error } = await supabase.from("tc_plantillas_mantenimiento").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function guardarPlantillaItem(item: PlantillaItem & { plantilla_id: string }): Promise<void> {
  const payload = {
    plantilla_id: item.plantilla_id, operacion_id: item.operacion_id, nombre: item.nombre ?? null,
    frecuencia_dias: item.frecuencia_dias ?? null, frecuencia_meses: item.frecuencia_meses ?? null,
    frecuencia_km: item.frecuencia_km ?? null, frecuencia_horas: item.frecuencia_horas ?? null,
    margen_aviso_dias: item.margen_aviso_dias ?? 15, tiempo_estimado_min: item.tiempo_estimado_min ?? null,
  };
  const { error } = item.id
    ? await supabase.from("tc_plantilla_items").update(payload).eq("id", item.id)
    : await supabase.from("tc_plantilla_items").insert(payload);
  if (error) throw new Error(error.message);
}

export async function eliminarPlantillaItem(id: string): Promise<void> {
  const { error } = await supabase.from("tc_plantilla_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Aplica una plantilla a varios vehículos (crea los planes). Devuelve nº creados.
export async function aplicarPlantilla(plantillaId: string, vehiculoIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("tc_aplicar_plantilla", { p_plantilla: plantillaId, p_vehiculos: vehiculoIds });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// ── Lotes de revisión (visitas conjuntas) ──────────────────────
export async function listarLotes(): Promise<LoteRevision[]> {
  const { data, error } = await supabase.from("tc_lotes_revision")
    .select("*, empresa:tc_empresas(*), delegacion:tc_delegaciones(*)")
    .order("fecha_prevista", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LoteRevision[];
}

export async function crearLote(input: {
  empresa_id: string; delegacion_id?: string | null; fecha_prevista?: string | null; hora_prevista?: string | null;
  tecnico_id?: string | null; observaciones?: string | null;
  vehiculos: { vehiculo_id: string; plan_id?: string | null }[];
}): Promise<string> {
  const ins = await supabase.from("tc_lotes_revision").insert({
    empresa_id: input.empresa_id, delegacion_id: input.delegacion_id ?? null, fecha_prevista: input.fecha_prevista ?? null,
    hora_prevista: input.hora_prevista ?? null, tecnico_id: input.tecnico_id ?? null, estado: "planificado",
    observaciones: input.observaciones ?? null,
  }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  const loteId = (ins.data as any).id as string;
  if (input.vehiculos.length > 0) {
    const filas = input.vehiculos.map((v, i) => ({ lote_id: loteId, vehiculo_id: v.vehiculo_id, plan_id: v.plan_id ?? null, orden: i }));
    const { error } = await supabase.from("tc_lote_vehiculos").insert(filas);
    if (error) throw new Error(error.message);
  }
  return loteId;
}

export async function listarLoteVehiculos(loteId: string): Promise<LoteVehiculo[]> {
  const { data, error } = await supabase.from("tc_lote_vehiculos")
    .select("*, vehiculo:tc_vehiculos(*)").eq("lote_id", loteId).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LoteVehiculo[];
}

export async function actualizarLoteVehiculoEstado(loteId: string, vehiculoId: string, estado: LoteVehiculo["estado"]): Promise<void> {
  const { error } = await supabase.from("tc_lote_vehiculos").update({ estado }).eq("lote_id", loteId).eq("vehiculo_id", vehiculoId);
  if (error) throw new Error(error.message);
}

export async function quitarLoteVehiculo(loteId: string, vehiculoId: string): Promise<void> {
  const { error } = await supabase.from("tc_lote_vehiculos").delete().eq("lote_id", loteId).eq("vehiculo_id", vehiculoId);
  if (error) throw new Error(error.message);
}

export async function actualizarLote(id: string, patch: Partial<Pick<LoteRevision, "fecha_prevista" | "hora_prevista" | "tecnico_id" | "estado" | "observaciones">>): Promise<void> {
  const { error } = await supabase.from("tc_lotes_revision").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function finalizarLote(id: string): Promise<void> {
  const { error } = await supabase.rpc("tc_finalizar_lote", { p_lote: id });
  if (error) throw new Error(error.message);
}

export async function listarMantenimientoRealizadas(vehiculoId: string): Promise<MantenimientoRealizada[]> {
  const { data, error } = await supabase.from("tc_mantenimiento_realizadas")
    .select("*, operacion:tc_operaciones_mantenimiento(*)").eq("vehiculo_id", vehiculoId).order("fecha", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MantenimientoRealizada[];
}

// Alertas internas de "vehículos en base".
export async function listarAlertasWebfleet(soloNoLeidas = true, limite = 50): Promise<WebfleetAlerta[]> {
  let q = supabase.from("tc_webfleet_alertas").select("*").order("created_at", { ascending: false }).limit(limite);
  if (soloNoLeidas) q = q.eq("leida", false);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as WebfleetAlerta[];
}

export async function marcarAlertaLeida(id: string): Promise<void> {
  const { error } = await supabase.from("tc_webfleet_alertas").update({ leida: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function marcarAlertasLeidas(): Promise<void> {
  const { error } = await supabase.from("tc_webfleet_alertas").update({ leida: true }).eq("leida", false);
  if (error) throw new Error(error.message);
}

export async function obtenerWebfleetSyncConfig(): Promise<WebfleetSyncConfig | null> {
  const { data, error } = await supabase.from("tc_webfleet_sync_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WebfleetSyncConfig) ?? null;
}

export async function guardarWebfleetSyncConfig(patch: Partial<Omit<WebfleetSyncConfig, "id">>): Promise<void> {
  const { error } = await supabase.from("tc_webfleet_sync_config")
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// Imagen de chasis asociada a la configuración de ejes: se sube una vez al
// catálogo y la heredan todos los vehículos con esa configuración (la imagen
// propia del tipo de vehículo, si existe, tiene prioridad).
export async function subirImagenConfigEjes(configId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop() || "png";
  const ruta = `config-ejes/${configId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from("tc-chasis").upload(ruta, file, { upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from("tc-chasis").getPublicUrl(ruta).data.publicUrl;
}

export async function actualizarImagenConfigEjes(configId: string, url: string | null): Promise<void> {
  const { error } = await supabase.from("tc_config_ejes").update({ imagen_chasis_url: url }).eq("id", configId);
  if (error) throw new Error(error.message);
}

// ── Tipos de llanta (catálogo editable: material + medida) ───
export async function listarTiposLlanta(): Promise<TipoLlanta[]> {
  const { data, error } = await supabase.from("tc_tipos_llanta").select("*").eq("activo", true).order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as TipoLlanta[];
}
export async function crearTipoLlanta(l: {
  material: string; medida: string;
  agujeros?: number | null; centrado?: string | null; tapacubo?: boolean;
}): Promise<void> {
  const { error } = await supabase.from("tc_tipos_llanta").insert({
    material: l.material.trim(),
    medida: l.medida.trim(),
    agujeros: l.agujeros ?? null,
    centrado: l.centrado || null,
    tapacubo: l.tapacubo ?? false,
  });
  if (error) throw new Error(error.message);
}
export async function desactivarTipoLlanta(id: string): Promise<void> {
  const { error } = await supabase.from("tc_tipos_llanta").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Desglose por eje de un vehículo ──────────────────────────
export async function listarEjesVehiculo(vehiculoId: string): Promise<VehiculoEje[]> {
  const { data, error } = await supabase.from("tc_vehiculo_ejes")
    .select("eje, ruedas, medida_id, tipo_llanta_id").eq("vehiculo_id", vehiculoId).order("eje");
  if (error) throw new Error(error.message);
  return (data ?? []) as VehiculoEje[];
}
export async function guardarEjesVehiculo(vehiculoId: string, ejes: VehiculoEje[]): Promise<void> {
  const { error } = await supabase.rpc("tc_set_vehiculo_ejes", { p_vehiculo: vehiculoId, p_ejes: ejes });
  if (error) throw new Error(error.message);
}

export async function listarIndicesCarga(): Promise<IndiceCarga[]> {
  const { data, error } = await supabase.from("tc_cat_indices_carga").select("*").eq("activo", true).order("valor");
  if (error) throw new Error(error.message);
  return (data ?? []) as IndiceCarga[];
}
export async function crearIndiceCarga(valor: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_indices_carga").insert({ valor: valor.trim() });
  if (error) throw new Error(error.message);
}

export async function listarIndicesVelocidad(): Promise<IndiceVelocidad[]> {
  const { data, error } = await supabase.from("tc_cat_indices_velocidad").select("*").eq("activo", true).order("valor");
  if (error) throw new Error(error.message);
  return (data ?? []) as IndiceVelocidad[];
}
export async function crearIndiceVelocidad(valor: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_indices_velocidad").insert({ valor: valor.trim() });
  if (error) throw new Error(error.message);
}

export async function listarMotivosFueraAlmacen(): Promise<MotivoFueraAlmacen[]> {
  const { data, error } = await supabase.from("tc_cat_motivos_fuera_almacen").select("*").eq("activo", true).order("motivo");
  if (error) throw new Error(error.message);
  return (data ?? []) as MotivoFueraAlmacen[];
}
export async function crearMotivoFueraAlmacen(motivo: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_motivos_fuera_almacen").insert({ motivo: motivo.trim() });
  if (error) throw new Error(error.message);
}
export async function actualizarMotivoFueraAlmacen(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_motivos_fuera_almacen").update({ motivo: motivo.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarMotivoFueraAlmacen(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_motivos_fuera_almacen").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Catálogo configurable de tipos de incidencia ─────────────
const COLS_TIPO_INCIDENCIA = ["clave", "etiqueta", "icono", "gravedad_sugerida", "operacion_sugerida", "orden"] as const;

export async function listarTiposIncidencia(soloActivos = false): Promise<TipoIncidencia[]> {
  let query = supabase.from("tc_cat_tipos_incidencia").select("*").order("orden").order("etiqueta");
  if (soloActivos) query = query.eq("activo", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as TipoIncidencia[];
}
export async function crearTipoIncidencia(input: TipoIncidenciaInput): Promise<void> {
  const { error } = await supabase.from("tc_cat_tipos_incidencia").insert(pick(input, COLS_TIPO_INCIDENCIA));
  if (error) throw new Error(error.message);
}
export async function actualizarTipoIncidencia(id: string, patch: Partial<TipoIncidenciaInput> & { activo?: boolean }): Promise<void> {
  const cols = [...COLS_TIPO_INCIDENCIA, "activo"] as const;
  const { error } = await supabase.from("tc_cat_tipos_incidencia").update(pick(patch, cols)).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarTipoIncidencia(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_tipos_incidencia").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Catálogo configurable de motivos "pendiente" ─────────────
const COLS_MOTIVO_PENDIENTE = ["clave", "etiqueta", "orden"] as const;

export async function listarMotivosPendiente(soloActivos = false): Promise<MotivoPendiente[]> {
  let query = supabase.from("tc_cat_motivos_pendiente").select("*").order("orden").order("etiqueta");
  if (soloActivos) query = query.eq("activo", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MotivoPendiente[];
}
export async function crearMotivoPendiente(input: MotivoPendienteInput): Promise<void> {
  const { error } = await supabase.from("tc_cat_motivos_pendiente").insert(pick(input, COLS_MOTIVO_PENDIENTE));
  if (error) throw new Error(error.message);
}
export async function actualizarMotivoPendiente(id: string, patch: Partial<MotivoPendienteInput> & { activo?: boolean }): Promise<void> {
  const cols = [...COLS_MOTIVO_PENDIENTE, "activo"] as const;
  const { error } = await supabase.from("tc_cat_motivos_pendiente").update(pick(patch, cols)).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function eliminarMotivoPendiente(id: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_motivos_pendiente").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Fase 16: tyre_sizes (referencia completa: medida + carga + velocidad) ─
function construirMedidaTs(ancho: number, perfil: number | null | undefined, diametro: number): string {
  return perfil != null ? `${ancho}/${perfil} R${diametro}` : `${ancho} R${diametro}`;
}
function construirReferenciaTs(medida: string, cargaSimple: string, cargaDoble: string | null | undefined, codigoVelocidad: string): string {
  const cargas = cargaDoble ? `${cargaSimple}/${cargaDoble}` : cargaSimple;
  return `${medida} ${cargas}${codigoVelocidad}`;
}

export async function listarTyreSizes(filtros?: {
  q?: string; diametro?: number; indiceCarga?: string; codigoVelocidad?: string;
}): Promise<TyreSize[]> {
  let query = supabase.from("tyre_sizes").select("*").eq("activo", true).order("medida").order("indice_carga_simple");
  if (filtros?.diametro) query = query.eq("diametro_llanta", filtros.diametro);
  if (filtros?.indiceCarga) query = query.or(`indice_carga_simple.eq.${filtros.indiceCarga},indice_carga_doble.eq.${filtros.indiceCarga}`);
  if (filtros?.codigoVelocidad) query = query.eq("codigo_velocidad", filtros.codigoVelocidad);
  if (filtros?.q) query = query.ilike("referencia_completa", `%${filtros.q}%`);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as TyreSize[];
}

async function resolverMedidaId(medida: string): Promise<string> {
  const valorCanonico = medida.replace(/\s+/g, "");
  const { data: existente } = await supabase.from("tc_cat_medidas_neumatico").select("id").eq("valor", valorCanonico).maybeSingle();
  if (existente) return existente.id;
  const { data: creada, error } = await supabase.from("tc_cat_medidas_neumatico").insert({ valor: valorCanonico }).select("id").single();
  if (error) throw new Error(error.message);
  return creada.id;
}

export async function crearTyreSize(input: TyreSizeInput): Promise<string> {
  const medida = construirMedidaTs(input.ancho, input.perfil, input.diametro_llanta);
  const referencia_completa = construirReferenciaTs(medida, input.indice_carga_simple, input.indice_carga_doble, input.codigo_velocidad);
  const medida_id = await resolverMedidaId(medida);
  const { error } = await supabase.from("tyre_sizes").insert({
    medida, referencia_completa, medida_id,
    ancho: input.ancho, perfil: input.perfil ?? null, diametro_llanta: input.diametro_llanta,
    indice_carga_simple: input.indice_carga_simple, indice_carga_doble: input.indice_carga_doble ?? null,
    codigo_velocidad: input.codigo_velocidad, activo: input.activo,
  });
  if (error) throw new Error(error.message);
  return medida_id; // id de la medida (tc_cat_medidas_neumatico) para asignar al vehículo
}

export async function eliminarTyreSize(id: string): Promise<void> {
  const { error } = await supabase.from("tyre_sizes").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Fase 17: ficha técnica de modelo + referencia comercial ────
export async function actualizarModeloTecnico(id: string, patch: Partial<Omit<ModeloNeumatico, "id" | "marca_id" | "nombre" | "activo">>): Promise<void> {
  const { error } = await supabase.from("tc_cat_modelos_neumatico").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

const BUCKET_MODELOS = "tc-modelos-neumatico";
export async function subirFotoModelo(modeloId: string, file: File): Promise<string> {
  const extension = file.name.split(".").pop() || "webp";
  const ruta = `${modeloId}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET_MODELOS).upload(ruta, file, { upsert: true });
  if (error) throw new Error(error.message);
  const url = supabase.storage.from(BUCKET_MODELOS).getPublicUrl(ruta).data.publicUrl;
  await actualizarModeloTecnico(modeloId, { foto_modelo_url: url });
  return url;
}
export async function eliminarFotoModelo(modeloId: string): Promise<void> {
  await actualizarModeloTecnico(modeloId, { foto_modelo_url: null });
}

// Clave normalizada para casar un neumático (marca/modelo en texto libre)
// con su modelo de catálogo. Igual criterio que las presiones recomendadas.
export function claveModeloCatalogo(marca?: string | null, modelo?: string | null): string {
  return `${marca ?? ""}|${modelo ?? ""}`.toLowerCase().replace(/\s+/g, "");
}

// Fotos del catálogo por marca+modelo: la foto se sube UNA vez al modelo
// (Catálogo de neumáticos) y la hereda cualquier neumático de ese modelo
// en fichas, planos y listados.
export async function listarFotosCatalogoPorModelo(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("tc_cat_modelos_neumatico")
    .select("nombre, foto_modelo_url, marca:tc_cat_marcas_neumatico(nombre)")
    .not("foto_modelo_url", "is", null);
  if (error) throw new Error(error.message);
  const mapa: Record<string, string> = {};
  for (const m of (data ?? []) as any[]) {
    const marca = m.marca?.nombre as string | undefined;
    if (!marca || !m.nombre || !m.foto_modelo_url) continue;
    mapa[claveModeloCatalogo(marca, m.nombre)] = m.foto_modelo_url as string;
  }
  return mapa;
}

const REFERENCIA_SELECT = "*, modelo:tc_cat_modelos_neumatico(*, marca:tc_cat_marcas_neumatico(*)), tyre_size:tyre_sizes(*)";

export async function listarReferenciasNeumatico(filtros?: {
  q?: string; marcaId?: string; modeloId?: string; eje?: string; aplicacion?: string; ms?: boolean; tresPmsf?: boolean;
}): Promise<ReferenciaNeumatico[]> {
  let query = supabase.from("tc_referencias_neumatico").select(REFERENCIA_SELECT).eq("activo", true).order("referencia_completa");
  if (filtros?.modeloId) query = query.eq("modelo_id", filtros.modeloId);
  if (filtros?.q) query = query.ilike("referencia_completa", `%${filtros.q}%`);
  const { data, error } = await query.limit(500);
  if (error) throw new Error(error.message);
  let items = (data ?? []) as unknown as ReferenciaNeumatico[];
  if (filtros?.marcaId) items = items.filter((r) => r.modelo?.marca_id === filtros.marcaId);
  if (filtros?.eje) items = items.filter((r) => r.modelo?.eje_recomendado === filtros.eje);
  if (filtros?.aplicacion) items = items.filter((r) => r.modelo?.aplicacion === filtros.aplicacion);
  if (filtros?.ms !== undefined) items = items.filter((r) => !!r.modelo?.m_s === filtros.ms);
  if (filtros?.tresPmsf !== undefined) items = items.filter((r) => !!r.modelo?.tres_pmsf === filtros.tresPmsf);
  return items;
}

export async function obtenerReferenciaNeumatico(id: string): Promise<ReferenciaNeumatico | null> {
  const { data, error } = await supabase.from("tc_referencias_neumatico").select(REFERENCIA_SELECT).eq("id", id).maybeSingle();
  if (error) return null;
  return (data as unknown as ReferenciaNeumatico) ?? null;
}

export async function listarReferenciasDeModelo(modeloId: string): Promise<ReferenciaNeumatico[]> {
  const { data, error } = await supabase.from("tc_referencias_neumatico").select(REFERENCIA_SELECT)
    .eq("modelo_id", modeloId).eq("activo", true).order("referencia_completa");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReferenciaNeumatico[];
}

export async function actualizarReferenciaNeumatico(id: string, cambios: Partial<Pick<ReferenciaNeumatico,
  "profundidad_dibujo_mm" | "llanta_recomendada" | "diametro_exterior_mm" | "revoluciones_km" | "carga_maxima_kg" | "presion_maxima_bar" | "peso_kg" |
  "ply" | "ancho_seccion_mm" | "anchura_rodadura_mm" | "radio_carga_mm" | "etiqueta_rr" | "etiqueta_grip_humedo" | "etiqueta_ruido_db" | "etiqueta_ruido_clase"
>>): Promise<void> {
  const { error } = await supabase.from("tc_referencias_neumatico").update(cambios).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function eliminarReferenciaNeumatico(id: string): Promise<void> {
  const { error } = await supabase.from("tc_referencias_neumatico").update({ activo: false }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Alta de referencias en el catálogo (desde neumáticos manuales) ──
// Normaliza texto libre y clave de comparación marca|modelo|medida.
function normTexto(s?: string | null): string { return (s ?? "").trim().toLowerCase().replace(/\s+/g, " "); }
function normMedida(s?: string | null): string { return (s ?? "").toUpperCase().replace(/\s+/g, ""); }
function claveReferencia(marca?: string | null, modelo?: string | null, medida?: string | null): string {
  return `${normTexto(marca)}|${normTexto(modelo)}|${normMedida(medida)}`;
}

// Parsea una medida en texto libre (315/80R22.5, 385/65 R 22.5, 12R22.5, 315/70R22.5)
// devolviendo ancho / perfil / diámetro de llanta. Lanza si no es reconocible.
export function parsearMedida(medida: string): { ancho: number; perfil: number | null; diametro: number } {
  const m = medida.trim().match(/^(\d{2,3})(?:\s*\/\s*(\d{2,3}))?\s*R?\s*(\d{1,2}(?:[.,]\d)?)/i);
  if (!m) throw new Error(`No se reconoce la medida «${medida}». Usa un formato tipo 315/80R22.5`);
  return { ancho: Number(m[1]), perfil: m[2] != null ? Number(m[2]) : null, diametro: Number(m[3].replace(",", ".")) };
}

async function upsertMarca(nombre: string): Promise<string> {
  const n = nombre.trim();
  if (!n) throw new Error("La marca es obligatoria");
  const { data } = await supabase.from("tc_cat_marcas_neumatico").select("id").ilike("nombre", n).limit(1).maybeSingle();
  if (data) return (data as any).id;
  const { data: c, error } = await supabase.from("tc_cat_marcas_neumatico").insert({ nombre: n }).select("id").single();
  if (error) throw new Error(error.message);
  return (c as any).id;
}

async function upsertModelo(marcaId: string, nombre: string): Promise<string> {
  const n = nombre.trim();
  if (!n) throw new Error("El modelo es obligatorio");
  const { data } = await supabase.from("tc_cat_modelos_neumatico").select("id").eq("marca_id", marcaId).ilike("nombre", n).limit(1).maybeSingle();
  if (data) return (data as any).id;
  const { data: c, error } = await supabase.from("tc_cat_modelos_neumatico").insert({ marca_id: marcaId, nombre: n }).select("id").single();
  if (error) throw new Error(error.message);
  return (c as any).id;
}

async function upsertTyreSize(medida: string, icSimple: string, icDoble: string | null, velocidad: string): Promise<string> {
  const { ancho, perfil, diametro } = parsearMedida(medida);
  const medidaStr = construirMedidaTs(ancho, perfil, diametro);
  const referencia_completa = construirReferenciaTs(medidaStr, icSimple, icDoble, velocidad);
  const { data } = await supabase.from("tyre_sizes").select("id").eq("referencia_completa", referencia_completa).limit(1).maybeSingle();
  if (data) return (data as any).id;
  const medida_id = await resolverMedidaId(medidaStr);
  const { data: c, error } = await supabase.from("tyre_sizes").insert({
    medida: medidaStr, referencia_completa, medida_id, ancho, perfil, diametro_llanta: diametro,
    indice_carga_simple: icSimple, indice_carga_doble: icDoble, codigo_velocidad: velocidad, activo: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return (c as any).id;
}

// Crea (o reutiliza) la referencia de catálogo para una combinación
// marca/modelo/medida. Reaprovecha marca, modelo y tyre_size existentes.
export async function crearReferenciaNeumatico(input: {
  marca: string; modelo: string; medida: string;
  indiceCargaSimple: string; indiceCargaDoble?: string | null; codigoVelocidad: string;
}): Promise<string> {
  const icSimple = input.indiceCargaSimple.trim();
  const velocidad = input.codigoVelocidad.trim().toUpperCase();
  if (!icSimple) throw new Error("Falta el índice de carga");
  if (!velocidad) throw new Error("Falta el código de velocidad");
  const marcaId = await upsertMarca(input.marca);
  const modeloId = await upsertModelo(marcaId, input.modelo);
  const tyreSizeId = await upsertTyreSize(input.medida, icSimple, input.indiceCargaDoble?.trim() || null, velocidad);

  const { data: exist } = await supabase.from("tc_referencias_neumatico")
    .select("id, activo").eq("modelo_id", modeloId).eq("tyre_size_id", tyreSizeId).limit(1).maybeSingle();
  if (exist) {
    if (!(exist as any).activo) await supabase.from("tc_referencias_neumatico").update({ activo: true }).eq("id", (exist as any).id);
    return (exist as any).id;
  }
  const { data: ts } = await supabase.from("tyre_sizes").select("referencia_completa").eq("id", tyreSizeId).single();
  const referencia_completa = `${input.marca.trim()} ${input.modelo.trim()} ${(ts as any)?.referencia_completa ?? input.medida}`.trim();
  const { data: c, error } = await supabase.from("tc_referencias_neumatico")
    .insert({ modelo_id: modeloId, tyre_size_id: tyreSizeId, referencia_completa, activo: true }).select("id").single();
  if (error) throw new Error(error.message);
  return (c as any).id;
}

// Detecta combinaciones marca/modelo/medida presentes en neumáticos reales
// que aún NO tienen referencia en el catálogo.
export interface ComboSinCatalogar {
  marca: string; modelo: string; medida: string;
  indice_carga: string | null; indice_velocidad: string | null;
  cantidad: number; empresas: string[];
}
export async function listarNeumaticosSinCatalogar(empresaId?: string): Promise<ComboSinCatalogar[]> {
  const { data: refs, error: refErr } = await supabase.from("tc_referencias_neumatico")
    .select("modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes(medida)")
    .eq("activo", true).limit(5000);
  if (refErr) throw new Error(refErr.message);
  const catalogadas = new Set<string>();
  for (const r of (refs ?? []) as any[]) {
    catalogadas.add(claveReferencia(r.modelo?.marca?.nombre, r.modelo?.nombre, r.tyre_size?.medida));
  }

  let q = supabase.from("tc_neumaticos")
    .select("marca, modelo, medida, indice_carga, indice_velocidad, empresa:tc_empresas(nombre)")
    .eq("activo", true).limit(5000);
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data: neus, error } = await q;
  if (error) throw new Error(error.message);

  const mapa = new Map<string, ComboSinCatalogar>();
  for (const n of (neus ?? []) as any[]) {
    if (!n.marca || !n.modelo || !n.medida) continue; // sin datos suficientes
    const clave = claveReferencia(n.marca, n.modelo, n.medida);
    if (catalogadas.has(clave)) continue;
    const emp = n.empresa?.nombre as string | undefined;
    const found = mapa.get(clave);
    if (found) {
      found.cantidad += 1;
      if (emp && !found.empresas.includes(emp)) found.empresas.push(emp);
    } else {
      mapa.set(clave, {
        marca: String(n.marca).trim(), modelo: String(n.modelo).trim(), medida: String(n.medida).trim(),
        indice_carga: n.indice_carga ?? null, indice_velocidad: n.indice_velocidad ?? null,
        cantidad: 1, empresas: emp ? [emp] : [],
      });
    }
  }
  return Array.from(mapa.values()).sort((a, b) => b.cantidad - a.cantidad);
}
