import { Home, LayoutDashboard, Users, Building2, MapPin, Truck, CircleDot, Wrench, Settings, User, ClipboardList, ClipboardCheck, ShieldCheck, Link2, Ruler, BookOpen, Bluetooth, BarChart3, Upload, Archive, CalendarCheck, AlertTriangle, History, HelpCircle, QrCode, Gauge, FileScan, type LucideIcon } from "lucide-react";
import type { Rol } from "../types";

/**
 * Grupos del menú, en el orden en que salen. Se agrupa por lo que está
 * haciendo quien entra: mirar la flota, organizar revisiones, seguir los
 * neumáticos, cargar datos, mantener el catálogo o administrar. El cliente
 * tiene los suyos, con sus palabras. «pie» son Ayuda y Perfil, siempre abajo
 * y fuera de los desplegables.
 */
export type GrupoKey =
  | "inicio" | "flota" | "revisiones" | "neumaticos" | "entrada" | "catalogo" | "administracion"
  | "mi-flota" | "mis-neumaticos" | "pie";

export const GRUPOS: { key: Exclude<GrupoKey, "pie">; label: string; icon: LucideIcon }[] = [
  { key: "inicio", label: "Inicio", icon: Home },
  { key: "flota", label: "Flota", icon: Truck },
  { key: "mi-flota", label: "Mi flota", icon: Truck },
  { key: "revisiones", label: "Revisiones", icon: ClipboardCheck },
  { key: "neumaticos", label: "Neumáticos y taller", icon: CircleDot },
  { key: "mis-neumaticos", label: "Mis neumáticos", icon: CircleDot },
  { key: "entrada", label: "Entrada de datos", icon: Upload },
  { key: "catalogo", label: "Catálogo", icon: BookOpen },
  { key: "administracion", label: "Administración", icon: Settings },
];

export type NavItem = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
  grupo: GrupoKey;
  roles?: Rol[]; // visible para estos roles (además del super-admin)
  superadminOnly?: boolean;
};

