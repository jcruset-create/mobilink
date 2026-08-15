/**
 * Connect Pro — menú lateral declarativo (patrón TyreControl).
 * Los apartados se muestran según el rol mínimo; los de fases futuras
 * aparecen deshabilitados con su badge.
 */

import {
  LayoutDashboard, Radio, PlusCircle, ClipboardList, Map, Building2,
  AlertTriangle, BellRing, Contact, Plug, BarChart3, FileText,
  Receipt, UserCog, ScrollText, Settings, Handshake, BrainCircuit, Wrench, HeartPulse, Tags, type LucideIcon,
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
  { key: "inteligencia", path: "inteligencia", label: "Inteligencia operacional", icon: BrainCircuit, minRole: "analyst" },
  { key: "centro", path: "centro", label: "Centro de control", icon: Radio, minRole: "operator" },
  { key: "nueva", path: "nueva", label: "Nueva asistencia", icon: PlusCircle, minRole: "operator" },
  { key: "asistencias", path: "asistencias", label: "Asistencias", icon: ClipboardList, minRole: "analyst" },
  { key: "ofertas", path: "ofertas", label: "Ofertas", icon: Handshake, minRole: "provider_user" },
  { key: "mapa", path: "mapa", label: "Mapa operativo", icon: Map, minRole: "operator" },
  // Empresas → Talleres → Unidades y Operarios es la jerarquía; "Talleres" es
  // la vista transversal de toda la red, y desde ella se dan de alta talleres
  // por WhatsApp sin tener que entrar antes en su empresa.
  { key: "empresas", path: "empresas", label: "Empresas de asistencia", icon: Building2, minRole: "analyst" },
  { key: "talleres", path: "talleres", label: "Talleres de la red", icon: Wrench, minRole: "analyst" },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, minRole: "operator" },
  { key: "sla", path: "sla", label: "SLA y alertas", icon: BellRing, minRole: "operator" },
  { key: "clientes", path: "clientes", label: "Clientes", icon: Contact, minRole: "operator" },
  { key: "salud-lite", path: "salud-lite", label: "Salud de Assist Lite", icon: HeartPulse, minRole: "analyst" },
  { key: "integraciones", path: "integraciones", label: "Partners e integraciones", icon: Plug, minRole: "cc_admin" },
  { key: "estadisticas", path: "estadisticas", label: "Estadísticas", icon: BarChart3, minRole: "analyst" },
  { key: "informes", path: "informes", label: "Informes", icon: FileText, minRole: "analyst" },
  // Tarifas va justo antes de Facturación porque es de donde salen los
  // importes que ahí se liquidan.
  { key: "tarifas", path: "tarifas", label: "Tarifas", icon: Tags, minRole: "cc_admin" },
  { key: "facturacion", path: "facturacion", label: "Facturación", icon: Receipt, minRole: "cc_admin" },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: UserCog, minRole: "cc_admin" },
  { key: "auditoria", path: "auditoria", label: "Auditoría", icon: ScrollText, minRole: "cc_admin" },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, minRole: "cc_admin" },
];
