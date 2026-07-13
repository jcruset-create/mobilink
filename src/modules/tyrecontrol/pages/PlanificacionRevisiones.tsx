import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarPlanesMantenimiento, listarPlanEstado, listarVehiculos, listarEstadoWebfleet,
  listarUsuarios, listarEmpresas, listarMantenimientoRealizadas, listarPlantillas,
  aplicarPlantilla, actualizarPlanesMasivo,
} from "../services/data";
import type {
  PlanMantenimiento, PlanEstado, Vehiculo, VehiculoWebfleetEstado, Perfil, Empresa,
  EstadoPlan, PrioridadPlan, MantenimientoRealizada, PlantillaMantenimiento,
} from "../types";
import { ESTADO_PLAN_LABELS, PRIORIDAD_PLAN_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";
import { BadgePlan, ModalRegistrar } from "../components/PlanMantenimiento";

type Fila = { plan: PlanMantenimiento; est: PlanEstado; v: Vehiculo; wf?: VehiculoWebfleetEstado };
type Tab = "pendientes" | "hoy" | "semana" | "atrasadas" | "realizadas" | "cliente" | "base" | "calendario";
const TABS: { k: Tab; l: string }[] = [
  { k: "pendientes", l: "Pendientes" }, { k: "hoy", l: "Hoy" }, { k: "semana", l: "Esta semana" },
  { k: "atrasadas", l: "Atrasadas" }, { k: "realizadas", l: "Realizadas" },
  { k: "cliente", l: "Por cliente" }, { k: "base", l: "Por base" }, { k: "calendario", l: "Calendario" },
];
const esListaTab = (t: Tab) => t === "pendientes" || t === "hoy" || t === "semana" || t === "atrasadas";

function fechaCorta(iso?: string | null) { return iso ? new Date(iso).toLocaleDateString("es-ES") : "—"; }
function diasTexto(d?: number | null) { return d == null ? "—" : d < 0 ? `${Math.abs(d)} d retraso` : d === 0 ? "hoy" : `${d} d`; }

export default function PlanificacionRevisiones() {
  const navigate = useNavigate();
  const [planes, setPlanes] = useState<PlanMantenimiento[]>([]);
  const [estados, setEstados] = useState<Map<string, PlanEstado>>(new Map());
  const [vehiculos, setVehiculos] = useState<Map<string, Vehiculo>>(new Map());
  const [wf, setWf] = useState<Map<string, VehiculoWebfleetEstado>>(new Map());
  const [tecnicos, setTecnicos] = useState<Perfil[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [realizadas, setRealizadas] = useState<MantenimientoRealizada[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pendientes");
  const [q, setQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fPrioridad, setFPrioridad] = useState("");
  const [registrar, setRegistrar] = useState<null | PlanMantenimiento>(null);
  const [plantillas, setPlantillas] = useState<PlantillaMantenimiento[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [masiva, setMasiva] = useState("");
  const [msg, setMsg] = useState("");
  const [mesRef, setMesRef] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  async function cargar() {
    setLoading(true);
    try {
      const [pl, est, vs, w, tec, emp, plt] = await Promise.all([
        listarPlanesMantenimiento(), listarPlanEstado(), listarVehiculos(), listarEstadoWebfleet(),
        listarUsuarios(), listarEmpresas(), listarPlantillas(),
      ]);
      setPlanes(pl);
      setEstados(new Map(est.map((e) => [e.plan_id, e])));
      setVehiculos(new Map(vs.map((v) => [v.id, v])));
      setWf(new Map(w.map((x) => [x.vehiculo_id, x])));
      setTecnicos(tec); setEmpresas(emp); setPlantillas(plt);
      setSel(new Set());
    } catch { /* módulo aún no migrado */ }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const toggleSel = (id: string) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function bulkAsignarTecnico(tecnicoId: string) {
    await actualizarPlanesMasivo(Array.from(sel), { tecnico_id: tecnicoId || null });
    setMasiva(""); await cargar();
  }
  async function bulkActivo(activo: boolean) {
    await actualizarPlanesMasivo(Array.from(sel), { activo });
    await cargar();
  }
  async function bulkAplicarPlantilla(plantillaId: string) {
    if (!plantillaId) return;
    const vehIds = Array.from(new Set(Array.from(sel).map((pid) => planes.find((p) => p.id === pid)?.vehiculo_id).filter(Boolean) as string[]));
    if (vehIds.length === 0) return;
    const n = await aplicarPlantilla(plantillaId, vehIds);
    setMasiva(""); await cargar();
    setMsg(`✔ Plantilla aplicada: ${n} plan(es) creados`);
  }

  // Realizadas del mes: se cargan aparte (todas, filtrando cliente/fecha en cliente).
  useEffect(() => {
    (async () => {
      try {
        const vs = Array.from(vehiculos.values());
        const arr = await Promise.all(vs.map((v) => listarMantenimientoRealizadas(v.id).catch(() => [])));
        const desde = new Date(); desde.setDate(1); const d = desde.toISOString().slice(0, 10);
        setRealizadas(arr.flat().filter((r) => r.fecha >= d).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)));
      } catch { /* ignore */ }
    })();
  }, [vehiculos]);

  const filas = useMemo<Fila[]>(() => {
    const out: Fila[] = [];
    for (const p of planes) {
      const est = estados.get(p.id);
      const v = vehiculos.get(p.vehiculo_id);
      if (!est || !v) continue;
      out.push({ plan: p, est, v, wf: wf.get(p.vehiculo_id) });
    }
    return out;
  }, [planes, estados, vehiculos, wf]);

  const kpis = useMemo(() => {
    const vehSet = new Set<string>();
    let pend = 0, hoy = 0, semana = 0, atras = 0, planif = 0, enBasePend = 0;
    for (const f of filas) {
      vehSet.add(f.v.id);
      const e = f.est.estado, dr = f.est.dias_restantes;
      if (e === "proxima" || e === "vence_hoy" || e === "atrasada") pend++;
      if (e === "vence_hoy") hoy++;
      if (dr != null && dr >= 0 && dr <= 7) semana++;
      if (e === "atrasada") atras++;
      if (e === "planificada") planif++;
      if (f.wf?.estado === "en_base" && (e === "proxima" || e === "vence_hoy" || e === "atrasada")) enBasePend++;
    }
    const total = filas.length;
    const cumplimiento = total > 0 ? Math.round(((total - atras) / total) * 100) : 100;
    return { controlados: vehSet.size, pend, hoy, semana, atras, planif, enBasePend, cumplimiento, realizadasMes: realizadas.length };
  }, [filas, realizadas]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return filas.filter((f) => {
      const e = f.est.estado, dr = f.est.dias_restantes;
      if (tab === "pendientes" && !(e === "proxima" || e === "vence_hoy" || e === "atrasada")) return false;
      if (tab === "hoy" && e !== "vence_hoy") return false;
      if (tab === "semana" && !(dr != null && dr >= 0 && dr <= 7)) return false;
      if (tab === "atrasadas" && e !== "atrasada") return false;
      if (fEmpresa && f.v.empresa_id !== fEmpresa) return false;
      if (fEstado && e !== fEstado) return false;
      if (fPrioridad && f.est.prioridad !== fPrioridad) return false;
      if (s && !f.v.matricula.toLowerCase().includes(s) && !(f.v.empresa?.nombre ?? "").toLowerCase().includes(s)) return false;
      return true;
    }).sort((a, b) => (a.est.dias_restantes ?? 9999) - (b.est.dias_restantes ?? 9999));
  }, [filas, tab, q, fEmpresa, fEstado, fPrioridad]);

  const porCliente = useMemo(() => {
    const m = new Map<string, { nombre: string; total: number; vehiculos: Set<string>; pend: number; atras: number; semana: number; bases: Set<string>; empresaId: string }>();
    for (const f of filas) {
      const k = f.v.empresa_id;
      let g = m.get(k);
      if (!g) { g = { nombre: f.v.empresa?.nombre ?? "—", total: 0, vehiculos: new Set(), pend: 0, atras: 0, semana: 0, bases: new Set(), empresaId: k }; m.set(k, g); }
      g.total++; g.vehiculos.add(f.v.id);
      if (f.v.delegacion?.nombre) g.bases.add(f.v.delegacion.nombre);
      const e = f.est.estado, dr = f.est.dias_restantes;
      if (e === "proxima" || e === "vence_hoy" || e === "atrasada") g.pend++;
      if (e === "atrasada") g.atras++;
      if (dr != null && dr >= 0 && dr <= 7) g.semana++;
    }
    return Array.from(m.values()).sort((a, b) => b.atras - a.atras);
  }, [filas]);

  const porBase = useMemo(() => {
    const m = new Map<string, { nombre: string; empresa?: string; total: number; presentes: number; pend: number; atras: number }>();
    for (const f of filas) {
      const k = f.v.delegacion_id ?? "sin";
      let g = m.get(k);
      if (!g) { g = { nombre: f.v.delegacion?.nombre ?? "Sin base", empresa: f.v.empresa?.nombre, total: 0, presentes: 0, pend: 0, atras: 0 }; m.set(k, g); }
      g.total++;
      if (f.wf?.estado === "en_base") g.presentes++;
      const e = f.est.estado;
      if (e === "proxima" || e === "vence_hoy" || e === "atrasada") g.pend++;
      if (e === "atrasada") g.atras++;
    }
    return Array.from(m.values()).sort((a, b) => b.atras - a.atras);
  }, [filas]);

  // Calendario: por día del mes, planes cuya próxima cae ese día.
  const porDia = useMemo(() => {
    const m = new Map<string, Fila[]>();
    for (const f of filas) {
      const d = f.est.proxima_fecha_efec;
      if (!d) continue;
      const k = d.slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(f);
    }
    return m;
  }, [filas]);

  const diasMes = useMemo(() => {
    const y = mesRef.getFullYear(), mo = mesRef.getMonth();
    const primero = new Date(y, mo, 1);
    const offset = (primero.getDay() + 6) % 7; // lunes = 0
    const total = new Date(y, mo + 1, 0).getDate();
    const celdas: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) celdas.push(null);
    for (let d = 1; d <= total; d++) celdas.push(new Date(y, mo, d));
    while (celdas.length % 7 !== 0) celdas.push(null);
    return celdas;
  }, [mesRef]);

  const tecNombre = (id?: string | null) => tecnicos.find((t) => t.id === id)?.nombre ?? "—";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-black">Planificación de revisiones</h1>
        <button onClick={() => navigate("/tyrecontrol/plantillas-mantenimiento")} className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-800">📋 Plantillas</button>
      </div>
      {msg && <div className="mb-3 text-sm text-emerald-400">{msg}</div>}

      {/* KPIs */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {([
          ["Controlados", kpis.controlados], ["Pendientes", kpis.pend], ["Hoy", kpis.hoy], ["Esta semana", kpis.semana],
          ["Atrasadas", kpis.atras], ["En base pend.", kpis.enBasePend], ["Realizadas mes", kpis.realizadasMes], ["Cumplimiento", `${kpis.cumplimiento}%`],
        ] as [string, number | string][]).map(([l, val]) => (
          <div key={l} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="text-2xl font-black text-slate-100">{val}</div>
            <div className="text-[11px] text-slate-400">{l}</div>
          </div>
        ))}
      </div>

      {/* Pestañas */}
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === t.k ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
            {t.l}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500 self-center">Vistas por cliente, por base y calendario: próxima fase</span>
      </div>

      {/* Acciones masivas */}
      {esListaTab(tab) && sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-600/40 bg-sky-500/5 p-2">
          <span className="text-[12px] font-bold text-sky-300">{sel.size} seleccionados</span>
          <select className={`${inputCls} w-auto text-[12px]`} value={masiva} onChange={(e) => { const v = e.target.value; if (v.startsWith("tec:")) bulkAsignarTecnico(v.slice(4)); else if (v.startsWith("plt:")) bulkAplicarPlantilla(v.slice(4)); else setMasiva(v); }}>
            <option value="">Acción…</option>
            <optgroup label="Asignar técnico">
              {tecnicos.map((t) => <option key={t.id} value={`tec:${t.id}`}>{t.nombre}</option>)}
            </optgroup>
            <optgroup label="Aplicar plantilla (a sus vehículos)">
              {plantillas.map((p) => <option key={p.id} value={`plt:${p.id}`}>{p.nombre}</option>)}
            </optgroup>
          </select>
          <button onClick={() => bulkActivo(false)} className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-700">Desactivar</button>
          <button onClick={() => bulkActivo(true)} className="rounded border border-slate-600 px-2 py-1 text-[12px] text-slate-200 hover:bg-slate-700">Activar</button>
          <button onClick={() => setSel(new Set())} className="text-[12px] text-slate-400 hover:underline">Deseleccionar</button>
        </div>
      )}

      {/* Filtros */}
      {esListaTab(tab) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input className={`${inputCls} max-w-[200px]`} placeholder="Buscar matrícula o cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
            <option value="">Todos los clientes</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {(["correcta", "proxima", "vence_hoy", "atrasada", "planificada"] as EstadoPlan[]).map((e) => <option key={e} value={e}>{ESTADO_PLAN_LABELS[e]}</option>)}
          </select>
          <select className={`${inputCls} w-auto`} value={fPrioridad} onChange={(e) => setFPrioridad(e.target.value)}>
            <option value="">Toda prioridad</option>
            {(["critica", "alta", "media", "baja"] as PrioridadPlan[]).map((p) => <option key={p} value={p}>{PRIORIDAD_PLAN_LABELS[p]}</option>)}
          </select>
          <span className="text-xs text-slate-500">{visibles.length}</span>
        </div>
      )}

      {loading ? <div className="text-slate-500">Cargando…</div> : tab === "calendario" ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => setMesRef(new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1))} className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800">←</button>
            <div className="text-sm font-bold text-slate-100">{mesRef.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</div>
            <button onClick={() => setMesRef(new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 1))} className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800">→</button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => <div key={d} className="py-1 text-center text-[11px] font-bold text-slate-500">{d}</div>)}
            {diasMes.map((d, i) => {
              if (!d) return <div key={i} className="min-h-[68px] rounded-lg bg-slate-900/30" />;
              const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const fs = porDia.get(k) ?? [];
              const atras = fs.filter((f) => f.est.estado === "atrasada").length;
              const hoyKey = new Date().toISOString().slice(0, 10) === k;
              return (
                <div key={i} className={`min-h-[68px] rounded-lg border p-1 ${hoyKey ? "border-sky-500/60" : "border-slate-700/60"} bg-slate-800`}>
                  <div className="text-[11px] font-bold text-slate-400">{d.getDate()}</div>
                  {fs.length > 0 && (
                    <div className="mt-0.5 flex flex-col gap-0.5">
                      <span className={`rounded px-1 text-[10px] font-bold ${atras > 0 ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>{fs.length} revisión{fs.length === 1 ? "" : "es"}</span>
                      {fs.slice(0, 2).map((f) => <span key={f.plan.id} className="truncate text-[10px] text-slate-400">{f.v.matricula}</span>)}
                      {fs.length > 2 && <span className="text-[10px] text-slate-500">+{fs.length - 2}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">Muestra la próxima revisión de cada plan en su fecha. Arrastrar/soltar para reprogramar llegará más adelante.</div>
        </div>
      ) : tab === "cliente" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {porCliente.map((g) => (
            <button key={g.empresaId} onClick={() => { setFEmpresa(g.empresaId); setTab("pendientes"); }}
              className="rounded-2xl border border-slate-700 bg-slate-800 p-4 text-left hover:border-sky-500/50">
              <div className="text-base font-black text-slate-100">{g.nombre}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-xl font-black text-slate-100">{g.vehiculos.size}</div><div className="text-[10px] text-slate-500">Vehículos</div></div>
                <div><div className="text-xl font-black text-amber-300">{g.pend}</div><div className="text-[10px] text-slate-500">Pendientes</div></div>
                <div><div className="text-xl font-black text-rose-300">{g.atras}</div><div className="text-[10px] text-slate-500">Atrasadas</div></div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">Esta semana: {g.semana} · Cumplimiento: {g.total > 0 ? Math.round(((g.total - g.atras) / g.total) * 100) : 100}%</div>
              {g.bases.size > 0 && <div className="mt-1 truncate text-[11px] text-slate-500">Bases: {Array.from(g.bases).join(", ")}</div>}
            </button>
          ))}
          {porCliente.length === 0 && <div className="text-slate-500">Sin datos.</div>}
        </div>
      ) : tab === "base" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {porBase.map((g, i) => (
            <div key={i} className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <div className="text-base font-black text-slate-100">{g.nombre}</div>
              <div className="text-[11px] text-slate-500">{g.empresa ?? ""}</div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <div><div className="text-lg font-black text-slate-100">{g.total}</div><div className="text-[10px] text-slate-500">Planes</div></div>
                <div><div className="text-lg font-black text-emerald-300">{g.presentes}</div><div className="text-[10px] text-slate-500">En base</div></div>
                <div><div className="text-lg font-black text-amber-300">{g.pend}</div><div className="text-[10px] text-slate-500">Pendientes</div></div>
                <div><div className="text-lg font-black text-rose-300">{g.atras}</div><div className="text-[10px] text-slate-500">Atrasadas</div></div>
              </div>
            </div>
          ))}
          {porBase.length === 0 && <div className="text-slate-500">Sin datos.</div>}
        </div>
      ) : tab === "realizadas" ? (
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Fecha</th><th className={thCls}>Operación</th><th className={thCls}>Técnico</th><th className={thCls}>Km</th><th className={thCls}>Resultado</th>
          </tr></thead>
          <tbody>
            {realizadas.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin revisiones registradas este mes.</td></tr>
            : realizadas.map((r) => (
              <tr key={r.id} className="border-t border-slate-700/60">
                <td className={tdCls}>{fechaCorta(r.fecha)}</td>
                <td className={tdCls + " font-semibold"}>{r.operacion?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{tecNombre(r.tecnico_id)}</td>
                <td className={tdCls + " text-slate-400"}>{r.km != null ? Number(r.km).toLocaleString("es-ES") : "—"}</td>
                <td className={tdCls + " text-slate-400"}>{r.resultado ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}><input type="checkbox" checked={visibles.length > 0 && visibles.every((f) => sel.has(f.plan.id))} onChange={(e) => setSel(e.target.checked ? new Set(visibles.map((f) => f.plan.id)) : new Set())} /></th>
            <th className={thCls}>Matrícula</th><th className={thCls}>Cliente</th><th className={thCls}>Base</th><th className={thCls}>Revisión</th>
            <th className={thCls}>Próxima</th><th className={thCls}>Días</th><th className={thCls}>Estado</th><th className={thCls}>Prioridad</th>
            <th className={thCls}>En base</th><th className={thCls}>Técnico</th><th className={thCls}>Acciones</th>
          </tr></thead>
          <tbody>
            {visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={12}>Sin revisiones en esta pestaña.</td></tr>
            : visibles.map((f) => (
              <tr key={f.plan.id} className={`border-t border-slate-700/60 ${f.est.estado === "atrasada" ? "bg-rose-500/5" : ""}`}>
                <td className={tdCls}><input type="checkbox" checked={sel.has(f.plan.id)} onChange={() => toggleSel(f.plan.id)} /></td>
                <td className={tdCls + " font-bold"}>{f.v.matricula}</td>
                <td className={tdCls + " text-slate-400"}>{f.v.empresa?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{f.v.delegacion?.nombre ?? "—"}</td>
                <td className={tdCls + " text-slate-300"}>{f.plan.nombre || f.plan.operacion?.nombre}</td>
                <td className={tdCls + " text-slate-400"}>{fechaCorta(f.est.proxima_fecha_efec)}{f.est.proxima_km_efec != null ? ` · ${Number(f.est.proxima_km_efec).toLocaleString("es-ES")} km` : ""}</td>
                <td className={tdCls + " text-slate-400"}>{diasTexto(f.est.dias_restantes)}</td>
                <td className={tdCls}><BadgePlan estado={f.est.estado} /></td>
                <td className={tdCls + " text-slate-400"}>{PRIORIDAD_PLAN_LABELS[f.est.prioridad]}</td>
                <td className={tdCls}>{f.wf?.estado === "en_base" ? <span className="text-[11px] font-bold text-emerald-300">🟢 Sí</span> : <span className="text-[11px] text-slate-500">—</span>}</td>
                <td className={tdCls + " text-slate-400"}>{tecNombre(f.plan.tecnico_id)}</td>
                <td className={tdCls}>
                  <div className="flex gap-2 text-[12px]">
                    <button onClick={() => setRegistrar(f.plan)} className="font-bold text-emerald-300 hover:underline">Registrar</button>
                    <button onClick={() => navigate(`/tyrecontrol/vehiculos/${f.v.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {registrar && (
        <ModalRegistrar plan={registrar} tecnicos={tecnicos} onClose={() => setRegistrar(null)} onDone={() => { setRegistrar(null); cargar(); }} />
      )}
    </div>
  );
}
