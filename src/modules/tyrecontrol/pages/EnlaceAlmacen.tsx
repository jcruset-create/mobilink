import { useEffect, useMemo, useState } from "react";
import {
  listarEmpresas, listarClientesAlmacen, enlazarClienteAlmacen,
  listarFichasGenericas, listarProductosAlmacen, crearFichaGenerica,
} from "../services/data";
import type { Empresa, ClienteAlmacen, FichaGenerica, ProductoAlmacen } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";

export default function EnlaceAlmacen() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<ClienteAlmacen[]>([]);
  const [fichas, setFichas] = useState<FichaGenerica[]>([]);
  const [productos, setProductos] = useState<ProductoAlmacen[]>([]);
  const [loading, setLoading] = useState(true);
  const [busquedaEmpresa, setBusquedaEmpresa] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [e, c, f, p] = await Promise.all([
        listarEmpresas(), listarClientesAlmacen(), listarFichasGenericas(), listarProductosAlmacen(),
      ]);
      setEmpresas(e); setClientes(c); setFichas(f); setProductos(p);
    } catch (er: any) { setMsg(er?.message || "Error cargando"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const empresasVisibles = useMemo(() => {
    const s = busquedaEmpresa.trim().toLowerCase();
    return empresas.filter((e) => !s || e.nombre.toLowerCase().includes(s));
  }, [empresas, busquedaEmpresa]);

  async function cambiarEnlace(empresaId: string, clienteId: string) {
    setMsg("");
    try { await enlazarClienteAlmacen(empresaId, clienteId || null); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error al enlazar"); }
  }

  // Productos del almacén que todavía no tienen una ficha genérica vinculada
  const productosSinFicha = useMemo(() => {
    const vinculados = new Set(fichas.map((f) => f.almacen_producto_id).filter(Boolean));
    return productos.filter((p) => !vinculados.has(p.id));
  }, [productos, fichas]);

  async function sincronizarFichas() {
    setSincronizando(true); setMsg("");
    try {
      for (const p of productosSinFicha) {
        await crearFichaGenerica({
          almacen_producto_id: p.id, referencia_almacen: null,
          marca: p.marca, modelo: p.modelo, medida: p.medida,
          indice_carga: null, codigo_velocidad: null, descripcion: p.dot ? `DOT ref. ${p.dot}` : null, activo: true,
        });
      }
      setMsg(`✔ ${productosSinFicha.length} ficha(s) genérica(s) creada(s) desde el almacén`);
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al sincronizar"); } finally { setSincronizando(false); }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Enlace con el almacén</h1>
      <p className="mb-3 text-sm text-slate-400">Vincula cada empresa de TyreControl con su cliente real del almacén, y sincroniza el catálogo de productos.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Fichas genéricas */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase text-slate-400">Fichas genéricas de neumático (catálogo)</div>
            <div className="text-[11px] text-slate-500">{fichas.length} ficha(s) enlazada(s) · {productosSinFicha.length} producto(s) del almacén sin ficha todavía</div>
          </div>
          {productosSinFicha.length > 0 && (
            <button onClick={sincronizarFichas} disabled={sincronizando} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {sincronizando ? "Sincronizando…" : `Sincronizar ${productosSinFicha.length} producto(s)`}
            </button>
          )}
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th><th className={thCls}>Origen</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Cargando…</td></tr>
            : fichas.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Sin fichas todavía. Sincroniza desde el almacén.</td></tr>
            : fichas.map((f) => (
              <tr key={f.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{f.marca}</td>
                <td className={tdCls + " text-slate-400"}>{f.modelo ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{f.medida}</td>
                <td className={tdCls + " text-[11px] text-slate-500"}>{f.almacen_producto_id ? "Almacén" : "Manual"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {/* Enlace de empresas con clientes del almacén */}
      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Empresas ↔ clientes del almacén</div>
          <input className={`${inputCls} w-auto`} placeholder="Buscar empresa…" value={busquedaEmpresa} onChange={(e) => setBusquedaEmpresa(e.target.value)} />
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Empresa (TyreControl)</th><th className={thCls}>Cliente enlazado (Almacén)</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={2}>Cargando…</td></tr>
            : empresasVisibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={2}>Sin resultados.</td></tr>
            : empresasVisibles.map((e) => (
              <tr key={e.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{e.nombre}</td>
                <td className={tdCls}>
                  <select className={`${inputCls} max-w-xs`} value={e.cliente_almacen_id ?? ""} onChange={(ev) => cambiarEnlace(e.id, ev.target.value)}>
                    <option value="">Sin enlazar</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.codigo ? ` · ${c.codigo}` : ""}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
