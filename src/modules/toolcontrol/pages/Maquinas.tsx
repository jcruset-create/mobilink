import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import ToolControlMenu from "../components/ToolControlMenu";
import { supabase } from "../services/supabase";

type Maquina = {
  id: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  estado: string;
  activa: boolean;
  tc_categories: { nombre: string } | null;
  tc_locations: { nombre: string } | null;
};

const ESTADOS = ["disponible","en_uso","mantenimiento","fuera_servicio","pendiente_revision"];
const ESTADO_BADGE: Record<string, string> = {
  disponible:        "bg-green-100 text-green-800",
  en_uso:            "bg-blue-100 text-blue-800",
  mantenimiento:     "bg-orange-100 text-orange-800",
  fuera_servicio:    "bg-gray-200 text-gray-600",
  pendiente_revision:"bg-purple-100 text-purple-800",
};

const EMPTY = { codigo: "", nombre: "", marca: "", modelo: "", estado: "disponible", category_id: "", ubicacion_id: "", numero_serie: "", descripcion: "" };

export default function Maquinas() {
  const [items, setItems] = useState<Maquina[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [ubicaciones, setUbicaciones] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [qrItem, setQrItem] = useState<{ id: string; codigo: string; nombre: string } | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: m }, { data: cats }, { data: ubics }] = await Promise.all([
      supabase.from("tc_machines").select("id, codigo, nombre, marca, modelo, estado, activa, tc_categories(nombre), tc_locations!tc_machines_ubicacion_id_fkey(nombre)").eq("activa", true).order("nombre"),
      supabase.from("tc_categories").select("id, nombre").eq("activa", true).order("nombre"),
      supabase.from("tc_locations").select("id, nombre").eq("activa", true).order("nombre"),
    ]);
    setItems((m ?? []) as any);
    setCategorias(cats ?? []);
    setUbicaciones(ubics ?? []);
    setCargando(false);
  }

  function abrir(m?: Maquina) {
    if (m) {
      setForm({ codigo: (m as any).codigo, nombre: m.nombre, marca: m.marca ?? "", modelo: m.modelo ?? "", estado: m.estado,
        category_id: (m as any).category_id ?? "", ubicacion_id: (m as any).ubicacion_id ?? "",
        numero_serie: (m as any).numero_serie ?? "", descripcion: (m as any).descripcion ?? "" });
      setEditId(m.id);
    } else {
      setForm({ ...EMPTY });
      setEditId(null);
    }
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.codigo?.trim() || !form.nombre?.trim()) { setError("Código y nombre obligatorios."); return; }
    setGuardando(true);
    const payload = { codigo: form.codigo.trim(), nombre: form.nombre.trim(), marca: form.marca || null, modelo: form.modelo || null,
      estado: form.estado, category_id: form.category_id || null, ubicacion_id: form.ubicacion_id || null,
      numero_serie: form.numero_serie || null, descripcion: form.descripcion || null };
    const { error: err } = editId
      ? await supabase.from("tc_machines").update(payload).eq("id", editId)
      : await supabase.from("tc_machines").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "Máquina actualizada." : "Máquina creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  const filtradas = items.filter((m) => !filtroEstado || m.estado === filtroEstado);

  return (
    <div className="p-6 space-y-4">
      <ToolControlMenu />
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Máquinas</h1><p className="text-sm text-gray-500">{filtradas.length} máquinas</p></div>
        <button onClick={() => abrir()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">+ Nueva máquina</button>
      </div>
      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      <div className="flex gap-2">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-gray-50 text-left">
              <tr><th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3">Marca / Modelo</th><th className="p-3">Categoría</th><th className="p-3">Ubicación</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr>
            </thead>
            <tbody>
              {filtradas.map((m) => (
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 font-mono font-semibold">{m.codigo}</td>
                  <td className="p-3 font-medium">{m.nombre}</td>
                  <td className="p-3 text-gray-500">{[m.marca, m.modelo].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="p-3 text-gray-500">{(m.tc_categories as any)?.nombre ?? "—"}</td>
                  <td className="p-3 text-gray-500">{(m.tc_locations as any)?.nombre ?? "—"}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[m.estado] ?? "bg-gray-100 text-gray-600"}`}>{m.estado.replace(/_/g, " ")}</span></td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => setQrItem({ id: m.id, codigo: m.codigo, nombre: m.nombre })}
                        className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">QR</button>
                      <button onClick={() => abrir(m)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-400">Sin máquinas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar máquina" : "Nueva máquina"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Código *</label>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Estado</label>
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
                  </select></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Marca</label>
                  <input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Modelo</label>
                  <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Categoría</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></div>
                <div><label className="text-xs font-medium text-gray-600">Ubicación</label>
                  <select value={form.ubicacion_id} onChange={(e) => setForm({ ...form, ubicacion_id: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Nº serie</label>
                <input value={form.numero_serie} onChange={(e) => setForm({ ...form, numero_serie: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal QR */}
      {qrItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="text-center">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Máquina · {qrItem.codigo}</div>
              <div className="font-bold text-gray-800">{qrItem.nombre}</div>
            </div>

            <div ref={qrRef} className="flex justify-center p-4 bg-white border rounded-xl">
              <QRCode
                value={`${window.location.origin}/qr/maquina/${qrItem.id}`}
                size={180}
                level="M"
              />
            </div>

            <p className="text-xs text-center text-gray-400 break-all">
              {window.location.origin}/qr/maquina/{qrItem.id}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setQrItem(null)}
                className="flex-1 rounded-xl border px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  const w = window.open("", "_blank");
                  if (!w) return;
                  const url = `${window.location.origin}/qr/maquina/${qrItem.id}`;
                  w.document.write(`<!DOCTYPE html><html><head><title>QR ${qrItem.codigo}</title>
                    <style>body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
                    svg{width:200px;height:200px}h2{margin:12px 0 4px;font-size:16px}p{margin:0;font-size:11px;color:#6b7280}
                    @media print{@page{margin:10mm}}</style></head><body>
                    ${qrRef.current?.innerHTML ?? ""}
                    <h2>${qrItem.codigo} · ${qrItem.nombre}</h2>
                    <p>${url}</p>
                    <script>window.onload=()=>window.print()</script>
                    </body></html>`);
                  w.document.close();
                }}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Imprimir etiqueta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
