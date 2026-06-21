import { useEffect, useState } from "react";
import SafetyMenu from "../components/SafetyMenu";
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
    <div className="p-6 space-y-4">
      <SafetyMenu />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">EPIs</h1>
          <p className="text-sm text-gray-500">{filtrados.length} equipos de protección individual</p>
        </div>
        <button onClick={abrirNuevo}
          className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600">
          + Nuevo EPI
        </button>
      </div>

      {mensaje && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por nombre, código, fabricante..." className="rounded-lg border px-3 py-2 text-sm w-64" />
        <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={filtroStockBajo} onChange={(e) => setFiltroStockBajo(e.target.checked)} />
          Solo stock bajo
        </label>
        {(filtroTexto || filtroCat || filtroStockBajo) && (
          <button onClick={() => { setFiltroTexto(""); setFiltroCat(""); setFiltroStockBajo(false); }}
            className="rounded-lg border px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">Limpiar</button>
        )}
      </div>

      {cargando ? <div className="py-10 text-center text-gray-400">Cargando...</div> : (
        <div className="overflow-auto rounded-xl border bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-gray-50 text-left">
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
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-mono font-semibold">{e.codigo}</td>
                    <td className="p-3 font-medium">{e.nombre}</td>
                    <td className="p-3 text-gray-500">{(e.sm_epi_categories as any)?.nombre ?? "—"}</td>
                    <td className="p-3 text-gray-500">{[e.fabricante, e.modelo].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="p-3 text-gray-500">{e.talla ?? "—"}</td>
                    <td className="p-3">
                      <div className={`font-bold ${stockBajo ? "text-red-600" : "text-green-700"}`}>{e.stock_actual}</div>
                      <div className="text-xs text-gray-400">mín. {e.stock_minimo}</div>
                      {stockBajo && <span className="rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-xs">Stock bajo</span>}
                    </td>
                    <td className="p-3 text-gray-500">{e.coste_unitario != null ? `${e.coste_unitario.toFixed(2)} €` : "—"}</td>
                    <td className="p-3 text-gray-500">{e.ubicacion ?? "—"}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => { setFormStock({ tipo: "compra", cantidad: "", observaciones: "" }); setError(""); setModalStock(e); }}
                          className="rounded-lg bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">Stock</button>
                        <button onClick={() => abrirEditar(e)}
                          className="rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200">Editar</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-gray-400">Sin EPIs registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal EPI */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-4">{editId ? "Editar EPI" : "Nuevo EPI"}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Código *</label>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="EPI-001" /></div>
                <div><label className="text-xs font-medium text-gray-600">Categoría</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Nombre *</label>
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Casco de seguridad clase 1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Fabricante</label>
                  <input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Modelo</label>
                  <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Talla</label>
                  <input value={form.talla} onChange={(e) => setForm({ ...form, talla: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="M / 42 / Única" /></div>
                <div><label className="text-xs font-medium text-gray-600">Stock actual</label>
                  <input type="number" value={form.stock_actual} onChange={(e) => setForm({ ...form, stock_actual: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Stock mínimo</label>
                  <input type="number" value={form.stock_minimo} onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600">Coste unitario (€)</label>
                  <input type="number" step="0.01" value={form.coste_unitario} onChange={(e) => setForm({ ...form, coste_unitario: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
                <div><label className="text-xs font-medium text-gray-600">Ubicación</label>
                  <input value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Armario PRL — Estante A" /></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600">Norma CE</label>
                <input value={form.norma_ce} onChange={(e) => setForm({ ...form, norma_ce: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="EN 397:2012" /></div>
              <div><label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-600 disabled:opacity-50">
                {guardando ? "Guardando..." : editId ? "Guardar cambios" : "Crear EPI"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ajuste stock */}
      {modalStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-1">Ajustar stock</h2>
            <p className="text-sm text-gray-500 mb-4">{modalStock.nombre} — actual: <strong>{modalStock.stock_actual}</strong></p>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600">Tipo de movimiento</label>
                <select value={formStock.tipo} onChange={(e) => setFormStock({ ...formStock, tipo: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="compra">Compra (entrada)</option>
                  <option value="reposicion">Reposición (entrada)</option>
                  <option value="devolucion">Devolución (entrada)</option>
                  <option value="entrega">Entrega (salida)</option>
                  <option value="perdida">Pérdida (salida)</option>
                  <option value="baja">Baja (salida)</option>
                  <option value="ajuste">Ajuste manual</option>
                </select></div>
              <div><label className="text-xs font-medium text-gray-600">Cantidad</label>
                <input type="number" min="1" value={formStock.cantidad} onChange={(e) => setFormStock({ ...formStock, cantidad: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
              <div><label className="text-xs font-medium text-gray-600">Observaciones</label>
                <input value={formStock.observaciones} onChange={(e) => setFormStock({ ...formStock, observaciones: e.target.value })}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" /></div>
            </div>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={() => setModalStock(null)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button onClick={ajustarStock} disabled={guardando}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                {guardando ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
