import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Plus } from "lucide-react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Maquina = {
  id: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  estado: string;
  activa: boolean;
  foto_url: string | null;
  tc_categories: { nombre: string } | null;
  tc_locations: { nombre: string } | null;
};

const ESTADOS = ["disponible","en_uso","mantenimiento","fuera_servicio","pendiente_revision"];
const ESTADO_BADGE: Record<string, string> = {
  disponible:        "bg-emerald-500/15 text-emerald-300",
  en_uso:            "bg-blue-500/15 text-blue-300",
  mantenimiento:     "bg-orange-500/15 text-orange-300",
  fuera_servicio:    "bg-slate-500/15 text-slate-300",
  pendiente_revision:"bg-purple-500/15 text-purple-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `mt-1 w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

type FotoItem = { id?: string; url: string; file?: File };

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
  const [fotos, setFotos] = useState<FotoItem[]>([]);
  const [fotosIniciales, setFotosIniciales] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: m }, { data: cats }, { data: ubics }] = await Promise.all([
      supabase.from("tc_machines").select("id, codigo, nombre, marca, modelo, estado, activa, foto_url, category_id, ubicacion_id, numero_serie, descripcion, tc_categories(nombre), tc_locations!tc_machines_ubicacion_id_fkey(nombre)").eq("activa", true).order("nombre"),
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
        numero_serie: (m as any).numero_serie ?? "", descripcion: (m as any).descripcion ?? "",
        foto_url: m.foto_url });
      setEditId(m.id);
      setFotos([]);
      setFotosIniciales([]);
      cargarFotos(m.id, m.foto_url);
    } else {
      setForm({ ...EMPTY });
      setEditId(null);
      setFotos([]);
      setFotosIniciales([]);
    }
    setError("");
    setModal(true);
  }

  async function cargarFotos(machineId: string, fotoUrl: string | null) {
    const { data } = await supabase
      .from("tc_item_photos")
      .select("id, url, orden")
      .eq("machine_id", machineId)
      .order("orden");
    let lista: FotoItem[] = (data ?? []).map((f) => ({ id: f.id, url: f.url }));
    // Migración perezosa: la foto antigua (foto_url) que aún no esté en la tabla
    if (fotoUrl && !lista.some((f) => f.url === fotoUrl)) {
      lista = [{ url: fotoUrl }, ...lista];
    }
    setFotos(lista);
    setFotosIniciales((data ?? []).map((f) => f.id));
  }

  function anadirFotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const nuevas: FotoItem[] = Array.from(files).map((f) => ({
      url: URL.createObjectURL(f),
      file: f,
    }));
    setFotos((prev) => [...prev, ...nuevas]);
  }

  function quitarFoto(idx: number) {
    setFotos((prev) => {
      const f = prev[idx];
      if (f?.file) URL.revokeObjectURL(f.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function guardar() {
    if (!form.codigo?.trim() || !form.nombre?.trim()) { setError("Código y nombre obligatorios."); return; }
    setGuardando(true);
    // Subir las fotos nuevas al bucket
    const finales: { id?: string; url: string }[] = [];
    for (const f of fotos) {
      if (f.file) {
        const ext = f.file.name.split(".").pop()?.toLowerCase() || "jpg";
        const ruta = `maquinas/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("toolcontrol-fotos")
          .upload(ruta, f.file, { upsert: true });
        if (upErr) {
          setGuardando(false);
          setError(`Error subiendo la foto: ${upErr.message}`);
          return;
        }
        finales.push({ url: supabase.storage.from("toolcontrol-fotos").getPublicUrl(ruta).data.publicUrl });
      } else {
        finales.push({ id: f.id, url: f.url });
      }
    }
    const fotoUrl: string | null = finales[0]?.url ?? null;
    const payload = { codigo: form.codigo.trim(), nombre: form.nombre.trim(), marca: form.marca || null, modelo: form.modelo || null,
      estado: form.estado, category_id: form.category_id || null, ubicacion_id: form.ubicacion_id || null,
      numero_serie: form.numero_serie || null, descripcion: form.descripcion || null, foto_url: fotoUrl };
    let machineId = editId;
    let err;
    if (editId) {
      ({ error: err } = await supabase.from("tc_machines").update(payload).eq("id", editId));
    } else {
      const { data: creada, error: insErr } = await supabase
        .from("tc_machines").insert(payload).select("id").single();
      err = insErr;
      machineId = creada?.id ?? null;
    }
    if (err || !machineId) { setGuardando(false); setError(err?.message ?? "Error guardando."); return; }

    // Sincronizar galería en tc_item_photos
    const idsActuales = finales.filter((f) => f.id).map((f) => f.id as string);
    const aBorrar = fotosIniciales.filter((fid) => !idsActuales.includes(fid));
    if (aBorrar.length) await supabase.from("tc_item_photos").delete().in("id", aBorrar);
    for (let i = 0; i < finales.length; i++) {
      const f = finales[i];
      if (f.id) {
        await supabase.from("tc_item_photos").update({ orden: i }).eq("id", f.id);
      } else {
        await supabase.from("tc_item_photos").insert({ machine_id: machineId, url: f.url, orden: i });
      }
    }
    setGuardando(false);
    setMensaje(editId ? "Máquina actualizada." : "Máquina creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  const filtradas = items.filter((m) => !filtroEstado || m.estado === filtroEstado);

  return (
    <ToolControlLayout
      title="Máquinas"
      subtitle={`${filtradas.length} máquinas`}
      actions={
        <button onClick={() => abrir()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva máquina</span>
        </button>
      }
    >
      {mensaje && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      <div className="flex gap-2">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className={FIELD}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr><th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3">Marca / Modelo</th><th className="p-3">Categoría</th><th className="p-3">Ubicación</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr>
            </thead>
            <tbody>
              {filtradas.map((m) => (
                <tr key={m.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                  <td className="p-3 font-mono font-semibold text-slate-200">{m.codigo}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {m.foto_url && (
                        <img src={m.foto_url} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-slate-700 object-cover" />
                      )}
                      <span className="font-medium text-slate-100">{m.nombre}</span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-400">{[m.marca, m.modelo].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="p-3 text-slate-400">{(m.tc_categories as any)?.nombre ?? "—"}</td>
                  <td className="p-3 text-slate-400">{(m.tc_locations as any)?.nombre ?? "—"}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[m.estado] ?? "bg-slate-500/15 text-slate-300"}`}>{m.estado.replace(/_/g, " ")}</span></td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => setQrItem({ id: m.id, codigo: m.codigo, nombre: m.nombre })}
                        className="rounded-lg border border-blue-500/30 bg-blue-500/15 px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/25">QR</button>
                      <button onClick={() => abrir(m)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin máquinas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4 text-slate-100">{editId ? "Editar máquina" : "Nueva máquina"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Código *</label>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} className={INPUT} /></div>
                <div><label className={LABEL}>Estado</label>
                  <select value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} className={INPUT}>
                    {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}
                  </select></div>
              </div>
              <div><label className={LABEL}>Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className={INPUT} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Marca</label>
                  <input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} className={INPUT} /></div>
                <div><label className={LABEL}>Modelo</label>
                  <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} className={INPUT} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Categoría</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className={INPUT}>
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></div>
                <div><label className={LABEL}>Ubicación</label>
                  <select value={form.ubicacion_id} onChange={(e) => setForm({ ...form, ubicacion_id: e.target.value })} className={INPUT}>
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select></div>
              </div>
              <div><label className={LABEL}>Nº serie</label>
                <input value={form.numero_serie} onChange={(e) => setForm({ ...form, numero_serie: e.target.value })} className={INPUT} /></div>
              <div><label className={LABEL}>Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className={INPUT} rows={2} /></div>
              <div>
                <label className={LABEL}>Fotos</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {fotos.map((f, i) => (
                    <div key={f.id ?? f.url} className="relative h-20 w-20">
                      <img
                        src={f.url}
                        alt=""
                        className="h-20 w-20 rounded-lg border border-slate-700 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => quitarFoto(i)}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/80 text-xs font-bold text-white hover:bg-red-500"
                      >
                        ×
                      </button>
                      {i === 0 && (
                        <span className="absolute bottom-1 left-1 rounded bg-amber-500 px-1 text-[10px] font-bold text-amber-950">
                          Principal
                        </span>
                      )}
                    </div>
                  ))}
                  <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500 hover:border-amber-500 hover:text-amber-400">
                    + Añadir
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { anadirFotos(e.target.files); e.target.value = ""; }}
                    />
                  </label>
                </div>
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">Cancelar</button>
              <button onClick={guardar} disabled={guardando} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal QR */}
      {qrItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl space-y-4">
            <div className="text-center">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Máquina · {qrItem.codigo}</div>
              <div className="font-bold text-slate-100">{qrItem.nombre}</div>
            </div>

            <div ref={qrRef} className="flex justify-center p-4 bg-white rounded-xl">
              <QRCode
                value={`${window.location.origin}/qr/maquina/${qrItem.id}`}
                size={180}
                level="M"
              />
            </div>

            <p className="text-xs text-center text-slate-500 break-all">
              {window.location.origin}/qr/maquina/{qrItem.id}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setQrItem(null)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
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
                className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400"
              >
                Imprimir etiqueta
              </button>
            </div>
          </div>
        </div>
      )}
    </ToolControlLayout>
  );
}
