import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../modules/administracion/services/supabase";
import { claveInterna } from "../modules/administracion/services/authClave";

/**
 * Traduce el error de Supabase Auth a algo accionable.
 *
 * Antes todo fallo (usuario inexistente, contraseña mala, proyecto sin cuota,
 * sin red, límite de intentos) mostraba el mismo texto, así que un problema de
 * servidor era indistinguible de una contraseña mal tecleada.
 */
function mensajeErrorAuth(error: { message?: string; status?: number }): string {
  const status = Number(error?.status ?? 0);
  const texto = String(error?.message ?? "").toLowerCase();

  if (status === 429 || texto.includes("rate limit") || texto.includes("too many")) {
    return "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.";
  }
  if (texto.includes("invalid login credentials")) {
    return "Contraseña incorrecta.";
  }
  if (texto.includes("email not confirmed")) {
    return "La cuenta está sin confirmar. Avisa al administrador.";
  }
  if (status >= 500 || texto.includes("failed to fetch") || texto.includes("network")) {
    return "El servidor no responde. Vuelve a intentarlo en un momento.";
  }
  return `No se ha podido iniciar sesión (${error?.message ?? "error desconocido"}).`;
}

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
      // 1) Usuario -> email interno. Un error AQUI no es una credencial mala:
      //    normalmente es el proyecto de Supabase sin cuota, caído o sin red.
      //    Distinguirlo importa: antes se mostraba como "contraseña incorrecta"
      //    y se perdían horas buscando el fallo donde no estaba.
      const { data: email, error: e1 } = await supabase.rpc("app_login_email", {
        p_username: usuario.trim(),
      });
      if (e1) {
        console.error("[acceso] app_login_email:", e1);
        throw new Error(
          "No se ha podido contactar con el servidor. Vuelve a intentarlo; si sigue igual, avisa al administrador."
        );
      }
      if (!email) {
        throw new Error("Ese usuario no existe o está dado de baja.");
      }

      // 2) Contraseña.
      const { error: e2 } = await supabase.auth.signInWithPassword({
        email: email as string,
        password: claveInterna(clave),
      });
      if (e2) {
        console.error("[acceso] signInWithPassword:", e2);
        throw new Error(mensajeErrorAuth(e2));
      }

      navigate("/inicio", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido iniciar sesión.");
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
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
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
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
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
