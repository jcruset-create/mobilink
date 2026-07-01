import { useEffect, useState } from "react";
import { listarEmpresas, crearEmpresa, actualizarEmpresa } from "../services/data";
import type { Empresa } from "../types";

export default function Empresas() {
  const [items, setItems] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ nombre: "", cif: "", telefono: "", email: "" });

  async function cargar() {
    setLoading(true);
    try { setItems(await listarEmpresas()); }
    catch (e: any) { setMsg(e?.message || "Error cargando empresas"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  async function crear() {
    if (!form.nombre.trim()) { setMsg("El nombre es obligatorio"); return; }
    try {
      await crearEmpresa(form);
      setForm({ nombre: "", cif: "", telefono: "", email: "" });
      setMsg("✔ Empresa creada");
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error creando empresa"); }
  }

  const inp = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500";

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Empresas</h1>
      <p className="mb-3 text-sm text-slate-400">Gestión de empresas (tenants) de la plataforma.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[10px] font-bold uppercase text-slate-400">Nueva empresa</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={inp} placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <input className={inp} placeholder="CIF" value={form.cif} onChange={(e) => setForm({ ...form, cif: e.target.value })} />
          <input className={inp} placeholder="Teléfono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          <input className={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <button onClick={crear} className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">Crear empresa</button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-[11px] uppercase text-slate-400">
            <tr><th className="px-4 py-2">Nombre</th><th className="px-4 py-2">CIF</th><th className="px-4 py-2">Contacto</th><th className="px-4 py-2">Activa</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={4}>Cargando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-4 text-slate-500" colSpan={4}>Sin empresas.</td></tr>
            ) : items.map((e) => (
              <tr key={e.id} className="border-t border-slate-700/60">
                <td className="px-4 py-2 font-semibold">{e.nombre}</td>
                <td className="px-4 py-2 text-slate-400">{e.cif ?? "—"}</td>
                <td className="px-4 py-2 text-slate-400">{e.telefono ?? "—"} {e.email ? `· ${e.email}` : ""}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={async () => { await actualizarEmpresa(e.id, { activo: !e.activo }); await cargar(); }}
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${e.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}`}
                  >
                    {e.activo ? "Activa" : "Inactiva"}
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
