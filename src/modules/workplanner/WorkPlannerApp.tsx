import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { Home, LogOut, CalendarClock, ClipboardList, CalendarDays, BarChart3, Settings, ShieldAlert, CalendarCheck, Network, TrendingUp, UserCheck, FileInput, MonitorSmartphone } from "lucide-react";
import logoMobilink from "../../assets/logo-mobilink.png";
import SeaTarragonaV1 from "../../SeaTarragonaV1";
import PedidosErpPage from "./PedidosErpPage";
import { supabase } from "../administracion/services/supabase";
import { APP_VERSION } from "../../version";

/** Clave del módulo en app_licencias / app_usuario_modulos. */
export const MODULO_WORKPLANNER = "workplanner";

// Menú del módulo. Estadísticas y Configuración quedan preparadas como
// placeholders ("Próximamente") para las próximas fases.
const SECCIONES = [
  { key: "operativo2", label: "Operativo 2", icon: ClipboardList, proximamente: false },
  { key: "agenda", label: "Agenda", icon: CalendarDays, proximamente: false },
  { key: "tecnicos", label: "Pantalla técnicos", icon: MonitorSmartphone, proximamente: false },
  { key: "pedidos", label: "Pedidos ERP", icon: FileInput, proximamente: false },
  { key: "estadisticas", label: "Análisis y estadísticas", icon: BarChart3, proximamente: true },
  { key: "configuracion", label: "Configuración", icon: Settings, proximamente: true },
] as const;

// Reclamo del módulo, reconstruido con iconos en vez de una imagen: fondo
// transparente real y se adapta al alto y al color de la cabecera.
const RECLAMO = [
  { label: "Planifica", icon: CalendarCheck, color: "text-sky-400" },
  { label: "Organiza", icon: Network, color: "text-emerald-400" },
  { label: "Optimiza", icon: TrendingUp, color: "text-sky-400" },
  { label: "Asigna", icon: UserCheck, color: "text-emerald-400" },
] as const;

function ReclamoWorkPlanner() {
  return (
    <div className="hidden shrink-0 items-center gap-2 xl:flex" aria-hidden>
      {RECLAMO.map((r, i) => {
        const Icon = r.icon;
        return (
          <div key={r.label} className="flex items-center gap-2">
            {i > 0 && <span className="h-4 w-px bg-slate-700" />}
            <span className="flex items-center gap-1.5">
              <Icon className={`h-4 w-4 ${r.color}`} />
              <span className="text-[11px] font-black uppercase italic tracking-wide text-slate-200">
                {r.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Proximamente({ titulo }: { titulo: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15">
          <CalendarClock className="h-6 w-6 text-sky-400" />
        </div>
        <h2 className="text-base font-bold text-slate-100">{titulo}</h2>
        <p className="mt-2 text-sm text-slate-400">
          Esta sección de Mobilink WorkPlanner estará disponible próximamente.
        </p>
      </div>
    </div>
  );
}

function SinLicencia() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15">
          <ShieldAlert className="h-6 w-6 text-amber-400" />
        </div>
        <h2 className="text-base font-bold text-amber-200">Módulo no disponible</h2>
        <p className="mt-2 text-sm text-amber-300/80">
          Tu empresa no tiene licencia vigente de Mobilink WorkPlanner, o tu usuario no tiene
          acceso a este módulo. Contacta con un administrador.
        </p>
        <button
          onClick={() => navigate("/inicio")}
          className="mt-4 rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          Volver al inicio
        </button>
      </div>
    </div>
  );
}

/**
 * Comprueba que el usuario tiene acceso a WorkPlanner Y que su empresa tiene
 * la licencia vigente del módulo. WorkPlanner se licencia de forma
 * INDEPENDIENTE del panel de taller ('taller'): tenerlo o no tenerlo no
 * implica nada sobre el otro módulo.
 *
 * Devuelve null mientras carga, true/false una vez resuelto.
 */
function useAccesoWorkplanner() {
  const [permitido, setPermitido] = useState<boolean | null>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) { if (activo) setPermitido(false); return; }

      // El superadmin de plataforma ve todos los módulos.
      try {
        const { data: u } = await supabase
          .from("app_usuarios")
          .select("es_superadmin")
          .eq("id", user.id)
          .maybeSingle();
        if (u?.es_superadmin) { if (activo) setPermitido(true); return; }
      } catch { /* tabla sin migrar: seguimos */ }

      // app_mis_modulos ya cruza permiso de usuario × licencia vigente.
      try {
        const { data: rows, error } = await supabase.rpc("app_mis_modulos");
        if (error) throw error;
        const ok = (rows ?? []).some((r: { modulo: string }) => r.modulo === MODULO_WORKPLANNER);
        if (activo) setPermitido(ok);
        return;
      } catch { /* migración SaaS no aplicada: fallback */ }

      // Fallback sin RPC: solo permiso de usuario (la licencia se valida en
      // servidor cuando la migración esté aplicada).
      try {
        const { data: rows } = await supabase
          .from("app_usuario_modulos")
          .select("modulo")
          .eq("user_id", user.id);
        const ok = (rows ?? []).some((r) => r.modulo === MODULO_WORKPLANNER);
        if (activo) setPermitido(ok);
      } catch {
        // Entorno sin las tablas SaaS: no bloqueamos el módulo.
        if (activo) setPermitido(true);
      }
    })();
    return () => { activo = false; };
  }, []);

  return permitido;
}

