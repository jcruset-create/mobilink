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
  | "almacen_producto_id" | "almacen_lote_id" | "almacen_ubicacion_id" | "almacen_movimiento_id">;

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
