import { useEffect, useState } from "react";
import CoreMenu from "../components/CoreMenu";
import { supabase } from "../../almacen-neumaticos/services/supabase";

type Empresa = {
  id: string; nombre: string; cif: string | null; sector: string | null;
  email: string | null; telefono: string | null; direccion: string | null;
  ciudad: string | null; activa: boolean;
};

const EMPTY = { nombre: "", cif: "", sector: "", email: "", telefono: "", direccion: "", ciudad: "", activa: true };

export default function Empresas() {
  const [items, setItems] = useState<Empresa[]>([]);
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
    const { data } = await supabase.from("sea_companies").select("*").order("nombre");
    setItems(data ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((e) => {
    const t = filtro.toLowerCase();
    return !t || [e.nombre, e.cif, e.sector, e.ciudad].join(" ").toLowerCase().includes(t);
  });

  function abrirNuevo() { setForm({ ...EMPTY }); setEditId(null); setError(""); setModal(true); }
  function abrirEditar(e: Empresa) {
    setForm({ nombre: e.nombre, cif: e.cif ?? "", sector: e.sector ?? "", email: e.email ?? "",
      telefono: e.telefono ?? "", direccion: e.direccion ?? "", ciudad: e.ciudad ?? "", activa: e.activa });
    setEditId(e.id); setError(""); setModal(true);
  }

  async function guardar() {
    if (!form.nombre?.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(), cif: form.cif || null, sector: form.sector || null,
      email: form.email || null, telefono: form.telefono || null,
      direccion: form.direccion || null, ciudad: form.ciudad || null, activa: form.activa,
    };
    const { error: err } = editId
      ? await supabase.from("sea_companies").update(payload).eq("id", editId)
      : await supabase.from("sea_companies").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Empresa actualizada." : "Empresa creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <div className="p-6 space-y-4">
      <CoreMenu />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-gray-500">{filtrados.length} empresas</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900">
          + Nueva empresa
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <input value={filtro} onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por nombre, CIF, sector, ciudad..." className="rounded-lg border px-3 py-2 text-sm w-72" />

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Empresa</th>
                <th className="p-3">CIF</th>
                <th className="p-3">Sector</th>
                <th className="p-3">Contacto</th>
                <th className="p-3">Ciudad</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-medium">{e.nombre}</td>
                  <td className="p-3 text-gray-500 font-mono text-xs">{e.cif ?? "—"}</td>
                  <td className="p-3 text-gray-500">{e.sector ?? "—"}</td>
                  <td className="p-3 text-gray-500">
                    <div>{e.email ?? "—"}</div>
                    <div className="text-xs">{e.telefono ?? ""}</div>
                  </td>
                  <td className="p-3 text-gray-500">{e.ciudad ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.activa ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                      {e.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="p-3">
                    <button onClick={() => abrirEditar(e)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin empresas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar empresa" : "Nueva empresa"}</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">CIF / NIF</label>
                  <input value={form.cif} onChange={(e) => setForm({ ...form, cif: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Sector</label>
                  <input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Industria, Logística..." /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Teléfono</label>
                  <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Dirección</label>
                <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-600">Ciudad</label>
                <input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
                Empresa activa
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
