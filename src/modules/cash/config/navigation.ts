/**
 * Navegación de Mobilink Cash.
 *
 * Mismo patrón que `administracion/config/navigation.ts`: la lista es datos y
 * la visibilidad se decide con los permisos que ya trae el bootstrap, no
 * repitiendo condiciones por pantalla.
 */

import {
  LayoutDashboard,
  Repeat,
  HandCoins,
  Banknote,
  ArrowLeftRight,
  Coins,
  Landmark,
  PiggyBank,
  UserRoundCheck,
  ClipboardCheck,
  Lock,
  History,
  FileText,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para verla. */
  permiso: string;
};

export const NAV: NavItem[] = [
  { key: "jornada", path: "jornada", label: "Jornada actual", icon: LayoutDashboard, permiso: "cash.view" },
  { key: "cobros", path: "cobros", label: "Cobros", icon: HandCoins, permiso: "cash.view" },
  { key: "pagos", path: "pagos", label: "Pagos", icon: Banknote, permiso: "cash.view" },
  { key: "movimientos", path: "movimientos", label: "Movimientos", icon: ArrowLeftRight, permiso: "cash.view" },
  { key: "darCambio", path: "dar-cambio", label: "Dar cambio", icon: Repeat, permiso: "cash.view" },
  { key: "stock", path: "stock", label: "Stock de caja", icon: Coins, permiso: "cash.view" },
  { key: "cambio", path: "cambio", label: "Cambio del banco", icon: Landmark, permiso: "cash.view" },
  { key: "entregas", path: "entregas", label: "Entregas de dinero", icon: UserRoundCheck, permiso: "cash.view" },
  { key: "ingresos", path: "ingresos", label: "Ingresos bancarios", icon: PiggyBank, permiso: "cash.view" },
  { key: "arqueo", path: "arqueo", label: "Arqueo", icon: ClipboardCheck, permiso: "cash.count.create" },
  { key: "cierre", path: "cierre", label: "Cierre", icon: Lock, permiso: "cash.close_session" },
  { key: "historico", path: "historico", label: "Histórico", icon: History, permiso: "cash.view" },
  { key: "informes", path: "informes", label: "Informes", icon: FileText, permiso: "cash.view" },
  { key: "erp", path: "erp", label: "Integración ERP", icon: Plug, permiso: "cash.erp.view" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, permiso: "cash.configure" },
];

export function navVisible(item: NavItem, permisos: readonly string[]): boolean {
  return permisos.includes(item.permiso);
}
