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

  const field = "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm";

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-black">Mi perfil</h1>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div><div className="text-xs text-slate-400">Nombre</div><div className={field}>{perfil?.nombre}</div></div>
        <div><div className="text-xs text-slate-400">Email</div><div className={field}>{perfil?.email}</div></div>
        <div><div className="text-xs text-slate-400">Rol</div><div className={field}>{perfil?.es_superadmin ? "Super-admin" : perfil ? ROL_LABELS[perfil.rol] : ""}</div></div>
        <div><div className="text-xs text-slate-400">Empresa</div><div className={field}>{perfil?.empresa?.nombre ?? "—"}</div></div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-bold">Cambiar contraseña</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={cambiarPassword} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Guardando…" : "Actualizar"}
          </button>
        </div>
        {msg && <div className={`mt-2 text-sm ${msg.startsWith("✔") ? "text-emerald-600" : "text-red-600"}`}>{msg}</div>}
      </div>
    </div>
  );
}
