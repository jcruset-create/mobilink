/**
 * Connect Pro — menú lateral declarativo (patrón TyreControl).
 * Los apartados se muestran según el rol mínimo; los de fases futuras
 * aparecen deshabilitados con su badge.
 */

import {
  LayoutDashboard, Radio, PlusCircle, ClipboardList, Map, Building2, Warehouse,
  Truck, AlertTriangle, BellRing, Contact, Plug, BarChart3, FileText,
  Receipt, UserCog, ScrollText, Settings, Handshake, type LucideIcon,
} from "lucide-react";
import type { ConnectRole } from "../types";

export type ConnectNavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  minRole: ConnectRole;
  phase?: "F2" | "F3"; // fase futura → deshabilitado
};

export const CONNECT_NAV: ConnectNavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard, minRole: "analyst" },
  { key: "centro", path: "centro", label: "Centro de control", icon: Radio, minRole: "operator" },
  { key: "nueva", path: "nueva", label: "Nueva asistencia", icon: PlusCircle, minRole: "operator" },
  { key: "asistencias", path: "asistencias", label: "Asistencias", icon: ClipboardList, minRole: "analyst" },
  { key: "ofertas", path: "ofertas", label: "Ofertas", icon: Handshake, minRole: "provider_user" },
  { key: "mapa", path: "mapa", label: "Mapa operativo", icon: Map, minRole: "operator" },
  { key: "empresas", path: "empresas", label: "Empresas de asistencia", icon: Building2, minRole: "analyst" },
  { key: "talleres", path: "talleres", label: "Talleres", icon: Warehouse, minRole: "analyst" },
  { key: "unidades", path: "unidades", label: "Unidades móviles", icon: Truck, minRole: "operator", phase: "F3" },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, minRole: "operator" },
  { key: "sla", path: "sla", label: "SLA y alertas", icon: BellRing, minRole: "supervisor", phase: "F2" },
  { key: "clientes", path: "clientes", label: "Clientes", icon: Contact, minRole: "cc_admin", phase: "F2" },
  { key: "integraciones", path: "integraciones", label: "Partners e integraciones", icon: Plug, minRole: "cc_admin" },
  { key: "estadisticas", path: "estadisticas", label: "Estadísticas", icon: BarChart3, minRole: "analyst" },
  { key: "informes", path: "informes", label: "Informes", icon: FileText, minRole: "analyst", phase: "F2" },
  { key: "facturacion", path: "facturacion", label: "Facturación", icon: Receipt, minRole: "cc_admin", phase: "F2" },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: UserCog, minRole: "cc_admin" },
  { key: "auditoria", path: "auditoria", label: "Auditoría", icon: ScrollText, minRole: "cc_admin" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, minRole: "cc_admin" },
];
