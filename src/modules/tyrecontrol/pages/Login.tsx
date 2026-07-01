import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck } from "lucide-react";
import { supabase } from "../services/supabase";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function Login() {
  const { user, loading } = useTyreAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  // Si Supabase redirige aquí con error en el hash (enlace caducado, etc.)
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">📧</div>
          <h2 className="mb-1 text-lg font-bold">Revisa tu email</h2>
          <p className="text-sm text-slate-500">
            Hemos enviado un enlace de acceso a <strong>{email}</strong>.<br />
            Haz clic en el enlace para entrar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <Truck className="h-6 w-6 text-slate-800" />
          <div>
            <h1 className="text-lg font-black leading-tight">SEA TyreControl</h1>
            <p className="text-xs text-slate-400">Acceso con enlace por email</p>
          </div>
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviarEnlace()}
          placeholder="tu@email.com"
          autoComplete="username"
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />

        {error && <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          onClick={enviarEnlace}
          disabled={cargando || !email.trim()}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {cargando ? "Enviando…" : "Enviar enlace de acceso"}
        </button>
      </div>
    </div>
  );
}