export const NAV: NavItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: LayoutDashboard, grupo: "inicio" },
  { key: "informes", path: "informes", label: "Informes", icon: BarChart3, grupo: "inicio", roles: ["administrador"] },
  // Administrador / super-admin
  { key: "empresas", path: "empresas", label: "Empresas", icon: Building2, grupo: "administracion", roles: ["administrador"] },
  { key: "delegaciones", path: "delegaciones", label: "Delegaciones", icon: MapPin, grupo: "administracion", roles: ["administrador"] },
  { key: "usuarios", path: "usuarios", label: "Usuarios", icon: Users, grupo: "administracion", roles: ["administrador"] },
  { key: "vehiculos", path: "vehiculos", label: "Vehículos", icon: Truck, grupo: "flota", roles: ["administrador"] },
  { key: "conciliacion-telematica", path: "conciliacion-telematica", label: "Conciliación telemática", icon: Link2, grupo: "flota", roles: ["administrador"] },
  { key: "vehiculos-en-bases", path: "vehiculos-en-bases", label: "Vehículos en bases", icon: MapPin, grupo: "flota", roles: ["administrador", "operador"] },
  { key: "ranking-kilometraje", path: "ranking-kilometraje", label: "Kilómetros por vehículo", icon: Gauge, grupo: "flota", roles: ["administrador"] },
  { key: "km-flota", path: "km-flota", label: "Km de la flota", icon: Gauge, grupo: "flota", roles: ["administrador"] },
  { key: "disponibles-revisar", path: "disponibles-revisar", label: "Disponibles para revisar", icon: CalendarCheck, grupo: "revisiones", roles: ["administrador", "operador"] },
  { key: "control-tacografos", path: "control-tacografos", label: "Control de tacógrafos", icon: Gauge, grupo: "flota", roles: ["administrador"] },
  { key: "propuestas-medida", path: "propuestas-medida", label: "Propuestas de medida", icon: Ruler, grupo: "revisiones", roles: ["administrador"] },
  { key: "planificacion", path: "planificacion", label: "Planificación de revisiones", icon: ClipboardList, grupo: "revisiones", roles: ["administrador", "operador"] },
  { key: "incidencias", path: "incidencias", label: "Incidencias", icon: AlertTriangle, grupo: "revisiones", roles: ["administrador", "operador"] },
  { key: "historico-revisiones", path: "historico-revisiones", label: "Histórico de revisiones", icon: History, grupo: "revisiones", roles: ["administrador", "operador"] },
  { key: "lotes-revision", path: "lotes-revision", label: "Lotes de revisión", icon: ClipboardList, grupo: "revisiones", roles: ["administrador"] },
  { key: "etiquetas", path: "etiquetas", label: "Etiquetas de neumáticos", icon: QrCode, grupo: "neumaticos", roles: ["administrador", "operador"] },
  { key: "plantillas-mantenimiento", path: "plantillas-mantenimiento", label: "Plantillas de mantenimiento", icon: ClipboardCheck, grupo: "neumaticos", roles: ["administrador"] },
  { key: "neumaticos", path: "neumaticos", label: "Neumáticos", icon: CircleDot, grupo: "neumaticos", roles: ["administrador"] },
  { key: "almacen-usados", path: "almacen-usados", label: "Almacén de usados", icon: Archive, grupo: "neumaticos", roles: ["administrador"] },
  { key: "montajes", path: "montajes", label: "Montajes actuales", icon: Wrench, grupo: "neumaticos", roles: ["administrador"] },
  { key: "operaciones", path: "operaciones", label: "Operaciones", icon: ClipboardList, grupo: "neumaticos", roles: ["administrador"] },
  { key: "intervenciones", path: "intervenciones", label: "Intervenciones", icon: CalendarCheck, grupo: "neumaticos", roles: ["administrador"] },
  { key: "revision-vehiculo", path: "revision-vehiculo", label: "Revisión de vehículo", icon: ClipboardCheck, grupo: "revisiones", roles: ["administrador", "operador"] },
  { key: "autorizaciones", path: "autorizaciones", label: "Autorizaciones", icon: ShieldCheck, grupo: "neumaticos", roles: ["administrador"] },
  { key: "enlace-almacen", path: "enlace-almacen", label: "Enlace con almacén", icon: Link2, grupo: "administracion", superadminOnly: true },
  { key: "medidas-neumaticos", path: "medidas-neumaticos", label: "Medidas de neumáticos", icon: Ruler, grupo: "catalogo", roles: ["administrador"] },
  { key: "catalogo-neumaticos", path: "catalogo-neumaticos", label: "Catálogo de neumáticos", icon: BookOpen, grupo: "catalogo", roles: ["administrador"] },
  { key: "sonda", path: "sonda", label: "Sonda TLGX", icon: Bluetooth, grupo: "entrada", roles: ["administrador", "operador"] },
  { key: "importar", path: "importar", label: "Importar", icon: Upload, grupo: "entrada", roles: ["administrador"] },
  { key: "parte-proveedor", path: "parte-proveedor", label: "Parte del taller", icon: FileScan, grupo: "entrada", roles: ["administrador"] },
  { key: "partes-papel", path: "partes-papel", label: "Partes en papel", icon: FileScan, grupo: "entrada", roles: ["administrador", "operador"] },
  { key: "tipos-incidencia", path: "tipos-incidencia", label: "Tipos y motivos de incidencia", icon: AlertTriangle, grupo: "administracion", roles: ["administrador"] },
  { key: "configuracion", path: "configuracion", label: "Configuración", icon: Settings, grupo: "administracion", roles: ["administrador"] },
  // Cliente
  { key: "mi-empresa", path: "mi-empresa", label: "Mi empresa", icon: Building2, grupo: "mi-flota", roles: ["cliente"] },
  { key: "mis-delegaciones", path: "mis-delegaciones", label: "Mis delegaciones", icon: MapPin, grupo: "mi-flota", roles: ["cliente"] },
  { key: "mis-vehiculos", path: "mis-vehiculos", label: "Mis vehículos", icon: Truck, grupo: "mi-flota", roles: ["cliente"] },
  { key: "mis-neumaticos", path: "mis-neumaticos", label: "Mis neumáticos", icon: CircleDot, grupo: "mis-neumaticos", roles: ["cliente"] },
  // El cliente tiene sus propias entradas, así que se nombran en su idioma:
  // "montaje" y "operación" son vocabulario de taller, no de un responsable
  // de flota que entra a ver cómo están sus autobuses.
  { key: "montajes-cliente", path: "montajes", label: "Neumáticos montados", icon: Wrench, grupo: "mis-neumaticos", roles: ["cliente"] },
  { key: "operaciones-cliente", path: "operaciones", label: "Trabajos realizados", icon: ClipboardList, grupo: "mis-neumaticos", roles: ["cliente"] },
  { key: "intervenciones-cliente", path: "intervenciones", label: "Partes de trabajo", icon: CalendarCheck, grupo: "mis-neumaticos", roles: ["cliente"] },
  { key: "informes-cliente", path: "informes", label: "Informes", icon: BarChart3, grupo: "inicio", roles: ["cliente"] },
  // Todos
  { key: "ayuda", path: "ayuda", label: "Ayuda / Manual", icon: HelpCircle, grupo: "pie" },
  { key: "perfil", path: "perfil", label: "Perfil", icon: User, grupo: "pie" },
];

