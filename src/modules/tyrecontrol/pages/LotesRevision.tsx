import { useEffect, useMemo, useState } from "react";
import {
  listarLotes, crearLote, listarLoteVehiculos, actualizarLoteVehiculoEstado, quitarLoteVehiculo,
  finalizarLote, actualizarLote, listarEmpresas, listarDelegaciones, listarUsuarios,
  listarPlanesMantenimiento, listarPlanEstado, listarVehiculos, listarEstadoWebfleet,
} from "../services/data";
import type {
  LoteRevision, LoteVehiculo, Empresa, Delegacion, Perfil,
  PlanMantenimiento, PlanEstado, Vehiculo, VehiculoWebfleetEstado, EstadoLote,
} from "../types";
import { ESTADO_LOTE_LABELS, ESTADO_LOTE_BADGE, ESTADO_PLAN_LABELS } from "../types";
import { Modal, inputCls, Field, TableWrap, tdCls, thCls } from "../components/ui";

const fechaCorta = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("es-ES") : "—");

export default function LotesRevision() {
  const [lotes, setLotes] = useState<LoteRevision[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const [planes, setPlanes] = useState<PlanMantenimiento[]>([]);
  const [estados, setEstados] = useState<Map<string, PlanEstado>>(new Map());
  const [vehiculos, setVehiculos] = useState<Map<string, Vehiculo>>(new Map());
  const [wf, setWf] = useState<Map<string, VehiculoWebfleetEstado>>(new Map());
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [detalle, setDetalle] = useState<LoteRevision | null>(null);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [lo, emp, del, tec, pl, est, vs, w] = await Promise.all([
        listarLotes(), listarEmpresas(), listarDelegaciones(), listarUsuarios(),
        listarPlanesMantenimiento(), listarPlanEstado(), listarVehiculos(), listarEstadoWebfleet(),
      ]);
      setLotes(lo); setEmpresas(emp); setDelegaciones(del); setTecnicos(tec);
      setPlanes(pl); setEstados(new Map(est.map((e) => [e.plan_id, e])));
      setVehiculos(new Map(vs.map((v) => [v.id, v]))); setWf(new Map(w.map((x) => [x.vehiculo_id, x])));
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const tecNombre = (id?: string | null) => tecnicos.find((t) => t.id === id)?.nombre ?? "—";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-black">Lotes de revisión</h1>
        <button onClick={() => setNuevo(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo lote</button>
      </div>
      {msg && <div className="mb-3 text-sm text-emerald-400">{msg}</div>}

      {loading ? <div className="text-slate-500">Cargando…</div> : lotes.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">Aún no hay lotes. Crea uno para agrupar la revisión de varios vehículos en una visita.</div>
      ) : (
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Cliente</th><th className={thCls}>Base</th><th className={thCls}>Fecha</th>
            <th className={thCls}>Técnico</th><th className={thCls}>Estado</th><th className={thCls}></th>
          </tr></thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}>{l.empresa?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{l.delegacion?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{fechaCorta(l.fecha_prevista)}{l.hora_prevista ? ` ${l.hora_prevista.slice(0, 5)}` : ""}</td>
                <td className={tdCls + " text-slate-400"}>{tecNombre(l.tecnico_id)}</td>
                <td className={tdCls}><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ESTADO_LOTE_BADGE[l.estado]}`}>{ESTADO_LOTE_LABELS[l.estado]}</span></td>
                <td className={tdCls}><button onClick={() => setDetalle(l)} className="text-sky-300 hover:underline">Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {nuevo && (
        <ModalNuevoLote empresas={empresas} delegaciones={delegaciones} tecnicos={tecnicos}
          planes={planes} estados={estados} vehiculos={vehiculos} wf={wf}
          onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); cargar(); setMsg("✔ Lote creado"); }} />
      )}
      {detalle && (
        <ModalDetalleLote lote={detalle} tecnicos={tecnicos}
          onClose={() => setDetalle(null)} onChanged={cargar} />
      )}
    </div>
  );
}

// ── Crear lote ─────────────────────────────────────────────────
function ModalNuevoLote({ empresas, delegaciones, tecnicos, planes, estados, vehiculos, wf, onClose, onDone }: {
  empresas: Empresa[]; delegaciones: Delegacion[]; tecnicos: Perfil[];
  planes: PlanMantenimiento[]; estados: Map<string, PlanEstado>; vehiculos: Map<string, Vehiculo>; wf: Map<string, VehiculoWebfleetEstado>;
  onClose: () => void; onDone: () => void;
}) {
  const [empresaId, setEmpresaId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [tecnicoId, setTecnicoId] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set()); // plan ids
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Planes pendientes del cliente/base elegidos.
  const candidatos = useMemo(() => {
    if (!empresaId) return [];
    return planes
      .map((p) => ({ p, e: estados.get(p.id), v: vehiculos.get(p.vehiculo_id) }))
      .filter(({ e, v }) => v && e && v.empresa_id === empresaId
        && (!baseId || v.delegacion_id === baseId)
        && (e.estado === "proxima" || e.estado === "vence_hoy" || e.estado === "atrasada"))
      .sort((a, b) => (a.e!.dias_restantes ?? 9999) - (b.e!.dias_restantes ?? 9999));
  }, [empresaId, baseId, planes, estados, vehiculos]);

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function guardar() {
    if (!empresaId) { setErr("Elige el cliente"); return; }
    if (sel.size === 0) { setErr("Selecciona al menos un vehículo"); return; }
    setSaving(true); setErr("");
    try {
      const vehs = candidatos.filter((c) => sel.has(c.p.id)).map((c) => ({ vehiculo_id: c.p.vehiculo_id, plan_id: c.p.id }));
      await crearLote({ empresa_id: empresaId, delegacion_id: baseId || null, fecha_prevista: fecha, tecnico_id: tecnicoId || null, vehiculos: vehs });
      onDone();
    } catch (e: any) { setErr(e?.message || "Error"); } finally { setSaving(false); }
  }

  return (
    <Modal title="Nuevo lote de revisión" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button><button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Crear lote ({sel.size})</button></div>}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Cliente *">
          <select className={inputCls} value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setBaseId(""); setSel(new Set()); }}>
            <option value="">Selecciona…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Field>
        <Field label="Base">
          <select className={inputCls} value={baseId} onChange={(e) => { setBaseId(e.target.value); setSel(new Set()); }}>
            <option value="">Todas</option>
            {delegaciones.filter((d) => d.empresa_id === empresaId).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </Field>
        <Field label="Fecha prevista"><input type="date" className={inputCls} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        <Field label="Técnico">
          <select className={inputCls} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-700">
        {!empresaId ? <div className="p-4 text-[12px] text-slate-500">Elige un cliente para ver sus vehículos con revisión pendiente.</div>
        : candidatos.length === 0 ? <div className="p-4 text-[12px] text-slate-500">Sin vehículos pendientes para ese cliente/base.</div>
        : candidatos.map(({ p, e, v }) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-800 px-3 py-2 last:border-0 hover:bg-slate-800/50">
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
            <span className="w-24 font-bold text-slate-100">{v!.matricula}</span>
            <span className="flex-1 text-[12px] text-slate-400">{p.nombre || p.operacion?.nombre}</span>
            <span className="text-[11px] text-slate-500">{ESTADO_PLAN_LABELS[e!.estado]}</span>
            {wf.get(p.vehiculo_id)?.estado === "en_base" && <span className="text-[11px] font-bold text-emerald-300">🟢 en base</span>}
          </label>
        ))}
      </div>
      {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
    </Modal>
  );
}

// ── Detalle del lote ───────────────────────────────────────────
function ModalDetalleLote({ lote, tecnicos, onClose, onChanged }: {
  lote: LoteRevision; tecnicos: Perfil[]; onClose: () => void; onChanged: () => void;
}) {
  const [vehs, setVehs] = useState<LoteVehiculo[]>([]);
  const [estado, setEstado] = useState<EstadoLote>(lote.estado);
  const [tecnicoId, setTecnicoId] = useState(lote.tecnico_id ?? "");
  const [busy, setBusy] = useState(false);

  async function cargar() { setVehs(await listarLoteVehiculos(lote.id)); }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [lote.id]);

  async function setVehEstado(v: LoteVehiculo, e: LoteVehiculo["estado"]) {
    await actualizarLoteVehiculoEstado(lote.id, v.vehiculo_id, e); cargar();
  }
  async function quitar(v: LoteVehiculo) { await quitarLoteVehiculo(lote.id, v.vehiculo_id); cargar(); }
  async function guardarCabecera() {
    await actualizarLote(lote.id, { estado, tecnico_id: tecnicoId || null }); onChanged();
  }
  async function finalizar() {
    if (!window.confirm("¿Finalizar el lote? Se registrarán como realizadas las revisiones marcadas y se recalcularán las próximas.")) return;
    setBusy(true);
    try { await finalizarLote(lote.id); onChanged(); onClose(); } finally { setBusy(false); }
  }

  const cerrado = lote.estado === "finalizado" || lote.estado === "cancelado";

  return (
    <Modal title={`Lote · ${lote.empresa?.nombre ?? ""}${lote.delegacion?.nombre ? " · " + lote.delegacion.nombre : ""}`} onClose={onClose}
      footer={<div className="flex justify-between gap-2">
        <button onClick={finalizar} disabled={busy || cerrado} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Finalizar lote</button>
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cerrar</button>
      </div>}>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div><div className="text-[10px] uppercase text-slate-500">Fecha</div><div className="text-slate-200">{fechaCorta(lote.fecha_prevista)}</div></div>
        <Field label="Estado">
          <select className={inputCls} value={estado} onChange={(e) => setEstado(e.target.value as EstadoLote)} onBlur={guardarCabecera} disabled={cerrado}>
            {(Object.keys(ESTADO_LOTE_LABELS) as EstadoLote[]).map((s) => <option key={s} value={s}>{ESTADO_LOTE_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Técnico">
          <select className={inputCls} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} onBlur={guardarCabecera} disabled={cerrado}>
            <option value="">—</option>
            {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Field>
      </div>

      <div className="text-[11px] font-bold uppercase text-slate-400">Vehículos ({vehs.length})</div>
      <div className="mt-1 flex flex-col gap-1">
        {vehs.map((v) => (
          <div key={v.vehiculo_id} className="flex flex-wrap items-center gap-2 rounded bg-slate-900/50 px-2 py-1.5">
            <span className="w-24 font-bold text-slate-100">{v.vehiculo?.matricula ?? "—"}</span>
            <div className="flex gap-1">
              {(["pendiente", "realizada", "no_disponible"] as const).map((e) => (
                <button key={e} onClick={() => setVehEstado(v, e)} disabled={cerrado}
                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${v.estado === e ? (e === "realizada" ? "bg-emerald-500/25 text-emerald-200" : e === "no_disponible" ? "bg-rose-500/20 text-rose-300" : "bg-slate-600/40 text-slate-200") : "bg-slate-800 text-slate-400"} disabled:opacity-50`}>
                  {e === "pendiente" ? "Pendiente" : e === "realizada" ? "Realizada" : "No disp."}
                </button>
              ))}
            </div>
            {!cerrado && <button onClick={() => quitar(v)} className="ml-auto text-[11px] text-rose-300 hover:underline">Quitar</button>}
          </div>
        ))}
        {vehs.length === 0 && <div className="text-[12px] text-slate-500">Sin vehículos.</div>}
      </div>
    </Modal>
  );
}
