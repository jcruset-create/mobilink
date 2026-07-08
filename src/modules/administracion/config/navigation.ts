import {
  LayoutDashboard, Euro, ClipboardList, AlertTriangle, Users, Settings, BarChart3, Wrench, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Rol } from "../types";

export type NavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  roles?: Rol[]; // visible para estos roles (el admin siempre ve todo)
  adminOnly?: boolean; // solo rol admin
};

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Resumen", icon: LayoutDashboard, roles: ["administracion", "recepcion", "supervisor"] },
  { key: "cobros-dia", path: "cobros-dia", label: "Cobros del día", icon: Euro, roles: ["administracion", "recepcion", "supervisor"] },
  { key: "seguimiento", path: "seguimiento", label: "Seguimiento de pagos", icon: ClipboardList, roles: ["administracion", "supervisor"] },
  { key: "recobros", path: "recobros", label: "Recobros", icon: AlertTriangle, roles: ["administracion", "supervisor"] },
  { key: "clientes", path: "clientes", label: "Clientes con seguimiento", icon: Users, roles: ["administracion", "supervisor"] },
  { key: "formas-pago", path: "formas-pago", label: "Configuración", icon: Settings, roles: ["administracion"] },
  { key: "informes", path: "informes", label: "Informes", icon: BarChart3, roles: ["administracion", "supervisor"] },
  { key: "estado-ots", path: "estado-ots", label: "Estado de OTs", icon: Wrench, roles: ["tecnico", "supervisor"] },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: ShieldCheck, adminOnly: true },
];

export function navVisible(item: NavItem, rol: Rol | undefined, pantallas?: string[] | null): boolean {
  if (!rol) return false;
  if (item.adminOnly) return rol === "admin";
  if (rol === "admin") return true;
  if (item.roles && !item.roles.includes(rol)) return false;
  // Gating por pantallas (usuarios unificados): null = todas las del rol
  if (pantallas && item.key !== "dashboard" && !pantallas.includes(item.key)) return false;
  return true;
}
