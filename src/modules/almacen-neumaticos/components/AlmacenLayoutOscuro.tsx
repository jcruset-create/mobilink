import type { ReactNode } from "react";
import { useState } from "react";
import {
  LayoutDashboard, Package, ArrowDownToLine, ArrowUpFromLine, Repeat, ClipboardList,
  PackageSearch, AlertTriangle, History, CircleDot, Users, Truck, Building2,
  UserCog, ShieldCheck, Settings, Menu, LogOut, Home,
} from "lucide-react";
import { usePermisosAlmacen } from "../hooks/usePermisosAlmacen";
import { cerrarSesion } from "../services/authAlmacen";

// Mismo estilo visual que SEA TyreControl (fondo slate-900, activo sky-600),
// aplicado al módulo de Almacén — sin tocar rutas ni lógica existente.
interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  visible: boolean;
}

export default function AlmacenLayoutOscuro({ children }: { children: ReactNode }) {
  const { permisos, cargandoPermisos } = usePermisosAlmacen();
  const [open, setOpen] = useState(false);

  const esAdmin = permisos.esAdmin;
  const esResponsable = permisos.esResponsable;
  const esOperario = permisos.esOperario;
  const puedeVerOperativo = esAdmin || esResponsable || esOperario;
  const puedeVerEntradas = esAdmin || esResponsable;
  const puedeVerReposiciones = esAdmin || esResponsable;
  const puedeVerMaestros = esAdmin;
  const puedeVerAdmin = esAdmin;

  const items: NavItem[] = [
    { href: "/almacen-neumaticos", label: "Dashboard", icon: LayoutDashboard, visible: true },
    { href: "/almacen-neumaticos/stock", label: "Stock", icon: Package, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/entradas", label: "Entradas", icon: ArrowDownToLine, visible: puedeVerEntradas },
    { href: "/almacen-neumaticos/salidas", label: "Salidas / Montajes", icon: ArrowUpFromLine, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/traspasos", label: "Traspasos", icon: Repeat, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/reposiciones", label: "Reposiciones", icon: ClipboardList, visible: puedeVerReposiciones },
    { href: "/almacen-neumaticos/inventarios", label: "Inventarios", icon: PackageSearch, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/incidencias", label: "Incidencias", icon: AlertTriangle, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/historial", label: "Historial", icon: History, visible: puedeVerOperativo },
    { href: "/almacen-neumaticos/productos", label: "Productos", icon: CircleDot, visible: puedeVerMaestros },
    { href: "/almacen-neumaticos/clientes", label: "Clientes", icon: Users, visible: puedeVerMaestros },
    { href: "/almacen-neumaticos/vehiculos", label: "Vehículos", icon: Truck, visible: puedeVerMaestros },
    { href: "/almacen-neumaticos/centros", label: "Centros", icon: Building2, visible: puedeVerMaestros },
    { href: "/almacen-neumaticos/usuarios", label: "Usuarios", icon: UserCog, visible: puedeVerAdmin },
    { href: "/almacen-neumaticos/auditoria", label: "Auditoría", icon: ShieldCheck, visible: puedeVerAdmin },
    { href: "/almacen-neumaticos/sistema", label: "Sistema", icon: Settings, visible: puedeVerAdmin },
  ];

  const rutaActual = typeof window !== "undefined" ? window.location.pathname : "";

  async function salir() {
    await cerrarSesion();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <Package className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-black">SEA Almacén</span>
        </div>
        <div className="flex items-center gap-3">
          {!cargandoPermisos && permisos.perfil && (
            <div className="hidden text-right sm:block">
              <div className="text-[12px] font-semibold leading-tight">{permisos.perfil.nombre || "—"}</div>
              <div className="text-[10px] text-slate-400">{permisos.perfil.rol || ""}</div>
            </div>
          )}
          <a href="/inicio" title="Volver al menú principal" className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <Home className="h-4 w-4" /> Inicio
          </a>
          <button onClick={salir} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px]">
        <aside className={`${open ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-700 bg-slate-900 p-2 md:block`}>
          <nav className="flex flex-col gap-1">
            {items.filter((i) => i.visible).map((item) => {
              const Icon = item.icon;
              const isActive = rutaActual === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium ${
                    isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </a>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-3">{children}</main>
      </div>
    </div>
  );
}
