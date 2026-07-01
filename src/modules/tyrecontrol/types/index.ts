export type Rol = "administrador" | "operador" | "cliente";

export interface Empresa {
  id: string;
  nombre: string;
  cif?: string | null;
  telefono?: string | null;
  email?: string | null;
  activo: boolean;
  created_at?: string;
}

export interface Perfil {
  id: string;
  empresa_id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  acceso_apk: boolean;
  acceso_panel: boolean;
  es_superadmin: boolean;
  created_at?: string;
  empresa?: Empresa | null;
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
