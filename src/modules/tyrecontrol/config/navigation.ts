import { LayoutDashboard, Users, Building2, Settings, User, type LucideIcon } from "lucide-react";
import type { Rol } from "../types";

export type NavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: Rol[]; // si se omite → visible para cualquier rol autenticado
  superadminOnly?: boolean;
};

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: Users, roles: ["administrador"] },
  { key: "empresas", path: "empresas", label: "Empresas", icon: Building2, superadminOnly: true },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, roles: ["administrador"] },
  { key: "perfil", path: "perfil", label: "Perfil", icon: User },
];

export function navVisible(item: NavItem, rol: Rol | undefined, esSuperadmin: boolean): boolean {
  if (esSuperadmin) return true;
  if (item.superadminOnly) return false;
  if (!item.roles) return true;
  return rol ? item.roles.includes(rol) : false;
}
