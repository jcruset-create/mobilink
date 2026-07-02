import { supabase } from "./supabase";
import type {
  Delegacion, DelegacionInput, Empresa, EmpresaInput, Perfil, Rol,
  TipoVehiculo, PosicionVehiculo, Vehiculo, VehiculoInput,
  Neumatico, NeumaticoInput, MontajeActual, HistorialMontaje, DestinoDesmontaje, MotivoDesmontaje,
  ClienteAlmacen, ProductoAlmacen, OperacionNeumatico, TipoOperacion, FichaGenerica,
  RevisionVehiculo, RevisionDetalle, AutorizacionOperacion,
  MarcaNeumatico, ModeloNeumatico, MedidaNeumatico,
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

const COLS_EMPRESA = ["nombre", "cif", "telefono", "email", "direccion", "ciudad", "provincia", "codigo_postal", "pais", "activo"] as const;
const COLS_DELEGACION = ["empresa_id", "nombre", "direccion", "ciudad", "provincia", "codigo_postal", "pais", "responsable", "telefono", "email", "activo"] as const;
const COLS_VEHICULO = ["empresa_id", "delegacion_id", "tipo_vehiculo_id", "matricula", "marca", "modelo", "bastidor", "fecha_matriculacion", "webfleet_vehicle_id", "km_actual", "origen_km", "activo"] as const;
const COLS_NEUMATICO = ["empresa_id", "codigo_interno", "numero_serie", "dot", "marca", "modelo", "medida", "indice_carga", "indice_velocidad", "rfid_epc", "estado", "fecha_compra", "coste_compra", "proveedor", "referencia_almacen", "activo", "almacen_producto_id"] as const;

// ── Empresas ─────────────────────────────────────────────────
export async function listarEmpresas(): Promise<Empresa[]> {
  const { data, error } = await supabase.from("tc_empresas").select("*").order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Empresa[];
}

export async function obtenerEmpresa(id: string): Promise<Empresa | null> {
  const { data, error } = await supabase.from("tc_empresas").select("*").eq("id", id).single();
  if (error) return null;
  return data as Empresa;
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
  let query = supabase.from("tc_productos_almacen").select("*").order("medida");
  if (q) query = query.or(`marca.ilike.%${q}%,medida.ilike.%${q}%,modelo.ilike.%${q}%`);
  const { data, error } = await query.limit(100);
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
  let q = supabase.from("tc_usuarios").select("*, empresa:tc_empresas(*), delegacion:tc_delegaciones(*)").order("nombre");
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

export async function guardarCoordenadasPosicion(id: string, coords: { pos_x: number; pos_y: number; pos_w: number; pos_h: number }): Promise<void> {
  const { error } = await supabase.from("tc_posiciones_vehiculo").update(coords).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Vehículos ────────────────────────────────────────────────
const VEHICULO_SELECT = "*, empresa:tc_empresas(*), delegacion:tc_delegaciones(*), tipo:tc_tipos_vehiculo(*)";

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

export async function crearVehiculo(input: VehiculoInput): Promise<void> {
  const payload = pick(input, COLS_VEHICULO);
  payload.matricula = String(input.matricula ?? "").trim().toUpperCase();
  const { error } = await supabase.from("tc_vehiculos").insert(payload);
  if (error) throw new Error(error.message);
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
    .select("*, neumatico:tc_neumaticos(*), posicion:tc_posiciones_vehiculo(*)")
    .eq("vehiculo_id", vehiculoId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MontajeActual[];
}

export async function montarNeumatico(params: {
  vehiculoId: string; neumaticoId: string; posicionId: string; km?: number | null; fecha?: string | null; observaciones?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("tc_montar_neumatico", {
    p_vehiculo: params.vehiculoId, p_neumatico: params.neumaticoId, p_posicion: params.posicionId,
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
  });
  if (error) throw new Error(error.message);
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

export async function historialNeumatico(neumaticoId: string): Promise<HistorialMontaje[]> {
  const { data, error } = await supabase.from("tc_historial_montajes").select("*")
    .eq("neumatico_id", neumaticoId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HistorialMontaje[];
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

// ── Fase 8: Montaje desde almacén (genérico/individual) y fuera de almacén ─
export async function montarDesdeAlmacen(params: {
  vehiculoId: string; posicionId: string; fichaGenericaId: string; controlIndividual: boolean;
  datos?: Record<string, string>; km?: number | null; fecha?: string | null; observaciones?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_montar_desde_almacen", {
    p_vehiculo: params.vehiculoId, p_posicion: params.posicionId, p_ficha_generica: params.fichaGenericaId,
    p_control_individual: params.controlIndividual, p_datos: params.datos ?? {},
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
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
  montajeActualId: string; fichaGenericaId: string; controlIndividual: boolean; datos?: Record<string, string>;
  motivoDesmontaje: MotivoDesmontaje; destinoRetirado: DestinoDesmontaje;
  km?: number | null; fecha?: string | null; observaciones?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("tc_sustituir_neumatico", {
    p_montaje_actual: params.montajeActualId, p_ficha_generica: params.fichaGenericaId,
    p_control_individual: params.controlIndividual, p_datos: params.datos ?? {},
    p_motivo_desmontaje: params.motivoDesmontaje, p_destino_retirado: params.destinoRetirado,
    p_km: params.km ?? null, p_fecha: params.fecha ?? null, p_obs: params.observaciones ?? null,
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

// ── Fase 8: Operaciones (listado/filtros) ──────────────────────
const OPERACION_SELECT = "*, empresa:tc_empresas(*), vehiculo:tc_vehiculos(*), neumatico:tc_neumaticos(*), posicion_origen:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_origen_id_fkey(*), posicion_destino:tc_posiciones_vehiculo!operaciones_neumaticos_posicion_destino_id_fkey(*)";

export async function listarOperaciones(filtros?: {
  empresaId?: string; vehiculoId?: string; tipo?: TipoOperacion; desde?: string; hasta?: string;
}): Promise<OperacionNeumatico[]> {
  let q = supabase.from("operaciones_neumaticos").select(OPERACION_SELECT).order("created_at", { ascending: false }).limit(200);
  if (filtros?.empresaId) q = q.eq("empresa_id", filtros.empresaId);
  if (filtros?.vehiculoId) q = q.eq("vehiculo_id", filtros.vehiculoId);
  if (filtros?.tipo) q = q.eq("tipo_operacion", filtros.tipo);
  if (filtros?.desde) q = q.gte("fecha_operacion", filtros.desde);
  if (filtros?.hasta) q = q.lte("fecha_operacion", filtros.hasta);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OperacionNeumatico[];
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
  let q = supabase.from("revisiones_vehiculo").select("*, vehiculo:tc_vehiculos(*)").order("fecha_revision", { ascending: false });
  if (vehiculoId) q = q.eq("vehiculo_id", vehiculoId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RevisionVehiculo[];
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

export async function listarMedidas(): Promise<MedidaNeumatico[]> {
  const { data, error } = await supabase.from("tc_cat_medidas_neumatico").select("*").eq("activo", true).order("valor");
  if (error) throw new Error(error.message);
  return (data ?? []) as MedidaNeumatico[];
}
export async function crearMedida(valor: string): Promise<void> {
  const { error } = await supabase.from("tc_cat_medidas_neumatico").insert({ valor: valor.trim() });
  if (error) throw new Error(error.message);
}
