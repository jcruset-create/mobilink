import { useEffect, useState } from "react";
import { listarIntervencionesPagina, listarEmpresas, listarVehiculos, listarUsuarios, listarPosiciones, listarNeumaticosDisponibles, listarOperaciones, planificarIntervencion, cancelarIntervencion, estadoIntervencion } from "../services/data";
import type { Intervencion, EstadoIntervencion, FiltrosIntervenciones, OperacionPrevistaPlan } from "../services/data";
import type { Empresa, Vehiculo, Perfil, PosicionVehiculo, Neumatico, OperacionNeumatico, TipoOperacion, PrioridadOperacion } from "../types";
import { TIPO_OPERACION_LABELS, ESTADO_OPERACION_LABELS, PRIORIDAD_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal, Field } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

/**
 * Intervenciones: el PARTE de trabajo (la sesión), no la operación suelta.
 *
 * Estados derivados, sin columna propia (ver estadoIntervencion):
 *   planificada → el panel la creó y nadie la ha empezado; la APK la recoge
 *   sola al abrir el vehículo (el plan se convierte en la sesión).
 *   en curso → un técnico está trabajando (o la dejó abierta).
 *   cerrada → parte terminado, con su número OP-AAAA-NNNNNN.
 */
const ESTADO_INTERV_LABEL: Record<EstadoIntervencion, string> = {
  planificada: "Planificada", en_curso: "En curso", cerrada: "Cerrada",
};
const ESTADO_INTERV_BADGE: Record<EstadoIntervencion, string> = {
  planificada: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  en_curso: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  cerrada: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30",
};

// Tipos que tiene sentido dejar previstos desde el panel. Las correcciones y
// los apuntes de almacén no se planifican: se registran cuando ocurren.
const TIPOS_PLANIFICABLES: TipoOperacion[] = [
  "sustitucion", "montaje", "desmontaje", "cambio_posicion", "intercambio", "reparacion", "descarte",
];

interface OpForm { tipo: TipoOperacion; posicionId: string; neumaticoId: string; reservar: boolean; motivo: string; obs: string }
const OP_VACIA: OpForm = { tipo: "sustitucion", posicionId: "", neumaticoId: "", reservar: false, motivo: "", obs: "" };

