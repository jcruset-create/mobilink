import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logoMobilink from "../assets/logo-mobilink.png";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-6 text-slate-100">
      {/*
        Fondo de marca: dos halos azules muy difusos sobre el oscuro.
        Son decorativos (aria-hidden) y no capturan el ratón
        (pointer-events-none); el contenido va por encima con z-10.
        No llevan z negativo a propósito: con -z-10 quedaban DETRÁS del fondo
        de este mismo contenedor, que los tapaba por completo.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-sky-500/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-32 h-[30rem] w-[30rem] rounded-full bg-blue-600/25 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/40 backdrop-blur sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src={logoMobilink}
              alt="Mobilink"
              className="h-20 w-auto drop-shadow-[0_4px_12px_rgba(56,189,248,0.25)] sm:h-24"
            />
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-400/90 sm:text-[11px]">
              Conectando vehículos, talleres y personas
            </p>
          </div>

          <label
            htmlFor="acceso-usuario"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Usuario
          </label>
          <input
            id="acceso-usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
          />

          <label
            htmlFor="acceso-clave"
            className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Contraseña
          </label>
          <input
            id="acceso-clave"
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            placeholder="••••"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
          />

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </div>
          )}

          <button
            onClick={entrar}
            disabled={cargando || !usuario.trim() || !clave}
            className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition hover:from-sky-400 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            {cargando ? "Entrando…" : "Entrar"}
          </button>

          <p className="mt-5 text-center text-[11px] text-slate-500">
            ¿Contraseña olvidada? Pídesela a un administrador.
          </p>
        </div>

        <p className="mt-6 text-center text-[11px] tracking-wide text-slate-600">
          mobilink-solutions.com
        </p>
      </div>
    </div>
  );
}
