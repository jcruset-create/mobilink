// Accesos directos entre módulos, para la cabecera de cada uno: un icono por
// módulo con licencia (y acceso del usuario) que lleva a su portada.
//
// Las rutas son las mismas que usa el hub de Inicio (rutaModulo); si allí
// cambia una portada, hay que cambiarla aquí también.
import type { ReactNode } from "react";
import { Wallet, Warehouse, Users, Hammer, HardHat, Clock, CalendarClock, Coins, Network, Gauge, Wrench } from "lucide-react";
import iconoAssist from "../assets/hub/icono-assist.png";
import emblemaTyre from "../assets/hub/emblema-tyrecontrol.png";

export type AccesoModulo = { key: string; label: string; ruta: string; icono: ReactNode };

const img = (src: string, alt: string) => <img src={src} alt={alt} className="h-6 w-6 rounded-md object-cover" />;
const cls = "h-5 w-5";

export const ACCESOS_MODULOS: AccesoModulo[] = [
  { key: "assist",         label: "Mobilink Assist", ruta: "/asistencias",              icono: img(iconoAssist, "Mobilink Assist") },
  { key: "tyrecontrol",    label: "TyreControl",     ruta: "/tyrecontrol/dashboard",    icono: img(emblemaTyre, "TyreControl") },
  { key: "administracion", label: "Administración",  ruta: "/administracion/dashboard", icono: <Wallet className={cls} /> },
  { key: "almacen",        label: "Almacén",         ruta: "/almacen-neumaticos",       icono: <Warehouse className={cls} /> },
  { key: "sea-core",       label: "Core",            ruta: "/core",                     icono: <Users className={cls} /> },
  { key: "toolcontrol",    label: "ToolControl",     ruta: "/toolcontrol",              icono: <Hammer className={cls} /> },
  { key: "safety",         label: "Safety",          ruta: "/safety",                   icono: <HardHat className={cls} /> },
  { key: "presencia",      label: "Presencia",       ruta: "/presencia",                icono: <Clock className={cls} /> },
  { key: "workplanner",    label: "WorkPlanner",     ruta: "/workplanner",              icono: <CalendarClock className={cls} /> },
  { key: "cash",           label: "Cash",            ruta: "/cash/jornada",             icono: <Coins className={cls} /> },
  { key: "central",        label: "Central",         ruta: "/central",                  icono: <Network className={cls} /> },
  { key: "tacografos",     label: "TachoCert",       ruta: "/tacografos",               icono: <Gauge className={cls} /> },
  { key: "taller",         label: "Panel de taller", ruta: "/taller",                   icono: <Wrench className={cls} /> },
];
