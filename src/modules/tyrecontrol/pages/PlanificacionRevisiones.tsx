import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarPlanesMantenimiento, listarPlanEstado, listarVehiculos, listarEstadoWebfleet,
  listarUsuarios, listarEmpresas, listarMantenimientoRealizadas,
} from "../services/data";
import type {
  PlanMantenimiento, PlanEstado, Vehiculo, VehiculoWebfleetEstado, Perfil, Empresa,
  EstadoPlan, PrioridadPlan, MantenimientoRealizada,
} from "../types";
import { ESTADO_PLAN_LABELS, PRIORIDAD_PLAN_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";
import { BadgePlan, ModalRegistrar } from "../components/PlanMantenimiento";

type Fila = { plan: PlanMantenimiento; est: PlanEstado; v: Vehiculo; wf?: VehiculoWebfleetEstado };
type Tab = "pendientes" | "hoy" | "semana" | "atrasadas" | "realizadas";
const TABS: { k: Tab; l: string }[] = [
  { k: "pendientes", l: "Pendientes" }, { k: "hoy", l: "Hoy" }, { k: "semana", l: "Esta semana" },
  { k: "atrasadas", l: "Atrasadas" }, { k: "realizadas", l: "Realizadas" },
];

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

  async function cargar() {
    setLoading(true);
    try {
      const [pl, est, vs, w, tec, emp] = await Promise.all([
        listarPlanesMantenimiento(), listarPlanEstado(), listarVehiculos(), listarEstadoWebfleet(),
        listarUsuarios(), listarEmpresas(),
      ]);
      setPlanes(pl);
      setEstados(new Map(est.map((e) => [e.plan_id, e])));
      setVehiculos(new Map(vs.map((v) => [v.id, v])));
      setWf(new Map(w.map((x) => [x.vehiculo_id, x])));
      setTecnicos(tec); setEmpresas(emp);
    } catch { /* módulo aún no migrado */ }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

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

  const tecNombre = (id?: string | null) => tecnicos.find((t) => t.id === id)?.nombre ?? "—";

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Planificación de revisiones</h1>

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

      {/* Filtros */}
      {tab !== "realizadas" && (
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

      {loading ? <div className="text-slate-500">Cargando…</div> : tab === "realizadas" ? (
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
            <th className={thCls}>Matrícula</th><th className={thCls}>Cliente</th><th className={thCls}>Base</th><th className={thCls}>Revisión</th>
            <th className={thCls}>Próxima</th><th className={thCls}>Días</th><th className={thCls}>Estado</th><th className={thCls}>Prioridad</th>
            <th className={thCls}>En base</th><th className={thCls}>Técnico</th><th className={thCls}>Acciones</th>
          </tr></thead>
          <tbody>
            {visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={11}>Sin revisiones en esta pestaña.</td></tr>
            : visibles.map((f) => (
              <tr key={f.plan.id} className={`border-t border-slate-700/60 ${f.est.estado === "atrasada" ? "bg-rose-500/5" : ""}`}>
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
