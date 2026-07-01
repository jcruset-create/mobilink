import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck } from "lucide-react";
import { supabase } from "../services/supabase";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function Login() {
  const { user, loading } = useTyreAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/tyrecontrol/dashboard", { replace: true });
  }, [user, loading, navigate]);

  async function entrar() {
    setCargando(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setCargando(false);
    if (err) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    navigate("/tyrecontrol/dashboard", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <Truck className="h-6 w-6 text-slate-800" />
          <div>
            <h1 className="text-lg font-black leading-tight">SEA TyreControl</h1>
            <p className="text-xs text-slate-400">Acceso al panel</p>
          </div>
        </div>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
          placeholder="Email"
          autoComplete="username"
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
          placeholder="Contraseña"
          autoComplete="current-password"
          className="mb-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />

        {error && <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <button
          onClick={entrar}
          disabled={cargando || !email || !password}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}
