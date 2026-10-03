/**
 * Navegación de Self Storage. La lista es datos; la visibilidad la deciden los
 * permisos del bootstrap. Las secciones de fases posteriores aparecen
 * deshabilitadas con su fase, para que se vea el mapa completo del módulo sin
 * que nadie entre en una pantalla vacía.
 */

import {
  AlertTriangle,
  BadgeEuro,
  Boxes,
  Building2,
  CreditCard,
  DoorOpen,
  FilePen,
  FileText,
  KeyRound,
  LayoutDashboard,
  Map as MapIcon,
  ReceiptText,
  Ruler,
  Settings,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { key: string; path: string; label: string; icon: LucideIcon; permiso: string; fase?: number };

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard, permiso: "ss.view" },
  { key: "plano", path: "plano", label: "Plano interactivo", icon: MapIcon, permiso: "ss.view" },
  { key: "trasteros", path: "trasteros", label: "Trasteros", icon: Boxes, permiso: "ss.view" },
  { key: "clientes", path: "clientes", label: "Clientes", icon: Users, permiso: "ss.customers.view" },
  { key: "contratos", path: "contratos", label: "Contratos", icon: FilePen, permiso: "ss.contracts.view" },
  { key: "facturas", path: "facturas", label: "Facturas", icon: FileText, permiso: "ss.billing.view" },
  { key: "pagos", path: "pagos", label: "Pagos", icon: CreditCard, permiso: "ss.billing.view" },
  { key: "impagos", path: "impagos", label: "Impagos", icon: BadgeEuro, permiso: "ss.billing.view" },
  { key: "accesos", path: "accesos", label: "Accesos", icon: KeyRound, permiso: "ss.view", fase: 3 },
  { key: "puertas", path: "puertas", label: "Puertas", icon: DoorOpen, permiso: "ss.view", fase: 3 },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, permiso: "ss.view", fase: 3 },
  { key: "centros", path: "centros", label: "Centros y zonas", icon: Building2, permiso: "ss.view" },
  { key: "tipos", path: "tipos", label: "Tipos de trastero", icon: Ruler, permiso: "ss.view" },
  { key: "importar", path: "importar", label: "Importar trasteros", icon: Upload, permiso: "ss.import" },
  { key: "conceptos", path: "conceptos", label: "Conceptos facturables", icon: ReceiptText, permiso: "ss.billing.view" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, permiso: "ss.settings.manage" },
];

export function navVisible(item: NavItem, permisos: readonly string[]): boolean {
  return permisos.includes(item.permiso);
}
