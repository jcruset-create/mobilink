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
  Headphones,
  KeyRound,
  ListChecks,
  PhoneCall,
  ScrollText,
  SlidersHorizontal,
  UserRound,
  LayoutDashboard,
  Map as MapIcon,
  ReceiptText,
  Ruler,
  Settings,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

/** `grupo`: sección del menú (p. ej. «Call Center»); sin grupo, la parte principal del módulo. */
export type NavItem = { key: string; path: string; label: string; icon: LucideIcon; permiso: string; fase?: number; grupo?: string };

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard, permiso: "ss.view" },
  { key: "plano", path: "plano", label: "Plano interactivo", icon: MapIcon, permiso: "ss.view" },
  { key: "trasteros", path: "trasteros", label: "Trasteros", icon: Boxes, permiso: "ss.view" },
  { key: "clientes", path: "clientes", label: "Clientes", icon: Users, permiso: "ss.customers.view" },
  { key: "contratos", path: "contratos", label: "Contratos", icon: FilePen, permiso: "ss.contracts.view" },
  { key: "facturas", path: "facturas", label: "Facturas", icon: FileText, permiso: "ss.billing.view" },
  { key: "pagos", path: "pagos", label: "Pagos", icon: CreditCard, permiso: "ss.billing.view" },
  { key: "impagos", path: "impagos", label: "Impagos", icon: BadgeEuro, permiso: "ss.billing.view" },
  { key: "accesos", path: "accesos", label: "Accesos", icon: KeyRound, permiso: "ss.access.view" },
  { key: "puertas", path: "puertas", label: "Puertas", icon: DoorOpen, permiso: "ss.doors.view" },
  { key: "centros", path: "centros", label: "Centros y zonas", icon: Building2, permiso: "ss.view" },
  { key: "tipos", path: "tipos", label: "Tipos de trastero", icon: Ruler, permiso: "ss.view" },
  { key: "importar", path: "importar", label: "Importar trasteros", icon: Upload, permiso: "ss.import" },
  { key: "conceptos", path: "conceptos", label: "Conceptos facturables", icon: ReceiptText, permiso: "ss.billing.view" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, permiso: "ss.settings.manage" },
  // Call Center: funciona sin el Asistente IA.
  { key: "cc-dashboard", path: "call-center", label: "Dashboard", icon: Headphones, permiso: "ss.callcenter.view", grupo: "Call Center" },
  { key: "cc-llamadas", path: "call-center/llamadas", label: "Llamadas", icon: PhoneCall, permiso: "ss.callcenter.view", grupo: "Call Center" },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, permiso: "ss.incidents.view", grupo: "Call Center" },
  { key: "cc-operadores", path: "call-center/operadores", label: "Operadores", icon: UserRound, permiso: "ss.callcenter.view", grupo: "Call Center" },
  { key: "cc-catalogo", path: "call-center/motivos", label: "Motivos y resultados", icon: ListChecks, permiso: "ss.callcenter.view", grupo: "Call Center" },
  { key: "cc-config", path: "call-center/configuracion", label: "Configuración", icon: SlidersHorizontal, permiso: "ss.settings.manage", grupo: "Call Center" },
  { key: "cc-logs", path: "call-center/logs", label: "Logs", icon: ScrollText, permiso: "ss.callcenter.view", grupo: "Call Center" },
];

export function navVisible(item: NavItem, permisos: readonly string[]): boolean {
  return permisos.includes(item.permiso);
}

/** Primera pantalla a la que puede entrar el usuario (p. ej. la operadora va directa al Call Center). */
export function inicioPara(permisos: readonly string[]): string {
  return NAV.find((i) => !i.fase && navVisible(i, permisos))?.path ?? "dashboard";
}