export default function Intervenciones() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [items, setItems] = useState<Intervencion[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [fEmpresa, setFEmpresa] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [fVehiculo, setFVehiculo] = useState("");
  const [fEstado, setFEstado] = useState<EstadoIntervencion | "">("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(0);
  const TAMANO = 50;
  const ultimaPagina = Math.max(0, Math.ceil(total / TAMANO) - 1);

  const filtros: FiltrosIntervenciones = {
    empresaId: fEmpresa || undefined, vehiculoId: fVehiculo || undefined,
    estado: fEstado || undefined, desde: fDesde || undefined, hasta: fHasta || undefined,
  };

  async function cargar() {
    setLoading(true);
    try {
      const [pag, veh] = await Promise.all([
        listarIntervencionesPagina(filtros, pagina, TAMANO),
        listarVehiculos(fEmpresa ? { empresaId: fEmpresa } : undefined),
      ]);
      setItems(pag.filas); setTotal(pag.total); setVehiculos(veh);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { if (!esCliente) listarEmpresas().then(setEmpresas).catch(() => {}); }, [esCliente]);
  useEffect(() => { setPagina(0); }, [fEmpresa, fVehiculo, fEstado, fDesde, fHasta]);
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [fEmpresa, fVehiculo, fEstado, fDesde, fHasta, pagina]);

  // ── Detalle: el parte con sus operaciones ─────────────────────────────────
  const [detalle, setDetalle] = useState<null | { interv: Intervencion; ops: OperacionNeumatico[]; errorOps?: string }>(null);
  const [cargandoDet, setCargandoDet] = useState(false);
  async function abrirDetalle(i: Intervencion) {
    setDetalle({ interv: i, ops: [] }); setCargandoDet(true);
    try {
      const ops = await listarOperaciones({ intervencionId: i.id });
      setDetalle({ interv: i, ops });
    } catch (e: any) {
      setDetalle({ interv: i, ops: [], errorOps: e?.message || "No se han podido cargar" });
    } finally { setCargandoDet(false); }
  }

  // ── Cancelar (solo abiertas, nunca cliente) ───────────────────────────────
  const [cancelar, setCancelar] = useState<null | Intervencion>(null);
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [cancelando, setCancelando] = useState(false);
  async function confirmarCancelar() {
    if (!cancelar) return;
    setCancelando(true); setMsg("");
    try { await cancelarIntervencion(cancelar.id, motivoCancelar.trim() || null); setCancelar(null); setMotivoCancelar(""); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error al cancelar"); } finally { setCancelando(false); }
  }

  // ── Nueva intervención planificada ────────────────────────────────────────
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const [plan, setPlan] = useState<null | {
    empresaId: string; vehiculoId: string; fecha: string; tecnicoId: string;
    prioridad: PrioridadOperacion; obs: string; ops: OpForm[];
  }>(null);
  const [posiciones, setPosiciones] = useState<PosicionVehiculo[]>([]);
  const [disponibles, setDisponibles] = useState<Neumatico[]>([]);
  const [guardando, setGuardando] = useState(false);

  function abrirPlan() {
    setPlan({ empresaId: esCliente ? (perfil?.empresa_id ?? "") : (fEmpresa || ""), vehiculoId: "", fecha: "", tecnicoId: "", prioridad: "normal", obs: "", ops: [{ ...OP_VACIA }] });
    setPosiciones([]); setDisponibles([]);
    if (tecnicos.length === 0) listarUsuarios().then(setTecnicos).catch(() => {});
  }

  // Al elegir vehículo: sus posiciones (por tipo) y los neumáticos en almacén
  // de la empresa, para poder dejar posición/neumático/reserva previstos.
  async function elegirVehiculo(vehiculoId: string) {
    setPlan((p) => (p ? { ...p, vehiculoId } : p));
    setPosiciones([]);
    const v = vehiculos.find((x) => x.id === vehiculoId);
    if (v?.tipo_vehiculo_id) listarPosiciones(v.tipo_vehiculo_id).then(setPosiciones).catch(() => setPosiciones([]));
    if (v?.empresa_id) listarNeumaticosDisponibles(v.empresa_id).then(setDisponibles).catch(() => setDisponibles([]));
  }

  async function guardarPlan() {
    if (!plan || !plan.empresaId || !plan.vehiculoId) { setMsg("Empresa y vehículo son obligatorios"); return; }
    if (plan.ops.length === 0) { setMsg("Añade al menos una operación prevista"); return; }
    setGuardando(true); setMsg("");
    try {
      const operaciones: OperacionPrevistaPlan[] = plan.ops.map((o) => ({
        tipo: o.tipo,
        posicion_destino: o.posicionId || null,
        neumatico: o.neumaticoId || null,
        reservar: o.reservar && !!o.neumaticoId,
        motivo: o.motivo.trim() || null,
        obs: o.obs.trim() || null,
      }));
      await planificarIntervencion({
        empresaId: plan.empresaId, vehiculoId: plan.vehiculoId,
        fechaPrevista: plan.fecha || null, tecnicoId: plan.tecnicoId || null,
        prioridad: plan.prioridad, observaciones: plan.obs.trim() || null, operaciones,
      });
      setPlan(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al planificar"); } finally { setGuardando(false); }
  }

  const ponerOp = (idx: number, cambio: Partial<OpForm>) =>
    setPlan((p) => (p ? { ...p, ops: p.ops.map((o, i) => (i === idx ? { ...o, ...cambio } : o)) } : p));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Intervenciones</h1>
        {!esCliente && (
          <button onClick={abrirPlan} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">+ Nueva intervención</button>
        )}
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
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoIntervencion | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_INTERV_LABEL) as EstadoIntervencion[]).map((s) => <option key={s} value={s}>{ESTADO_INTERV_LABEL[s]}</option>)}
        </select>
        <input type="date" className={`${inputCls} w-auto`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        <span className="text-xs text-slate-500">a</span>
        <input type="date" className={`${inputCls} w-auto`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        <span className="text-xs text-slate-500">
          {total === 0 ? "0" : `${pagina * TAMANO + 1}–${Math.min((pagina + 1) * TAMANO, total)} de ${total}`}
        </span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls} title="Número de parte (OP-…). Se asigna al cerrar; una planificada aún no lo tiene.">Nº parte</th>
          <th className={thCls}>Fecha</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
          <th className={thCls}>Técnico</th><th className={thCls}>Estado</th><th className={thCls}>Ops</th>
          <th className={thCls}>Resumen</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Sin intervenciones.</td></tr>
          : items.map((i) => {
            const est = estadoIntervencion(i);
            return (
              <tr key={i.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-mono text-slate-300"}>{i.numero ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.fecha}</td>
                <td className={tdCls + " text-slate-400"}>{i.empresa?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.vehiculo?.matricula ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.tecnico?.nombre ?? "—"}</td>
                <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_INTERV_BADGE[est]}`}>{ESTADO_INTERV_LABEL[est]}</span></td>
                <td className={tdCls + " text-slate-400"}>{i.n_operaciones}</td>
                <td className={tdCls + " max-w-[280px] truncate text-slate-400"} title={i.resumen ?? undefined}>{i.resumen ?? "—"}</td>
                <td className={tdCls}>
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => abrirDetalle(i)} className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">Detalle</button>
                    {!esCliente && est !== "cerrada" && (
                      <button onClick={() => { setCancelar(i); setMotivoCancelar(""); }} className="rounded border border-rose-600 px-1.5 py-0.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-600/10">Cancelar</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {total > TAMANO && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || loading}
            className="rounded-lg border border-slate-600 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">← Anterior</button>
          <span className="text-slate-400">Página {pagina + 1} de {ultimaPagina + 1}</span>
          <button onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina || loading}
            className="rounded-lg border border-slate-600 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40">Siguiente →</button>
        </div>
      )}

      {detalle && (
        <Modal title={`Intervención ${detalle.interv.numero ?? "(sin nº de parte)"}`} onClose={() => setDetalle(null)}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_INTERV_BADGE[estadoIntervencion(detalle.interv)]}`}>{ESTADO_INTERV_LABEL[estadoIntervencion(detalle.interv)]}</span>
            <span className="text-slate-400">{detalle.interv.fecha} · {detalle.interv.vehiculo?.matricula ?? "—"} · {detalle.interv.tecnico?.nombre ?? "sin técnico"}</span>
          </div>
          {detalle.interv.observaciones && <div className="mb-2 rounded-lg bg-slate-800/60 p-2 text-[12px] text-slate-300">{detalle.interv.observaciones}</div>}
          {detalle.interv.resumen && (
            <div className="mb-2 rounded-lg bg-slate-800/60 p-2 text-[12px] text-slate-300 whitespace-pre-line">{detalle.interv.resumen}</div>
          )}
          {detalle.interv.resumen_ia && detalle.interv.resumen_ia !== detalle.interv.resumen && (
            <div className="mb-2 rounded-lg bg-slate-800/60 p-2 text-[12px] italic text-slate-400">{detalle.interv.resumen_ia}</div>
          )}
          {/* Fase 5: la foto del stock al cierre. Es el dato de ENTONCES,
              guardado en la intervención — no se recalcula con el stock de hoy. */}
          {detalle.interv.stock_snapshot?.efecto && detalle.interv.stock_snapshot.efecto.length > 0 && (
            <div className="mb-2 rounded-lg bg-slate-800/60 p-2">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Efecto en el stock (al cierre)</div>
              {detalle.interv.stock_snapshot.efecto.map((e, i) => (
                <div key={i} className="text-[12px] text-slate-300">
                  • {e.medida ?? "—"} {e.marca ?? ""} {e.modelo ?? ""} — nuevo {e.antes_nuevo ?? 0} → {e.despues_nuevo ?? 0} · usado {e.antes_usado ?? 0} → {e.despues_usado ?? 0}
                  <span className="text-slate-500">
                    {" "}({[
                      (e.montados_nuevo ?? 0) > 0 ? `${e.montados_nuevo} nuevo(s) montado(s)` : "",
                      (e.montados_usado ?? 0) > 0 ? `${e.montados_usado} usado(s) montado(s)` : "",
                      (e.devueltos_usado ?? 0) > 0 ? `${e.devueltos_usado} devuelto(s) al almacén` : "",
                    ].filter(Boolean).join(", ")})
                  </span>
                </div>
              ))}
            </div>
          )}
          {detalle.interv.stock_snapshot?.lineas && detalle.interv.stock_snapshot.lineas.length > 0 && (
            <details className="mb-2 rounded-lg bg-slate-800/60 p-2">
              <summary className="cursor-pointer text-[11px] font-bold uppercase text-slate-400">
                Stock del almacén al cierre ({detalle.interv.stock_snapshot.lineas.length} productos)
              </summary>
              <div className="mt-1 space-y-0.5">
                {detalle.interv.stock_snapshot.lineas.map((l, i) => (
                  <div key={i} className="text-[12px] text-slate-300">
                    • {l.medida ?? "—"} {l.marca ?? ""} {l.modelo ?? ""} — nuevo {l.nuevo ?? 0} · usado {l.usado ?? 0}
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Operaciones</div>
          {cargandoDet ? <div className="text-sm text-slate-500">Cargando…</div>
          : detalle.errorOps ? <div className="text-[12px] text-amber-300">⚠ No se han podido cargar: {detalle.errorOps}</div>
          : detalle.ops.length === 0 ? <div className="text-[12px] text-slate-500">Sin operaciones todavía.</div>
          : (
            <div className="space-y-0.5">
              {detalle.ops.map((o) => (
                <div key={o.id} className="text-[12px] text-slate-300">
                  • #{o.numero_operacion ?? "—"} {TIPO_OPERACION_LABELS[o.tipo_operacion]}
                  {o.posicion_destino?.codigo_posicion || o.posicion_origen?.codigo_posicion
                    ? ` · ${o.posicion_origen?.codigo_posicion ?? ""}${o.posicion_origen && o.posicion_destino ? "→" : ""}${o.posicion_destino?.codigo_posicion ?? ""}` : ""}
                  {o.status ? ` · ${ESTADO_OPERACION_LABELS[o.status]}` : ""}
                  {o.is_anulada ? " · ANULADA" : ""}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {cancelar && (
        <Modal title={`Cancelar intervención ${cancelar.numero ?? "(planificada)"}`} onClose={() => setCancelar(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setCancelar(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Volver</button>
            <button onClick={confirmarCancelar} disabled={cancelando} className="rounded-lg border border-rose-600 bg-rose-600/20 px-4 py-2 text-sm font-bold text-rose-200 hover:bg-rose-600/30 disabled:opacity-50">{cancelando ? "Cancelando…" : "Cancelar intervención"}</button>
          </div>}>
          <p className="mb-2 text-xs text-slate-400">
            Sus operaciones previstas pasarán a canceladas (liberando reservas) y la intervención
            se cerrará sin número de parte. Lo ya ejecutado no se toca.
          </p>
          <Field label="Motivo (opc.)"><input className={inputCls} value={motivoCancelar} onChange={(e) => setMotivoCancelar(e.target.value)} /></Field>
        </Modal>
      )}

      {plan && (
        <Modal title="Nueva intervención planificada" onClose={() => setPlan(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setPlan(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarPlan} disabled={guardando || !plan.empresaId || !plan.vehiculoId} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{guardando ? "Guardando…" : "Planificar"}</button>
          </div>}>
          <p className="mb-3 text-xs text-slate-400">
            La intervención queda planificada con sus operaciones previstas dentro. Cuando el técnico
            abra este vehículo en la APK, su sesión recogerá este plan automáticamente y cada ejecución
            irá cerrando la operación prevista vinculada.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {!esCliente && (
              <Field label="Empresa">
                <select className={inputCls} value={plan.empresaId} onChange={(e) => setPlan({ ...plan, empresaId: e.target.value, vehiculoId: "" })}>
                  <option value="">Elegir…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </Field>
            )}
            <Field label="Vehículo">
              <select className={inputCls} value={plan.vehiculoId} onChange={(e) => void elegirVehiculo(e.target.value)}>
                <option value="">Elegir…</option>
                {vehiculos.filter((v) => !plan.empresaId || v.empresa_id === plan.empresaId).map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
              </select>
            </Field>
            <Field label="Fecha prevista"><input type="date" className={inputCls} value={plan.fecha} onChange={(e) => setPlan({ ...plan, fecha: e.target.value })} /></Field>
            <Field label="Técnico (opc.)">
              <select className={inputCls} value={plan.tecnicoId} onChange={(e) => setPlan({ ...plan, tecnicoId: e.target.value })}>
                <option value="">—</option>
                {tecnicos.filter((t) => !plan.empresaId || t.empresa_id === plan.empresaId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Field>
            <Field label="Prioridad">
              <select className={inputCls} value={plan.prioridad} onChange={(e) => setPlan({ ...plan, prioridad: e.target.value as PrioridadOperacion })}>
                {(Object.keys(PRIORIDAD_OPERACION_LABELS) as PrioridadOperacion[]).map((p) => <option key={p} value={p}>{PRIORIDAD_OPERACION_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="Observaciones"><input className={inputCls} value={plan.obs} onChange={(e) => setPlan({ ...plan, obs: e.target.value })} /></Field>
          </div>

          <div className="mt-3 mb-1 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase text-slate-400">Operaciones previstas ({plan.ops.length})</div>
            <button onClick={() => setPlan({ ...plan, ops: [...plan.ops, { ...OP_VACIA }] })} className="rounded border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700">+ Añadir</button>
          </div>
          <div className="space-y-2">
            {plan.ops.map((o, idx) => (
              <div key={idx} className="rounded-lg bg-slate-800/60 p-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <select className={inputCls} value={o.tipo} onChange={(e) => ponerOp(idx, { tipo: e.target.value as TipoOperacion })}>
                    {TIPOS_PLANIFICABLES.map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
                  </select>
                  <select className={inputCls} value={o.posicionId} onChange={(e) => ponerOp(idx, { posicionId: e.target.value })}>
                    <option value="">Posición (opc.)</option>
                    {posiciones.map((p) => <option key={p.id} value={p.id}>{p.nombre ?? p.codigo_posicion}</option>)}
                  </select>
                  <select className={inputCls} value={o.neumaticoId} onChange={(e) => ponerOp(idx, { neumaticoId: e.target.value, reservar: e.target.value ? o.reservar : false })}>
                    <option value="">Neumático (opc.)</option>
                    {disponibles.map((n) => <option key={n.id} value={n.id}>{n.numero_interno ?? n.codigo_interno} · {n.marca ?? ""} {n.medida ?? ""}</option>)}
                  </select>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
                  <label className={`flex items-center gap-1 text-[12px] ${o.neumaticoId ? "text-slate-300" : "text-slate-600"}`}>
                    <input type="checkbox" disabled={!o.neumaticoId} checked={o.reservar} onChange={(e) => ponerOp(idx, { reservar: e.target.checked })} />
                    Reservar
                  </label>
                  <input className={inputCls} placeholder="Motivo (opc.)" value={o.motivo} onChange={(e) => ponerOp(idx, { motivo: e.target.value })} />
                  <input className={inputCls} placeholder="Observaciones (opc.)" value={o.obs} onChange={(e) => ponerOp(idx, { obs: e.target.value })} />
                  {plan.ops.length > 1 && (
                    <button onClick={() => setPlan({ ...plan, ops: plan.ops.filter((_, i) => i !== idx) })} className="justify-self-end rounded border border-slate-600 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-600/10">Quitar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
