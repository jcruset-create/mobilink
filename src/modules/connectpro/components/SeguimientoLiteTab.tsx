/**
 * Connect Pro — Seguimiento de un taller Mobilink Assist Lite: posición del
 * operario en tiempo real, rastro recorrido, evidencias, firma y KPIs.
 *
 * Sirve igual para talleres FULL (rastro del core) porque lee de la misma
 * asistencia de Connect; lo que cambia es quién alimenta los datos.
 */

import { useCallback, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { boFetch } from "../services/api";
import { Badge, Button } from "./ui";
import { ASSISTANCE_STATUS_LABELS, fmtDateTime } from "../types";

type TrackPoint = {
  lat: number; lng: number; accuracyM: number | null; speedKmh: number | null;
  headingDeg: number | null; status: string | null; deviceTsMs: number;
};

type LiteData = {
  assistance: {
    id: number; status: string; liteUserName: string | null; resultCode: string | null;
    resolutionNotes: string | null; odometerKm: number | null; workedMinutes: number | null;
    operatorLat: number | null; operatorLng: number | null; operatorAccuracyM: number | null;
    operatorSpeedKmh: number | null; operatorLocationAtMs: number | null;
    latitude: number | null; longitude: number | null;
    workshopName: string | null; workshopLat: number | null; workshopLng: number | null;
    integrationType: string;
  };
  tier: "FULL" | "LITE" | "EXTERNAL" | null;
  track: TrackPoint[];
  files: { id: number; category: string; url: string; fileName: string | null; createdAtMs: number }[];
  signature: { id: number; signerName: string; signerDocument: string | null; url: string; signedAtMs: number } | null;
  device: {
    lastSeenAtMs: number | null; platform: string | null; appVersion: string | null;
    gpsPermission: string | null; notifPermission: string | null; pushEnabled: boolean;
  } | null;
  kpis: Record<string, number | boolean | null>;
  locationStale: boolean | null;
  lastLocationAtMs: number | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  arrival: "Vehículo al llegar", damage: "Daño o avería", work: "Trabajo realizado",
  part: "Pieza sustituida", finished: "Vehículo finalizado", document: "Documento",
  signature: "Firma", other: "Otros",
};

const KPI_LABELS: Record<string, string> = {
  acceptMin: "Asignación → aceptación",
  acceptToEnRouteMin: "Aceptación → en camino",
  travelMin: "Desplazamiento",
  assignToArrivalMin: "Asignación → llegada",
  onSiteBeforeWorkMin: "En punto antes de trabajar",
  workMin: "Tiempo de trabajo",
  totalMin: "Tiempo total",
  returnMin: "Vuelta al taller",
  cycleMin: "Ciclo completo",
};

function operatorIcon(stale: boolean) {
  return L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${stale ? "#64748b" : "#8b5cf6"};
             border:3px solid #0f172a;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
    className: "", iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

const targetIcon = L.divIcon({
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#06b6d4;border:3px solid #0f172a"></div>`,
  className: "", iconSize: [20, 20], iconAnchor: [10, 10],
});

const workshopIcon = L.divIcon({
  html: `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;
           background:#0e7490;border:2px solid #67e8f9;border-radius:6px;font-size:13px">🔧</div>`,
  className: "", iconSize: [24, 24], iconAnchor: [12, 12],
});

export default function SeguimientoLiteTab({ assistanceId, canOperate, onChanged }: {
  assistanceId: number; canOperate: boolean; onChanged: () => void;
}) {
  const [data, setData] = useState<LiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<LiteData>(`/assistances/${assistanceId}/lite`).then(setData).catch((e) => setError(e.message));
  }, [assistanceId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Cargando seguimiento…</p>;

  const a = data.assistance;
  const hasPosition = a.operatorLat != null && a.operatorLng != null;
  const center: [number, number] = hasPosition
    ? [a.operatorLat!, a.operatorLng!]
    : a.latitude != null ? [a.latitude, a.longitude!] : [41.1189, 1.2445];
  const line = data.track.map((p) => [p.lat, p.lng] as [number, number]);

  const corregir = async (status: string) => {
    setBusy(true);
    try {
      await boFetch(`/assistances/${assistanceId}/manual-status`, { method: "POST", body: { status } });
      load(); onChanged();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Cabecera de estado: texto + icono, nunca solo color */}
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <Badge className="border-violet-500/40 bg-violet-500/10 text-violet-300">
          {data.tier ?? "—"} · {a.workshopName ?? "Sin taller"}
        </Badge>
        <span className="text-slate-300">Operario: <b>{a.liteUserName ?? "sin asignar"}</b></span>
        <span className="text-slate-300">
          GPS:{" "}
          <b>
            {!hasPosition ? "sin datos"
              : data.locationStale ? `⚠ desactualizado (${fmtDateTime(data.lastLocationAtMs)})`
              : `✓ activo (${fmtDateTime(data.lastLocationAtMs)})`}
          </b>
        </span>
        {a.operatorAccuracyM != null && <span className="text-slate-400">Precisión ±{Math.round(a.operatorAccuracyM)} m</span>}
        {a.operatorSpeedKmh != null && <span className="text-slate-400">{Math.round(a.operatorSpeedKmh)} km/h</span>}
      </div>

      {data.device && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-slate-400">
          <span>Dispositivo: {data.device.platform ?? "?"} · app {data.device.appVersion ?? "?"}</span>
          <span>Permiso GPS: {data.device.gpsPermission ?? "desconocido"}</span>
          <span>Avisos push: {data.device.pushEnabled ? "activos" : "no configurados"}</span>
          <span>Última conexión: {fmtDateTime(data.device.lastSeenAtMs)}</span>
        </div>
      )}

      {/* Mapa con rastro */}
      <div className="h-80 overflow-hidden rounded-xl border border-slate-700">
        <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {a.latitude != null && (
            <Marker position={[a.latitude, a.longitude!]} icon={targetIcon}>
              <Popup>Punto de la asistencia</Popup>
            </Marker>
          )}
          {a.workshopLat != null && (
            <Marker position={[a.workshopLat, a.workshopLng!]} icon={workshopIcon}>
              <Popup>{a.workshopName}</Popup>
            </Marker>
          )}
          {line.length > 1 && <Polyline positions={line} pathOptions={{ color: "#8b5cf6", weight: 3, opacity: 0.8 }} />}
          {hasPosition && (
            <Marker position={[a.operatorLat!, a.operatorLng!]} icon={operatorIcon(!!data.locationStale)}>
              <Popup>
                {a.liteUserName ?? "Operario"}<br />
                {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}<br />
                {fmtDateTime(data.lastLocationAtMs)}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
      <p className="text-[12px] text-slate-500">
        {data.track.length} posiciones registradas durante el servicio.
      </p>

      {/* Corrección de estados desde Central (queda auditada) */}
      {canOperate && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-slate-400">Corregir estado (auditado):</span>
          {["technician_assigned", "en_route", "arrived", "in_progress", "finished", "returning_to_workshop", "at_workshop"]
            .filter((s) => s !== a.status)
            .map((s) => (
              <Button key={s} variant="ghost" disabled={busy} onClick={() => corregir(s)}>
                → {ASSISTANCE_STATUS_LABELS[s] ?? s}
              </Button>
            ))}
        </div>
      )}

      {/* Cierre reportado por el taller */}
      {(a.resultCode || a.resolutionNotes) && (
        <div className="rounded-xl border border-slate-700 p-3 text-[13px]">
          <h4 className="mb-1 font-semibold text-slate-200">Cierre del servicio</h4>
          <p className="text-slate-300">Resultado: {a.resultCode ?? "—"}</p>
          {a.resolutionNotes && <p className="mt-1 whitespace-pre-wrap text-slate-400">{a.resolutionNotes}</p>}
          {a.odometerKm != null && <p className="text-slate-400">Kilómetros: {a.odometerKm}</p>}
          {a.workedMinutes != null && <p className="text-slate-400">Tiempo trabajado: {a.workedMinutes} min</p>}
        </div>
      )}

      {/* Evidencias */}
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-slate-200">Evidencias ({data.files.length})</h4>
        {data.files.length === 0 ? (
          <p className="text-[13px] text-slate-500">El taller aún no ha subido fotografías.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.files.map((f) => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="w-36">
                <img src={f.url} alt={CATEGORY_LABELS[f.category] ?? f.category} className="h-24 w-36 rounded-lg border border-slate-700 object-cover" />
                <span className="mt-1 block text-[11px] text-slate-400">{CATEGORY_LABELS[f.category] ?? f.category}</span>
                <span className="block text-[11px] text-slate-500">{fmtDateTime(f.createdAtMs)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Firma */}
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-slate-200">Firma</h4>
        {!data.signature ? (
          <p className="text-[13px] text-slate-500">Sin firma registrada.</p>
        ) : (
          <div className="flex items-start gap-3">
            <img src={data.signature.url} alt="Firma del cliente" className="h-24 rounded-lg border border-slate-700 bg-white p-1" />
            <div className="text-[13px] text-slate-300">
              <div>{data.signature.signerName}</div>
              {data.signature.signerDocument && <div className="text-slate-400">{data.signature.signerDocument}</div>}
              <div className="text-slate-500">{fmtDateTime(data.signature.signedAtMs)}</div>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div>
        <h4 className="mb-2 text-[13px] font-semibold text-slate-200">KPIs del servicio</h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(KPI_LABELS).map(([key, label]) => {
            const v = data.kpis[key];
            return (
              <div key={key} className="rounded-lg border border-slate-700 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
                <div className="text-[15px] font-semibold text-slate-100">{typeof v === "number" ? `${v} min` : "—"}</div>
              </div>
            );
          })}
          <div className="rounded-lg border border-slate-700 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">SLA de llegada</div>
            <div className="text-[15px] font-semibold text-slate-100">
              {data.kpis.slaMet == null ? "—" : data.kpis.slaMet ? "✓ cumplido" : "✗ incumplido"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
