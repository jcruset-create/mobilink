import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../modules/administracion/services/supabase";
import { claveInterna } from "../modules/administracion/services/authClave";

/** Login unificado por usuario y contraseña para toda la aplicación. */
export default function AccesoPage() {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  // Si ya hay sesión, entrar directo al hub
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) navigate("/inicio", { replace: true });
    });
  }, [navigate]);

  async function entrar() {
    if (!usuario.trim() || !clave) return;
    setCargando(true);
    setError("");
    try {
      const { data: email, error: e1 } = await supabase.rpc("app_login_email", { p_username: usuario.trim() });
      if (e1 || !email) throw new Error("Usuario o contraseña incorrectos");

      const { error: e2 } = await supabase.auth.signInWithPassword({
        email: email as string,
        password: claveInterna(clave),
      });
      if (e2) throw new Error("Usuario o contraseña incorrectos");

      navigate("/inicio", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Usuario o contraseña incorrectos");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8">
        <div className="mb-6 flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-sky-400" />
          <div>
            <h1 className="text-lg font-black leading-tight">Mobilink</h1>
            <p className="text-xs text-slate-400">Acceso a la aplicación</p>
          </div>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-400">Usuario</label>
        <input
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
          placeholder="Jordi"
          autoComplete="username"
          autoFocus
          className="mb-3 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500"
        />

        <label className="mb-1 block text-[11px] font-semibold uppercase text-slate-400">Contraseña</label>
        <input
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
          placeholder="••••"
          autoComplete="current-password"
          className="mb-3 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500"
        />

        {error && <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        <button
          onClick={entrar}
          disabled={cargando || !usuario.trim() || !clave}
          className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>

        <p className="mt-4 text-center text-[11px] text-slate-500">
          ¿Contraseña olvidada? Pídesela a un administrador.
        </p>
      </div>
    </div>
  );
}
