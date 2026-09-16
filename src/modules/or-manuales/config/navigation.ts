/**
 * Navegación de OR Manuales. La lista es datos y la visibilidad se decide con
 * los permisos del bootstrap, como en Recepciones y Cash.
 */

import { AlertTriangle, Bell, FileStack, History, LayoutDashboard, ScanLine, Settings, type LucideIcon } from "lucide-react";

export type NavItem = { key: string; path: string; label: string; icon: LucideIcon; permiso: string };

export const NAV: NavItem[] = [
  { key: "panel", path: "panel", label: "Panel", icon: LayoutDashboard, permiso: "or-manuales.view" },
  { key: "blocs", path: "blocs", label: "Blocs", icon: FileStack, permiso: "or-manuales.view" },
  { key: "escanear", path: "escanear", label: "Escanear documentos", icon: ScanLine, permiso: "or-manuales.documento.subir" },
  { key: "pendientes", path: "pendientes", label: "Documentos pendientes", icon: AlertTriangle, permiso: "or-manuales.view" },
  { key: "avisos", path: "avisos", label: "Avisos", icon: Bell, permiso: "or-manuales.view" },
  { key: "historico", path: "historico", label: "Histórico", icon: History, permiso: "or-manuales.view" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, permiso: "or-manuales.config.manage" },
];

export function navVisible(item: NavItem, permisos: readonly string[]): boolean {
  return permisos.includes(item.permiso);
}
