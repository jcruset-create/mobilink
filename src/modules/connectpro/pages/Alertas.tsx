/** Connect Pro — SLA y alertas: historial completo de alertas del centro. */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { useConnectEvents } from "../services/events";
import { PageTitle, Card, Th, Td, Badge, Button, ErrorBanner, EmptyState, Select } from "../components/ui";
import { fmtDateTime } from "../types";

type Alert = {
  id: number; type: string; severity: string; title: string; body: string | null;
  assistanceId: number | null; incidentId: number | null; status: string;
  createdAtMs: number; readAtMs: number | null;
};

const TYPE_LABELS: Record<string, string> = {
  assignment_failed: "Sin proveedor",
  no_coverage: "Sin cobertura",
  offer_expired: "Oferta expirada",
  sla_risk: "SLA en riesgo",
  sla_breached: "SLA incumplido",
  incident_critical: "Incidencia crítica",
  webhook_dead: "Webhook caído",
};

const SEV: Record<string, { label: string; cls: string }> = {
  info: { label: "Info", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  warning: { label: "Aviso", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  critical: { label: "Crítica", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
};

export default function Alertas() {
  const [rows, setRows] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<{ data: Alert[]; unread: number }>(`/alerts?limit=200${onlyUnread === "unread" ? "&unread=true" : ""}`)
      .then((r) => { setRows(r.data); setUnread(r.unread); })
      .catch((e) => setError(e.message));
  }, [onlyUnread]);
  useEffect(load, [load]);
  useConnectEvents((p) => { if (p.kind === "alert") load(); });

  return (
    <div>
      <PageTitle
        title="SLA y alertas"
        subtitle={`Alertas automáticas del centro de control · ${unread} sin leer`}
        actions={
          <div className="flex gap-2">
            <Select value={onlyUnread} onChange={(e) => setOnlyUnread(e.target.value)}>
              <option value="all">Todas</option>
              <option value="unread">Solo no leídas</option>
            </Select>
            {unread > 0 && (
              <Button variant="ghost" onClick={() => boFetch("/alerts/read-all", { method: "POST" }).then(load)}>
                Marcar todas leídas
              </Button>
            )}
          </div>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {rows.length === 0 ? (
        <EmptyState message="No hay alertas." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Fecha</Th><Th>Tipo</Th><Th>Gravedad</Th><Th>Alerta</Th><Th>Asistencia</Th><Th>Estado</Th>
            </tr></thead>
            <tbody>
              {rows.map((a) => {
                const sev = SEV[a.severity] ?? SEV.warning;
                return (
                  <tr key={a.id} className={`border-b border-slate-700/50 ${a.status === "unread" ? "bg-slate-700/15" : ""}`}>
                    <Td className="whitespace-nowrap">{fmtDateTime(a.createdAtMs)}</Td>
                    <Td>{TYPE_LABELS[a.type] ?? a.type}</Td>
                    <Td><Badge className={sev.cls}>{sev.label}</Badge></Td>
                    <Td className={a.status === "unread" ? "font-semibold text-slate-100" : ""}>
                      {a.title}
                      {a.body && <div className="text-[11px] text-slate-500">{a.body}</div>}
                    </Td>
                    <Td>
                      {a.assistanceId
                        ? <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${a.assistanceId}`}
                            onClick={() => a.status === "unread" && boFetch(`/alerts/${a.id}/read`, { method: "POST" })}>
                            #{a.assistanceId}
                          </Link>
                        : "-"}
                    </Td>
                    <Td>
                      {a.status === "unread" ? (
                        <Button variant="ghost" onClick={() => boFetch(`/alerts/${a.id}/read`, { method: "POST" }).then(load)}>
                          Marcar leída
                        </Button>
                      ) : (
                        <span className="text-[11px] text-slate-600">Leída {fmtDateTime(a.readAtMs)}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
