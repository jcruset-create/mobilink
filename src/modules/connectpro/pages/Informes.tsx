/**
 * Connect Pro — Informes: informes predefinidos por periodo con vista
 * previa y export CSV (separador ; con BOM, listo para Excel).
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Input, Select, Button, ErrorBanner, EmptyState } from "../components/ui";

type Report = { title: string; columns: string[]; rows: Array<Array<string | number>> };

const KINDS = [
  { id: "actividad", label: "Actividad de asistencias (con tiempos)" },
  { id: "proveedores", label: "Rendimiento de proveedores" },
  { id: "sla", label: "Cumplimiento de SLA" },
  { id: "rechazos", label: "Rechazos de ofertas" },
  { id: "incidencias", label: "Incidencias" },
];

function monthStart(): string { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }
function today(): string { return new Date().toISOString().slice(0, 10); }

export default function Informes() {
  const [kind, setKind] = useState("actividad");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    const f = new Date(`${from}T00:00:00`).getTime();
    const t = new Date(`${to}T23:59:59`).getTime();
    boFetch<Report>(`/reports/${kind}?from=${f}&to=${t}`)
      .then(setReport)
      .catch((e) => { setError(e.message); setReport(null); })
      .finally(() => setLoading(false));
  }, [kind, from, to]);
  useEffect(load, [load]);

  const exportCsv = () => {
    if (!report) return;
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return s.includes(";") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [report.columns.join(";"), ...report.rows.map((r) => r.map(esc).join(";"))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `connect-${kind}_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PageTitle
        title="Informes"
        subtitle="Informes predefinidos del periodo, con vista previa y descarga en CSV."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-500">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button onClick={exportCsv} disabled={!report || report.rows.length === 0}>Descargar CSV</Button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {loading ? (
        <p className="text-sm text-slate-500">Generando informe…</p>
      ) : !report || report.rows.length === 0 ? (
        <EmptyState message="Sin datos en el periodo seleccionado." />
      ) : (
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
            {report.title} · {report.rows.length} fila(s)
          </h2>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              {report.columns.map((c) => <Th key={c}>{c}</Th>)}
            </tr></thead>
            <tbody>
              {report.rows.slice(0, 200).map((r, i) => (
                <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  {r.map((v, j) => <Td key={j} className="max-w-[260px] truncate">{String(v ?? "")}</Td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {report.rows.length > 200 && (
            <p className="border-t border-slate-700 px-4 py-2 text-[12px] text-slate-500">
              Vista previa limitada a 200 filas — el CSV incluye las {report.rows.length}.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
