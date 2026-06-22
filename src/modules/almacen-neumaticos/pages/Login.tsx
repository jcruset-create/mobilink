import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../services/supabase";

export default function Login() {
  const [email, setEmail] = useState("jcruset@gmail.com");
  const [enviado, setEnviado] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Detectar si Supabase redirigió aquí con error en el hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("error_code=otp_expired") || hash.includes("error=access_denied")) {
      setError("El enlace ha caducado. Solicita uno nuevo.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Si ya hay sesión activa, redirigir directo
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) navigate("/almacen-neumaticos", { replace: true });
    });
  }, [navigate]);

  async function enviarMagicLink() {
    setCargando(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + "/almacen-neumaticos" },
    });
    setCargando(false);
    if (err) { setError(err.message); return; }
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="text-4xl mb-4">📧</div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Revisa tu email</h2>
          <p className="text-sm text-gray-500">
            Hemos enviado un enlace de acceso a <strong>{email}</strong>.<br />
            Haz clic en el enlace para entrar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="text-xl font-black text-gray-900 mb-1">Almacén Neumáticos</h1>
        <p className="text-sm text-gray-400 mb-6">Acceso con enlace mágico</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={enviarMagicLink}
            disabled={cargando || !email.trim()}
            className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {cargando ? "Enviando..." : "Enviar enlace de acceso"}
          </button>
        </div>
      </div>
    </div>
  );
}
