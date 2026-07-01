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

  const inp = "rounded-xl border border-slate-200 px-3 py-2 text-sm";

  return (
    <div>
      <h1 className="mb-1 text-xl font-black">Empresas</h1>
      <p className="mb-4 text-sm text-slate-500">Gestión de empresas (tenants) de la plataforma.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-600" : "text-red-600"}`}>{msg}</div>}

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-sm font-bold">Nueva empresa</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={inp} placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <input className={inp} placeholder="CIF" value={form.cif} onChange={(e) => setForm({ ...form, cif: e.target.value })} />
          <input className={inp} placeholder="Teléfono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          <input className={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <button onClick={crear} className="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">Crear empresa</button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th className="px-4 py-2">Nombre</th><th className="px-4 py-2">CIF</th><th className="px-4 py-2">Contacto</th><th className="px-4 py-2">Activa</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-4 text-slate-400" colSpan={4}>Cargando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="px-4 py-4 text-slate-400" colSpan={4}>Sin empresas.</td></tr>
            ) : items.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-semibold">{e.nombre}</td>
                <td className="px-4 py-2 text-slate-500">{e.cif ?? "—"}</td>
                <td className="px-4 py-2 text-slate-500">{e.telefono ?? "—"} {e.email ? `· ${e.email}` : ""}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={async () => { await actualizarEmpresa(e.id, { activo: !e.activo }); await cargar(); }}
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${e.activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
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
