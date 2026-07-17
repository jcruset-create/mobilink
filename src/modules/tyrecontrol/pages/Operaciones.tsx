import { useEffect, useState } from "react";
import { listarOperaciones, listarEmpresas, listarVehiculos, actualizarCosteOperacion, planificarOperacion, cambiarEstadoOperacion, listarUsuarios, listarReservas, liberarReserva } from "../services/data";
import type { Empresa, OperacionNeumatico, TipoOperacion, Vehiculo, EstadoOperacion, Perfil, ReservaNeumatico, PrioridadOperacion } from "../types";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS, ESTADO_OPERACION_LABELS, ESTADO_OPERACION_BADGE, PRIORIDAD_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal, Field } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Acciones de estado disponibles según el estado actual (transiciones simples).
const ACCIONES_ESTADO: Partial<Record<EstadoOperacion, { estado: EstadoOperacion; label: string; cls: string }[]>> = {
  pendiente: [{ estado: "asignada", label: "Asignar", cls: "text-sky-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  planificada: [{ estado: "asignada", label: "Asignar", cls: "text-sky-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  asignada: [{ estado: "en_proceso", label: "Iniciar", cls: "text-amber-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
  en_proceso: [{ estado: "completada", label: "Completar", cls: "text-emerald-300" }, { estado: "pausada", label: "Pausar", cls: "text-amber-300" }],
  pausada: [{ estado: "en_proceso", label: "Reanudar", cls: "text-amber-300" }, { estado: "cancelada", label: "Cancelar", cls: "text-rose-300" }],
};

const COLOR_TIPO: Record<TipoOperacion, string> = {
  montaje: "bg-emerald-500/30 text-emerald-200",
  desmontaje: "bg-slate-600 text-slate-100",
  sustitucion: "bg-sky-500/30 text-sky-200",
  rotacion: "bg-indigo-500/30 text-indigo-200",
  reparacion: "bg-purple-500/30 text-purple-200",
  descarte: "bg-rose-500/30 text-rose-200",
  entrada_almacen: "bg-teal-500/30 text-teal-200",
  salida_almacen: "bg-amber-500/30 text-amber-200",
  revision_vehiculo: "bg-cyan-500/30 text-cyan-200",
  cambio_posicion: "bg-indigo-500/30 text-indigo-200",
  intercambio: "bg-violet-500/30 text-violet-200",
  retirada_stock: "bg-teal-500/30 text-teal-200",
  retirada_definitiva: "bg-rose-500/30 text-rose-200",
  correccion_posicion: "bg-orange-500/30 text-orange-200",
  correccion_montado: "bg-orange-500/30 text-orange-200",
};

export default function Operaciones() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [items, setItems] = useState<OperacionNeumatico[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editCoste, setEditCoste] = useState<null | { id: string; material: string; mano: string }>(null);
  const [savingCoste, setSavingCoste] = useState(false);

  // Fase 5: planificar operación + reservas
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const vacioPlan = { empresaId: "", tipo: "desmontaje" as TipoOperacion, vehiculoId: "", fechaPrevista: "", prioridad: "normal" as PrioridadOperacion, tecnicoId: "", motivo: "", obs: "" };
  const [plan, setPlan] = useState<typeof vacioPlan | null>(null);
  const [guardandoPlan, setGuardandoPlan] = useState(false);
  const [accionando, setAccionando] = useState<string | null>(null);
  const [reservas, setReservas] = useState<ReservaNeumatico[] | null>(null);
  const [cargandoRes, setCargandoRes] = useState(false);

  async function abrirPlan() {
    setPlan({ ...vacioPlan, empresaId: esCliente ? (perfil?.empresa_id ?? "") : (fEmpresa || "") });
    if (tecnicos.length === 0) listarUsuarios().then(setTecnicos).catch(() => {});
  }

  async function guardarPlan() {
    if (!plan || !plan.empresaId || !plan.tipo) { setMsg("Empresa y tipo son obligatorios"); return; }
    setGuardandoPlan(true); setMsg("");
    try {
      await planificarOperacion({
        empresaId: plan.empresaId, tipoOperacion: plan.tipo, vehiculoId: plan.vehiculoId || null,
        fechaPrevista: plan.fechaPrevista || null, prioridad: plan.prioridad,
        tecnicoId: plan.tecnicoId || null, motivo: plan.motivo.trim() || null, observaciones: plan.obs.trim() || null,
      });
      setPlan(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al planificar"); } finally { setGuardandoPlan(false); }
  }

  async function accionEstado(o: OperacionNeumatico, estado: EstadoOperacion) {
    setAccionando(o.id); setMsg("");
    try { await cambiarEstadoOperacion({ operacionId: o.id, nuevoEstado: estado }); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setAccionando(null); }
  }

  async function abrirReservas() {
    setReservas([]); setCargandoRes(true);
    try { setReservas(await listarReservas({ empresaId: fEmpresa || undefined, status: "activa" })); }
    catch { setReservas([]); } finally { setCargandoRes(false); }
  }
  async function quitarReserva(r: ReservaNeumatico) {
    try { await liberarReserva(r.id); setReservas((prev) => (prev ?? []).filter((x) => x.id !== r.id)); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  const [fEmpresa, setFEmpresa] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [fVehiculo, setFVehiculo] = useState("");
  const [fTipo, setFTipo] = useState<TipoOperacion | "">("");
  const [fEstado, setFEstado] = useState<EstadoOperacion | "">("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [ops, veh] = await Promise.all([
        listarOperaciones({
          empresaId: fEmpresa || undefined, vehiculoId: fVehiculo || undefined,
          tipo: fTipo || undefined, estado: fEstado || undefined, desde: fDesde || undefined, hasta: fHasta || undefined,
        }),
        listarVehiculos(fEmpresa ? { empresaId: fEmpresa } : undefined),
      ]);
      setItems(ops); setVehiculos(veh);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { if (!esCliente) listarEmpresas().then(setEmpresas); }, [esCliente]);
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [fEmpresa, fVehiculo, fTipo, fEstado, fDesde, fHasta]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  async function guardarCoste() {
    if (!editCoste) return;
    setSavingCoste(true);
    try {
      await actualizarCosteOperacion(editCoste.id, { coste_material: num(editCoste.material), coste_mano_obra: num(editCoste.mano) });
      setEditCoste(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al guardar el coste"); } finally { setSavingCoste(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Operaciones de neumáticos</h1>
        <div className="flex gap-2">
          <button onClick={abrirReservas} className="rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-600/10">Reservas activas</button>
          <button onClick={abrirPlan} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">+ Nueva operación</button>
        </div>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!esCliente && (
          <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFVehiculo(""); }}>
            <option value="">Todas las empresas</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={fVehiculo} onChange={(e) => setFVehiculo(e.target.value)}>
          <option value="">Todos los vehículos</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTipo} onChange={(e) => setFTipo(e.target.value as TipoOperacion | "")}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_OPERACION_LABELS) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoOperacion | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_OPERACION_LABELS) as EstadoOperacion[]).map((s) => <option key={s} value={s}>{ESTADO_OPERACION_LABELS[s]}</option>)}
        </select>
        <input type="date" className={`${inputCls} w-auto`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        <span className="text-xs text-slate-500">a</span>
        <input type="date" className={`${inputCls} w-auto`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        <span className="text-xs text-slate-500">{items.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Nº</th><th className={thCls}>Fecha</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
          <th className={thCls}>Tipo</th><th className={thCls}>Estado</th><th className={thCls}>Neumático</th><th className={thCls}>Posición</th>
          <th className={thCls}>Km</th><th className={thCls}>Motivo</th><th className={thCls}>Destino</th><th className={thCls}>Coste</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={13}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={13}>Sin operaciones.</td></tr>
          : items.map((o) => (
            <tr key={o.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-mono text-slate-500"}>{o.numero_operacion ? `#${o.numero_operacion}` : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}</td>
              <td className={tdCls + " text-slate-400"}>{o.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.vehiculo?.matricula ?? "—"}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_TIPO[o.tipo_operacion]}`}>{TIPO_OPERACION_LABELS[o.tipo_operacion]}</span></td>
              <td className={tdCls}>
                {o.status ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_OPERACION_BADGE[o.status]}`}>{ESTADO_OPERACION_LABELS[o.status]}</span> : "—"}
                {o.prioridad && o.prioridad !== "normal" && <span className="ml-1 text-[10px] uppercase text-amber-300">{PRIORIDAD_OPERACION_LABELS[o.prioridad]}</span>}
              </td>
              <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
              <td className={tdCls + " text-slate-400"}>{o.km_vehiculo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.destino ?? "—"}</td>
              <td className={tdCls}>
                {(() => {
                  const total = (o.coste_material ?? 0) + (o.coste_mano_obra ?? 0);
                  const tiene = o.coste_material != null || o.coste_mano_obra != null;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300">{tiene ? total.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "—"}</span>
                      {!esCliente && (
                        <button
                          onClick={() => setEditCoste({ id: o.id, material: o.coste_material != null ? String(o.coste_material) : "", mano: o.coste_mano_obra != null ? String(o.coste_mano_obra) : "" })}
                          className="text-[11px] text-sky-300 hover:underline"
                        >editar</button>
                      )}
                    </div>
                  );
                })()}
              </td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-1">
                  {(o.status ? ACCIONES_ESTADO[o.status] ?? [] : []).map((a) => (
                    <button key={a.estado} onClick={() => accionEstado(o, a.estado)} disabled={accionando === o.id}
                      className={`rounded border border-slate-600 px-1.5 py-0.5 text-[11px] font-semibold hover:bg-slate-700 disabled:opacity-50 ${a.cls}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editCoste && (
        <Modal title="Coste de la operación" onClose={() => setEditCoste(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditCoste(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarCoste} disabled={savingCoste} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savingCoste ? "Guardando…" : "Guardar"}</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Coste material (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.material} onChange={(e) => setEditCoste({ ...editCoste, material: e.target.value })} /></Field>
            <Field label="Coste mano de obra (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.mano} onChange={(e) => setEditCoste({ ...editCoste, mano: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {plan && (
        <Modal title="Planificar operación" onClose={() => setPlan(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setPlan(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarPlan} disabled={guardandoPlan || !plan.empresaId} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{guardandoPlan ? "Guardando…" : "Planificar"}</button>
          </div>}>
          <p className="mb-3 text-xs text-slate-400">La operación queda pendiente/planificada. Su ejecución física se registra al marcarla como completada desde la app o el escritorio.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {!esCliente && (
              <Field label="Empresa">
                <select className={inputCls} value={plan.empresaId} onChange={(e) => setPlan({ ...plan, empresaId: e.target.value, vehiculoId: "" })}>
                  <option value="">Elegir…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </Field>
            )}
            <Field label="Tipo de operación">
              <select className={inputCls} value={plan.tipo} onChange={(e) => setPlan({ ...plan, tipo: e.target.value as TipoOperacion })}>
                {(Object.keys(TIPO_OPERACION_LABELS) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Vehículo (opc.)">
              <select className={inputCls} value={plan.vehiculoId} onChange={(e) => setPlan({ ...plan, vehiculoId: e.target.value })}>
                <option value="">—</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
              </select>
            </Field>
            <Field label="Fecha prevista"><input type="date" className={inputCls} value={plan.fechaPrevista} onChange={(e) => setPlan({ ...plan, fechaPrevista: e.target.value })} /></Field>
            <Field label="Prioridad">
              <select className={inputCls} value={plan.prioridad} onChange={(e) => setPlan({ ...plan, prioridad: e.target.value as PrioridadOperacion })}>
                {(Object.keys(PRIORIDAD_OPERACION_LABELS) as PrioridadOperacion[]).map((p) => <option key={p} value={p}>{PRIORIDAD_OPERACION_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Técnico (opc.)">
              <select className={inputCls} value={plan.tecnicoId} onChange={(e) => setPlan({ ...plan, tecnicoId: e.target.value })}>
                <option value="">—</option>{tecnicos.filter((t) => !plan.empresaId || t.empresa_id === plan.empresaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-2 grid gap-2">
            <Field label="Motivo (opc.)"><input className={inputCls} value={plan.motivo} onChange={(e) => setPlan({ ...plan, motivo: e.target.value })} /></Field>
            <Field label="Observaciones"><textarea className={inputCls} rows={2} value={plan.obs} onChange={(e) => setPlan({ ...plan, obs: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {reservas !== null && (
        <Modal title="Reservas de neumático activas" onClose={() => setReservas(null)}>
          {cargandoRes ? (
            <div className="text-sm text-slate-500">Cargando…</div>
          ) : reservas.length === 0 ? (
            <div className="text-sm text-slate-500">No hay reservas activas.</div>
          ) : (
            <TableWrap>
              <thead className="bg-slate-900"><tr>
                <th className={thCls}>Neumático</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
                <th className={thCls}>Prevista</th><th className={thCls}></th>
              </tr></thead>
              <tbody>
                {reservas.map((r) => (
                  <tr key={r.id} className="border-t border-slate-700/60">
                    <td className={tdCls + " text-slate-200"}>{r.neumatico?.numero_interno ?? r.neumatico?.codigo_interno ?? "—"}{r.neumatico ? ` · ${r.neumatico.marca ?? ""} ${r.neumatico.medida ?? ""}` : ""}</td>
                    <td className={tdCls + " text-slate-400"}>{(r as any).empresa?.nombre ?? "—"}</td>
                    <td className={tdCls + " text-slate-400"}>{(r as any).vehiculo?.matricula ?? "—"}</td>
                    <td className={tdCls + " text-slate-400"}>{r.fecha_prevista ?? "—"}</td>
                    <td className={tdCls}><button onClick={() => quitarReserva(r)} className="rounded border border-rose-600 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-600/10">Liberar</button></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Modal>
      )}
    </div>
  );
}
