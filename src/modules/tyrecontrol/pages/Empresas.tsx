import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarEmpresas, crearEmpresa, actualizarEmpresa } from "../services/data";
import type { Empresa, EmpresaInput } from "../types";
import { Badge, Modal, TableWrap, tdCls, thCls, inputCls } from "../components/ui";
import { EmpresaFormFields, EMPRESA_VACIA } from "../components/forms";
import { useTyreAuth } from "../contexts/TyreAuthContext";

export default function Empresas() {
  const { perfil } = useTyreAuth();
  const esSuper = Boolean(perfil?.es_superadmin);
  const navigate = useNavigate();

  const [items, setItems] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "activas" | "inactivas">("todas");

  const [modal, setModal] = useState<null | { id: string | null; draft: EmpresaInput }>(null);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true);
    try { setItems(await listarEmpresas()); }
    catch (e: any) { setMsg(e?.message || "Error cargando empresas"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((e) => {
      if (filtro === "activas" && !e.activo) return false;
      if (filtro === "inactivas" && e.activo) return false;
      if (!q) return true;
      return [e.nombre, e.cif, e.email, e.ciudad].some((x) => (x ?? "").toLowerCase().includes(q));
    });
  }, [items, busqueda, filtro]);

  async function guardar() {
    if (!modal) return;
    if (!modal.draft.nombre.trim()) { setMsg("El nombre es obligatorio"); return; }
    setSaving(true);
    try {
      if (modal.id) await actualizarEmpresa(modal.id, modal.draft);
      else await crearEmpresa(modal.draft);
      setModal(null);
      setMsg("✔ Guardado");
      await cargar();
    } catch (e: any) { setMsg(e?.message || "Error guardando"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Empresas</h1>
        {esSuper && (
          <button onClick={() => setModal({ id: null, draft: { ...EMPRESA_VACIA } })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nueva empresa</button>
        )}
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Buscar nombre / CIF / email / ciudad…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value as any)}>
          <option value="todas">Todas</option>
          <option value="activas">Solo activas</option>
          <option value="inactivas">Solo inactivas</option>
        </select>
        <span className="text-xs text-slate-500">{visibles.length} empresa(s)</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Nombre</th><th className={thCls}>CIF</th><th className={thCls}>Teléfono</th>
          <th className={thCls}>Email</th><th className={thCls}>Ciudad</th><th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin resultados.</td></tr>
          : visibles.map((e) => (
            <tr key={e.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold"}>{e.nombre}</td>
              <td className={tdCls + " text-slate-400"}>{e.cif ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{e.telefono ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{e.email ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{e.ciudad ?? "—"}</td>
              <td className={tdCls}><Badge ok={e.activo}>{e.activo ? "Activa" : "Inactiva"}</Badge></td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/empresas/${e.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  <button onClick={() => setModal({ id: e.id, draft: { ...EMPRESA_VACIA, ...e } })} className="text-slate-300 hover:underline">Editar</button>
                  <button
                    onClick={async () => { await actualizarEmpresa(e.id, { activo: !e.activo }); await cargar(); }}
                    className="text-amber-300 hover:underline"
                  >{e.activo ? "Desactivar" : "Activar"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal
          title={modal.id ? "Editar empresa" : "Nueva empresa"}
          onClose={() => setModal(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
            </div>
          }
        >
          <EmpresaFormFields draft={modal.draft} set={(p) => setModal({ ...modal, draft: { ...modal.draft, ...p } })} />
        </Modal>
      )}
    </div>
  );
}
