import { useState } from "react";
import { supabase } from "../services/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);

  async function iniciarSesion() {
    setMensaje("");

    if (!email.trim() || !password.trim()) {
      setMensaje("Email y contraseña son obligatorios.");
      return;
    }

    setCargando(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setCargando(false);

    if (error) {
      setMensaje(`Error iniciando sesión: ${error.message}`);
      return;
    }

    setMensaje("Sesión iniciada correctamente.");
    window.location.href = "/almacen-neumaticos";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Acceso almacén neumáticos</h1>
          <p className="text-sm text-gray-500">
            Inicia sesión con tu usuario autorizado.
          </p>
        </div>

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Contraseña"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              iniciarSesion();
            }
          }}
        />

        <button
          type="button"
          onClick={iniciarSesion}
          disabled={cargando}
          className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {cargando ? "Entrando..." : "Entrar"}
        </button>

        {mensaje && <p className="text-sm text-gray-700">{mensaje}</p>}
      </div>
    </div>
  );
}