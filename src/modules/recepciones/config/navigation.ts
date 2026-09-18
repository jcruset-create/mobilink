/**
 * Navegación de Recepciones. La lista es datos y la visibilidad se decide con
 * los permisos del bootstrap, como en Cash y Therefore.
 */

import { AlertTriangle, ClipboardList, Inbox, Mail, MessageCircle, Truck, UserCheck, type LucideIcon } from "lucide-react";

export type NavItem = { key: string; path: string; label: string; icon: LucideIcon; permiso: string };

export const NAV: NavItem[] = [
  { key: "bandeja", path: "bandeja", label: "Recepciones pendientes", icon: Inbox, permiso: "recepciones.view" },
  { key: "pedidos", path: "pedidos", label: "Pedidos", icon: ClipboardList, permiso: "recepciones.view" },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, permiso: "recepciones.view" },
  { key: "proveedores", path: "proveedores", label: "Proveedores", icon: Truck, permiso: "recepciones.view" },
  { key: "operarios", path: "operarios", label: "Operarios del muelle", icon: UserCheck, permiso: "recepciones.view" },
  { key: "correo", path: "correo", label: "Correo del proveedor", icon: Mail, permiso: "recepciones.view" },
  { key: "avisos", path: "avisos", label: "Avisos por WhatsApp", icon: MessageCircle, permiso: "recepciones.view" },
];

export function navVisible(item: NavItem, permisos: readonly string[]): boolean {
  return permisos.includes(item.permiso);
}
