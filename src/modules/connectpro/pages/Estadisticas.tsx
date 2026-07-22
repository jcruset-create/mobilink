/**
 * Connect Pro — Estadísticas por empresa y taller: volumen, aceptación,
 * tiempos, incidencias y Score Inteligente con desglose y confianza.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, Select, ErrorBanner, EmptyState } from "../components/ui";

type Row = {
  workshopId: number; workshopName: string; providerName: string | null; currentScore: number;
  offered: number; accepted: number; rejected: number; expired: number;
  finished: number; active: number; incidents: number;
  avgAcceptMin: number | null; avgArrivalMin: number | null;
  scoreComponents: string | null; confidence: number | null; tier: string | null; sampleSize: number | null;
};

const TIER_LABELS: Record<string, { label: string; cls: string }> = {
  excelente: { label: "Excelente", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  muy_recomendable: { label: "Muy recomendable", cls: "border-teal-500/40 bg-teal-500/10 text-teal-300" },
  correcto: { label: "Correcto", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  observacion: { label: "En observación", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  bajo_rendimiento: { label: "Bajo rendimiento", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  no_recomendable: { label: "No recomendable", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
};

function fmtMin(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)} min`;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)} %` : "—";
}

export default function Estadisticas() {
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState("90");
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<{ data: Row[] }>(`/stats/providers?days=${days}`).then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [days]);
  useEffect(load, [load]);

  return (
    <div>
      <PageTitle
        title="Estadísticas de proveedores"
        subtitle="Rendimiento por taller: volumen, aceptación, tiempos y Score Inteligente."
        actions={
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
            <option value="180">Últimos 180 días</option>
            <option value="365">Último año</option>
          </Select>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {rows.length === 0 ? (
        <EmptyState message="Sin datos todavía." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Taller</Th><Th>Empresa</Th><Th>Ofertadas</Th><Th>Aceptación</Th><Th>Rechazos</Th>
              <Th>Finalizadas</Th><Th>Activas</Th><Th>T. aceptar</Th><Th>T. llegada</Th><Th>Incid.</Th><Th>Score</Th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const tier = r.tier ? TIER_LABELS[r.tier] : null;
                const comp = r.scoreComponents ? JSON.parse(r.scoreComponents) : null;
                return (
                  <>
                    <tr key={r.workshopId} onClick={() => setOpenId(openId === r.workshopId ? null : r.workshopId)}
                        className="cursor-pointer border-b border-slate-700/50 hover:bg-slate-700/30">
                      <Td className="font-semibold text-slate-100">{r.workshopName}</Td>
                      <Td>{r.providerName ?? "-"}</Td>
                      <Td>{r.offered}</Td>
                      <Td>{pct(r.accepted, r.offered)}</Td>
                      <Td>{r.rejected + r.expired > 0 ? `${r.rejected} + ${r.expired} exp.` : "0"}</Td>
                      <Td>{r.finished}</Td>
                      <Td>{r.active}</Td>
                      <Td>{fmtMin(r.avgAcceptMin)}</Td>
                      <Td>{fmtMin(r.avgArrivalMin)}</Td>
                      <Td className={r.incidents > 0 ? "font-bold text-amber-300" : ""}>{r.incidents}</Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-black text-slate-100">{Math.round(r.currentScore)}</span>
                          {tier && <Badge className={tier.cls}>{tier.label}</Badge>}
                        </div>
                      </Td>
                    </tr>
                    {openId === r.workshopId && comp && (
                      <tr key={`${r.workshopId}-d`} className="border-b border-slate-700/50 bg-slate-900/50">
                        <Td colSpan={11} className="py-3">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 pl-4 text-[12px] text-slate-400">
                            <span>Score bruto: <b className="text-slate-200">{comp.raw}</b></span>
                            <span>Media de la red: <b className="text-slate-200">{comp.networkMean}</b></span>
                            <span>Confianza estadística: <b className="text-slate-200">{Math.round((r.confidence ?? 0) * 100)} %</b> ({r.sampleSize ?? 0} servicios en 90 días)</span>
                            <span>Tasa de aceptación: <b className="text-slate-200">{comp.acceptanceRate != null ? `${Math.round(comp.acceptanceRate * 100)} %` : "sin datos"}</b></span>
                            <span>Tasa de finalización: <b className="text-slate-200">{comp.completionRate != null ? `${Math.round(comp.completionRate * 100)} %` : "sin datos"}</b></span>
                            <span>Incidencias/100: <b className="text-slate-200">{comp.incidentsPer100 != null ? Math.round(comp.incidentsPer100) : "sin datos"}</b></span>
                            <span className="text-slate-500">El score con poca muestra se suaviza hacia la media de la red (bayesiano); ningún taller se bloquea automáticamente.</span>
                          </div>
                        </Td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
