import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import SafetyLayout from "../components/SafetyLayout";
import { supabase } from "../services/supabase";

type Epi = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  fabricante: string | null;
  modelo: string | null;
  talla: string | null;
  stock_actual: number;
  stock_minimo: number;
  coste_unitario: number | null;
  ubicacion: string | null;
  norma_ce: string | null;
  activo: boolean;
  category_id: string | null;
  sm_epi_categories: { nombre: string } | null;
};

type Categoria = { id: string; nombre: string };

const EMPTY = {
  codigo: "", nombre: "", descripcion: "", fabricante: "", modelo: "", talla: "",
  stock_actual: 0, stock_minimo: 0, coste_unitario: "", ubicacion: "", norma_ce: "",
  category_id: "", activo: true,
};

const FIELD = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40";
const INPUT = `w-full ${FIELD}`;
const LABEL = "text-xs font-medium text-slate-400";

export default function Epis() {
  const [items, setItems] = useState<Epi[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroStockBajo, setFiltroStockBajo] = useState(false);
  const [filtroCat, setFiltroCat] = useState("");
  const [modal, setModal] = useState(false);
  const [modalStock, setModalStock] = useState<Epi | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [formStock, setFormStock] = useState({ tipo: "compra", cantidad: "", observaciones: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => { cargar(); }, []);

  async function cargar() {
    setCargando(true);
    const [{ data: epis }, { data: cats }] = await Promise.all([
      supabase.from("sm_epis")
        .select("id, codigo, nombre, descripcion, fabricante, modelo, talla, stock_actual, stock_minimo, coste_unitario, ubicacion, norma_ce, activo, category_id, sm_epi_categories(nombre)")
        .eq("activo", true).order("nombre"),
      supabase.from("sm_epi_categories").select("id, nombre").eq("activa", true).order("nombre"),
    ]);
    setItems((epis ?? []) as any);
    setCategorias(cats ?? []);
    setCargando(false);
  }

  const filtrados = items.filter((e) => {
    if (filtroCat && e.category_id !== filtroCat) return false;
    if (filtroStockBajo && e.stock_actual > e.stock_minimo) return false;
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      if (![e.nombre, e.codigo, e.fabricante, e.modelo].join(" ").toLowerCase().includes(t)) return false;
    }
    return true;
  });

  function abrirNuevo() {
    setForm({ ...EMPTY });
    setEditId(null);
    setError("");
    setModal(true);
  }

  function abrirEditar(e: Epi) {
    setForm({
      codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion ?? "",
      fabricante: e.fabricante ?? "", modelo: e.modelo ?? "", talla: e.talla ?? "",
      stock_actual: e.stock_actual, stock_minimo: e.stock_minimo,
      coste_unitario: e.coste_unitario ?? "", ubicacion: e.ubicacion ?? "",
      norma_ce: e.norma_ce ?? "", category_id: e.category_id ?? "", activo: e.activo,
    });
    setEditId(e.id);
    setError("");
    setModal(true);
  }

  async function guardar() {
    if (!form.codigo?.trim() || !form.nombre?.trim()) { setError("Código y nombre son obligatorios."); return; }
    setGuardando(true);
    const payload = {
      codigo: form.codigo.trim(), nombre: form.nombre.trim(),
      descripcion: form.descripcion || null, fabricante: form.fabricante || null,
      modelo: form.modelo || null, talla: form.talla || null,
      stock_actual: Number(form.stock_actual) || 0, stock_minimo: Number(form.stock_minimo) || 0,
      coste_unitario: form.coste_unitario ? parseFloat(form.coste_unitario) : null,
      ubicacion: form.ubicacion || null, norma_ce: form.norma_ce || null,
      category_id: form.category_id || null, activo: true,
    };
    const { error: err } = editId
      ? await supabase.from("sm_epis").update(payload).eq("id", editId)
      : await supabase.from("sm_epis").insert(payload);
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje(editId ? "EPI actualizado." : "EPI creado.");
    setModal(false);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  async function ajustarStock() {
    if (!modalStock) return;
    if (!formStock.cantidad || Number(formStock.cantidad) <= 0) { setError("Cantidad inválida."); return; }
    setGuardando(true);
    const cantidad = Number(formStock.cantidad);
    const esEntrada = ["compra", "reposicion", "devolucion"].includes(formStock.tipo);
    const stockDespues = esEntrada
      ? modalStock.stock_actual + cantidad
      : Math.max(0, modalStock.stock_actual - cantidad);

    const { error: err } = await supabase.from("sm_epi_stock_movements").insert({
      epi_id: modalStock.id,
      tipo: formStock.tipo,
      cantidad: esEntrada ? cantidad : -cantidad,
      stock_antes: modalStock.stock_actual,
      stock_despues: stockDespues,
      observaciones: formStock.observaciones || null,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setMensaje("Stock actualizado.");
    setModalStock(null);
    setTimeout(() => setMensaje(""), 3000);
    cargar();
  }

  return (
    <SafetyLayout
      title="EPIs"
      subtitle={`${filtrados.length} equipos de protección individual`}
      actions={
        <button onClick={abrirNuevo}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-400">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nuevo EPI</span>
        </button>
      }
    >
      {mensaje && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-3 text-sm text-emerald-300">{mensaje}</p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por nombre, código, fabricante..." className={`w-64 ${FIELD}`} />
        <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} className={FIELD}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={filtroStockBajo} onChange={(e) => setFiltroStockBajo(e.target.checked)} className="accent-amber-500" />
          Solo stock bajo
        </label>
        {(filtroTexto || filtroCat || filtroStockBajo) && (
          <button onClick={() => { setFiltroTexto(""); setFiltroCat(""); setFiltroStockBajo(false); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-slate-500">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border border-slate-700 bg-slate-800 shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-950/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3">Código</th>
                <th className="p-3">Nombre</th>
                <th className="p-3">Categoría</th>
                <th className="p-3">Fabricante / Modelo</th>
                <th className="p-3">Talla</th>
                <th className="p-3">Stock</th>
                <th className="p-3">Coste unit.</th>
                <th className="p-3">Ubicación</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((e) => {
                const stockBajo = e.stock_actual <= e.stock_minimo;
                return (
                  <tr key={e.id} className="border-t border-slate-700/70 hover:bg-slate-700/40">
                    <td className="p-3 font-mono font-semibold text-slate-200">{e.codigo}</td>
                    <td className="p-3 font-medium text-slate-100">{e.nombre}</td>
                    <td className="p-3 text-slate-400">{(e.sm_epi_categories as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-slate-400">{[e.fabricante, e.modelo].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="p-3 text-slate-400">{e.talla ?? "—"}</td>
                    <td className="p-3">
                      <div className={`font-bold ${stockBajo ? "text-red-400" : "text-emerald-400"}`}>{e.stock_actual}</div>
                      <div className="text-xs text-slate-500">mín. {e.stock_minimo}</div>
                      {stockBajo && <span className="rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">Stock bajo</span>}
                    </td>
                    <td className="p-3 text-slate-400">{e.coste_unitario != null ? `${e.coste_unitario.toFixed(2)} €` : "—"}</td>
                    <td className="p-3 text-slate-400">{e.ubicacion ?? "—"}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => { setFormStock({ tipo: "compra", cantidad: "", observaciones: "" }); setError(""); setModalStock(e); }}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25">Stock</button>
                        <button onClick={() => abrirEditar(e)}
                          className="rounded-lg border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600">Editar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500">Sin EPIs registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal EPI */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-100">{editId ? "Editar EPI" : "Nuevo EPI"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Código *</label>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className={`mt-1 ${INPUT}`} placeholder="EPI-001" /></div>
                <div><label className={LABEL}>Categoría</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className={`mt-1 ${INPUT}`}>
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></div>
              </div>
              <div><label className={LABEL}>Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className={`mt-1 ${INPUT}`} placeholder="Casco de seguridad clase 1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Fabricante</label>
                  <input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Modelo</label>
                  <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={LABEL}>Talla</label>
                  <input value={form.talla} onChange={(e) => setForm({ ...form, talla: e.target.value })}
                    className={`mt-1 ${INPUT}`} placeholder="M / 42 / Única" /></div>
                <div><label className={LABEL}>Stock actual</label>
                  <input type="number" value={form.stock_actual} onChange={(e) => setForm({ ...form, stock_actual: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Stock mínimo</label>
                  <input type="number" value={form.stock_minimo} onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={LABEL}>Coste unitario (€)</label>
                  <input type="number" step="0.01" value={form.coste_unitario} onChange={(e) => setForm({ ...form, coste_unitario: e.target.value })}
                    className={`mt-1 ${INPUT}`} /></div>
                <div><label className={LABEL}>Ubicación</label>
                  <input value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })}
                    className={`mt-1 ${INPUT}`} placeholder="Armario PRL — Estante A" /></div>
              </div>
              <div><label className={LABEL}>Norma CE</label>
                <input value={form.norma_ce} onChange={(e) => setForm({ ...form, norma_ce: e.target.value })}
                  className={`mt-1 ${INPUT}`} placeholder="EN 397:2012" /></div>
              <div><label className={LABEL}>Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className={`mt-1 resize-none ${INPUT}`} rows={2} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModal(false)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear EPI"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajuste stock */}
      {modalStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-bold text-slate-100">Ajustar stock</h2>
            <p className="mb-4 text-sm text-slate-400">{modalStock.nombre} — actual: <strong className="text-slate-200">{modalStock.stock_actual}</strong></p>
            <div className="space-y-3">
              <div><label className={LABEL}>Tipo de movimiento</label>
                <select value={formStock.tipo} onChange={(e) => setFormStock({ ...formStock, tipo: e.target.value })}
                  className={`mt-1 ${INPUT}`}>
                  <option value="compra">Compra (entrada)</option>
                  <option value="reposicion">Reposición (entrada)</option>
                  <option value="devolucion">Devolución (entrada)</option>
                  <option value="entrega">Entrega (salida)</option>
                  <option value="perdida">Pérdida (salida)</option>
                  <option value="baja">Baja (salida)</option>
                  <option value="ajuste">Ajuste manual</option>
                </select></div>
              <div><label className={LABEL}>Cantidad</label>
                <input type="number" min="1" value={formStock.cantidad} onChange={(e) => setFormStock({ ...formStock, cantidad: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
              <div><label className={LABEL}>Observaciones</label>
                <input value={formStock.observaciones} onChange={(e) => setFormStock({ ...formStock, observaciones: e.target.value })}
                  className={`mt-1 ${INPUT}`} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setModalStock(null)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600">Cancelar</button>
              <button onClick={ajustarStock} disabled={guardando}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                {guardando ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SafetyLayout>
  );
}
