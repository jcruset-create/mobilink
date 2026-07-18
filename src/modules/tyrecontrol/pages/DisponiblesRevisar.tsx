import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarVehiculos, listarEstadoWebfleet, listarRevisionEstado, listarRevisionFlags,
  guardarRevisionFlag, sincronizarWebfleet,
} from "../services/data";
import type { Vehiculo, VehiculoWebfleetEstado, RevisionEstado, RevisionFlag } from "../types";
import { ESTADO_PERIODICIDAD_LABELS } from "../types";

function duracionDesde(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}
function fechaHoraCorta(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fechaCorta(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES");
}
const HOY = () => new Date().toISOString().slice(0, 10);

// Prioridad: 0 sin revisión, 1 vencida, 2 próxima.
function prioridad(estado: string): number {
  return estado === "sin_revision" ? 0 : estado === "vencida" ? 1 : 2;
}

type Fila = { v: Vehiculo; est: VehiculoWebfleetEstado; rev: RevisionEstado };

export default function DisponiblesRevisar() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [estados, setEstados] = useState<Map<string, VehiculoWebfleetEstado>>(new Map());
  const [revs, setRevs] = useState<Map<string, RevisionEstado>>(new Map());
  const [flags, setFlags] = useState<Map<string, RevisionFlag>>(new Map());
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [v, est, rev, fl] = await Promise.all([
        listarVehiculos(), listarEstadoWebfleet(), listarRevisionEstado(), listarRevisionFlags(),
      ]);
      setItems(v);
      setEstados(new Map(est.map((e) => [e.vehiculo_id, e])));
      setRevs(new Map(rev.map((r) => [r.vehiculo_id, r])));
      setFlags(new Map(fl.map((f) => [f.vehiculo_id, f])));
    } catch (e: any) { setMsg(e?.message || "Error cargando"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  async function sincronizar() {
    setSincronizando(true); setMsg("");
    try { const r = await sincronizarWebfleet(); if (r.error) setMsg(`Webfleet: ${r.error}`); else await cargar(); }
    finally { setSincronizando(false); }
  }

  async function posponer(f: Fila) {
    const hasta = new Date(); hasta.setDate(hasta.getDate() + 7);
    await guardarRevisionFlag(f.v.id, f.v.empresa_id, { pospuesta_hasta: hasta.toISOString().slice(0, 10) });
    await cargar();
  }
  async function noDisponible(f: Fila) {
    if (!window.confirm(`¿Marcar ${f.v.matricula} como no disponible? Dejará de aparecer aquí.`)) return;
    await guardarRevisionFlag(f.v.id, f.v.empresa_id, { no_disponible: true });
    await cargar();
  }

  // En base + revisión pendiente + no pospuesto/no descartado, ordenado por prioridad.
  const filas = useMemo<Fila[]>(() => {
    const hoy = HOY();
    const out: Fila[] = [];
    for (const v of items) {
      const est = estados.get(v.id);
      const rev = revs.get(v.id);
      // En base = en su base asignada O en otra base de su empresa (revisable igual).
      if (!est || !(est.estado === "en_base" || est.estado === "otra_base") || !rev) continue;
      if (!(rev.estado === "sin_revision" || rev.estado === "vencida" || rev.estado === "proxima")) continue;
      const fl = flags.get(v.id);
      if (fl?.no_disponible) continue;
      if (fl?.pospuesta_hasta && fl.pospuesta_hasta >= hoy) continue;
      out.push({ v, est, rev });
    }
    out.sort((a, b) => {
      const pa = prioridad(a.rev.estado), pb = prioridad(b.rev.estado);
      if (pa !== pb) return pa - pb;
      const da = a.rev.dias_vencido ?? 0, db = b.rev.dias_vencido ?? 0;
      if (da !== db) return db - da; // más vencido primero
      const ua = a.rev.ultima_revision ?? "", ub = b.rev.ultima_revision ?? "";
      if (ua !== ub) return ua < ub ? -1 : 1; // revisión más antigua primero
      const ea = a.est.entrada_base_at ?? "", eb = b.est.entrada_base_at ?? "";
      return ea < eb ? -1 : ea > eb ? 1 : 0; // llegó antes primero
    });
    return out;
  }, [items, estados, revs, flags]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Vehículos disponibles para revisar</h1>
          <p className="text-xs text-slate-500">En base ahora mismo y con revisión pendiente · {filas.length} vehículo(s)</p>
        </div>
        <button onClick={sincronizar} disabled={sincronizando} className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
          {sincronizando ? "Sincronizando…" : "↻ Sincronizar Webfleet"}
        </button>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      {loading ? (
        <div className="text-slate-500">Cargando…</div>
      ) : filas.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400">
          No hay vehículos en base con revisión pendiente ahora mismo.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filas.map((f) => {
            const venc = f.rev.estado === "vencida" && (f.rev.dias_vencido ?? 0) > 0;
            const tono = f.rev.estado === "proxima" ? "border-amber-500/40" : "border-rose-500/40";
            const chip = f.rev.estado === "proxima" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
            return (
              <div key={f.v.id} className={`flex flex-col rounded-2xl border ${tono} bg-slate-800 p-4`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {/* Sin foto por ahora: placeholder con la matrícula */}
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-[10px] font-black text-slate-500">
                      {f.v.matricula.slice(0, 4)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-black text-slate-100">{f.v.matricula}</div>
                      <div className="truncate text-[12px] text-slate-400">{f.v.empresa?.nombre ?? "—"}</div>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${chip}`}>
                    {ESTADO_PERIODICIDAD_LABELS[f.rev.estado]}{venc ? ` · ${f.rev.dias_vencido} d` : ""}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  {[
                    ["Base", f.est.delegacion?.nombre ?? "—"],
                    ["Hora de llegada", fechaHoraCorta(f.est.entrada_base_at)],
                    ["Tiempo en base", duracionDesde(f.est.entrada_base_at)],
                    ["Última revisión", fechaCorta(f.rev.ultima_revision)],
                    ["Próxima revisión", fechaCorta(f.rev.proxima_revision)],
                    ["Revisión", f.rev.estado === "sin_revision" ? "Nunca revisado" : ESTADO_PERIODICIDAD_LABELS[f.rev.estado]],
                  ].map(([l, val]) => (
                    <div key={l as string} className="rounded-lg bg-slate-900/60 p-2">
                      <div className="text-[10px] uppercase text-slate-500">{l}</div>
                      <div className="truncate text-slate-200">{val}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/revision-vehiculo?vehiculo=${f.v.id}&empresa=${f.v.empresa_id}`)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500">Iniciar revisión</button>
                  <button onClick={() => navigate(`/tyrecontrol/vehiculos/${f.v.id}`)}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-slate-700">Ver ficha</button>
                  <button onClick={() => posponer(f)}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-slate-700">Posponer 7 d</button>
                  <button onClick={() => noDisponible(f)}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] text-rose-300 hover:bg-slate-700">No disponible</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
