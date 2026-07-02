import { useEffect, useMemo, useState } from "react";
import { listarEmpresas, listarClientesAlmacen, enlazarClienteAlmacen, listarProductosAlmacen } from "../services/data";
import type { Empresa, ClienteAlmacen, ProductoAlmacen } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";

export default function EnlaceAlmacen() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [clientes, setClientes] = useState<ClienteAlmacen[]>([]);
  const [productos, setProductos] = useState<ProductoAlmacen[]>([]);
  const [loading, setLoading] = useState(true);
  const [busquedaEmpresa, setBusquedaEmpresa] = useState("");
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [e, c, p] = await Promise.all([listarEmpresas(), listarClientesAlmacen(), listarProductosAlmacen()]);
      setEmpresas(e); setClientes(c); setProductos(p);
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

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Enlace con el almacén</h1>
      <p className="mb-3 text-sm text-slate-400">Vincula cada empresa de TyreControl con su cliente real del almacén.</p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Catálogo de productos del almacén (fuente única, sin copia) */}
      <div className="mb-4 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Catálogo de productos del almacén ({productos.length})</div>
        <div className="mb-2 text-[11px] text-slate-500">
          Se lee en vivo de <code>productos_neumaticos</code> (el mismo catálogo que gestiona el módulo de Almacén, en Productos/Neumáticos) — no hay copia ni sincronización manual: al montar un neumático desde TyreControl eliges directamente uno de estos productos.
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={3}>Cargando…</td></tr>
            : productos.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={3}>Sin productos. Crea alguno en Almacén → Productos.</td></tr>
            : productos.map((p) => (
              <tr key={p.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{p.marca}</td>
                <td className={tdCls + " text-slate-400"}>{p.modelo ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{p.medida}</td>
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
