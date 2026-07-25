/**
 * Centro de Inteligencia Operacional — Recomendaciones de IA.
 *
 * Cada recomendación se muestra con su explicación completa (qué se ha
 * detectado, con qué datos, qué factores pesan, qué confianza tiene y qué
 * alternativas hay) y con los botones de aceptar o rechazar, que quedan
 * registrados como feedback para medir la precisión del motor.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Check, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { Card, ErrorBanner, Select, Badge, Button, EmptyState, Th, Td } from "../../components/ui";
import { useConnectAuth, hasRole } from "../../contexts/ConnectAuthContext";
import { oiFetch, PRIORITY_STYLES, fmtDateTime, type Recommendation } from "../../services/oiApi";

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Media", low: "Baja",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente", accepted: "Aceptada", rejected: "Rechazada", expired: "Caducada",
};

type Stats = {
  type: string; total: number; accepted: number; rejected: number; expired: number;
  acceptanceRate: number | null; estimatedImpact: number; impactUnit: string | null;
};

export default function Recomendaciones() {
  const { user } = useConnectAuth();
  const [data, setData] = useState<Recommendation[]>([]);
  const [stats, setStats] = useState<Stats[]>([]);
  const [status, setStatus] = useState("pending");
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canDecide = hasRole(user, "operator");

  const load = useCallback(() => {
    oiFetch<{ data: Recommendation[]; stats: Stats[] }>(`/recommendations?status=${status}`)
      .then((r) => { setData(r.data); setStats(r.stats); })
      .catch((e) => setError(e.message));
  }, [status]);

  useEffect(load, [load]);

  async function decide(rec: Recommendation, accept: boolean) {
    if (busy) return;
    const reason = accept ? null : window.prompt("Motivo del rechazo (opcional):") ?? "";
    setBusy(true);
    try {
      await oiFetch(`/recommendations/${rec.id}/${accept ? "accept" : "reject"}`, {
        method: "POST",
        body: accept ? {} : { reason },
      });
      load();
      if (accept && rec.proposedAction?.link) navigate(rec.proposedAction.link);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await oiFetch("/recommendations/refresh", { method: "POST" });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-400">
          La IA propone, la persona decide: aceptar una recomendación registra la decisión y abre la pantalla donde ejecutarla.
        </p>
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pendientes</option>
            <option value="accepted">Aceptadas</option>
            <option value="rejected">Rechazadas</option>
            <option value="expired">Caducadas</option>
            <option value="all">Todas</option>
          </Select>
          {hasRole(user, "supervisor") && (
            <Button variant="ghost" onClick={refresh} disabled={busy}>
              <span className="flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Recalcular</span>
            </Button>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState message="No hay recomendaciones con ese estado." />
      ) : (
        <div className="space-y-2">
          {data.map((r) => {
            const open = openId === r.id;
            return (
              <Card key={r.id} className="p-3">
                <div className="flex items-start gap-3">
                  <Brain className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={PRIORITY_STYLES[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>
                      <span className="text-[11px] text-slate-500">{r.recommendationType}</span>
                      {r.status !== "pending" && (
                        <Badge className="border-slate-600 bg-slate-700/40 text-slate-300">{STATUS_LABELS[r.status]}</Badge>
                      )}
                      <span className="text-[11px] text-slate-600">{fmtDateTime(r.createdAtMs)}</span>
                    </div>
                    <h3 className="mt-1 text-[14px] font-bold text-slate-100">{r.title}</h3>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate-300">{r.description}</p>
                    {r.expectedImpact && (
                      <p className="mt-1 text-[12px] text-emerald-300">Impacto estimado: {r.expectedImpact}</p>
                    )}

                    <button
                      onClick={() => setOpenId(open ? null : r.id)}
                      className="mt-2 flex items-center gap-1 text-[12px] text-cyan-400 hover:text-cyan-300"
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Por qué se recomienda
                    </button>

                    {open && (
                      <div className="mt-2 space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-[12px]">
                        <p className="text-slate-300"><b>Detectado:</b> {r.explanation.detected}</p>
                        <div>
                          <b className="text-slate-300">Factores principales:</b>
                          <ul className="mt-0.5 space-y-0.5 text-slate-400">
                            {r.explanation.factors.map((f, i) => <li key={i}>· <b className="text-slate-300">{f.name}:</b> {f.detail}</li>)}
                          </ul>
                        </div>
                        <p className="text-slate-400"><b className="text-slate-300">Datos utilizados:</b> {r.explanation.dataUsed.join(" · ")}</p>
                        <p className="text-slate-400"><b className="text-slate-300">Confianza del modelo:</b> {Math.round((r.explanation.confidence ?? 0) * 100)} %</p>
                        {r.explanation.alternatives?.length ? (
                          <div>
                            <b className="text-slate-300">Alternativas:</b>
                            <ul className="mt-0.5 space-y-0.5 text-slate-400">
                              {r.explanation.alternatives.map((a, i) => <li key={i}>· {a}</li>)}
                            </ul>
                          </div>
                        ) : null}
                        {r.rejectionReason && <p className="text-amber-300">Motivo del rechazo: {r.rejectionReason}</p>}
                      </div>
                    )}
                  </div>

                  {r.status === "pending" && canDecide && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button onClick={() => decide(r, true)} disabled={busy}>
                        <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> {r.proposedAction?.label ?? "Aceptar"}</span>
                      </Button>
                      <Button variant="ghost" onClick={() => decide(r, false)} disabled={busy}>
                        <span className="flex items-center gap-1"><X className="h-3.5 w-3.5" /> Descartar</span>
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {stats.length > 0 && (
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-700 px-3 py-2 text-sm font-black text-slate-100">
            Aceptación e impacto (últimos 30 días)
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Tipo</Th><Th>Generadas</Th><Th>Aceptadas</Th><Th>Rechazadas</Th><Th>Caducadas</Th>
              <Th>Tasa de aceptación</Th><Th>Impacto estimado</Th>
            </tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.type} className="border-b border-slate-700/50">
                  <Td className="text-slate-200">{s.type}</Td>
                  <Td>{s.total}</Td>
                  <Td>{s.accepted}</Td>
                  <Td>{s.rejected}</Td>
                  <Td>{s.expired}</Td>
                  <Td>{s.acceptanceRate == null ? "—" : `${s.acceptanceRate} %`}</Td>
                  <Td>{s.estimatedImpact} {s.impactUnit ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-700 px-3 py-2 text-[11px] text-slate-500">
            La automatización de una familia de recomendaciones solo debe habilitarse cuando su tasa de aceptación e
            impacto real sostenidos lo justifiquen.
          </p>
        </Card>
      )}
    </div>
  );
}
