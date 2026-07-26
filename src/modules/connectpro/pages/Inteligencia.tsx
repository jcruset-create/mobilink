/**
 * Connect Pro — Centro de Inteligencia Operacional.
 * Pestañas: Resumen (KPIs con objetivo, semáforo y variaciones),
 * Demanda (previsión 24 h con confianza y precisión del modelo) y
 * Recomendaciones de IA (accionables, explicables, con aceptar/rechazar).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { useConnectEvents } from "../services/events";
import { PageTitle, Card, Badge, Button, ErrorBanner, EmptyState, Input } from "../components/ui";
import { fmtDateTime } from "../types";

type Kpi = {
  code: string; name: string; category: string; unit: string; direction: string;
  value: number | null; target: number | null; status: "green" | "yellow" | "red" | "gray";
  vs_yesterday: number | null; vs_last_week: number | null;
};

type DemandHour = { targetKey: string; predictedValue: number; confidenceMin: number | null; confidenceMax: number | null };

type Recommendation = {
  id: number; recommendationType: string; title: string; description: string;
  priority: string; explanation: string | null; proposedAction: string | null;
  expectedImpact: string | null; entityType: string | null; entityId: string | null;
  status: string; resolvedByName: string | null; rejectionReason: string | null; createdAtMs: number;
};

const SEMAFORO: Record<string, string> = {
  green: "border-emerald-500/50 bg-emerald-500/10",
  yellow: "border-amber-500/50 bg-amber-500/10",
  red: "border-red-500/60 bg-red-500/15",
  gray: "border-slate-700 bg-slate-800",
};

const DOT: Record<string, string> = { green: "bg-emerald-400", yellow: "bg-amber-400", red: "bg-red-500", gray: "bg-slate-600" };

function Delta({ v, direction, label }: { v: number | null; direction: string; label: string }) {
  if (v == null || v === 0) return <span className="text-slate-600">{label}: =</span>;
  const improving = direction === "higher_better" ? v > 0 : v < 0;
  return (
    <span className={improving ? "text-emerald-400" : "text-red-400"}>
      {label}: {v > 0 ? "+" : ""}{v}
    </span>
  );
}

const TABS = ["Resumen", "Demanda", "Recomendaciones"] as const;

export default function Inteligencia() {
  const { user } = useConnectAuth();
  const canOperate = hasRole(user, "operator");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumen");
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [demand, setDemand] = useState<{ forecast: DemandHour[]; precision: { mae: number | null; evaluated_hours: number } } | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recFilter, setRecFilter] = useState("open");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ kpis: Kpi[] }>("/oi/dashboard").then((r) => setKpis(r.kpis)).catch((e) => setError(e.message));
    boFetch<typeof demand>("/oi/demand").then(setDemand).catch(() => {});
    boFetch<{ data: Recommendation[] }>(`/oi/recommendations?status=${recFilter}`).then((r) => setRecs(r.data)).catch(() => {});
  }, [recFilter]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  useConnectEvents(() => load());

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); setRejecting(null); setRejectReason(""); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const openRecs = recs.filter((r) => r.status === "open").length;
  const maxDemand = Math.max(...(demand?.forecast.map((f) => f.confidenceMax ?? f.predictedValue) ?? [1]), 1);

  return (
    <div>
      <PageTitle
        title="Inteligencia operacional"
        subtitle="KPIs con objetivo y semáforo, previsión de demanda y recomendaciones explicables."
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === t ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}>
            {t}{t === "Recomendaciones" && openRecs > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white">{openRecs}</span>}
          </button>
        ))}
      </div>

      {tab === "Resumen" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.code} className={`rounded-xl border p-3 ${SEMAFORO[k.status]}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-slate-400">{k.name}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${DOT[k.status]}`} title={k.status} />
              </div>
              <div className="mt-1 text-2xl font-black text-slate-100">
                {k.value != null ? `${k.value}${k.unit ? ` ${k.unit}` : ""}` : "—"}
                {k.target != null && <span className="ml-2 text-[11px] font-normal text-slate-500">obj. {k.target}{k.unit}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
                <Delta v={k.vs_yesterday} direction={k.direction} label="vs ayer" />
                <Delta v={k.vs_last_week} direction={k.direction} label="vs -7d" />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Demanda" && (
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-300">Demanda prevista — próximas 24 horas</h2>
              {demand?.precision.mae != null && (
                <Badge className="border-sky-500/40 bg-sky-500/10 text-sky-300">
                  Precisión del modelo: ±{demand.precision.mae} servicios/hora ({demand.precision.evaluated_hours} h evaluadas)
                </Badge>
              )}
            </div>
            {!demand || demand.forecast.length === 0 ? (
              <EmptyState message="Aún no hay previsión generada — el modelo se calcula cada hora con el histórico de 8 semanas." />
            ) : (
              <div className="flex h-40 items-end gap-1">
                {demand.forecast.map((f) => {
                  const hour = f.targetKey.slice(11);
                  return (
                    <div key={f.targetKey} className="flex min-w-0 flex-1 flex-col items-center gap-1"
                      title={`${hour}:00 → previsto ${f.predictedValue}${f.confidenceMin != null ? ` (${f.confidenceMin}–${f.confidenceMax})` : ""}`}>
                      <div className="flex w-full flex-col justify-end" style={{ height: "120px" }}>
                        {f.confidenceMax != null && (
                          <div className="w-full rounded-t bg-cyan-500/15"
                            style={{ height: `${((f.confidenceMax - f.predictedValue) / maxDemand) * 120}px` }} />
                        )}
                        <div className="w-full bg-cyan-600/80" style={{ height: `${(f.predictedValue / maxDemand) * 120}px` }} />
                      </div>
                      <span className="text-[9px] text-slate-500">{hour}h</span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-500">
              Barra sólida: demanda prevista · sombra: intervalo de confianza 95 %. Modelo v1: perfil por día de semana y hora sobre 8 semanas; la precisión se mide continuamente contra la demanda real.
            </p>
          </Card>
        </div>
      )}

      {tab === "Recomendaciones" && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1">
            {(["open", "accepted", "rejected", "all"] as const).map((s) => (
              <button key={s} onClick={() => setRecFilter(s)}
                className={`rounded-lg px-3 py-1 text-[12px] ${recFilter === s ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800"}`}>
                {s === "open" ? "Abiertas" : s === "accepted" ? "Aceptadas" : s === "rejected" ? "Rechazadas" : "Todas"}
              </button>
            ))}
          </div>
          {recs.length === 0 ? (
            <EmptyState message="Sin recomendaciones — el motor las genera automáticamente cuando detecta picos de demanda, riesgos de SLA, degradación de proveedores o huecos de cobertura." />
          ) : recs.map((r) => (
            <Card key={r.id} className={`p-4 ${r.priority === "high" && r.status === "open" ? "border-red-500/40" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={r.priority === "high" ? "border-red-500/40 bg-red-500/10 text-red-300" : r.priority === "medium" ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-slate-600 text-slate-400"}>
                      {r.priority === "high" ? "Alta" : r.priority === "medium" ? "Media" : "Baja"}
                    </Badge>
                    <span className="font-bold text-slate-100">{r.title}</span>
                    {r.status !== "open" && (
                      <Badge className={r.status === "accepted" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-400"}>
                        {r.status === "accepted" ? `Aceptada por ${r.resolvedByName}` : r.status === "rejected" ? `Rechazada por ${r.resolvedByName}` : "Expirada"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-slate-300">{r.description}</p>
                  {r.proposedAction && <p className="mt-1 text-[13px] text-cyan-300">→ {r.proposedAction}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-slate-500">
                    {r.explanation && <span>Base: {r.explanation}</span>}
                    {r.expectedImpact && <span>Impacto esperado: {r.expectedImpact}</span>}
                    <span>{fmtDateTime(r.createdAtMs)}</span>
                    {r.entityType === "workshop" && r.entityId && (
                      <Link to="/connect/estadisticas" className="text-cyan-300 hover:underline">Ver estadísticas del taller</Link>
                    )}
                  </div>
                  {r.rejectionReason && <p className="mt-1 text-[11px] text-slate-500">Motivo del rechazo: {r.rejectionReason}</p>}
                </div>
                {canOperate && r.status === "open" && (
                  <div className="flex shrink-0 items-center gap-1">
                    {rejecting === r.id ? (
                      <>
                        <Input placeholder="Motivo (opcional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="w-44" />
                        <Button variant="danger" disabled={busy}
                          onClick={() => act(() => boFetch(`/oi/recommendations/${r.id}/reject`, { method: "POST", body: { reason: rejectReason } }))}>
                          Confirmar
                        </Button>
                        <Button variant="ghost" onClick={() => setRejecting(null)}>✕</Button>
                      </>
                    ) : (
                      <>
                        <Button disabled={busy} onClick={() => act(() => boFetch(`/oi/recommendations/${r.id}/accept`, { method: "POST" }))}>
                          Aceptar
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(r.id); setRejectReason(""); }}>
                          Rechazar…
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
