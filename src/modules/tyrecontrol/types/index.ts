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
  created_at?: string;
  updated_at?: string;
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
