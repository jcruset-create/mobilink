import { useEffect, useRef, useState } from "react";
import ToolControlMenu from "../components/ToolControlMenu";
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
  disponible:           "bg-green-100 text-green-800",
  en_uso:               "bg-blue-100 text-blue-800",
  compartida:           "bg-cyan-100 text-cyan-800",
  pendiente_devolucion: "bg-yellow-100 text-yellow-800",
  danada:               "bg-red-100 text-red-800",
  mantenimiento:        "bg-orange-100 text-orange-800",
  perdida:              "bg-gray-200 text-gray-600",
  fuera_servicio:       "bg-gray-200 text-gray-600",
  pendiente_revision:   "bg-purple-100 text-purple-800",
  desactualizada:       "bg-pink-100 text-pink-800",
};

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
    <div className="p-6 space-y-4">
      <ToolControlMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Herramientas</h1>
          <p className="text-sm text-gray-500">{filtradas.length} herramientas</p>
        </div>
        <button
          onClick={abrirNueva}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Nueva herramienta
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <input
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por nombre, código, marca..."
          className="rounded-lg border px-3 py-2 text-sm w-64"
        />
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        {(filtroEstado || filtroTexto || filtroCat) && (
          <button
            onClick={() => { setFiltroEstado(""); setFiltroTexto(""); setFiltroCat(""); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Tabla */}
      {cargando ? (
        <div className="text-center py-10 text-gray-400">Cargando...</div>
      ) : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                  <tr key={h.id} className="border-t align-middle hover:bg-gray-50">
                    <td className="p-3 font-mono font-semibold">{h.codigo}</td>
                    <td className="p-3">
                      <div className="font-medium">{h.nombre}</div>
                      {h.es_compartida && (
                        <span className="text-xs text-cyan-600">Compartida</span>
                      )}
                    </td>
                    <td className="p-3 text-gray-600">
                      {[h.marca, h.modelo].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="p-3 text-gray-600">
                      {(h.tc_categories as any)?.nombre ?? "—"}
                    </td>
                    <td className="p-3 text-gray-600">
                      {(h.ubicacion_actual as any)?.nombre ?? "—"}
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_BADGE[h.estado] ?? "bg-gray-100 text-gray-600"}`}>
                        {h.estado.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3">
                      {diasRevision === null ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <span className={`text-xs font-semibold ${diasRevision < 0 ? "text-red-600" : diasRevision < 7 ? "text-orange-600" : "text-gray-500"}`}>
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
                          onClick={() => abrirEditar(h)}
                          className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => eliminar(h.id)}
                          className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
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
                  <td colSpan={8} className="p-8 text-center text-gray-400">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">
              {editId ? "Editar herramienta" : "Nueva herramienta"}
            </h2>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Código *</label>
                  <input
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="HRR-001"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Estado</label>
                  <select
                    value={form.estado}
                    onChange={(e) => setForm({ ...form, estado: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {ESTADOS.map((e) => (
                      <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Llave de impacto 1/2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Marca</label>
                  <input
                    value={form.marca}
                    onChange={(e) => setForm({ ...form, marca: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Modelo</label>
                  <input
                    value={form.modelo}
                    onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Número de serie</label>
                <input
                  value={form.numero_serie}
                  onChange={(e) => setForm({ ...form, numero_serie: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Categoría</label>
                  <select
                    value={form.category_id ?? ""}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Ubicación habitual</label>
                  <select
                    value={form.ubicacion_habitual_id ?? ""}
                    onChange={(e) => setForm({ ...form, ubicacion_habitual_id: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Ubicación actual</label>
                <select
                  value={form.ubicacion_actual_id ?? ""}
                  onChange={(e) => setForm({ ...form, ubicacion_actual_id: e.target.value || null })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">Misma que habitual</option>
                  {ubicaciones.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600">Observaciones</label>
                <textarea
                  value={form.observaciones}
                  onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.es_compartida}
                  onChange={(e) => setForm({ ...form, es_compartida: e.target.checked })}
                />
                Herramienta compartida (varios usuarios simultáneos)
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setModal(false)}
                className="rounded-xl border px-4 py-2 text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear herramienta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
