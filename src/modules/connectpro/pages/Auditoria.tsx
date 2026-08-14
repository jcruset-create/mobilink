/**
 * Connect Pro — Auditoría.
 *
 * Dos vistas que responden preguntas distintas:
 *
 *  - **Acciones**: el registro inmutable de quién hizo qué.
 *  - **Económica**: cuánto dinero se ha apartado de lo que dice la tarifa,
 *    quién lo ha apartado y con qué motivo. Es la que mira un director.
 */

import { useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, ErrorBanner, EmptyState } from "../components/ui";
import AuditoriaEconomica from "../components/AuditoriaEconomica";
import { fmtDateTime } from "../types";

type AuditRow = {
  id: number; actorType: string; actorName: string | null; action: string;
  resourceType: string | null; resourceId: string | null; detail: string | null; createdAtMs: number;
};

export default function Auditoria() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<"acciones" | "economica">("acciones");

  useEffect(() => {
    boFetch<{ data: AuditRow[] }>("/audit?limit=200").then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageTitle
        title="Auditoría"
        subtitle={vista === "acciones"
          ? "Registro inmutable de acciones en Connect Pro (últimas 200)."
          : "Importes ajustados a mano: cuánto se ha apartado de la tarifa, quién y por qué."}
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="mb-4 flex gap-1">
        {([["acciones", "Acciones"], ["economica", "Económica"]] as const).map(([v, t]) => (
          <button
            key={v}
            type="button"
            onClick={() => setVista(v)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
              vista === v ? "bg-cyan-600/20 text-cyan-300" : "text-slate-400 hover:bg-slate-800"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {vista === "economica" && <AuditoriaEconomica />}

      {vista === "acciones" && (rows.length === 0 ? (
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
      ))}
    </div>
  );
}
