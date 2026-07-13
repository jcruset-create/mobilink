export type Rol = "administrador" | "operador" | "cliente";

export interface Empresa {
  id: string;
  nombre: string;
  cif?: string | null;
  codigo_cliente?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  pais?: string | null;
  activo: boolean;
  cliente_almacen_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ClienteAlmacen {
  id: string;
  empresa_id_almacen: string;
  codigo: string | null;
  nombre: string;
  nif: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
}

export interface ProductoAlmacen {
  id: string;
  empresa_id_almacen: string;
  marca: string;
  modelo: string | null;
  medida: string;
  dot: string | null;
  activo: boolean;
}

export interface Delegacion {
  id: string;
  empresa_id: string;
  nombre: string;
  direccion?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  pais?: string | null;
  responsable?: string | null;
  telefono?: string | null;
  email?: string | null;
  activo: boolean;
  // Geo-zona de la base (Webfleet "vehículos en base")
  webfleet_lat?: number | null;
  webfleet_lng?: number | null;
  webfleet_radio_m?: number | null;
  webfleet_zona_nombre?: string | null;
  webfleet_genera_avisos?: boolean;
  created_at?: string;
  updated_at?: string;
  empresa?: Empresa | null;
}

export interface Perfil {
  id: string;
  empresa_id: string;
  delegacion_id?: string | null;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  acceso_apk: boolean;
  acceso_panel: boolean;
  es_superadmin: boolean;
  created_at?: string;
  empresa?: Empresa | null;
  delegacion?: Delegacion | null;
}

export interface PermisoCliente {
  id: string;
  usuario_id: string;
  pantalla: string;
  puede_ver: boolean;
  puede_exportar: boolean;
}

export const ROL_LABELS: Record<Rol, string> = {
  administrador: "Administrador",
  operador: "Operador",
  cliente: "Cliente",
};

export type EmpresaInput = Omit<Empresa, "id" | "created_at" | "updated_at">;
export type DelegacionInput = Omit<Delegacion, "id" | "created_at" | "updated_at" | "empresa">;

export interface TipoVehiculo {
  id: string;
  nombre: string;
  descripcion?: string | null;
  numero_ejes: number;
  numero_ruedas: number;
  activo: boolean;
  imagen_chasis_url?: string | null;
  configuracion_ejes?: string | null;
}

export interface PosicionVehiculo {
  id: string;
  tipo_vehiculo_id: string;
  codigo_posicion: string;
  nombre?: string | null;
  eje?: number | null;
  lado?: string | null;
  interior_exterior?: string | null;
  orden_visual: number;
  orden_revision?: number | null; // orden de revisión en la tablet (null = recorrido por defecto)
  activo: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  pos_w?: number | null;
  pos_h?: number | null;
}

export type OrigenKm = "manual" | "webfleet" | "importacion_excel";

// ── Webfleet: vehículos en base ─────────────────────────────────
export type EstadoWebfleet = "en_base" | "otra_base" | "en_ruta" | "sin_conexion" | "sin_dispositivo";

export const ESTADO_WEBFLEET_LABELS: Record<EstadoWebfleet, string> = {
  en_base: "En base",
  otra_base: "Otra base",
  en_ruta: "En ruta",
  sin_conexion: "Sin conexión",
  sin_dispositivo: "Sin Webfleet",
};

// Clases de badge (tema slate), coherentes con el resto de la app.
export const ESTADO_WEBFLEET_BADGE: Record<EstadoWebfleet, string> = {
  en_base: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
  otra_base: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  en_ruta: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  sin_conexion: "bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/30",
  sin_dispositivo: "bg-slate-700/40 text-slate-400 ring-1 ring-slate-600/40",
};

export const ESTADO_WEBFLEET_PUNTO: Record<EstadoWebfleet, string> = {
  en_base: "🟢", otra_base: "🔵", en_ruta: "🟠", sin_conexion: "⚪", sin_dispositivo: "⚫",
};

export interface VehiculoWebfleetEstado {
  vehiculo_id: string;
  empresa_id: string;
  estado: EstadoWebfleet;
  delegacion_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  postext?: string | null;
  velocidad_kmh?: number | null;
  odometro_km?: number | null;
  pos_time?: string | null;
  entrada_base_at?: string | null;
  updated_at?: string | null;
  delegacion?: { id: string; nombre: string } | null; // base detectada
}

export interface WebfleetSyncConfig {
  id: number;
  intervalo_min: number;
  min_tiempo_base_min: number;
  antiguedad_max_pos_min: number;
  alertas_activas: boolean;
}

export interface Vehiculo {
  id: string;
  empresa_id: string;
  delegacion_id?: string | null;
  tipo_vehiculo_id?: string | null;
  matricula: string;
  numero_unidad?: string | null;
  marca?: string | null;
  modelo?: string | null;
  bastidor?: string | null;
  fecha_matriculacion?: string | null;
  webfleet_vehicle_id?: string | null;
  km_actual: number;
  origen_km: OrigenKm;
  activo: boolean;
  // Configuración de neumáticos (fase 30)
  config_ejes_id?: string | null;
  medida_id?: string | null;
  tipo_llanta_id?: string | null;
  medidas_por_eje?: boolean;
  created_at?: string;
  updated_at?: string;
  empresa?: Empresa | null;
  delegacion?: Delegacion | null;
  tipo?: TipoVehiculo | null;
  config_ejes?: ConfigEjes | null;
}

export type VehiculoInput = Omit<Vehiculo, "id" | "created_at" | "updated_at" | "empresa" | "delegacion" | "tipo" | "config_ejes">;

// Umbrales de profundidad por empresa (mínimo legal, aviso, tolerancia presión).
export interface UmbralesEmpresa {
  empresa_id: string;
  profundidad_minima_mm: number;
  profundidad_aviso_mm: number;
  presion_tolerancia_bar: number;
}

// Override de umbrales para una medida concreta dentro de una empresa.
export interface UmbralMedida {
  empresa_id: string;
  medida: string;
  profundidad_minima_mm: number;
  profundidad_aviso_mm: number;
}

// Configuración de ejes (catálogo editable): "2x2x2", "2x4"…
// imagen_chasis_url: imagen del plano que heredan todos los vehículos con
// esta configuración (la del tipo de vehículo, si existe, tiene prioridad).
export interface ConfigEjes {
  id: string; nombre: string; descripcion?: string | null; orden: number; activo: boolean;
  imagen_chasis_url?: string | null;
}

// Tipo de llanta (catálogo editable): material + medida + detalle
export interface TipoLlanta {
  id: string; material: string; medida: string; orden: number; activo: boolean;
  agujeros?: number | null;
  centrado?: "centrada" | "desplazada" | null;
  tapacubo?: boolean;
}

// Etiqueta legible de una llanta para desplegables y listas
export function tipoLlantaLabel(l: TipoLlanta): string {
  const partes = [
    l.material.charAt(0).toUpperCase() + l.material.slice(1),
    l.medida,
  ];
  if (l.agujeros) partes.push(`${l.agujeros} aguj.`);
  if (l.centrado) partes.push(l.centrado);
  partes.push(l.tapacubo ? "c/tapacubo" : "s/tapacubo");
  return partes.join(" · ");
}

// Desglose por eje de un vehículo (cuando medidas_por_eje = true)
export interface VehiculoEje {
  eje: number; ruedas: number | null; medida_id: string | null; tipo_llanta_id: string | null;
}

export const ORIGEN_KM_LABELS: Record<OrigenKm, string> = {
  manual: "Manual",
  webfleet: "Webfleet",
  importacion_excel: "Importación Excel",
};

export type EstadoNeumatico = "almacen" | "reservado" | "montado" | "reparacion" | "descartado";
export type MotivoDesmontaje = "desgaste" | "pinchazo" | "rotura" | "preventivo" | "rotacion" | "reparacion" | "descarte";
export type DestinoDesmontaje = "almacen" | "reparacion" | "descartado";

export const ESTADO_NEUMATICO_LABELS: Record<EstadoNeumatico, string> = {
  almacen: "En almacén", reservado: "Reservado", montado: "Montado", reparacion: "Reparación", descartado: "Descartado",
};
export const MOTIVO_DESMONTAJE_LABELS: Record<MotivoDesmontaje, string> = {
  desgaste: "Desgaste", pinchazo: "Pinchazo", rotura: "Rotura", preventivo: "Preventivo",
  rotacion: "Rotación", reparacion: "Reparación", descarte: "Descarte",
};

export interface Neumatico {
  id: string;
  empresa_id: string;
  numero_interno?: string | null;
  control_individual?: boolean;
  creado_automaticamente?: boolean;
  origen?: string | null;
  ficha_generica_id?: string | null;
  vehiculo_id?: string | null;
  posicion_id?: string | null;
  codigo_interno?: string | null;
  numero_serie?: string | null;
  dot?: string | null;
  marca?: string | null;
  modelo?: string | null;
  medida?: string | null;
  indice_carga?: string | null;
  indice_velocidad?: string | null;
  rfid_epc?: string | null;
  estado: EstadoNeumatico;
  fecha_compra?: string | null;
  coste_compra?: number | null;
  proveedor?: string | null;
  profundidad_actual_mm?: number | null;
  almacen_producto_id?: string | null;
  almacen_lote_id?: string | null;
  almacen_ubicacion_id?: string | null;
  almacen_movimiento_id?: string | null;
  referencia_almacen?: string | null;
  sincronizado_almacen?: boolean;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
  empresa?: Empresa | null;
  producto_almacen?: { referencia?: { presion_maxima_bar?: number | null } | null } | null;
}

export type NeumaticoInput = Omit<Neumatico, "id" | "created_at" | "updated_at" | "empresa" | "sincronizado_almacen"
  | "almacen_lote_id" | "almacen_ubicacion_id" | "almacen_movimiento_id">;

export interface MontajeActual {
  id: string;
  empresa_id: string;
  vehiculo_id: string;
  neumatico_id: string;
  posicion_id: string;
  fecha_montaje: string;
  km_montaje?: number | null;
  observaciones?: string | null;
  neumatico?: Neumatico | null;
  posicion?: PosicionVehiculo | null;
}

export interface HistorialMontaje {
  id: string;
  empresa_id: string;
  vehiculo_id?: string | null;
  neumatico_id?: string | null;
  posicion_id?: string | null;
  fecha_montaje?: string | null;
  km_montaje?: number | null;
  fecha_desmontaje?: string | null;
  km_desmontaje?: number | null;
  motivo_desmontaje?: string | null;
  observaciones?: string | null;
}

// ── Fase 8: Operaciones de neumáticos ──────────────────────────
export type TipoOperacion =
  | "montaje" | "desmontaje" | "sustitucion" | "rotacion" | "reparacion"
  | "descarte" | "entrada_almacen" | "salida_almacen" | "revision_vehiculo";

export type MotivoOperacion =
  | "desgaste" | "pinchazo" | "rotura" | "preventivo" | "desgaste_irregular"
  | "cambio_estacional" | "reparacion" | "fin_vida" | "error_montaje" | "otro";

export type DestinoOperacion = "vehiculo" | "almacen" | "reparacion" | "descarte";

export const TIPO_OPERACION_LABELS: Record<TipoOperacion, string> = {
  montaje: "Montaje", desmontaje: "Desmontaje", sustitucion: "Sustitución", rotacion: "Rotación",
  reparacion: "Reparación", descarte: "Descarte", entrada_almacen: "Entrada a almacén",
  salida_almacen: "Salida de almacén", revision_vehiculo: "Revisión de vehículo",
};

export const MOTIVO_OPERACION_LABELS: Record<MotivoOperacion, string> = {
  desgaste: "Desgaste", pinchazo: "Pinchazo", rotura: "Rotura", preventivo: "Preventivo",
  desgaste_irregular: "Desgaste irregular", cambio_estacional: "Cambio estacional",
  reparacion: "Reparación", fin_vida: "Fin de vida", error_montaje: "Error de montaje", otro: "Otro",
};

export interface OperacionNeumatico {
  id: string;
  empresa_id: string;
  vehiculo_id?: string | null;
  neumatico_id?: string | null;
  tipo_operacion: TipoOperacion;
  posicion_origen_id?: string | null;
  posicion_destino_id?: string | null;
  montaje_origen_id?: string | null;
  montaje_destino_id?: string | null;
  km_vehiculo?: number | null;
  fecha_operacion: string;
  motivo?: MotivoOperacion | null;
  estado_anterior?: string | null;
  estado_nuevo?: string | null;
  destino?: DestinoOperacion | null;
  coste_material?: number | null;
  coste_mano_obra?: number | null;
  almacen_movimiento_id?: string | null;
  tecnico_id?: string | null;
  observaciones?: string | null;
  created_at?: string;
  empresa?: Empresa | null;
  vehiculo?: Vehiculo | null;
  neumatico?: Neumatico | null;
  tecnico?: Perfil | null;
  posicion_origen?: PosicionVehiculo | null;
  posicion_destino?: PosicionVehiculo | null;
}

export interface FichaGenerica {
  id: string;
  almacen_producto_id?: string | null;
  referencia_almacen?: string | null;
  marca: string;
  modelo?: string | null;
  medida: string;
  indice_carga?: string | null;
  codigo_velocidad?: string | null;
  descripcion?: string | null;
  activo: boolean;
}

export type EstadoRevision = "borrador" | "completada" | "enviada" | "anulada";

export interface RevisionVehiculo {
  id: string;
  empresa_id: string;
  vehiculo_id: string;
  km_vehiculo?: number | null;
  origen_km?: string | null;
  fecha_revision: string;
  created_at?: string | null;
  tecnico_id?: string | null;
  tecnico_nombre?: string | null; // resuelto en listarRevisiones (best-effort)
  estado_revision: EstadoRevision;
  observaciones?: string | null;
  vehiculo?: Vehiculo | null;
}

export interface RevisionDetalle {
  id: string;
  revision_id: string;
  empresa_id: string;
  vehiculo_id: string;
  neumatico_id?: string | null;
  posicion_id: string;
  profundidad_mm?: number | null;
  presion_bar?: number | null;
  temperatura?: number | null;
  metodo_profundidad?: "manual" | "bluetooth" | "importacion_excel" | null;
  metodo_presion?: "manual" | "bluetooth" | "importacion_excel" | null;
  estado_visual?: string | null;
  observaciones?: string | null;
  foto_url?: string | null;
  no_accesible: boolean;
  neumatico_ausente: boolean;
  alerta_generada: boolean;
  neumatico?: Neumatico | null;
  posicion?: PosicionVehiculo | null;
}

export interface AutorizacionOperacion {
  id: string;
  empresa_id: string;
  operacion_id?: string | null;
  tipo_autorizacion: "montaje_fuera_almacen" | "montaje_sin_dot" | "montaje_sin_rfid" | "correccion_manual" | "anulacion_operacion";
  solicitado_por: string;
  autorizado_por?: string | null;
  motivo: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  fecha_solicitud: string;
  fecha_autorizacion?: string | null;
  operacion?: OperacionNeumatico | null;
}

// ── Catálogos de marca / modelo / medida de neumático ──────────
export interface Fabricante {
  id: string; nombre: string; activo: boolean;
  pais_origen?: string | null; anio_fundacion?: number | null; web?: string | null;
  logo_url?: string | null; descripcion?: string | null; grupo_empresarial?: string | null;
  observaciones?: string | null;
}

export type SegmentoMarca = "premium" | "quality" | "budget" | "industrial" | "otr" | "agricola" | "carretillas_elevadoras";
export type TipoPrincipalMarca = "camion" | "autobus" | "turismo" | "furgoneta" | "agricola" | "otr" | "industrial" | "carretillas_elevadoras" | "multisegmento";

export const SEGMENTO_LABELS: Record<SegmentoMarca, string> = {
  premium: "Premium", quality: "Quality", budget: "Budget", industrial: "Industrial",
  otr: "OTR", agricola: "Agrícola", carretillas_elevadoras: "Carretillas elevadoras",
};

export interface MarcaNeumatico {
  id: string; nombre: string; activo: boolean; logo_url?: string | null;
  fabricante_id?: string | null; pais_origen?: string | null;
  segmento?: SegmentoMarca | null; tipo_principal?: TipoPrincipalMarca | null; observaciones?: string | null;
}

export interface MarcaContadores { id: string; num_modelos: number; num_neumaticos: number; num_vehiculos: number; }

export interface TyreSize {
  id: string;
  medida_id?: string | null;
  referencia_completa: string;
  medida: string;
  ancho: number;
  perfil?: number | null;
  diametro_llanta: number;
  indice_carga_simple: string;
  indice_carga_doble?: string | null;
  codigo_velocidad: string;
  activo: boolean;
}
export type TyreSizeInput = Omit<TyreSize, "id" | "referencia_completa" | "medida_id" | "medida">;
export type EjeRecomendado = "direccion" | "traccion" | "remolque" | "mixto";

export interface ModeloNeumatico {
  id: string; marca_id: string | null; nombre: string; activo: boolean;
  gama?: string | null; eje_recomendado?: EjeRecomendado | null; aplicacion?: string | null;
  tipo_vehiculo?: string | null; m_s?: boolean | null; tres_pmsf?: boolean | null;
  reesculturable?: boolean | null; recauchutable?: boolean | null; foto_modelo_url?: string | null;
}

export interface ReferenciaNeumatico {
  id: string; modelo_id: string; tyre_size_id: string; referencia_completa: string; activo: boolean;
  profundidad_dibujo_mm?: number | null; llanta_recomendada?: string | null; diametro_exterior_mm?: number | null;
  revoluciones_km?: number | null; carga_maxima_kg?: number | null; presion_maxima_bar?: number | null; peso_kg?: number | null;
  ply?: number | null; ancho_seccion_mm?: number | null; anchura_rodadura_mm?: number | null; radio_carga_mm?: number | null;
  etiqueta_rr?: string | null; etiqueta_grip_humedo?: string | null; etiqueta_ruido_db?: number | null; etiqueta_ruido_clase?: string | null;
  modelo?: ModeloNeumatico & { marca?: MarcaNeumatico | null } | null;
  tyre_size?: TyreSize | null;
}
export interface MedidaNeumatico {
  id: string; valor: string; activo: boolean;
  ancho?: number | null; perfil?: number | null; diametro?: number | null;
  construccion?: "radial" | "diagonal" | "otros" | null;
  aplicacion?: string | null; notas?: string | null;
  categoria?: string | null; // turismo | 4x4 | furgoneta | camion | otros
}

// Categorías de neumático para umbrales por tipo de vehículo.
export const CATEGORIAS_NEUMATICO = ["turismo", "4x4", "furgoneta", "camion", "otros"] as const;
export type CategoriaNeumatico = (typeof CATEGORIAS_NEUMATICO)[number];
export const CATEGORIA_NEUMATICO_LABELS: Record<CategoriaNeumatico, string> = {
  turismo: "Turismo", "4x4": "4x4", furgoneta: "Furgoneta", camion: "Camión", otros: "Otros",
};

// Configuración de Webfleet por empresa (credenciales del cliente).
export interface WebfleetConfig {
  empresa_id: string;
  account: string | null;
  username: string | null;
  password: string | null;
  apikey: string | null;
  base_url: string | null;
  activo: boolean;
}

// Precios de referencia por medida (para calcular ahorros).
export interface PrecioMedida {
  empresa_id: string;
  medida: string;
  precio_nuevo: number | null;
  precio_recauchutado: number | null;
}

// Override de umbrales para una categoría dentro de una empresa.
export interface UmbralCategoria {
  empresa_id: string;
  categoria: string;
  profundidad_minima_mm: number;
  profundidad_aviso_mm: number;
}
export interface IndiceCarga { id: string; valor: string; activo: boolean; }
export interface IndiceVelocidad { id: string; valor: string; activo: boolean; }
export interface MotivoFueraAlmacen { id: string; motivo: string; activo: boolean; }