/**
 * Mobilink WorkPlanner: agrupa Operativo 2 y la agenda (Agenda 2) del panel
 * de taller bajo un menú propio, con Estadísticas y Configuración preparadas
 * para fases futuras. Las vistas funcionales reutilizan SeaTarragonaV1 en
 * modo embebido (sin su cabecera ni su conmutador de vistas), sin duplicar
 * código.
 */
export default function WorkPlannerApp() {
  const navigate = useNavigate();
  const permitido = useAccesoWorkplanner();

  // El body de la app es claro (#f8fafc) porque el panel de taller lo es. En
  // WorkPlanner todo va en oscuro, así que se tiñe el fondo del documento con
  // el mismo slate-900 del resto de módulos para que no asome ninguna zona de
  // otro color por debajo del contenido.
  useEffect(() => {
    const anterior = document.body.style.background;
    document.body.style.background = "#0f172a";
    return () => { document.body.style.background = anterior; };
  }, []);

  async function salir() {
    // Cierra tanto la sesión de plataforma como el login interno del panel.
    try {
      localStorage.removeItem("sea-authenticated");
      localStorage.removeItem("sea-admin-token");
      localStorage.removeItem("sea-role");
      localStorage.removeItem("sea-allowed-views");
      localStorage.removeItem("sea-user-name");
    } catch { /* noop */ }
    await supabase.auth.signOut();
    navigate("/acceso", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-700 bg-slate-900/95 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-3 overflow-x-auto">
          <div className="flex shrink-0 items-center gap-1.5">
            <img
              src={logoMobilink}
              alt="Mobilink"
              className="h-7 w-auto shrink-0"
            />
            <CalendarClock className="h-4 w-4 text-sky-400" />
            <span className="text-[13px] font-black">WorkPlanner</span>
            <span
              className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400"
              title="Versión desplegada"
            >
              {APP_VERSION}
            </span>
          </div>
          <ReclamoWorkPlanner />
          {permitido && (
            <nav className="flex items-center gap-1">
              {SECCIONES.map((s) => {
                const Icon = s.icon;
                return (
                  <NavLink
                    key={s.key}
                    to={`/workplanner/${s.key}`}
                    className={({ isActive }) =>
                      `flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ${
                        isActive
                          ? "bg-sky-600 text-white"
                          : s.proximamente
                            ? "text-slate-500 hover:bg-slate-800 hover:text-slate-400"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                    {s.proximamente && (
                      <span className="rounded-full border border-slate-600 px-1.5 py-px text-[9px] font-bold uppercase text-slate-500">
                        Próx.
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => navigate("/inicio")}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700"
              title="Volver a Inicio"
            >
              <Home className="h-4 w-4" /> <span className="hidden sm:inline">Inicio</span>
            </button>
            <button
              onClick={salir}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {permitido === null ? (
        <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>
      ) : !permitido ? (
        <SinLicencia />
      ) : (
        <Routes>
          <Route index element={<Navigate to="/workplanner/operativo2" replace />} />
          <Route
            path="operativo2"
            element={<SeaTarragonaV1 key="wp-operativo2" initialView="operativo2" embebido />}
          />
          <Route
            path="agenda"
            element={
              <SeaTarragonaV1
                key="wp-agenda2"
                initialView="agenda2"
                embebido
                onVolverModulo={() => navigate("/workplanner/operativo2")}
              />
            }
          />
          <Route path="pedidos" element={<PedidosErpPage />} />
          <Route
            path="tecnicos"
            element={
              <SeaTarragonaV1
                key="wp-operarios"
                initialView="operarios"
                embebido
                onVolverModulo={() => navigate("/workplanner/operativo2")}
              />
            }
          />
          <Route path="estadisticas" element={<Proximamente titulo="Análisis y estadísticas" />} />
          <Route path="configuracion" element={<Proximamente titulo="Configuración" />} />
          <Route path="*" element={<Navigate to="/workplanner/operativo2" replace />} />
        </Routes>
      )}
    </div>
  );
}
