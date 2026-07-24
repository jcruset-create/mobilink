import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Plus } from "lucide-react";
import ToolControlLayout from "../components/ToolControlLayout";
import { supabase } from "../services/supabase";

type Herramienta = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  estado: string;
  es_compartida: boolean;
  foto_url: string | null;
  proxima_revision: string | null;
  observaciones: string | null;
  category_id: string | null;
  ubicacion_habitual_id: string | null;
  ubicacion_actual_id: string | null;
  activa: boolean;
  tc_categories: { nombre: string } | null;
  ubicacion_actual: { nombre: string } | null;
  ubicacion_habitual: { nombre: string } | null;
};

type Categoria = { id: string; nombre: string };
type Ubicacion = { id: string; nombre: string };

const ESTADOS = [
  "disponible", "en_uso", "compartida", "pendiente_devolucion",
  "danada", "mantenimiento", "perdida", "fuera_servicio",
  "pendiente_revision", "desactualizada",
];

const ESTADO_BADGE: Record<string, string> = {
  disponible:           "bg-emerald-500/15 text-emerald-300",
  en_uso:               "bg-blue-500/15 text-blue-300",
  compartida:           "bg-cyan-500/15 text-cyan-300",
  pendiente_devolucion: "bg-yellow-500/15 text-yellow-300",
  danada:               "bg-red-500/15 text-red-300",
  mantenimiento:        "bg-orange-500/15 text-orange-300",
  perdida:              "bg-slate-500/15 text-slate-300",
  fuera_servicio:       "bg-slate-500/15 text-slate-300",
  pendiente_revision:   "bg-purple-500/15 text-purple-300",
  desactualizada:       "bg-pink-500/15 text-pink-300",
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `mt-1 w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

const EMPTY: Partial<Herramienta> = {
  codigo: "", nombre: "", descripcion: "", marca: "", modelo: "",
  numero_serie: "", estado: "disponible", es_compartida: false,
  category_id: null, ubicacion_habitual_id: null, ubicacion_actual_id: null,
  observaciones: "", activa: true,
};

export default function Herramientas() {
  const [herramientas, setHerramientas] = useState<Herramienta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroCat, setFiltroCat] = useState("");

  const [modal, setModal] = useState(false);
  const [qrItem, setQrItem] = useState<{ id: string; codigo: string; nombre: string } | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: h }, { data: cats }, { data: ubics }] = await Promise.all([
      supabase
        .from("tc_tools")
        .select(`
          id, codigo, nombre, descripcion, marca, modelo, numero_serie,
          estado, es_compartida, foto_url, proxima_revision, observaciones,
          category_id, ubicacion_habitual_id, ubicacion_actual_id, activa,
          tc_categories ( nombre ),
          ubicacion_actual:tc_locations!tc_tools_ubicacion_actual_id_fkey ( nombre ),
          ubicacion_habitual:tc_locations!tc_tools_ubicacion_habitual_id_fkey ( nombre )
        `)
        .eq("activa", true)
        .order("nombre"),
      supabase.from("tc_categories").select("id, nombre").eq("activa", true).order("nombre"),
      supabase.from("tc_locations").select("id, nombre").eq("activa", true).order("nombre"),
    ]);

    setHerramientas((h ?? []) as any);
    setCategorias(cats ?? []);
    setUbicaciones(ubics ?? []);
    setCargando(false);
  }

  const filtradas = herramientas.filter((h) => {
    if (filtroEstado && h.estado !== filtroEstado) return false;
    if (filtroCat && h.category_id !== filtroCat) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      const campos = [h.nombre, h.codigo, h.marca, h.modelo, h.numero_serie].join(" ").toLowerCase();
      if (!campos.includes(t)) return false;
    }
    return true;
  });

  function abrirNueva() {
    setForm({ ...EMPTY });
    setEditId(null);
    setError("");
    setModal(true);
  }

  function abrirEditar(h: Herramienta) {
    setForm({
      codigo: h.codigo, nombre: h.nombre, descripcion: h.descripcion ?? "",
      marca: h.marca ?? "", modelo: h.modelo ?? "", numero_serie: h.numero_serie ?? "",
      estado: h.estado, es_compartida: h.es_compartida,
      category_id: h.category_id ?? "", ubicacion_habitual_id: h.ubicacion_habitual_id ?? "",
      ubicacion_actual_id: h.ubicacion_actual_id ?? "", observaciones: h.observaciones ?? "",
      activa: h.activa,
    });
    setEditId(h.id);
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.codigo?.trim() || !form.nombre?.trim()) {
      setError("Código y nombre son obligatorios.");
      return;
    }
    setGuardando(true);
    setError("");

    const payload = {
      codigo:               form.codigo.trim(),
      nombre:               form.nombre.trim(),
      descripcion:          form.descripcion || null,
      marca:                form.marca || null,
      modelo:               form.modelo || null,
      numero_serie:         form.numero_serie || null,
      estado:               form.estado,
      es_compartida:        form.es_compartida,
      category_id:          form.category_id || null,
      ubicacion_habitual_id: form.ubicacion_habitual_id || null,
      ubicacion_actual_id:  form.ubicacion_actual_id || null,
      observaciones:        form.observaciones || null,
      activa:               form.activa ?? true,
    };

    const { error: err } = editId
      ? await supabase.from("tc_tools").update(payload).eq("id", editId)
      : await supabase.from("tc_tools").insert(payload);

    setGuardando(false);
    if (err) { setError(err.message); return; }

    setMensaje(editId ? "Herramienta actualizada." : "Herramienta creada.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function eliminar(id: string) {
    if (!confirm("¿Desactivar esta herramienta?")) return;
    await supabase.from("tc_tools").update({ activa: false }).eq("id", id);
    cargar();
  }

  return (
    <ToolControlLayout
      title="Herramientas"
      subtitle={`${filtradas.length} herramientas`}
      actions={
        <button
          onClick={abrirNueva}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400"
        >
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva herramienta</span>
        </button>
      }
    >
      {mensaje && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por nombre, código, marca..."
          className={`w-64 ${FIELD}`}
        />
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className={FIELD}
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value)}
          className={FIELD}
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        {(filtroEstado || filtroTexto || filtroCat) && (
          <button
            onClick={() => { setFiltroEstado(""); setFiltroTexto(""); setFiltroCat(""); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      {cargando ? (
        <div className="text-center py-10 text-slate-500">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-800 bg-slate-800/60">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Código</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Marca / Modelo</th>
                <th className="p-3">Categoría</th>
                <th className="p-3">Ubicación actual</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Próx. revisión</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((h) => {
                const diasRevision = h.proxima_revision
                  ? Math.ceil((new Date(h.proxima_revision).getTime() - Date.now()) / 86400000)
                  : null;
                return (
                  <tr key={h.id} className="border-t border-slate-800 align-middle hover:bg-slate-800/50">
                    <td className="p-3 font-mono font-semibold text-slate-200">{h.codigo}</td>
                    <td className="p-3">
                      <div className="font-medium text-slate-100">{h.nombre}</div>
                      {h.es_compartida && (
                        <span className="text-xs text-cyan-300">Compartida</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400">
                      {[h.marca, h.modelo].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="p-3 text-slate-400">
                      {(h.tc_categories as any)?.nombre ?? "—"}
                    </td>
                    <td className="p-3 text-slate-400">
                      {(h.ubicacion_actual as any)?.nombre ?? "—"}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[h.estado] ?? "bg-slate-500/15 text-slate-300"}`}>
                        {h.estado.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">
                      {diasRevision === null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <span className={`text-xs font-semibold ${diasRevision < 0 ? "text-red-400" : diasRevision < 7 ? "text-orange-400" : "text-slate-400"}`}>
                          {diasRevision < 0
                            ? `Vencida (${Math.abs(diasRevision)}d)`
                            : diasRevision === 0
                            ? "Hoy"
                            : `${diasRevision}d`}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setQrItem({ id: h.id, codigo: h.codigo, nombre: h.nombre })}
                          className="rounded-lg border border-blue-500/30 bg-blue-500/15 px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/25"
                        >
                          QR
                        </button>
                        <button
                          onClick={() => abrirEditar(h)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => eliminar(h.id)}
                          className="rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1 text-xs text-red-300 hover:bg-red-500/25"
                        >
                          Desactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No hay herramientas con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4 text-slate-100">
              {editId ? "Editar herramienta" : "Nueva herramienta"}
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Código *</label>
                  <input
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className={INPUT}
                    placeholder="HRR-001"
                  />
                </div>
                <div>
                  <label className={LABEL}>Estado</label>
                  <select
                    value={form.estado}
                    onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className={INPUT}
                  >
                    {ESTADOS.map((e) => (
                      <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={LABEL}>Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className={INPUT}
                  placeholder="Llave de impacto 1/2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Marca</label>
                  <input
                    value={form.marca}
                    onChange={(e) => setForm({ ...form, marca: e.target.value })}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>Modelo</label>
                  <input
                    value={form.modelo}
                    onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                    className={INPUT}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL}>Número de serie</label>
                <input
                  value={form.numero_serie}
                  onChange={(e) => setForm({ ...form, numero_serie: e.target.value })}
                  className={INPUT}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Categoría</label>
                  <select
                    value={form.category_id ?? ""}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                    className={INPUT}
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Ubicación habitual</label>
                  <select
                    value={form.ubicacion_habitual_id ?? ""}
                    onChange={(e) => setForm({ ...form, ubicacion_habitual_id: e.target.value || null })}
                    className={INPUT}
                  >
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={LABEL}>Ubicación actual</label>
                <select
                  value={form.ubicacion_actual_id ?? ""}
                  onChange={(e) => setForm({ ...form, ubicacion_actual_id: e.target.value || null })}
                  className={INPUT}
                >
                  <option value="">Misma que habitual</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL}>Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={INPUT}
                  rows={2}
                />
              </div>

              <div>
                <label className={LABEL}>Observaciones</label>
                <textarea
                  value={form.observaciones}
                  onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                  className={INPUT}
                  rows={2}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.es_compartida}
                  onChange={(e) => setForm({ ...form, es_compartida: e.target.checked })}
                  className="accent-amber-500"
                />
                Herramienta compartida (varios usuarios simultáneos)
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setModal(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear herramienta"}
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
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Herramienta · {qrItem.codigo}</div>
              <div className="font-bold text-slate-100">{qrItem.nombre}</div>
            </div>

            <div ref={qrRef} className="flex justify-center p-4 bg-white rounded-xl">
              <QRCode
                value={`${window.location.origin}/qr/herramienta/${qrItem.id}`}
                size={180}
                level="M"
              />
            </div>

            <p className="text-xs text-center text-slate-500 break-all">
              {window.location.origin}/qr/herramienta/{qrItem.id}
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
                  const url = `${window.location.origin}/qr/herramienta/${qrItem.id}`;
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
