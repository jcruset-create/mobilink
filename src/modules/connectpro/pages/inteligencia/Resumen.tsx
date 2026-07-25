/**
 * Centro de Inteligencia Operacional — Resumen operacional.
 *
 * Panel principal: KPIs con semáforo, evolución de los últimos 14 días,
 * riesgo agregado de los servicios activos y cobertura por zona.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, ErrorBanner, Th, Td, Badge } from "../../components/ui";
import { KpiGrid } from "../../components/oi/KpiTile";
import { LineChart } from "../../components/oi/TrendChart";
import { PeriodPicker, filtersToQuery, useOiFilters } from "./IntelligenceLayout";
import {
  oiFetch, RISK_LABELS, RISK_STYLES, fmtDateTime, type DashboardResponse, type KpiCard,
} from "../../services/oiApi";

const ZONE_STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "Cobertura suficiente", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  tight: { label: "Ajustada", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  deficit: { label: "Déficit", cls: "border-red-500/50 bg-red-500/10 text-red-300" },
};

export default function Resumen() {
  const { filters } = useOiFilters();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<KpiCard | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    oiFetch<DashboardResponse>(`/dashboard?${filtersToQuery(filters)}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [filters]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000); // el panel se refresca solo cada minuto
    return () => clearInterval(timer);
  }, [load]);

  const labels = (data?.trend ?? []).map((t) => new Date(t.day).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }));

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker />
        {data && (
          <span className="text-[11px] text-slate-500">
            Actualizado a las {new Date(data.generatedAtMs).toLocaleTimeString("es-ES")}
            {!data.scope.full && " · ámbito limitado a tu empresa"}
          </span>
        )}
      </div>

      {!data ? (
        <div className="text-sm text-slate-400">Calculando indicadores…</div>
      ) : (
        <>
          <KpiGrid kpis={data.kpis} onSelect={setDetail} />

          {detail && (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-100">{detail.name}</h3>
                  <p className="mt-0.5 text-[13px] text-slate-400">{detail.description}</p>
                  <p className="mt-2 text-[12px] text-slate-500">
                    Muestra: {detail.sampleSize} · Objetivo: {detail.target ?? "sin objetivo"} {detail.unit} ·
                    {" "}Variación diaria {detail.vsPrevDay ?? "—"} % · semanal {detail.vsPrevWeek ?? "—"} %
                  </p>
                  {!detail.available && (
                    <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
                      Dato no disponible todavía: {detail.missingData}
                    </p>
                  )}
                </div>
                <button onClick={() => setDetail(null)} className="text-slate-500 hover:text-slate-300">✕</button>
              </div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-2 text-sm font-black text-slate-100">Evolución de los últimos 14 días</h3>
              <LineChart
                labels={labels}
                series={[
                  { label: "Recibidos", color: "#22d3ee", values: data.trend.map((t) => t.received) },
                  { label: "Finalizados", color: "#34d399", values: data.trend.map((t) => t.finished) },
                  { label: "Cancelados", color: "#f87171", values: data.trend.map((t) => t.cancelled) },
                ]}
              />
              <h3 className="mb-2 mt-4 text-sm font-black text-slate-100">Tiempos y cumplimiento</h3>
              <LineChart
                labels={labels}
                series={[
                  { label: "Asignación (min)", color: "#a78bfa", values: data.trend.map((t) => t.assignmentMin) },
                  { label: "Llegada (min)", color: "#fbbf24", values: data.trend.map((t) => t.arrivalMin) },
                  { label: "SLA (%)", color: "#34d399", values: data.trend.map((t) => t.slaPct) },
                ]}
              />
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-black text-slate-100">Riesgo de los servicios activos</h3>
                <div className="grid grid-cols-2 gap-2">
                  {(["critical", "high", "medium", "low"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => navigate("/connect/inteligencia/tiempo-real")}
                      className={`rounded-lg border p-3 text-left ${RISK_STYLES[level]}`}
                    >
                      <div className="text-[11px] uppercase tracking-wide opacity-80">{RISK_LABELS[level]}</div>
                      <div className="text-2xl font-black">{data.riskSummary[level]}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Puntuación calculada cada minuto con el margen de SLA, la posición de la unidad y el histórico del proveedor.
                </p>
              </Card>

              <Card className="p-4">
                <h3 className="mb-2 text-sm font-black text-slate-100">Cobertura por zona (3 h)</h3>
                {data.coverage.length === 0 ? (
                  <p className="text-[13px] text-slate-500">Sin zonas configuradas.</p>
                ) : (
                  <table className="w-full">
                    <thead><tr className="border-b border-slate-700"><Th>Zona</Th><Th>Activos</Th><Th>Unid.</Th><Th>Estado</Th></tr></thead>
                    <tbody>
                      {data.coverage.map((z) => (
                        <tr key={z.zoneId} className="border-b border-slate-700/50">
                          <Td className="text-slate-200">{z.label}</Td>
                          <Td>{z.active}</Td>
                          <Td>{z.availableUnits}</Td>
                          <Td><Badge className={ZONE_STATUS[z.status].cls}>{ZONE_STATUS[z.status].label}</Badge></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          </div>

          <p className="text-[11px] text-slate-600">
            Datos del periodo {fmtDateTime(filters.from)} → {fmtDateTime(filters.to)}. Los indicadores marcados como
            «en vivo» reflejan el estado actual y se comparan con las fotos guardadas de ayer y de la semana pasada.
          </p>
        </>
      )}
    </div>
  );
}
