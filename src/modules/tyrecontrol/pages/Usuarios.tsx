import { useEffect, useState } from "react";
import { listarUsuarios, crearUsuario, actualizarUsuario, listarEmpresas } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import { ROL_LABELS, type Empresa, type Perfil, type Rol } from "../types";

const EMPTY = { nombre: "", email: "", password: "", rol: "cliente" as Rol, acceso_apk: false, acceso_panel: true, empresa_id: "" };

export default function Usuarios() {
  const { perfil } = useTyreAuth();
  const esSuper = Boolean(perfil?.es_superadmin);
  const [items, setItems] = useState<Perfil[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ ...EMPTY });

  async function cargar() {
    setLoading(true);
    try {
      setItems(await listarUsuarios());
      if (esSuper) setEmpresas(await listarEmpresas());
    } catch (e: any) { setMsg(e?.message || "Error cargando usuarios"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, []);

  async function crear() {
    if (!form.nombre.trim() || !form.email.trim() || !form.password.trim()) { setMsg("Nombre, email y contraseña obligatorios"); return; }
    if (esSuper && !form.empresa_id) { setMsg("Selecciona una empresa"); return; }
    try {
      await crearUsuario({
        nombre: form.nombre, email: form.email, password: form.password,
        rol: form.rol, acceso_apk: form.acceso_apk, acceso_panel: form.acceso_panel,
        empresa_id: esSuper ? form.empresa_id : undefined,
      });
      setForm({ ...EMPTY });
      setMsg("✔ Usuario creado");
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error creando usuario"); }
  }

  const inp = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";
  const cols = esSuper ? 6 : 5;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Usuarios</h1>
      <p className="mb-3 text-sm text-slate-400">Gestión de usuarios y accesos {esSuper ? "(todas las empresas)" : "de tu empresa"}.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Alta */}
      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[10px] font-bold uppercase text-slate-400">Nuevo usuario</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={inp} placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <input className={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className={inp} type="password" placeholder="Contraseña" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className={inp} value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
            {(Object.keys(ROL_LABELS) as Rol[]).map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}
          </select>
          {esSuper && (
            <select className={inp} value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })}>
              <option value="">Empresa…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          )}
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.acceso_panel} onChange={(e) => setForm({ ...form, acceso_panel: e.target.checked })} /> Panel</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.acceso_apk} onChange={(e) => setForm({ ...form, acceso_apk: e.target.checked })} /> APK</label>
          </div>
        </div>
        <button onClick={crear} className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">Crear usuario</button>
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-[11px] uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Rol</th>{esSuper && <th className="px-4 py-2">Empresa</th>}
              <th className="px-4 py-2">Accesos</th><th className="px-4 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={cols}>Cargando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={cols}>Sin usuarios.</td></tr>
            ) : items.map((u) => (
              <tr key={u.id} className="border-t border-slate-700/60">
                <td className="px-4 py-2 font-semibold">{u.nombre}{u.es_superadmin ? " ⭐" : ""}</td>
                <td className="px-4 py-2 text-slate-400">{u.email}</td>
                <td className="px-4 py-2">{ROL_LABELS[u.rol]}</td>
                {esSuper && <td className="px-4 py-2 text-slate-400">{u.empresa?.nombre ?? "—"}</td>}
                <td className="px-4 py-2 text-[11px] text-slate-400">{u.acceso_panel ? "Panel " : ""}{u.acceso_apk ? "APK" : ""}</td>
                <td className="px-4 py-2">
                  <button
                    disabled={u.es_superadmin}
                    onClick={async () => { await actualizarUsuario(u.id, { activo: !u.activo }); await cargar(); }}
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${u.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"} disabled:opacity-40`}
                  >
                    {u.activo ? "Activo" : "Inactivo"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
