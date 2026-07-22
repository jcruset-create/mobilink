/**
 * Connect Pro — Mapa operativo: asistencias activas y talleres de la red
 * sobre Leaflet (misma librería que el resto del panel). Refresco 15 s.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { boFetch } from "../services/api";
import { PageTitle, ErrorBanner, Badge } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES } from "../types";

type MapAssistance = {
  id: number; status: string; priority: string; serviceType: string; address: string;
  customerName: string; latitude: number; longitude: number;
  workshopName: string | null; assignedTechName: string | null;
};
type MapWorkshop = {
  id: number; name: string; latitude: number; longitude: number; radiusKm: number;
  connectStatus: string; currentScore: number; providerName: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b", searching: "#38bdf8", awaiting_acceptance: "#e879f9",
  assigned: "#3b82f6", technician_assigned: "#6366f1", en_route: "#8b5cf6",
  arrived: "#06b6d4", in_progress: "#14b8a6", no_coverage: "#f97316", assignment_failed: "#ef4444",
};

function assistanceIcon(status: string, urgent: boolean) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  return L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};
             border:3px solid ${urgent ? "#ef4444" : "#0f172a"};box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
    className: "", iconSize: [18, 18], iconAnchor: [9, 9],
  });
}

const workshopIcon = L.divIcon({
  html: `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
           background:#0e7490;border:2px solid #67e8f9;border-radius:6px;font-size:14px;
           box-shadow:0 1px 6px rgba(0,0,0,.5)">🔧</div>`,
  className: "", iconSize: [26, 26], iconAnchor: [13, 13],
});

export default function MapaOperativo() {
  const [data, setData] = useState<{ assistances: MapAssistance[]; workshops: MapWorkshop[] } | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boFetch<{ assistances: MapAssistance[]; workshops: MapWorkshop[] }>("/map")
      .then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const center: [number, number] = data?.workshops[0]
    ? [data.workshops[0].latitude, data.workshops[0].longitude]
    : [41.1189, 1.2445];

  return (
    <div>
      <PageTitle
        title="Mapa operativo"
        subtitle="Asistencias en curso y talleres de la red."
        actions={
          <label className="flex items-center gap-1.5 text-[13px] text-slate-300">
            <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
            Mostrar cobertura
          </label>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="overflow-hidden rounded-xl border border-slate-700" style={{ height: "calc(100vh - 220px)" }}>
        <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {data?.workshops.map((w) => (
            <span key={`w${w.id}`}>
              <Marker position={[w.latitude, w.longitude]} icon={workshopIcon}>
                <Popup>
                  <b>{w.name}</b>{w.providerName ? ` · ${w.providerName}` : ""}<br />
                  Score {Math.round(w.currentScore)}/100 · radio {w.radiusKm} km
                </Popup>
              </Marker>
              {showCoverage && (
                <Circle
                  center={[w.latitude, w.longitude]} radius={w.radiusKm * 1000}
                  pathOptions={{ color: "#0e7490", weight: 1, fillOpacity: 0.05 }}
                />
              )}
            </span>
          ))}
          {data?.assistances.map((a) => (
            <Marker key={`a${a.id}`} position={[a.latitude, a.longitude]} icon={assistanceIcon(a.status, a.priority === "urgente")}>
              <Popup>
                <b>#{a.id} — {a.customerName}</b><br />
                {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status} · {a.serviceType}<br />
                {a.address}<br />
                {a.workshopName && <>Taller: {a.workshopName}<br /></>}
                {a.assignedTechName && <>Técnico: {a.assignedTechName}<br /></>}
                <Link to={`/connect/asistencias/${a.id}`}>Abrir ficha</Link>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <Badge key={status} className={ASSISTANCE_STATUS_STYLES[status] ?? "border-slate-600 text-slate-400"}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: color }} />
            {ASSISTANCE_STATUS_LABELS[status] ?? status}
          </Badge>
        ))}
      </div>
    </div>
  );
}
