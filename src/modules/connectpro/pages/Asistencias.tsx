/** Connect Pro — Asistencias (listado + timeline; gestión completa en S2/S3). */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Select, ErrorBanner, EmptyState } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

type Assistance = {
  id: number; uuid: string; partnerName: string | null; workshopName: string | null;
  externalReference: string | null; status: string; priority: string; serviceType: string;
  address: string; customerName: string; assignmentExplanation: string | null;
  origin: string; createdAtMs: number;
};

const ORIGIN_LABELS: Record<string, string> = {
  manual: "Manual", api: "API", partner: "Partner", import: "Importada", reopen: "Reapertura", derived: "Derivada", core: "Mobilink Assist",
};

export default function Asistencias() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Assistance[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<{ data: Assistance[] }>(`/assistances${status ? `?status=${status}` : ""}`)
      .then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [status]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

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
                  <tr
                    key={a.id}
                    onClick={() => navigate(`/connect/asistencias/${a.id}`)}
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
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
