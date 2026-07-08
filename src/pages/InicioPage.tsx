import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, Wallet, Warehouse, Truck, Wrench, type LucideIcon } from "lucide-react";
import { supabase } from "../modules/administracion/services/supabase";
import { MODULOS_APP, type ModuloApp } from "../modules/administracion/config/modulosApp";

// Tarjeta fija del Panel de taller (tiene su propio login interno).
// Ponlo a false si no quieres que aparezca en el hub.
const MOSTRAR_PANEL_TALLER = true;

const ICONOS: Record<string, LucideIcon> = {
  administracion: Wallet,
  almacen: Warehouse,
  tyrecontrol: Truck,
};

const COLORES: Record<string, { bg: string; text: string }> = {
  administracion: { bg: "bg-sky-500/15", text: "text-sky-400" },
  almacen: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  tyrecontrol: { bg: "bg-violet-500/15", text: "text-violet-400" },
};

function rutaModulo(modulo: string): string {
  if (modulo === "administracion") return "/administracion/dashboard";
  if (modulo === "almacen") return "/almacen-neumaticos";
  return "/tyrecontrol/dashboard";
}

function rutaPantalla(modulo: string, pantalla: string): string {
  if (modulo === "administracion") return `/administracion/${pantalla}`;
  if (modulo === "almacen") return pantalla === "dashboard" ? "/almacen-neumaticos" : `/almacen-neumaticos/${pantalla}`;
  return `/tyrecontrol/${pantalla}`;
}

type TarjetaModulo = {
  modulo: ModuloApp;
  rolLabel: string;
  pantallas: { key: string; label: string }[];
};

/** Hub de entrada: los módulos y pantallas disponibles para el usuario. */
export default function InicioPage() {
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [username, setUsername] = useState("");
  const [tarjetas, setTarjetas] = useState<TarjetaModulo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) { navigate("/acceso", { replace: true }); return; }

      // Ficha maestra (mejor esfuerzo) + accesos por módulo
      let esSuperadmin = false;
      try {
        const { data: u } = await supabase.from("app_usuarios")
          .select("username, nombre, es_superadmin").eq("id", user.id).maybeSingle();
        if (u) {
          if (activo) { setNombre(u.nombre); setUsername(u.username); }
          esSuperadmin = Boolean(u.es_superadmin);
        }
      } catch { /* tabla sin migrar: seguimos con fallbacks */ }

      const accesos = new Map<string, { rol: string; pantallas: string[] | null }>();
      try {
        const { data: rows } = await supabase.from("app_usuario_modulos")
          .select("modulo, rol, pantallas").eq("user_id", user.id);
        for (const r of rows ?? []) accesos.set(r.modulo, { rol: r.rol, pantallas: r.pantallas });
      } catch { /* sin filas: fallbacks */ }

      // Fallback para usuarios aún no unificados: perfiles propios de módulo
      if (accesos.size === 0 && !esSuperadmin) {
        try {
          const { data: a } = await supabase.from("adm_usuarios").select("rol, nombre").eq("id", user.id).maybeSingle();
          if (a) {
            accesos.set("administracion", { rol: a.rol as string, pantallas: null });
            if (activo && !nombre) setNombre(a.nombre as string);
          }
        } catch { /* opcional */ }
        try {
          const { data: t } = await supabase.from("tc_usuarios").select("rol, es_superadmin").eq("id", user.id).maybeSingle();
          if (t) {
            accesos.set("tyrecontrol", { rol: t.rol as string, pantallas: null });
            esSuperadmin = esSuperadmin || Boolean(t.es_superadmin);
          }
        } catch { /* opcional */ }
      }

      const lista: TarjetaModulo[] = [];
      for (const m of MODULOS_APP) {
        const acc = accesos.get(m.key);
        if (!acc && !esSuperadmin) continue;
        const rolLabel = acc
          ? (m.roles.find((r) => r.value === acc.rol)?.label ?? acc.rol)
          : "Superadmin";
        const permitidas = acc?.pantallas
          ? m.pantallas.filter((p) => acc.pantallas!.includes(p.key))
          : m.pantallas;
        lista.push({ modulo: m, rolLabel, pantallas: permitidas });
      }
      if (activo) { setTarjetas(lista); setCargando(false); }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  async function salir() {
    await supabase.auth.signOut();
    navigate("/acceso", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-700 bg-slate-900/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-sky-400" />
          <span className="text-sm font-black">SEA Tarragona</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-[12px] font-semibold leading-tight">👤 {username || nombre || "Usuario"}</div>
            {nombre && username && <div className="text-[10px] text-slate-400">{nombre}</div>}
          </div>
          <button onClick={salir} className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-700">
            <LogOut className="h-4 w-4" /> Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <h1 className="text-lg font-black">Hola{nombre ? `, ${nombre.split(" ")[0]}` : ""}</h1>
        <p className="mb-4 text-sm text-slate-400">Estos son tus módulos. Entra a uno o salta directo a una pantalla.</p>

        {cargando ? (
          <div className="p-6 text-center text-sm text-slate-500">Cargando…</div>
        ) : tarjetas.length === 0 && !MOSTRAR_PANEL_TALLER ? (
          <div className="max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-300">
            Tu usuario no tiene módulos asignados. Contacta con un administrador.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tarjetas.map((t) => {
              const Icon = ICONOS[t.modulo.key] ?? Wallet;
              const color = COLORES[t.modulo.key] ?? COLORES.administracion;
              const visibles = t.pantallas.slice(0, 6);
              const resto = t.pantallas.length - visibles.length;
              return (
                <div key={t.modulo.key} className="flex flex-col rounded-2xl border border-slate-700 bg-slate-800 p-4 transition hover:border-slate-500">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color.bg}`}>
                        <Icon className={`h-5 w-5 ${color.text}`} />
                      </div>
                      <span className="text-sm font-bold">{t.modulo.label}</span>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-300">{t.rolLabel}</span>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1">
                    {visibles.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => navigate(rutaPantalla(t.modulo.key, p.key))}
                        className="rounded-full border border-slate-600 bg-slate-900 px-2.5 py-0.5 text-[11px] text-slate-300 hover:border-sky-500 hover:text-sky-300"
                      >
                        {p.label}
                      </button>
                    ))}
                    {resto > 0 && <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-500">+{resto} más</span>}
                  </div>

                  <button
                    onClick={() => navigate(rutaModulo(t.modulo.key))}
                    className="mt-auto rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                  >
                    Entrar
                  </button>
                </div>
              );
            })}

            {MOSTRAR_PANEL_TALLER && (
              <div className="flex flex-col rounded-2xl border border-slate-700 bg-slate-800 p-4 transition hover:border-slate-500">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
                    <Wrench className="h-5 w-5 text-amber-400" />
                  </div>
                  <span className="text-sm font-bold">Panel de taller</span>
                </div>
                <p className="mb-3 text-[12px] text-slate-500">
                  Planificación operativa del taller: técnicos, trabajos, entradas rápidas y agenda.
                </p>
                <button
                  onClick={() => navigate("/")}
                  className="mt-auto rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
                >
                  Entrar
                </button>
              </div>
            )}
          </div>
        )}

        {!cargando && tarjetas.length === 0 && MOSTRAR_PANEL_TALLER && (
          <div className="mt-4 max-w-md rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
            Tu usuario no tiene módulos asignados. Contacta con un administrador.
          </div>
        )}
      </main>
    </div>
  );
}
