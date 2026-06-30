import { useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { ALL_VIEWS, VIEW_LABELS, ROLE_LABELS, type AppView, type UserRole } from "../modules/permissions";

type ApiUser = {
  id: string;
  name: string;
  role: UserRole;
  allowedViews: string[];
  hasPassword?: boolean;
};

type Draft = {
  id: string | null;
  name: string;
  password: string;
  role: UserRole;
  allowedViews: string[];
};

const EMPTY_DRAFT: Draft = { id: null, name: "", password: "", role: "supervisor", allowedViews: [] };

export default function UsersScreen({ onBack }: { onBack: () => void }) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users`, { headers: getAdminHeaders() });
      if (!res.ok) throw new Error("No autorizado");
      setUsers(await res.json());
    } catch (e: any) {
      setMsg(e?.message || "Error cargando usuarios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function toggleView(v: AppView) {
    setDraft((d) => ({
      ...d,
      allowedViews: d.allowedViews.includes(v)
        ? d.allowedViews.filter((x) => x !== v)
        : [...d.allowedViews, v],
    }));
  }

  function editUser(u: ApiUser) {
    setDraft({ id: u.id, name: u.name, password: "", role: u.role, allowedViews: u.allowedViews ?? [] });
    setMsg("");
  }

  async function save() {
    if (!draft.name.trim()) { setMsg("El nombre es obligatorio"); return; }
    if (!draft.id && !draft.password.trim()) { setMsg("La contraseña es obligatoria"); return; }
    setLoading(true);
    try {
      const body = JSON.stringify({
        name: draft.name.trim(),
        password: draft.password.trim() || undefined,
        role: draft.role,
        allowedViews: draft.allowedViews,
      });
      const url = draft.id ? `${API_BASE}/api/users/${draft.id}` : `${API_BASE}/api/users`;
      const res = await fetch(url, {
        method: draft.id ? "PUT" : "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || "Error guardando");
      }
      setDraft(EMPTY_DRAFT);
      setMsg("✔ Guardado");
      await load();
      setTimeout(() => setMsg(""), 2500);
    } catch (e: any) {
      setMsg(e?.message || "Error guardando");
    } finally {
      setLoading(false);
    }
  }

  async function remove(u: ApiUser) {
    if (!window.confirm(`¿Eliminar el usuario "${u.name}"?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: "DELETE", headers: getAdminHeaders() });
      if (!res.ok) throw new Error("Error eliminando");
      if (draft.id === u.id) setDraft(EMPTY_DRAFT);
      await load();
    } catch (e: any) {
      setMsg(e?.message || "Error eliminando");
    } finally {
      setLoading(false);
    }
  }

  const input = "rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[12px] text-slate-100";

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-slate-900 p-3 text-slate-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">👤 Usuarios y accesos</span>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-orange-400"}`}>{msg}</span>}
          <button type="button" onClick={onBack} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200 hover:bg-slate-700">← Volver</button>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_1.4fr]">
        {/* Lista */}
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400">USUARIOS ({users.length})</span>
            <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">+ Nuevo</button>
          </div>
          {loading && users.length === 0 ? <div className="text-[11px] text-slate-500">Cargando…</div> : null}
          {!loading && users.length === 0 ? <div className="text-[11px] text-slate-500">Sin usuarios. Crea el primero.</div> : null}
          <div className="space-y-1">
            {users.map((u) => (
              <div key={u.id} className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-[11px] ${draft.id === u.id ? "bg-slate-700" : "bg-slate-900"}`}>
                <span>
                  <span className="font-bold">{u.name}</span>
                  <span className="text-slate-500"> · {ROLE_LABELS[u.role] ?? u.role} · {u.allowedViews?.length ?? 0} pantallas</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => editUser(u)} className="font-bold text-sky-300">Editar</button>
                  <button type="button" onClick={() => void remove(u)} className="font-bold text-rose-300">Eliminar</button>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Formulario */}
        <div className="rounded-lg bg-slate-800 p-2">
          <div className="mb-1.5 text-[10px] font-bold text-slate-400">{draft.id ? "EDITAR USUARIO" : "NUEVO USUARIO"}</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            <input className={input} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Nombre" />
            <input className={input} type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} placeholder={draft.id ? "Contraseña (dejar vacío = mantener)" : "Contraseña"} />
            <select className={input} value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as UserRole }))}>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400">PANTALLAS A LAS QUE PUEDE ACCEDER</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setDraft((d) => ({ ...d, allowedViews: [...ALL_VIEWS] }))} className="text-[10px] text-sky-300">Todas</button>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, allowedViews: [] }))} className="text-[10px] text-slate-400">Ninguna</button>
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {ALL_VIEWS.map((v) => {
              const checked = draft.allowedViews.includes(v);
              return (
                <label key={v} className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${checked ? "border-sky-400 bg-slate-700" : "border-slate-600 bg-slate-900"}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleView(v)} />
                  <span>{VIEW_LABELS[v]}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2">
            <button type="button" disabled={loading} onClick={() => void save()} className="rounded bg-emerald-600 px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-40">{draft.id ? "Guardar cambios" : "Crear usuario"}</button>
            {draft.id && <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} className="rounded border border-slate-600 px-4 py-1.5 text-[12px] text-slate-200">Cancelar</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
