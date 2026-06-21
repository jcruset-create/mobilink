import { useEffect, useState } from "react";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Centro = {
  id: string; nombre: string; codigo: string | null; direccion: string | null;
  ciudad: string | null; telefono: string | null; email: string | null;
  activo: boolean; company_id: string | null;
  sea_companies: { nombre: string } | null;
};

const EMPTY = { nombre: "", codigo: "", direccion: "", ciudad: "", telefono: "", email: "", activo: true, company_id: "" };

export default function CentrosTrabajo() {
  const [items, setItems] = useState<Centro[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data }, { data: emp }] = await Promise.all([
      supabase.from("sea_work_centers").select("*, sea_companies(nombre)").order("nombre"),
      supabase.from("sea_companies").select("id, nombre").eq("activa", true).order("nombre"),
    ]);
    setItems((data ?? []) as any);
    setEmpresas(emp ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((c) => {
    const t = filtro.toLowerCase();
    return !t || [c.nombre, c.codigo, c.ciudad, (c.sea_companies as any)?.nombre].join(" ").toLowerCase().includes(t);
  });

  function abrirNuevo() { setForm({ ...EMPTY }); setEditId(null); setError(""); setModal(true); }
  function abrirEditar(c: Centro) {
    setForm({ nombre: c.nombre, codigo: c.codigo ?? "", direccion: c.direccion ?? "",
      ciudad: c.ciudad ?? "", telefono: c.telefono ?? "", email: c.email ?? "",
      activo: c.activo, company_id: (c as any).company_id ?? "" });
    setEditId(c.id); setError(""); setModal(true);
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(), codigo: form.codigo || null, direccion: form.direccion || null,
      ciudad: form.ciudad || null, telefono: form.telefono || null, email: form.email || null,
      activo: form.activo, company_id: form.company_id || null,
    };
    const { error: err } = editId
      ? await supabase.from("sea_work_centers").update(payload).eq("id", editId)
      : await supabase.from("sea_work_centers").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Centro actualizado." : "Centro creado.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <CoreMenu />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Centros de trabajo</h1>
          <p className="text-sm text-gray-500">{filtrados.length} centros</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nuevo centro
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por nombre, código, ciudad..." className="rounded-lg border px-3 py-2 text-sm w-72" />

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[550px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Centro</th>
                <th className="p-3">Código</th>
                <th className="p-3">Empresa</th>
                <th className="p-3">Ciudad</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-medium">{c.nombre}</td>
                  <td className="p-3 font-mono text-xs text-gray-500">{c.codigo ?? "—"}</td>
                  <td className="p-3 text-gray-500">{(c.sea_companies as any)?.nombre ?? "—"}</td>
                  <td className="p-3 text-gray-500">{c.ciudad ?? "—"}</td>
                  <td className="p-3 text-gray-500">
                    <div>{c.email ?? "—"}</div>
                    <div className="text-xs">{c.telefono ?? ""}</div>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.activo ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                      {c.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="p-3">
                    <button onClick={() => abrirEditar(c)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin centros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar centro" : "Nuevo centro de trabajo"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Código interno</label>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="CT-001" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Empresa</label>
                <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="">Sin empresa</option>
                  {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Dirección</label>
                <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Ciudad</label>
                  <input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                Centro activo
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
