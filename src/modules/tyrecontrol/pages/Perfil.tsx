import { useState } from "react";
import { supabase } from "../services/supabase";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { ROL_LABELS } from "../types";

export default function Perfil() {
  const { perfil } = useTyreAuth();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  async function cambiarPassword() {
    if (password.length < 6) { setMsg("La contraseña debe tener al menos 6 caracteres."); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    setMsg(error ? error.message : "✔ Contraseña actualizada.");
    if (!error) setPassword("");
  }

  const box = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200";

  return (
    <div className="max-w-xl">
      <h1 className="mb-3 text-lg font-black">Mi perfil</h1>
      <div className="grid gap-2 rounded-lg bg-slate-800 p-4">
        <div><div className="text-[10px] text-slate-400">Nombre</div><div className={box}>{perfil?.nombre}</div></div>
        <div><div className="text-[10px] text-slate-400">Email</div><div className={box}>{perfil?.email}</div></div>
        <div><div className="text-[10px] text-slate-400">Rol</div><div className={box}>{perfil?.es_superadmin ? "Super-admin" : perfil ? ROL_LABELS[perfil.rol] : ""}</div></div>
        <div><div className="text-[10px] text-slate-400">Empresa</div><div className={box}>{perfil?.empresa?.nombre ?? "—"}</div></div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-4">
        <h2 className="mb-2 text-sm font-bold">Cambiar contraseña</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button onClick={cambiarPassword} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {saving ? "Guardando…" : "Actualizar"}
          </button>
        </div>
        {msg && <div className={`mt-2 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}
      </div>
    </div>
  );
}
