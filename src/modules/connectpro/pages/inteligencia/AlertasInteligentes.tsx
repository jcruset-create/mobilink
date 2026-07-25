/**
 * Centro de Inteligencia Operacional — Alertas inteligentes.
 *
 * Ciclo de vida completo de cada alerta: reconocer, comentar, asignar y
 * resolver, con nivel de escalado y fecha límite visibles.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, Check, MessageSquare, RefreshCw, ShieldAlert } from "lucide-react";
import { Card, ErrorBanner, Select, Badge, Button, EmptyState } from "../../components/ui";
import { useConnectAuth, hasRole } from "../../contexts/ConnectAuthContext";
import { oiFetch, fmtDateTime, type OperationalAlert } from "../../services/oiApi";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-red-500/60 bg-red-500/15 text-red-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  low: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Crítica", high: "Alta", medium: "Media", low: "Baja",
};

const CATEGORY_LABELS: Record<string, string> = {
  operational: "Operacional", quality: "Calidad", economic: "Económica",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Abierta", acknowledged: "Reconocida", resolved: "Resuelta", expired: "Caducada",
};

export default function AlertasInteligentes() {
  const { user } = useConnectAuth();
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [counts, setCounts] = useState<Array<{ category: string; severity: string; n: number }>>([]);
  const [status, setStatus] = useState("open");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canAct = hasRole(user, "operator");

  const load = useCallback(() => {
    const p = new URLSearchParams({ status });
    if (category) p.set("category", category);
    oiFetch<{ data: OperationalAlert[]; counts: typeof counts }>(`/alerts?${p.toString()}`)
      .then((r) => { setAlerts(r.data); setCounts(r.counts); })
      .catch((e) => setError(e.message));
  }, [status, category]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(id: number, action: "acknowledge" | "resolve" | "comment") {
    if (busy) return;
    let body: Record<string, unknown> = {};
    if (action === "resolve") {
      const resolution = window.prompt("¿Cómo se ha resuelto la alerta?");
      if (!resolution) return;
      body = { resolution };
    }
    if (action === "comment") {
      const text = window.prompt("Comentario:");
      if (!text) return;
      body = { text };
    }
    setBusy(true);
    try {
      await oiFetch(`/alerts/${id}/${action}`, { method: "POST", body });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const bySeverity = (sev: string) => counts.filter((c) => c.severity === sev).reduce((s, c) => s + c.n, 0);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((sev) => (
          <div key={sev} className={`rounded-xl border p-3 ${SEVERITY_STYLES[sev]}`}>
            <div className="text-[11px] uppercase tracking-wide opacity-80">{SEVERITY_LABELS[sev]}</div>
            <div className="text-2xl font-black">{bySeverity(sev)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Abiertas</option>
          <option value="acknowledged">Reconocidas</option>
          <option value="resolved">Resueltas</option>
          <option value="all">Todas</option>
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas las categorías</option>
          <option value="operational">Operacionales</option>
          <option value="quality">Calidad</option>
          <option value="economic">Económicas</option>
        </Select>
        {hasRole(user, "supervisor") && (
          <Button variant="ghost" onClick={async () => { setBusy(true); await oiFetch("/alerts/refresh", { method: "POST" }).catch((e) => setError(e.message)); setBusy(false); load(); }} disabled={busy}>
            <span className="flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Revisar ahora</span>
          </Button>
        )}
      </div>

      {alerts.length === 0 ? (
        <EmptyState message="No hay alertas con esos criterios. La operación está bajo control." />
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <Card key={a.id} className="p-3">
              <div className="flex items-start gap-3">
                {a.severity === "critical"
                  ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  : <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SEVERITY_STYLES[a.severity]}>{SEVERITY_LABELS[a.severity]}</Badge>
                    <span className="text-[11px] text-slate-500">{CATEGORY_LABELS[a.category]} · {a.alertType}</span>
                    <Badge className="border-slate-600 bg-slate-700/40 text-slate-300">{STATUS_LABELS[a.status]}</Badge>
                    {a.escalationLevel > 0 && (
                      <Badge className="border-red-500/50 bg-red-500/10 text-red-300">Escalado nivel {a.escalationLevel}</Badge>
                    )}
                  </div>
                  <h3 className="mt-1 text-[14px] font-bold text-slate-100">{a.title}</h3>
                  {a.description && <p className="mt-0.5 text-[13px] text-slate-300">{a.description}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                    <span>Detectada: {fmtDateTime(a.detectedAtMs)}</span>
                    {a.dueAtMs && <span>Límite: {fmtDateTime(a.dueAtMs)}</span>}
                    {a.assignedUserName && <span>Responsable: {a.assignedUserName}</span>}
                    {a.acknowledgedBy && <span>Reconocida por {a.acknowledgedBy}</span>}
                    {a.resolvedBy && <span>Resuelta por {a.resolvedBy}: {a.resolution}</span>}
                  </div>
                  {a.comments?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 border-l-2 border-slate-700 pl-2 text-[12px] text-slate-400">
                      {a.comments.map((c, i) => (
                        <li key={i}><b className="text-slate-300">{c.by}:</b> {c.text} <span className="text-slate-600">({fmtDateTime(c.atMs)})</span></li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-1.5">
                  {a.entityType === "assistance" && a.entityId && (
                    <Button variant="ghost" onClick={() => navigate(`/connect/asistencias/${a.entityId}`)}>Ver servicio</Button>
                  )}
                  {canAct && a.status === "open" && (
                    <Button variant="ghost" onClick={() => act(a.id, "acknowledge")} disabled={busy}>Reconocer</Button>
                  )}
                  {canAct && (a.status === "open" || a.status === "acknowledged") && (
                    <>
                      <Button onClick={() => act(a.id, "resolve")} disabled={busy}>
                        <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Resolver</span>
                      </Button>
                      <Button variant="ghost" onClick={() => act(a.id, "comment")} disabled={busy}>
                        <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> Comentar</span>
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Las alertas sin reconocer suben de nivel automáticamente al vencer su plazo, y las de un servicio ya finalizado
        o cancelado se cierran solas dejando constancia.
      </p>
    </div>
  );
}
