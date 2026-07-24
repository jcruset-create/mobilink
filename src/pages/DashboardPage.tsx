import { useEffect, useState } from "react";
import { fetchDashboardKpis } from "../modules/roadsideAssistanceApi";
import { ROADSIDE_ASSISTANCE_STATUS_LABELS } from "../modules/roadsideAssistanceTypes";

function fmtMin(m: number) {
  if (!m) return "—";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-4">
      <div className="text-[13px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-black text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [k, setK] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(d: number) {
    setLoading(true);
    try {
      setK(await fetchDashboardKpis(d));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(days); }, [days]);

  const maxTec = k?.porTecnico?.reduce((m: number, t: any) => Math.max(m, t.total), 0) || 1;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-black">📊 Panel de dirección</h1>
          <div className="flex items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
            <a href="/asistencias" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← Volver</a>
          </div>
        </header>

        {loading || !k ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-400">Cargando…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Asistencias (periodo)" value={k.asistencias.periodo} />
              <Metric label="Hoy" value={k.asistencias.hoy} />
              <Metric label="Esta semana" value={k.asistencias.semana} />
              <Metric label="Cerradas en taller" value={k.asistencias.cerradasPeriodo} sub={`${k.asistencias.canceladasPeriodo} canceladas`} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black uppercase text-slate-500">Tiempos medios</h2>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Salida → punto" value={fmtMin(k.tiempos.salidaPuntoMin)} />
                  <Metric label="Punto → fin" value={fmtMin(k.tiempos.puntoFinMin)} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-black uppercase text-slate-500">Estado actual</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(k.estadoActual).length === 0 ? (
                    <span className="text-sm text-slate-400">Sin asistencias activas</span>
                  ) : Object.entries(k.estadoActual).map(([st, n]) => (
                    <span key={st} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">
                      {(ROADSIDE_ASSISTANCE_STATUS_LABELS as any)[st] ?? st}: {n as number}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-black uppercase text-slate-500">OTF (flota)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="OTF activas" value={k.otf.activas} />
                <Metric label="OTF totales" value={k.otf.total} />
                <Metric label="Trabajos en curso" value={k.otf.trabajos} />
                <Metric label="Trabajos hechos" value={k.otf.trabajosHechos} />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-black uppercase text-slate-500">Asistencias por técnico (periodo)</h2>
              {k.porTecnico.length === 0 ? <div className="text-sm text-slate-400">Sin datos</div> : (
                <div className="space-y-2">
                  {k.porTecnico.map((t: any) => (
                    <div key={t.tech} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 truncate text-sm font-bold">{t.tech}</div>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
                        <div className="h-full bg-slate-800" style={{ width: `${(t.total / maxTec) * 100}%` }} />
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs text-slate-500">{t.total} · {t.finalizadas} fin.</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
