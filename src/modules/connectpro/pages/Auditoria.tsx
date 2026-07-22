/** Connect Pro — Auditoría (consulta de connect_audit_logs). */

import { useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, ErrorBanner, EmptyState } from "../components/ui";
import { fmtDateTime } from "../types";

type AuditRow = {
  id: number; actorType: string; actorName: string | null; action: string;
  resourceType: string | null; resourceId: string | null; detail: string | null; createdAtMs: number;
};

export default function Auditoria() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boFetch<{ data: AuditRow[] }>("/audit?limit=200").then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageTitle title="Auditoría" subtitle="Registro inmutable de acciones en Connect Pro (últimas 200)." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {rows.length === 0 ? (
        <EmptyState message="Sin registros de auditoría todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Fecha</Th><Th>Actor</Th><Th>Acción</Th><Th>Recurso</Th><Th>Detalle</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-700/50">
                  <Td className="whitespace-nowrap">{fmtDateTime(r.createdAtMs)}</Td>
                  <Td>{r.actorName ?? r.actorType}</Td>
                  <Td className="font-mono text-[12px] text-cyan-300">{r.action}</Td>
                  <Td>{r.resourceType ? `${r.resourceType} #${r.resourceId}` : "-"}</Td>
                  <Td className="max-w-[320px] truncate font-mono text-[11px] text-slate-500">{r.detail ?? "-"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
