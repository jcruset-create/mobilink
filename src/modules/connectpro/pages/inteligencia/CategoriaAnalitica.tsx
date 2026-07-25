/**
 * Centro de Inteligencia Operacional — vista analítica por categoría.
 *
 * Los apartados de proveedores, flota, calidad y economía comparten estructura:
 * los KPIs de su categoría con semáforo y el detalle tabular correspondiente,
 * exportable. Se factoriza aquí para que las cuatro pantallas se mantengan
 * coherentes y cualquier mejora las alcance a todas.
 */

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Card, ErrorBanner, Th, Td, EmptyState, Button } from "../../components/ui";
import { KpiGrid } from "../../components/oi/KpiTile";
import { PeriodPicker, filtersToQuery, useOiFilters } from "./IntelligenceLayout";
import { oiDownloadCsv, oiFetch, type KpiCard, type ReportOutput } from "../../services/oiApi";

export default function CategoriaAnalitica({
  category, reportKind, title, description, extraCategories = [],
}: {
  category: string;
  reportKind: string;
  title: string;
  description: string;
  /** Categorías adicionales del catálogo cuyos KPIs también son relevantes aquí. */
  extraCategories?: string[];
}) {
  const { filters } = useOiFilters();
  const [kpis, setKpis] = useState<KpiCard[]>([]);
  const [report, setReport] = useState<ReportOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = filtersToQuery(filters);
    Promise.all([
      Promise.all([category, ...extraCategories].map((c) =>
        oiFetch<{ data: KpiCard[] }>(`/kpis?category=${c}&${q}`).then((r) => r.data))),
      oiFetch<ReportOutput>("/reports/generate", {
        method: "POST",
        body: { kind: reportKind, from: filters.from, to: filters.to },
      }),
    ])
      .then(([kpiGroups, rep]) => { setKpis(kpiGroups.flat()); setReport(rep); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // extraCategories es una constante literal en cada pantalla
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, category, reportKind]);

  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-slate-100">{title}</h2>
          <p className="text-[12px] text-slate-400">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker />
          <Button variant="ghost" onClick={() => oiDownloadCsv(reportKind, { from: filters.from, to: filters.to }).catch((e) => setError(e.message))}>
            <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5" /> CSV</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Calculando…</div>
      ) : (
        <>
          <KpiGrid kpis={kpis} />

          <Card className="overflow-x-auto">
            {report && (
              <div className="border-b border-slate-700 px-3 py-2">
                <div className="text-sm font-black text-slate-100">{report.title}</div>
                {report.subtitle && <div className="text-[11px] text-slate-500">{report.subtitle}</div>}
              </div>
            )}
            {report && report.rows.length > 0 ? (
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">{report.columns.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      {row.map((cell, j) => (
                        <Td key={j} className={j === 0 ? "font-semibold text-slate-100" : ""}>{cell ?? "—"}</Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState message="Sin datos en el periodo seleccionado." />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
