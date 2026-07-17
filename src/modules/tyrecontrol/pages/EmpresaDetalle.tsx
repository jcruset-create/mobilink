import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  obtenerEmpresa, actualizarEmpresa, listarDelegaciones, crearDelegacion, actualizarDelegacion, listarUsuarios,
  listarClientesAlmacen, enlazarClienteAlmacen,
} from "../services/data";
import type { Delegacion, DelegacionInput, Empresa, EmpresaInput, Perfil, ClienteAlmacen } from "../types";
import { ROL_LABELS } from "../types";
import { Badge, Modal, TableWrap, tdCls, thCls } from "../components/ui";
import { EmpresaFormFields, EMPRESA_VACIA, DelegacionFormFields, delegacionVacia } from "../components/forms";
import UmbralesEmpresa from "../components/UmbralesEmpresa";
import StockAlmacen from "../components/StockAlmacen";
import PreciosMedida from "../components/PreciosMedida";
import WebfleetEmpresa from "../components/WebfleetEmpresa";

export default function EmpresaDetalle() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [deles, setDeles] = useState<Delegacion[]>([]);
  const [usuarios, setUsuarios] = useState<Perfil[]>([]);
  const [msg, setMsg] = useState("");
  const [editEmpresa, setEditEmpresa] = useState<EmpresaInput | null>(null);
  const [modalDele, setModalDele] = useState<null | { id: string | null; draft: DelegacionInput }>(null);
  const [saving, setSaving] = useState(false);
  const [modalAlmacen, setModalAlmacen] = useState(false);
  const [busquedaAlmacen, setBusquedaAlmacen] = useState("");
  const [clientesAlmacen, setClientesAlmacen] = useState<ClienteAlmacen[]>([]);
  const [clienteEnlazado, setClienteEnlazado] = useState<ClienteAlmacen | null>(null);
  const [cargado, setCargado] = useState(false);

  async function cargar() {
    try {
      const [e, d, u] = await Promise.all([obtenerEmpresa(id), listarDelegaciones(id), listarUsuarios(id)]);
      setEmpresa(e); setDeles(d); setUsuarios(u);
      if (e?.cliente_almacen_id) {
        const lista = await listarClientesAlmacen();
        setClienteEnlazado(lista.find((c) => c.id === e.cliente_almacen_id) ?? null);
      } else setClienteEnlazado(null);
    } catch (er: any) { setMsg(er?.message || "Error cargando"); } finally { setCargado(true); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  async function guardarEmpresa() {
    if (!editEmpresa) return;
    setSaving(true);
    try { await actualizarEmpresa(id, editEmpresa); setEditEmpresa(null); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }
  async function abrirModalAlmacen() {
    setBusquedaAlmacen(""); setClientesAlmacen(await listarClientesAlmacen()); setModalAlmacen(true);
  }
  async function buscarClientesAlmacen(q: string) {
    setBusquedaAlmacen(q); setClientesAlmacen(await listarClientesAlmacen(q));
  }
  async function enlazar(clienteId: string | null) {
    setSaving(true);
    try { await enlazarClienteAlmacen(id, clienteId); setModalAlmacen(false); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }
  async function guardarDele() {
    if (!modalDele) return;
    if (!modalDele.draft.nombre.trim()) { setMsg("Nombre de delegación obligatorio"); return; }
    setSaving(true);
    try {
      if (modalDele.id) await actualizarDelegacion(modalDele.id, modalDele.draft);
      else await crearDelegacion(modalDele.draft);
      setModalDele(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  if (!empresa) {
    if (!cargado) return <div className="text-slate-400">Cargando ficha…</div>;
    return (
      <div>
        <button onClick={() => navigate("/tyrecontrol/empresas")} className="mb-3 rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Empresas</button>
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-6 text-center text-sm text-red-300">
          {msg || "No se ha encontrado esta empresa."}
        </div>
      </div>
    );
  }

  const dato = (l: string, v?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{v || "—"}</div></div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/tyrecontrol/empresas")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Empresas</button>
          <h1 className="text-lg font-black">{empresa.nombre}</h1>
          <Badge ok={empresa.activo}>{empresa.activo ? "Activa" : "Inactiva"}</Badge>
        </div>
        <button onClick={() => setEditEmpresa({ ...EMPRESA_VACIA, ...empresa })} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white">Editar datos</button>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      {/* Datos */}
      <div className="mb-3 grid gap-2 rounded-lg bg-slate-800 p-3 sm:grid-cols-3">
        {dato("Número de cliente", empresa.codigo_cliente)}{dato("CIF", empresa.cif)}{dato("Teléfono", empresa.telefono)}{dato("Email", empresa.email)}
        {dato("Dirección", empresa.direccion)}{dato("Ciudad", empresa.ciudad)}{dato("Provincia", empresa.provincia)}
        {dato("C. Postal", empresa.codigo_postal)}{dato("País", empresa.pais)}
      </div>

      {/* Enlace almacén */}
      <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-800 p-3">
        <div>
          <div className="text-[11px] font-bold uppercase text-slate-400">Cliente de almacén enlazado</div>
          <div className="text-sm text-slate-200">{clienteEnlazado ? `${clienteEnlazado.nombre}${clienteEnlazado.codigo ? " · " + clienteEnlazado.codigo : ""}` : "Sin enlazar"}</div>
        </div>
        <button onClick={abrirModalAlmacen} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200">
          {empresa.cliente_almacen_id ? "Cambiar enlace" : "Enlazar con almacén"}
        </button>
      </div>

      {/* Stock de almacén (nuevo / usado) */}
      <div className="mb-3">
        <StockAlmacen empresaId={id} enlazado={!!empresa.cliente_almacen_id} />
      </div>

      {/* Umbrales de profundidad */}
      <div className="mb-3">
        <UmbralesEmpresa empresaId={id} />
      </div>

      {/* Precios de referencia */}
      <div className="mb-3">
        <PreciosMedida empresaId={id} />
      </div>

      {/* Integración Webfleet */}
      <div className="mb-3">
        <WebfleetEmpresa empresaId={id} />
      </div>

      {/* Delegaciones */}
      <div className="mb-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase text-slate-400">Delegaciones ({deles.length})</span>
          <button onClick={() => setModalDele({ id: null, draft: delegacionVacia(id) })} className="rounded bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white">+ Nueva</button>
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Nombre</th><th className={thCls}>Ciudad</th><th className={thCls}>Responsable</th>
            <th className={thCls}>Teléfono</th><th className={thCls}>Email</th><th className={thCls}>Estado</th><th className={thCls}></th>
          </tr></thead>
          <tbody>
            {deles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin delegaciones.</td></tr>
            : deles.map((d) => (
              <tr key={d.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{d.nombre}</td>
                <td className={tdCls + " text-slate-400"}>{d.ciudad ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{d.responsable ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{d.telefono ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{d.email ?? "—"}</td>
                <td className={tdCls}><Badge ok={d.activo}>{d.activo ? "Activa" : "Inactiva"}</Badge></td>
                <td className={tdCls}><button onClick={() => setModalDele({ id: d.id, draft: { ...delegacionVacia(id), ...d } })} className="text-sky-300 hover:underline">Editar</button></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {/* Usuarios */}
      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Usuarios asignados ({usuarios.length})</div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Nombre</th><th className={thCls}>Email</th><th className={thCls}>Rol</th>
            <th className={thCls}>Delegación</th><th className={thCls}>Accesos</th><th className={thCls}>Estado</th>
          </tr></thead>
          <tbody>
            {usuarios.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin usuarios.</td></tr>
            : usuarios.map((u) => (
              <tr key={u.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{u.nombre}{u.es_superadmin ? " ⭐" : ""}</td>
                <td className={tdCls + " text-slate-400"}>{u.email}</td>
                <td className={tdCls}>{ROL_LABELS[u.rol]}</td>
                <td className={tdCls + " text-slate-400"}>{u.delegacion?.nombre ?? "—"}</td>
                <td className={tdCls + " text-[11px] text-slate-400"}>{u.acceso_panel ? "Panel " : ""}{u.acceso_apk ? "APK" : ""}</td>
                <td className={tdCls}><Badge ok={u.activo}>{u.activo ? "Activo" : "Inactivo"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {editEmpresa && (
        <Modal title="Editar empresa" onClose={() => setEditEmpresa(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditEmpresa(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarEmpresa} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
          </div>}>
          <EmpresaFormFields draft={editEmpresa} set={(p) => setEditEmpresa({ ...editEmpresa, ...p })} />
        </Modal>
      )}
      {modalDele && (
        <Modal title={modalDele.id ? "Editar delegación" : "Nueva delegación"} onClose={() => setModalDele(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModalDele(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarDele} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
          </div>}>
          <DelegacionFormFields draft={modalDele.draft} set={(p) => setModalDele({ ...modalDele, draft: { ...modalDele.draft, ...p } })} />
        </Modal>
      )}
      {modalAlmacen && (
        <Modal title="Enlazar con cliente de almacén" onClose={() => setModalAlmacen(false)}
          footer={<div className="flex justify-between gap-2">
            {empresa.cliente_almacen_id
              ? <button onClick={() => enlazar(null)} disabled={saving} className="rounded-lg border border-rose-600 px-4 py-2 text-sm text-rose-300 disabled:opacity-50">Quitar enlace</button>
              : <span />}
            <button onClick={() => setModalAlmacen(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button>
          </div>}>
          <input
            className="mb-3 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            placeholder="Buscar cliente por nombre…"
            value={busquedaAlmacen}
            onChange={(e) => buscarClientesAlmacen(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto">
            {clientesAlmacen.length === 0
              ? <div className="p-4 text-center text-sm text-slate-500">Sin resultados.</div>
              : clientesAlmacen.map((c) => (
                <button key={c.id} onClick={() => enlazar(c.id)} disabled={saving}
                  className="flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50">
                  <span>{c.nombre}{c.codigo ? ` · ${c.codigo}` : ""}</span>
                  {empresa.cliente_almacen_id === c.id && <span className="text-[11px] font-bold text-emerald-400">Enlazado</span>}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
