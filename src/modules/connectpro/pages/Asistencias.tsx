/** Connect Pro — Asistencias (listado + timeline; gestión completa en S2/S3). */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Select, ErrorBanner, EmptyState } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Assistance = {
  id: number; uuid: string; partnerName: string | null; workshopName: string | null;
  externalReference: string | null; status: string; priority: string; serviceType: string;
  address: string; customerName: string; assignmentExplanation: string | null;
  origin: string; createdAtMs: number;
};

type TimelineEntry = { fromStatus: string | null; toStatus: string; actorType: string; reason: string | null; occurredAtMs: number };

const ORIGIN_LABELS: Record<string, string> = {
  manual: "Manual", api: "API", partner: "Partner", import: "Importada", reopen: "Reapertura", derived: "Derivada", core: "Mobilink Assist",
};

export default function Asistencias() {
  const [rows, setRows] = useState<Assistance[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  const load = useCallback(() => {
    boFetch<{ data: Assistance[] }>(`/assistances${status ? `?status=${status}` : ""}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [status]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const verTimeline = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    try {
      const r = await boFetch<{ data: TimelineEntry[] }>(`/assistances/${id}/timeline`);
      setTimeline(r.data);
    } catch { setTimeline([]); }
  };

  return (
    <div>
      <PageTitle
        title="Asistencias"
        subtitle="Histórico de asistencias gestionadas por el centro de control."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            {Object.entries(ASSISTANCE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {rows.length === 0 ? (
        <EmptyState message="No hay asistencias con este filtro." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Fecha</Th><Th>Origen</Th><Th>Ref.</Th><Th>Cliente</Th><Th>Dirección</Th><Th>Servicio</Th><Th>Taller</Th><Th>Estado</Th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <>
                  <tr
                    key={a.id}
                    onClick={() => verTimeline(a.id)}
                    className="cursor-pointer border-b border-slate-700/50 hover:bg-slate-700/30"
                    title={a.assignmentExplanation ?? undefined}
                  >
                    <Td className="whitespace-nowrap">{fmtDateTime(a.createdAtMs)}</Td>
                    <Td>{ORIGIN_LABELS[a.origin] ?? a.origin}{a.partnerName ? ` · ${a.partnerName}` : ""}</Td>
                    <Td>{a.externalReference ?? "-"}</Td>
                    <Td className="text-slate-100">
                      {a.customerName}
                      {a.priority === "urgente" && <Badge className="ml-1 border-red-500/40 bg-red-500/10 text-red-300">urgente</Badge>}
                    </Td>
                    <Td className="max-w-[220px] truncate">{a.address}</Td>
                    <Td>{a.serviceType}</Td>
                    <Td>{a.workshopName ?? "-"}</Td>
                    <Td>
                      <Badge className={ASSISTANCE_STATUS_STYLES[a.status] ?? "border-slate-600 text-slate-400"}>
                        {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}
                      </Badge>
                    </Td>
                  </tr>
                  {openId === a.id && (
                    <tr key={`${a.id}-tl`} className="border-b border-slate-700/50 bg-slate-900/50">
                      <Td className="py-3" colSpan={8}>
                        <div className="flex flex-col gap-1 pl-4">
                          {timeline.length === 0 ? (
                            <span className="text-slate-500">Sin historial.</span>
                          ) : timeline.map((t, i) => (
                            <div key={i} className="flex items-center gap-2 text-[12px]">
                              <span className="text-slate-500">{fmtDateTime(t.occurredAtMs)}</span>
                              <Badge className={ASSISTANCE_STATUS_STYLES[t.toStatus] ?? "border-slate-600 text-slate-400"}>
                                {ASSISTANCE_STATUS_LABELS[t.toStatus] ?? t.toStatus}
                              </Badge>
                              <span className="text-slate-500">({t.actorType})</span>
                              {t.reason && <span className="text-slate-400">— {t.reason}</span>}
                            </div>
                          ))}
                        </div>
                      </Td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
