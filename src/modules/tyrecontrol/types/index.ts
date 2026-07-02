export type Rol = "administrador" | "operador" | "cliente";

export interface Empresa {
  id: string;
  nombre: string;
  cif?: string | null;
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
  activo: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  pos_w?: number | null;
  pos_h?: number | null;
}

export type OrigenKm = "manual" | "webfleet" | "importacion_excel";

export interface Vehiculo {
  id: string;
  empresa_id: string;
  delegacion_id?: string | null;
  tipo_vehiculo_id?: string | null;
  matricula: string;
  marca?: string | null;
  modelo?: string | null;
  bastidor?: string | null;
  fecha_matriculacion?: string | null;
  webfleet_vehicle_id?: string | null;
  km_actual: number;
  origen_km: OrigenKm;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
  empresa?: Empresa | null;
  delegacion?: Delegacion | null;
  tipo?: TipoVehiculo | null;
}

export type VehiculoInput = Omit<Vehiculo, "id" | "created_at" | "updated_at" | "empresa" | "delegacion" | "tipo">;

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
  tecnico_id?: string | null;
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
export interface MarcaNeumatico { id: string; nombre: string; activo: boolean; }
export interface ModeloNeumatico { id: string; marca_id: string | null; nombre: string; activo: boolean; }
export interface MedidaNeumatico { id: string; valor: string; activo: boolean; }
export interface IndiceCarga { id: string; valor: string; activo: boolean; }
export interface IndiceVelocidad { id: string; valor: string; activo: boolean; }
