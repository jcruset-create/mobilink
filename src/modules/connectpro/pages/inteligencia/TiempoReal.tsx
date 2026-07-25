/**
 * Centro de Inteligencia Operacional — Operación en tiempo real.
 *
 * Supervisión de toda la operación activa: servicios por estado con su riesgo,
 * unidades móviles, mapa operacional y filtros. Se refresca cada 30 segundos.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, MapPin, RefreshCw, SatelliteDish } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { Card, ErrorBanner, Select, Th, Td, Badge, EmptyState } from "../../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES } from "../../types";
import {
  oiFetch, RISK_LABELS, RISK_STYLES, fmtTime, type LiveService, type LiveUnit,
} from "../../services/oiApi";

type LiveResponse = {
  generatedAtMs: number;
  services: LiveService[];
  units: LiveUnit[];
  zones: Array<{ zoneId: string; label: string; active: number; availableUnits: number; ratio: number }>;
};

const UNIT_COLORS: Record<string, string> = {
  available: "#34d399", at_base: "#22d3ee", en_route_to_assistance: "#a78bfa", working: "#fbbf24",
  assigned: "#818cf8", out_of_service: "#f87171", breakdown: "#f87171", no_connection: "#94a3b8",
};

const SERVICE_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#fb923c", medium: "#fbbf24", low: "#38bdf8",
};

export default function TiempoReal() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [priority, setPriority] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (serviceType) p.set("serviceType", serviceType);
    if (priority) p.set("priority", priority);
    oiFetch<LiveResponse>(`/live-operation?${p.toString()}`).then(setData).catch((e) => setError(e.message));
  }, [status, serviceType, priority]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const services = useMemo(
    () => (data?.services ?? []).filter((s) => !riskOnly || (s.risk && (s.risk.level === "high" || s.risk.level === "critical"))),
    [data, riskOnly],
  );

  const counters = useMemo(() => {
    const all = data?.services ?? [];
    return {
      pending: all.filter((s) => ["pending", "searching"].includes(s.status)).length,
      awaiting: all.filter((s) => s.status === "awaiting_acceptance").length,
      assigned: all.filter((s) => ["assigned", "technician_assigned"].includes(s.status)).length,
      enRoute: all.filter((s) => s.status === "en_route").length,
      working: all.filter((s) => ["arrived", "in_progress"].includes(s.status)).length,
      atRisk: all.filter((s) => s.risk && (s.risk.level === "high" || s.risk.level === "critical")).length,
      noGps: all.filter((s) => s.gpsStale).length,
    };
  }, [data]);

  const center = useMemo<[number, number]>(() => {
    const pts = (data?.services ?? []).filter((s) => s.latitude != null && s.longitude != null);
    if (!pts.length) return [41.118, 1.245];
    return [
      pts.reduce((s, p) => s + Number(p.latitude), 0) / pts.length,
      pts.reduce((s, p) => s + Number(p.longitude), 0) / pts.length,
    ];
  }, [data]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Pendientes", counters.pending, "border-amber-500/40 bg-amber-500/10"],
          ["Esperando aceptación", counters.awaiting, "border-fuchsia-500/40 bg-fuchsia-500/10"],
          ["Asignados", counters.assigned, "border-blue-500/40 bg-blue-500/10"],
          ["En desplazamiento", counters.enRoute, "border-violet-500/40 bg-violet-500/10"],
          ["En ejecución", counters.working, "border-teal-500/40 bg-teal-500/10"],
          ["Riesgo alto/crítico", counters.atRisk, "border-red-500/50 bg-red-500/10"],
          ["Sin GPS reciente", counters.noGps, "border-slate-600 bg-slate-800"],
        ].map(([label, value, cls]) => (
          <div key={String(label)} className={`rounded-xl border p-3 ${cls}`}>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-0.5 text-2xl font-black text-slate-100">{value as number}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ASSISTANCE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
          <option value="">Todos los servicios</option>
          {["tow_truck", "mechanical", "tyres", "battery", "fuel", "lockout", "electric_vehicle", "heavy_vehicle", "machinery", "other"]
            .map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Cualquier prioridad</option>
          <option value="normal">Normal</option>
          <option value="urgente">Urgente</option>
        </Select>
        <label className="flex items-center gap-1.5 text-[12px] text-slate-300">
          <input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
          Solo servicios en riesgo
        </label>
        <button onClick={load} className="flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1.5 text-[12px] text-slate-300 hover:bg-slate-700">
          <RefreshCw className="h-3.5 w-3.5" /> Actualizar
        </button>
        {data && <span className="text-[11px] text-slate-500">{fmtTime(data.generatedAtMs)}</span>}
      </div>

      <Card className="overflow-hidden">
        <MapContainer center={center} zoom={9} style={{ height: 380, width: "100%" }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {services.filter((s) => s.latitude != null && s.longitude != null).map((s) => (
            <CircleMarker
              key={`s${s.id}`}
              center={[Number(s.latitude), Number(s.longitude)]}
              radius={s.risk && (s.risk.level === "critical" || s.risk.level === "high") ? 11 : 8}
              pathOptions={{ color: SERVICE_COLORS[s.risk?.level ?? "low"], fillOpacity: 0.7 }}
            >
              <Popup>
                <div className="text-[12px]">
                  <b>Asistencia #{s.id}</b> · {ASSISTANCE_STATUS_LABELS[s.status] ?? s.status}<br />
                  {s.address}<br />
                  {s.workshop && <>Proveedor: {s.workshop}<br /></>}
                  {s.risk && <>Riesgo: {RISK_LABELS[s.risk.level]} ({Math.round(s.risk.score * 100)} %)<br /></>}
                  <button className="mt-1 underline" onClick={() => navigate(`/connect/asistencias/${s.id}`)}>Abrir ficha</button>
                </div>
              </Popup>
            </CircleMarker>
          ))}
          {(data?.units ?? []).filter((u) => u.latitude != null && u.longitude != null).map((u) => (
            <CircleMarker
              key={`u${u.id}`}
              center={[Number(u.latitude), Number(u.longitude)]}
              radius={6}
              pathOptions={{ color: UNIT_COLORS[u.status] ?? "#94a3b8", fillOpacity: 0.9, weight: 3 }}
            >
              <Popup>
                <div className="text-[12px]">
                  <b>{u.name}</b> {u.plate ? `(${u.plate})` : ""}<br />
                  Estado: {u.status}<br />
                  Último reporte: {fmtTime(u.lastReportAtMs)}
                  {u.activeAssistanceId && <><br />Servicio #{u.activeAssistanceId}</>}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
        <div className="flex flex-wrap gap-3 border-t border-slate-700 px-3 py-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Servicio crítico</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> Riesgo alto</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Riesgo medio</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Riesgo bajo</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-400" /> Unidad disponible</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-violet-400" /> Unidad en desplazamiento</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border-2 border-slate-400" /> Sin conexión</span>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-slate-700">
            <Th>Servicio</Th><Th>Estado</Th><Th>Espera</Th><Th>Proveedor</Th><Th>Unidad</Th>
            <Th>ETA</Th><Th>SLA</Th><Th>Riesgo</Th><Th>Motivo</Th>
          </tr></thead>
          <tbody>
            {services.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/connect/asistencias/${s.id}`)}
                className="cursor-pointer border-b border-slate-700/50 hover:bg-slate-700/30"
              >
                <Td className="font-semibold text-slate-100">
                  #{s.id}
                  {s.priority === "urgente" && <Badge className="ml-1 border-red-500/50 bg-red-500/10 text-red-300">Urgente</Badge>}
                  <div className="text-[11px] font-normal text-slate-500">{s.serviceType} · {s.address}</div>
                </Td>
                <Td><Badge className={ASSISTANCE_STATUS_STYLES[s.status] ?? ""}>{ASSISTANCE_STATUS_LABELS[s.status] ?? s.status}</Badge></Td>
                <Td>{s.waitingMin} min</Td>
                <Td>{s.workshop ?? <span className="text-amber-300">sin asignar</span>}</Td>
                <Td>
                  {s.unitName ?? "—"}
                  {s.gpsStale && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-amber-300">
                      <SatelliteDish className="h-3 w-3" /> sin GPS
                    </span>
                  )}
                </Td>
                <Td>{s.risk?.etaMinutes != null ? `${s.risk.etaMinutes} min` : "—"}</Td>
                <Td className={s.risk?.minutesToDeadline != null && s.risk.minutesToDeadline < 0 ? "font-bold text-red-300" : ""}>
                  {s.risk?.minutesToDeadline != null ? `${s.risk.minutesToDeadline} min` : "—"}
                </Td>
                <Td>
                  {s.risk ? (
                    <Badge className={RISK_STYLES[s.risk.level]}>
                      {RISK_LABELS[s.risk.level]} {Math.round(s.risk.score * 100)} %
                    </Badge>
                  ) : "—"}
                </Td>
                <Td className="max-w-[320px] text-[11px] text-slate-400">{s.risk?.explanation ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {services.length === 0 && <EmptyState message="No hay servicios activos con los filtros seleccionados." />}
      </Card>

      {(data?.zones ?? []).some((z) => z.ratio > 2) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Zonas con carga elevada:</b>{" "}
            {(data?.zones ?? []).filter((z) => z.ratio > 2).map((z) => `${z.label} (${z.active} activos / ${z.availableUnits} unidades)`).join(" · ")}
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300/80">
              <MapPin className="h-3 w-3" /> Revisa las recomendaciones de cobertura para reforzar estas áreas.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