/** Pantallas que nunca se filtran por permisos. */
export const SIEMPRE_VISIBLES = ["dashboard", "ayuda", "perfil"];

/**
 * Las que nunca se filtran para ESTE usuario. Un director de cliente solo
 * tiene informes: el dashboard, que es del día a día de la flota, tampoco.
 */
export function siempreVisibles(soloInformes?: boolean): string[] {
  return soloInformes ? SIEMPRE_VISIBLES.filter((p) => p !== "dashboard") : SIEMPRE_VISIBLES;
}

export function navVisible(item: NavItem, rol: Rol | undefined, esSuperadmin: boolean, pantallas?: string[] | null, soloInformes?: boolean): boolean {
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
  // Dashboard, Ayuda y Perfil no se filtran nunca: dejar a alguien sin su
  // propia ficha o sin la ayuda no es restringir, es dejarle atrapado.
  if (!esSuperadmin && pantallas && !siempreVisibles(soloInformes).includes(item.path) && !pantallas.includes(item.path)) {
    return false;
  }
  return true;
}

/** Un grupo del menú con las pantallas que ve este usuario. */
export interface GrupoNav {
  key: Exclude<GrupoKey, "pie">;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * Reparte las pantallas visibles en sus grupos, en el orden de GRUPOS. Un
 * grupo sin ninguna pantalla para este usuario no sale. Ayuda y Perfil van
 * aparte (`pie`), siempre abajo.
 */
export function agruparNav(items: NavItem[]): { grupos: GrupoNav[]; pie: NavItem[] } {
  const grupos = GRUPOS.map((g) => ({ ...g, items: items.filter((i) => i.grupo === g.key) }))
    .filter((g) => g.items.length > 0);
  return { grupos, pie: items.filter((i) => i.grupo === "pie") };
}

/** El grupo de una ruta (`/tyrecontrol/vehiculos-en-bases/…` → «flota»). */
export function grupoDeRuta(items: NavItem[], pathname: string): GrupoKey | null {
  const pantalla = pathname.split("/")[2] || "dashboard";
  return items.find((i) => i.path === pantalla)?.grupo ?? null;
}

/** Sin acentos y en minúsculas: «planificacion» encuentra «Planificación». */
function plano(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * El buscador del menú: las pantallas visibles cuyo nombre, o el de su
 * grupo, contiene todas las palabras escritas. «bases» → Vehículos en bases;
 * «revisiones hist» → Histórico de revisiones. Ayuda y Perfil también salen.
 */
export function buscarEnMenu(items: NavItem[], consulta: string): NavItem[] {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const nombreGrupo = new Map(GRUPOS.map((g) => [g.key as GrupoKey, g.label]));
  return items.filter((i) => {
    const texto = plano(`${i.label} ${nombreGrupo.get(i.grupo) ?? ""}`);
    return palabras.every((p) => texto.includes(p));
  });
}
