import { LayoutDashboard, Users, Building2, MapPin, Truck, CircleDot, Wrench, Settings, User, ClipboardList, ClipboardCheck, ShieldCheck, Link2, Ruler, BookOpen, Bluetooth, BarChart3, Upload, CalendarCheck, type LucideIcon } from "lucide-react";
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
  { key: "informes", path: "informes", label: "Informes", icon: BarChart3, roles: ["administrador"] },
  // Administrador / super-admin
  { key: "empresas", path: "empresas", label: "Empresas", icon: Building2, roles: ["administrador"] },
  { key: "delegaciones", path: "delegaciones", label: "Delegaciones", icon: MapPin, roles: ["administrador"] },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: Users, roles: ["administrador"] },
  { key: "vehiculos", path: "vehiculos", label: "Vehículos", icon: Truck, roles: ["administrador"] },
  { key: "disponibles-revisar", path: "disponibles-revisar", label: "Disponibles para revisar", icon: CalendarCheck, roles: ["administrador"] },
  { key: "planificacion", path: "planificacion", label: "Planificación de revisiones", icon: ClipboardList, roles: ["administrador"] },
  { key: "neumaticos", path: "neumaticos", label: "Neumáticos", icon: CircleDot, roles: ["administrador"] },
  { key: "montajes", path: "montajes", label: "Montajes actuales", icon: Wrench, roles: ["administrador"] },
  { key: "operaciones", path: "operaciones", label: "Operaciones", icon: ClipboardList, roles: ["administrador"] },
  { key: "revision-vehiculo", path: "revision-vehiculo", label: "Revisión de vehículo", icon: ClipboardCheck, roles: ["administrador"] },
  { key: "autorizaciones", path: "autorizaciones", label: "Autorizaciones", icon: ShieldCheck, roles: ["administrador"] },
  { key: "enlace-almacen", path: "enlace-almacen", label: "Enlace con almacén", icon: Link2, superadminOnly: true },
  { key: "medidas-neumaticos", path: "medidas-neumaticos", label: "Medidas de neumáticos", icon: Ruler, roles: ["administrador"] },
  { key: "catalogo-neumaticos", path: "catalogo-neumaticos", label: "Catálogo de neumáticos", icon: BookOpen, roles: ["administrador"] },
  { key: "sonda", path: "sonda", label: "Sonda TLGX", icon: Bluetooth, roles: ["administrador"] },
  { key: "importar", path: "importar", label: "Importar", icon: Upload, roles: ["administrador"] },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, roles: ["administrador"] },
  // Cliente
  { key: "mi-empresa", path: "mi-empresa", label: "Mi empresa", icon: Building2, roles: ["cliente"] },
  { key: "mis-delegaciones", path: "mis-delegaciones", label: "Mis delegaciones", icon: MapPin, roles: ["cliente"] },
  { key: "mis-vehiculos", path: "mis-vehiculos", label: "Mis vehículos", icon: Truck, roles: ["cliente"] },
  { key: "mis-neumaticos", path: "mis-neumaticos", label: "Mis neumáticos", icon: CircleDot, roles: ["cliente"] },
  { key: "montajes-cliente", path: "montajes", label: "Montajes actuales", icon: Wrench, roles: ["cliente"] },
  { key: "operaciones-cliente", path: "operaciones", label: "Operaciones", icon: ClipboardList, roles: ["cliente"] },
  { key: "informes-cliente", path: "informes", label: "Informes", icon: BarChart3, roles: ["cliente"] },
  // Todos
  { key: "perfil", path: "perfil", label: "Perfil", icon: User },
];

export function navVisible(item: NavItem, rol: Rol | undefined, esSuperadmin: boolean, pantallas?: string[] | null): boolean {
  if (item.superadminOnly) return esSuperadmin;
  // el super-admin ve lo de administrador; el resto según su rol
  if (item.roles) {
    if (esSuperadmin) {
      if (!item.roles.includes("administrador")) return false;
    } else if (!rol || !item.roles.includes(rol)) {
      return false;
    }
  }
  // Gating por pantallas (usuarios unificados): se compara por path;
  // null = todas las del rol; el super-admin no se filtra.
  if (!esSuperadmin && pantallas && item.path !== "dashboard" && !pantallas.includes(item.path)) {
    return false;
  }
  return true;
}
