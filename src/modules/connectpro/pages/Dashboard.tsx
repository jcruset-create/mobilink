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

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => boFetch<Overview>("/stats/overview").then(setData).catch((e) => setError(e.message));
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
