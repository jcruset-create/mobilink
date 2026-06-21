import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../modules/almacen-neumaticos/services/supabase";

const SESSION_KEY = "sea-portal-session";

export function getPortalSession(): { id: string; nombre: string; codigo: string } | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}

export function clearPortalSession() { localStorage.removeItem(SESSION_KEY); }

export default function PortalLogin() {
  const navigate = useNavigate();
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string; apellidos: string | null }[]>([]);
  const [empleadoId, setEmpleadoId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (getPortalSession()) { navigate("/portal/mi-ficha"); return; }
    supabase.from("sea_employees")
      .select("id, nombre, apellidos")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => {
        setEmpleados(data ?? []);
        if (data?.length) setEmpleadoId(data[0].id);
        setCargando(false);
      });
  }, [navigate]);

  async function handleLogin() {
    setError("");
    if (!empleadoId || !codigo.trim()) { setError("Selecciona tu nombre e introduce el código."); return; }
    setEnviando(true);
    const { data } = await supabase
      .from("sea_employees")
      .select("id, nombre, apellidos, codigo_operario")
      .eq("id", empleadoId)
      .eq("activo", true)
      .single();
    setEnviando(false);
    if (!data || data.codigo_operario !== codigo.trim()) {
      setError("Código incorrecto. Consulta con tu responsable.");
      return;
    }
    const sesion = { id: data.id, nombre: [data.nombre, data.apellidos].filter(Boolean).join(" "), codigo: codigo.trim() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
    navigate("/portal/mi-ficha");
  }

  if (cargando) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 text-sm">Cargando...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-1">
          <div className="h-14 w-14 rounded-2xl bg-gray-800 flex items-center justify-center text-white font-black text-xl mx-auto">S</div>
          <h1 className="text-xl font-black text-gray-900">Portal del empleado</h1>
          <p className="text-sm text-gray-500">Accede a tu ficha personal</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tu nombre</label>
            <select
              value={empleadoId}
              onChange={(e) => setEmpleadoId(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-gray-300"
            >
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {[e.nombre, e.apellidos].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Código personal (4 dígitos)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => { if (e.key === "Enter") void handleLogin(); }}
              placeholder="••••"
              className="mt-1 w-full rounded-xl border px-3 py-3 text-center text-2xl font-bold tracking-[1rem] outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <button
            onClick={handleLogin}
            disabled={enviando || codigo.length !== 4}
            className="w-full rounded-xl bg-gray-800 py-3 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-40 transition-colors"
          >
            {enviando ? "Verificando..." : "Entrar"}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          ¿No tienes código? Consulta con tu responsable o RRHH.
        </p>
      </div>
    </div>
  );
}
