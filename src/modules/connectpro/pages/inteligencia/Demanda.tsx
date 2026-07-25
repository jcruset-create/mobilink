/**
 * Centro de Inteligencia Operacional — Demanda y predicciones.
 *
 * Previsión por zona y franja horaria con intervalo de confianza, comparación
 * con la media histórica, recursos recomendados y estado de cobertura.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, ErrorBanner, Select, Th, Td, Badge, EmptyState } from "../../components/ui";
import { BarChart } from "../../components/oi/TrendChart";
import {
  oiFetch, fmtTime, type CoverageZone, type DemandSlot,
} from "../../services/oiApi";

const ZONE_STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "Suficiente", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  tight: { label: "Ajustada", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  deficit: { label: "Déficit", cls: "border-red-500/50 bg-red-500/10 text-red-300" },
};

export default function Demanda() {
  const [slots, setSlots] = useState<DemandSlot[]>([]);
  const [coverage, setCoverage] = useState<CoverageZone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [hours, setHours] = useState("12");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ hours });
    if (zoneId) p.set("zoneId", zoneId);
    if (serviceType) p.set("serviceType", serviceType);
    Promise.all([
      oiFetch<{ data: DemandSlot[] }>(`/predictions/demand?${p.toString()}`),
      oiFetch<{ coverage: CoverageZone[] }>("/resource-availability"),
    ])
      .then(([d, c]) => { setSlots(d.data); setCoverage(c.coverage); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hours, zoneId, serviceType]);

  useEffect(load, [load]);

  const zones = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of slots) map.set(s.zoneId, s.zoneLabel);
    for (const c of coverage) map.set(c.zoneId, c.label);
    return [...map.entries()];
  }, [slots, coverage]);

  // Serie agregada de todas las zonas visibles, por franja horaria
  const byHour = useMemo(() => {
    const acc = new Map<number, { predicted: number; min: number; max: number }>();
    for (const s of slots) {
      const e = acc.get(s.targetAtMs) ?? { predicted: 0, min: 0, max: 0 };
      e.predicted += s.predicted; e.min += s.confidenceMin; e.max += s.confidenceMax;
      acc.set(s.targetAtMs, e);
    }
    return [...acc.entries()].sort((a, b) => a[0] - b[0]);
  }, [slots]);

  const topSlots = useMemo(
    () => [...slots].sort((a, b) => b.predicted - a.predicted).slice(0, 20),
    [slots],
  );

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="6">Próximas 6 horas</option>
          <option value="12">Próximas 12 horas</option>
          <option value="24">Próximas 24 horas</option>
          <option value="48">Próximas 48 horas</option>
        </Select>
        <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">Todas las zonas</option>
          {zones.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
        <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option value="">Todos los tipos de servicio</option>
          {["tow_truck", "mechanical", "tyres", "battery", "fuel", "lockout", "electric_vehicle", "heavy_vehicle", "machinery", "other"]
            .map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <Card className="p-4">
        <h3 className="mb-1 text-sm font-black text-slate-100">Demanda prevista por franja</h3>
        <p className="mb-3 text-[12px] text-slate-500">
          Media estacional de la misma franja y día de la semana sobre 90 días de histórico, con intervalo de confianza del 80 %.
        </p>
        {loading ? (
          <div className="text-sm text-slate-400">Calculando previsión…</div>
        ) : (
          <BarChart
            labels={byHour.map(([t]) => fmtTime(t))}
            values={byHour.map(([, v]) => Math.round(v.predicted * 10) / 10)}
            emptyMessage="Sin histórico suficiente para prever la demanda."
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <div className="border-b border-slate-700 px-3 py-2 text-sm font-black text-slate-100">
            Franjas con mayor demanda prevista
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Zona</Th><Th>Franja</Th><Th>Previstas</Th><Th>IC 80 %</Th><Th>vs. media</Th><Th>Confianza</Th><Th>Unidades</Th>
            </tr></thead>
            <tbody>
              {topSlots.map((s) => (
                <tr key={`${s.zoneId}-${s.targetAtMs}`} className="border-b border-slate-700/50" title={s.factors.join(" · ")}>
                  <Td className="text-slate-200">{s.zoneLabel}</Td>
                  <Td>{fmtTime(s.targetAtMs)}</Td>
                  <Td className="font-semibold text-slate-100">{s.predicted}</Td>
                  <Td className="text-[11px] text-slate-400">{s.confidenceMin} – {s.confidenceMax}</Td>
                  <Td className={s.vsAveragePct != null && s.vsAveragePct > 20 ? "font-bold text-amber-300" : ""}>
                    {s.vsAveragePct == null ? "—" : `${s.vsAveragePct} %`}
                  </Td>
                  <Td>{Math.round(s.confidenceScore * 100)} %</Td>
                  <Td>{s.recommendedUnits}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {topSlots.length === 0 && !loading && <EmptyState message="Todavía no hay histórico geolocalizado suficiente." />}
        </Card>

        <Card className="overflow-x-auto">
          <div className="border-b border-slate-700 px-3 py-2 text-sm font-black text-slate-100">
            Cobertura por zona (próximas 3 horas)
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Zona</Th><Th>Activos</Th><Th>Unidades disp.</Th><Th>Demanda 3 h</Th><Th>Capacidad 3 h</Th><Th>Estado</Th>
            </tr></thead>
            <tbody>
              {coverage.map((z) => (
                <tr key={z.zoneId} className="border-b border-slate-700/50">
                  <Td className="text-slate-200">{z.label}</Td>
                  <Td>{z.active}</Td>
                  <Td>{z.availableUnits}</Td>
                  <Td>{z.demand3h}</Td>
                  <Td>{z.capacity3h}</Td>
                  <Td><Badge className={ZONE_STATUS[z.status].cls}>{ZONE_STATUS[z.status].label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {coverage.length === 0 && <EmptyState message="Sin zonas configuradas." />}
          <p className="border-t border-slate-700 px-3 py-2 text-[11px] text-slate-500">
            Capacidad estimada: 1,5 servicios por hora y unidad disponible. Las zonas se derivan del taller más cercano.
          </p>
        </Card>
      </div>

      {slots.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-black text-slate-100">Variables que utiliza el modelo</h3>
          <ul className="grid gap-1 text-[12px] text-slate-400 sm:grid-cols-2">
            {[...new Set(slots.flatMap((s) => s.factors))].map((f) => <li key={f}>· {f}</li>)}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">
            Pendiente de incorporar cuando existan las fuentes: meteorología, tráfico, festivos, operaciones salida/retorno
            y campañas de aseguradoras. Mientras tanto el modelo solo usa el histórico real de asistencias.
          </p>
        </Card>
      )}
    </div>
  );
}
