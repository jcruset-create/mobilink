import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function Login() {
  const { user, loading } = useTyreAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("error_code") || hash.includes("error=access_denied")) {
      setError("El enlace ha caducado o no es válido. Solicita uno nuevo.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) navigate("/tyrecontrol/dashboard", { replace: true });
  }, [user, loading, navigate]);

  async function enviarEnlace() {
    if (!email.trim()) return;
    setCargando(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin + "/tyrecontrol/dashboard" },
    });
    setCargando(false);
    if (err) { setError(err.message); return; }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center">
          <div className="mb-3 text-4xl">📧</div>
          <h2 className="mb-1 text-lg font-bold">Revisa tu email</h2>
          <p className="text-sm text-slate-400">
            Hemos enviado un enlace de acceso a <strong className="text-slate-200">{email}</strong>.<br />
            Haz clic en el enlace para entrar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/sea-tyrecontrol-logo.png" alt="SEA TyreControl" className="mb-3 h-20 w-auto" />
          <h1 className="text-lg font-black leading-tight">SEA TyreControl</h1>
          <p className="text-xs text-slate-400">Acceso con enlace por email</p>
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviarEnlace()}
          placeholder="tu@email.com"
          autoComplete="username"
          className="mb-3 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-sky-500"
        />

        {error && <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

        <button
          onClick={enviarEnlace}
          disabled={cargando || !email.trim()}
          className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {cargando ? "Enviando…" : "Enviar enlace de acceso"}
        </button>
      </div>
    </div>
  );
}
