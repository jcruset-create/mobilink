import { LayoutDashboard, Users, Building2, MapPin, Truck, CircleDot, Wrench, Settings, User, ClipboardList, type LucideIcon } from "lucide-react";
import type { Rol } from "../types";

export type NavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: Rol[]; // visible para estos roles (además del super-admin)
  superadminOnly?: boolean;
};

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  // Administrador / super-admin
  { key: "empresas", path: "empresas", label: "Empresas", icon: Building2, roles: ["administrador"] },
  { key: "delegaciones", path: "delegaciones", label: "Delegaciones", icon: MapPin, roles: ["administrador"] },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: Users, roles: ["administrador"] },
  { key: "vehiculos", path: "vehiculos", label: "Vehículos", icon: Truck, roles: ["administrador"] },
  { key: "neumaticos", path: "neumaticos", label: "Neumáticos", icon: CircleDot, roles: ["administrador"] },
  { key: "montajes", path: "montajes", label: "Montajes actuales", icon: Wrench, roles: ["administrador"] },
  { key: "operaciones", path: "operaciones", label: "Operaciones", icon: ClipboardList, roles: ["administrador"] },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, roles: ["administrador"] },
  // Cliente
  { key: "mi-empresa", path: "mi-empresa", label: "Mi empresa", icon: Building2, roles: ["cliente"] },
  { key: "mis-delegaciones", path: "mis-delegaciones", label: "Mis delegaciones", icon: MapPin, roles: ["cliente"] },
  { key: "mis-vehiculos", path: "mis-vehiculos", label: "Mis vehículos", icon: Truck, roles: ["cliente"] },
  { key: "mis-neumaticos", path: "mis-neumaticos", label: "Mis neumáticos", icon: CircleDot, roles: ["cliente"] },
  { key: "montajes-cliente", path: "montajes", label: "Montajes actuales", icon: Wrench, roles: ["cliente"] },
  { key: "operaciones-cliente", path: "operaciones", label: "Operaciones", icon: ClipboardList, roles: ["cliente"] },
  // Todos
  { key: "perfil", path: "perfil", label: "Perfil", icon: User },
];

export function navVisible(item: NavItem, rol: Rol | undefined, esSuperadmin: boolean): boolean {
  if (item.superadminOnly) return esSuperadmin;
  // el super-admin ve lo de administrador; el resto según su rol
  if (!item.roles) return true;
  if (esSuperadmin) return item.roles.includes("administrador");
  return rol ? item.roles.includes(rol) : false;
}
