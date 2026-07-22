/**
 * Connect Pro — Facturación: liquidación del periodo por cliente y por
 * proveedor a partir de los costes (final, o estimado si falta), con
 * export CSV y marca de facturado.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Input, Button, ErrorBanner, EmptyState, KpiCard } from "../components/ui";
import { fmtDateTime } from "../types";

type Summary = {
  totals: { services: number; amount: number; without_final: number; pending_invoice: number };
  by_client: Array<{ name: string; services: number; amount: number; invoiced: number }>;
  by_provider: Array<{ name: string; services: number; amount: number; invoiced: number }>;
};

type Line = {
  id: number; expedientNumber: string | null; externalReference: string | null;
  serviceType: string; createdAtMs: number; clientName: string | null; providerName: string | null;
  customerName: string; estimatedCost: number | null; finalCost: number | null;
  costCurrency: string; invoicedAtMs: number | null;
};

function monthStart(): string {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function eur(v: number | null | undefined): string {
  return v == null ? "—" : `${Number(v).toFixed(2)} €`;
}

export default function Facturacion() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range = useCallback(() => {
    const f = new Date(`${from}T00:00:00`).getTime();
    const t = new Date(`${to}T23:59:59`).getTime();
    return `from=${f}&to=${t}`;
  }, [from, to]);

  const load = useCallback(() => {
    boFetch<Summary>(`/billing/summary?${range()}`).then(setSummary).catch((e) => setError(e.message));
    boFetch<{ data: Line[] }>(`/billing/lines?${range()}`).then((r) => setLines(r.data)).catch(() => {});
  }, [range]);
  useEffect(load, [load]);

  const exportCsv = () => {
    const header = "id;expediente;ref_externa;fecha;cliente;proveedor;cliente_final;servicio;coste_estimado;coste_final;moneda;facturada";
    const rows = lines.map((l) => [
      l.id, l.expedientNumber ?? "", l.externalReference ?? "",
      new Date(Number(l.createdAtMs)).toISOString().slice(0, 10),
      l.clientName ?? "", l.providerName ?? "", l.customerName, l.serviceType,
      l.estimatedCost ?? "", l.finalCost ?? "", l.costCurrency,
      l.invoicedAtMs ? "si" : "no",
    ].join(";"));
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `connect-facturacion_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const marcarFacturado = async () => {
    const pendientes = lines.filter((l) => !l.invoicedAtMs).map((l) => l.id);
    if (pendientes.length === 0) return;
    if (!window.confirm(`Marcar ${pendientes.length} asistencia(s) del periodo como facturadas? (quedará auditado)`)) return;
    setBusy(true);
    try {
      await boFetch("/billing/mark-invoiced", { method: "POST", body: { assistanceIds: pendientes } });
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageTitle
        title="Facturación"
        subtitle="Liquidación del periodo sobre asistencias finalizadas (coste final; estimado si aún no hay final)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-slate-500">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button variant="ghost" onClick={exportCsv} disabled={lines.length === 0}>Exportar CSV</Button>
            <Button onClick={marcarFacturado} disabled={busy || lines.every((l) => l.invoicedAtMs != null)}>
              Marcar periodo facturado
            </Button>
          </div>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Servicios finalizados" value={summary.totals.services} />
          <KpiCard label="Importe del periodo" value={eur(summary.totals.amount)} tone="ok" />
          <KpiCard label="Sin coste final" value={summary.totals.without_final} tone={summary.totals.without_final > 0 ? "warn" : "default"} />
          <KpiCard label="Pendientes de facturar" value={summary.totals.pending_invoice} tone={summary.totals.pending_invoice > 0 ? "warn" : "default"} />
        </div>
      )}

      {summary && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          {([["Por cliente", summary.by_client], ["Por proveedor", summary.by_provider]] as const).map(([title, rows]) => (
            <Card key={title} className="overflow-x-auto">
              <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">{title}</h2>
              <table className="w-full">
                <thead><tr className="border-b border-slate-700"><Th>Nombre</Th><Th>Servicios</Th><Th>Importe</Th><Th>Facturadas</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className="border-b border-slate-700/50">
                      <Td className="font-semibold text-slate-100">{r.name}</Td>
                      <Td>{r.services}</Td>
                      <Td>{eur(r.amount)}</Td>
                      <Td>{r.invoiced}/{r.services}</Td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><Td colSpan={4} className="py-6 text-center">Sin datos en el periodo.</Td></tr>}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState message="No hay asistencias finalizadas en el periodo." />
      ) : (
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Detalle de líneas ({lines.length})</h2>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Asistencia</Th><Th>Fecha</Th><Th>Cliente</Th><Th>Proveedor</Th><Th>Servicio</Th>
              <Th>Estimado</Th><Th>Final</Th><Th>Facturada</Th>
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <Td>
                    <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${l.id}`}>
                      #{l.id}{l.expedientNumber ? ` · ${l.expedientNumber}` : ""}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(l.createdAtMs)}</Td>
                  <Td>{l.clientName ?? "-"}</Td>
                  <Td>{l.providerName ?? "-"}</Td>
                  <Td>{l.serviceType}</Td>
                  <Td>{eur(l.estimatedCost)}</Td>
                  <Td className={l.finalCost == null ? "text-amber-300" : "font-semibold text-slate-100"}>{eur(l.finalCost)}</Td>
                  <Td>
                    {l.invoicedAtMs
                      ? <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Sí</Badge>
                      : <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Pendiente</Badge>}
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
