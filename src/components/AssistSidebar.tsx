/**
 * Barra lateral compartida de Mobilink Assist para las pantallas de
 * herramientas (OTF, etc.). Réplica visual del menú de Asistencias:
 * cajón deslizante en móvil, fija en escritorio.
 *
 * Las entradas de asistencias navegan a /asistencias?tab=…; `active` marca
 * la herramienta actual en naranja.
 */

import { useState } from "react";
import {
  Plus,
  Clock3,
  CheckCircle2,
  FileText,
  Map,
  Wifi,
  Store,
  MapPin,
  Truck,
  List,
  Home,
  X,
  Menu,
} from "lucide-react";

type Props = {
  /** Clave de la entrada activa (p. ej. "otf"). */
  active?: "flota" | "central" | "talleres" | "lugares" | "otf" | "vehiculo" | "panel";
};

const itemCls = (activo: boolean) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium transition-colors ${
    activo ? "bg-orange-600 text-white" : "text-slate-300 hover:bg-slate-800"
  }`;

export default function AssistSidebar({ active }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Botón hamburguesa (solo móvil), flotando sobre la cabecera */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3.5 z-20 rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700 md:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-800 bg-slate-950 transition-transform duration-200 md:static md:z-auto md:w-52 md:flex-shrink-0 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end p-2 md:hidden">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          onClick={() => setOpen(false)}
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 pt-1 text-sm md:pt-3"
        >
          <a href="/asistencias?tab=nueva" className={itemCls(false)}>
            <Plus className="h-4 w-4 shrink-0" /> Nueva asistencia
          </a>
          <a href="/asistencias?tab=activas" className={itemCls(false)}>
            <Clock3 className="h-4 w-4 shrink-0" /> Activas
          </a>
          <a href="/asistencias?tab=cerradas" className={itemCls(false)}>
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Últimas cerradas
          </a>
          <a href="/asistencias?tab=historial" className={itemCls(false)}>
            <FileText className="h-4 w-4 shrink-0" /> Historial
          </a>

          <div className="my-2 border-t border-slate-800" />
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Herramientas
          </div>
          <a href="/flota" className={itemCls(active === "flota")}>
            <Map className="h-4 w-4 shrink-0" /> Mapa flota
          </a>
          <a href="/asistencias/central" className={itemCls(active === "central")}>
            <Wifi className="h-4 w-4 shrink-0" /> Central
          </a>
          <a href="/asistencias/talleres" className={itemCls(active === "talleres")}>
            <Store className="h-4 w-4 shrink-0" /> Talleres
          </a>
          <a href="/asistencias" className={itemCls(active === "lugares")}>
            <MapPin className="h-4 w-4 shrink-0" /> Lugares
          </a>
          <a href="/otf" className={itemCls(active === "otf")}>
            <Truck className="h-4 w-4 shrink-0" /> OTF
          </a>
          <a href="/vehiculo" className={itemCls(active === "vehiculo")}>
            <List className="h-4 w-4 shrink-0" /> Historial vehículo
          </a>
          <a href="/dashboard" className={itemCls(active === "panel")}>
            <Home className="h-4 w-4 shrink-0" /> Panel
          </a>
        </nav>
        <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          Mobilink Assist
        </div>
      </aside>
    </>
  );
}
