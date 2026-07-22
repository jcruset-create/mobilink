/** Connect Pro — Dashboard (Sprint 1: tarjetas de situación básicas). */

import { useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, KpiCard, Card, ErrorBanner } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS } from "../types";

type Overview = {
  cards: {
    active: number; pending: number; unassigned_failed: number; en_route: number;
    in_progress: number; finished_today: number; cancelled_today: number;
    created_today: number; providers_active: number; workshops_active: number;
  };
  by_status: Record<string, number>;
};

type Evolution = {
  daily: Array<{ day: string; created: number; finished: number; cancelled: number }>;
  by_service: Array<{ serviceType: string; n: number }>;
};

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [evo, setEvo] = useState<Evolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      boFetch<Overview>("/stats/overview").then(setData).catch((e) => setError(e.message));
      boFetch<Evolution>("/stats/evolution?days=14").then(setEvo).catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <PageTitle title="Dashboard" subtitle="Situación general de las asistencias de la red." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {!data ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard label="Activas" value={data.cards.active} tone={data.cards.active > 0 ? "ok" : "default"} />
            <KpiCard label="Pendientes de asignar" value={data.cards.pending} tone={data.cards.pending > 0 ? "warn" : "default"} />
            <KpiCard label="Sin asignación / cobertura" value={data.cards.unassigned_failed} tone={data.cards.unassigned_failed > 0 ? "bad" : "default"} />
            <KpiCard label="En desplazamiento" value={data.cards.en_route} />
            <KpiCard label="En intervención" value={data.cards.in_progress} />
            <KpiCard label="Creadas hoy" value={data.cards.created_today} />
            <KpiCard label="Finalizadas hoy" value={data.cards.finished_today} />
            <KpiCard label="Canceladas hoy" value={data.cards.cancelled_today} />
            <KpiCard label="Empresas activas" value={data.cards.providers_active} />
            <KpiCard label="Talleres operativos" value={data.cards.workshops_active} />
          </div>

          {evo && evo.daily.length > 0 && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-300">Evolución diaria (14 días)</h2>
                <div className="flex h-32 items-end gap-1">
                  {evo.daily.map((d) => {
                    const max = Math.max(...evo.daily.map((x) => x.created), 1);
                    return (
                      <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.created} creadas, ${d.finished} finalizadas`}>
                        <div className="flex w-full flex-col justify-end" style={{ height: "100px" }}>
                          <div className="w-full rounded-t bg-cyan-600/70" style={{ height: `${(d.created / max) * 100}%` }} />
                        </div>
                        <span className="text-[9px] text-slate-500">{d.day.slice(8)}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-300">Por tipo de servicio (14 días)</h2>
                <div className="flex flex-col gap-1.5">
                  {evo.by_service.slice(0, 8).map((s) => {
                    const max = Math.max(...evo.by_service.map((x) => x.n), 1);
                    return (
                      <div key={s.serviceType} className="flex items-center gap-2 text-[12px]">
                        <span className="w-32 truncate text-slate-400">{s.serviceType}</span>
                        <div className="h-3 flex-1 rounded bg-slate-900">
                          <div className="h-3 rounded bg-indigo-500/70" style={{ width: `${(s.n / max) * 100}%` }} />
                        </div>
                        <span className="w-8 text-right font-bold text-slate-200">{s.n}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          <Card className="mt-4 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Distribución por estado</h2>
            {Object.keys(data.by_status).length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay asistencias registradas.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.by_status).map(([status, n]) => (
                  <span key={status} className="rounded-full border border-slate-600 bg-slate-900 px-3 py-1 text-[12px] text-slate-300">
                    {ASSISTANCE_STATUS_LABELS[status] ?? status}: <b className="text-slate-100">{n}</b>
                  </span>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
