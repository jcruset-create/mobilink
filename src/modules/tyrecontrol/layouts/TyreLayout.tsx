import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Menu, LogOut, Home, ChevronDown, ChevronRight } from "lucide-react";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { NAV, agruparNav, grupoDeRuta, navVisible, siempreVisibles, type GrupoKey, type NavItem } from "../config/navigation";
import { PERFIL_CLIENTE_LABELS, ROL_LABELS, perfilClienteDe } from "../types";
import CampanaAvisos from "../components/CampanaAvisos";
import AsistenteChat from "../components/AsistenteChat";
import AccesosCabecera from "../../../components/AccesosCabecera";
import VersionDesplegada from "../../../components/VersionDesplegada";
import { pendientes } from "../services/conciliacion";

/** Dónde se recuerdan los grupos abiertos del menú, en este navegador. */
const CLAVE_MENU = "tc-menu-grupos-abiertos";

export default function TyreLayout() {
  const { perfil, pantallas, signOut } = useTyreAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const esSuperadmin = Boolean(perfil?.es_superadmin);
  const soloInformes = perfilClienteDe(perfil) === "director";
  const items = NAV.filter((i) => navVisible(i, perfil?.rol, esSuperadmin, pantallas, soloInformes));
  const { grupos, pie } = agruparNav(items);

  /*
   * Grupos abiertos del menú. Lo que el usuario abre o cierra se recuerda en
   * este navegador; el grupo de la pantalla en la que está se abre solo, para
   * que la pantalla marcada siempre se vea.
   */
  const [abiertos, setAbiertos] = useState<Set<GrupoKey>>(() => {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE_MENU) ?? "[]");
      return new Set(Array.isArray(g) ? (g as GrupoKey[]) : []);
    } catch {
      return new Set();
    }
  });
  // Al cambiar de pantalla se abre su grupo. Se ajusta durante el render (el
  // patrón de React para «estado que sigue a una prop»), no en un efecto.
  const grupoActual = grupoDeRuta(items, location.pathname);
  const [grupoVisto, setGrupoVisto] = useState<GrupoKey | null>(null);
  if (grupoActual !== grupoVisto) {
    setGrupoVisto(grupoActual);
    if (grupoActual && grupoActual !== "pie" && !abiertos.has(grupoActual)) {
      setAbiertos(new Set(abiertos).add(grupoActual));
    }
  }
  useEffect(() => {
    try { localStorage.setItem(CLAVE_MENU, JSON.stringify([...abiertos])); } catch { /* sin memoria, igual funciona */ }
  }, [abiertos]);
  function alternar(g: GrupoKey) {
    setAbiertos((a) => {
      const n = new Set(a);
      if (n.has(g)) n.delete(g); else n.add(g);
      return n;
    });
  }

  /*
   * Distintivo de la conciliación telemática.
   *
   * Lee los contadores GUARDADOS por el repaso quincenal, no concilia: una
   * conciliación de verdad descarga la flota entera del proveedor, y eso no
   * puede pasar cada vez que alguien entra en el panel. Si no hay ninguna
   * pasada todavía, no se enseña nada: un cero daría a entender que se ha
   * comprobado y está todo al día.
   */
  const verConciliacion = items.some((i) => i.key === "conciliacion-telematica");
  const [porRevisar, setPorRevisar] = useState<number | null>(null);

  useEffect(() => {
    if (!verConciliacion) return;
    let vivo = true;
    pendientes()
      .then((p) => { if (vivo) setPorRevisar(p.hayDatos ? p.total : null); })
      // Un contador que no carga no es motivo para romper el menú.
      .catch(() => { if (vivo) setPorRevisar(null); });
    return () => { vivo = false; };
  }, [verConciliacion]);

  // Gating por URL (usuarios unificados): bloquea también el acceso directo
  const pantallaActual = location.pathname.split("/")[2] || "dashboard";
  const bloqueada =
    !esSuperadmin &&
    pantallas !== null &&
    !siempreVisibles(soloInformes).includes(pantallaActual) &&
    !pantallas.includes(pantallaActual);

  function enlace(item: NavItem, dentro: boolean) {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.key}
        to={`/tyrecontrol/${item.path}`}
        onClick={() => setOpen(false)}
        className={({ isActive }) =>
          `flex items-center gap-2 rounded-xl ${dentro ? "py-1.5 pl-8 pr-3" : "px-3 py-2"} text-[13px] font-medium ${
            isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`
        }
      >
        {!dentro && <Icon className="h-4 w-4" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.key === "conciliacion-telematica" && porRevisar ? (
          <span
            title={`${porRevisar} vehículos por revisar en la última conciliación`}
            className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900"
          >
            {porRevisar > 99 ? "99+" : porRevisar}
          </span>
        ) : null}
      </NavLink>
    );
  }

  async function handleSignOut() {
    await signOut();
    navigate("/tyrecontrol/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Topbar */}
      <header className="no-imprimir sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2 md:gap-3">
          <button className="rounded-lg p-1.5 hover:bg-slate-800 md:hidden" onClick={() => setOpen((v) => !v)}>
            <Menu className="h-5 w-5" />
          </button>
          <img src="/tyrecontrol-emblem.png" alt="" className="h-9 w-auto" />
          <span className="whitespace-nowrap text-sm font-black leading-none">
            <span className="text-white">Mobi</span>
            <span className="text-blue-400">link</span>{" "}
            <span className="text-green-400">Tyre</span>
            <span className="text-slate-100">Control</span>
          </span>
          {/* Versión del panel y commit desplegado. El segundo es el que dice
              de verdad si un arreglo ha llegado a producción. */}
          <VersionDesplegada className="hidden sm:inline" />
          <img
            src="/tyrecontrol-features.png"
            alt="Flotas, neumáticos, mantenimiento, informes"
            className="ml-2 hidden h-7 w-auto lg:block"
          />
        </div>
        <div className="flex items-center gap-3">
          <CampanaAvisos />
          <div className="hidden text-right sm:block">
            <div className="text-[12px] font-semibold leading-tight">👤 {perfil?.nombre}</div>
            <div className="text-[10px] text-slate-400">
              {perfil?.es_superadmin ? "Super-admin" : perfil ? (perfilClienteDe(perfil) ? PERFIL_CLIENTE_LABELS[perfilClienteDe(perfil)!] : ROL_LABELS[perfil.rol]) : ""}
              {perfil?.empresa?.nombre ? ` · ${perfil.empresa.nombre}` : ""}
            </div>
          </div>
          <AccesosCabecera actual="tyrecontrol" />
          <button onClick={() => navigate("/inicio")} title="Volver al inicio" className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <Home className="h-4 w-4" /> Inicio
          </button>
          <button onClick={handleSignOut} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px]">
        {/* Sidebar */}
        <aside className={`no-imprimir ${open ? "block" : "hidden"} w-52 shrink-0 border-r border-slate-700 bg-slate-900 p-2 md:block`}>
          <nav className="flex flex-col gap-1">
            {grupos.map((g) => {
              const Icono = g.icon;
              const abierto = abiertos.has(g.key);
              const avisos = g.items.some((it) => it.key === "conciliacion-telematica") ? porRevisar : null;
              return (
                <div key={g.key}>
                  <button
                    type="button"
                    onClick={() => alternar(g.key)}
                    aria-expanded={abierto}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold ${
                      abierto ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <Icono className="h-4 w-4 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{g.label}</span>
                    {/* Con el grupo cerrado, el aviso de la conciliación sube al grupo. */}
                    {!abierto && avisos ? (
                      <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900">
                        {avisos > 99 ? "99+" : avisos}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">{g.items.length}</span>
                    {abierto ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                  </button>
                  {abierto && (
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      {g.items.map((item) => enlace(item, true))}
                    </div>
                  )}
                </div>
              );
            })}
            {pie.length > 0 && (
              <div className="mt-2 flex flex-col gap-0.5 border-t border-slate-700 pt-2">
                {pie.map((item) => enlace(item, false))}
              </div>
            )}
          </nav>
        </aside>

        {/* Contenido */}
        {/* `zona-impresion` es lo ÚNICO que sale en papel. Ver estilos/impresion.css. */}
        <main className="zona-impresion min-w-0 flex-1 p-3">
          {bloqueada ? (
            <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
              No tienes acceso a esta pantalla. Contacta con un administrador.
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* Asistente: acompaña a todo el módulo, sin ocupar sitio en las pantallas. */}
      <AsistenteChat />
    </div>
  );
}
