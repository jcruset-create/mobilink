/**
 * Connect Pro — Mapa operativo: asistencias activas y talleres de la red
 * sobre Leaflet (misma librería que el resto del panel). Refresco 15 s.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { circle as turfCircle } from "@turf/circle";
import { intersect as turfIntersect } from "@turf/intersect";
import { featureCollection } from "@turf/helpers";
import spainGeo from "../assets/spain.geo.json";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
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

/**
 * Los marcadores escalan con el zoom: pequeños con el mapa alejado y a
 * tamaño completo a partir de zoom ~11 (factor 0,35–1,0).
 */
function zoomFactor(zoom: number): number {
  return Math.min(1, Math.max(0.35, (zoom - 4) / 7));
}

function assistanceIcon(status: string, urgent: boolean, zoom: number) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  const s = Math.round(18 * zoomFactor(zoom));
  const border = Math.max(1, Math.round(3 * zoomFactor(zoom)));
  return L.divIcon({
    html: `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${color};
             border:${border}px solid ${urgent ? "#ef4444" : "#0f172a"};box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
    className: "", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
}

function workshopIcon(zoom: number) {
  const s = Math.round(26 * zoomFactor(zoom));
  return L.divIcon({
    html: `<div style="width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center;
             background:#0e7490;border:${Math.max(1, Math.round(2 * zoomFactor(zoom)))}px solid #67e8f9;border-radius:${Math.round(s / 4)}px;
             font-size:${Math.round(s * 0.55)}px;box-shadow:0 1px 6px rgba(0,0,0,.5)">🔧</div>`,
    className: "", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
  });
}

/** Observa el zoom del mapa y lo propaga al estado de React. */
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

/**
 * Cobertura recortada contra la línea de costa: círculo geodésico del taller
 * ∩ contorno de España — el mar queda fuera. Si la intersección falla,
 * se devuelve el círculo completo como respaldo.
 */
const spainFeature = (spainGeo as any).features[0];
function coveragePolygon(lat: number, lng: number, radiusKm: number) {
  const circ = turfCircle([lng, lat], radiusKm, { steps: 96, units: "kilometers" });
  try {
    return turfIntersect(featureCollection([circ, spainFeature])) ?? circ;
  } catch {
    return circ;
  }
}

export default function MapaOperativo() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [data, setData] = useState<{ assistances: MapAssistance[]; workshops: MapWorkshop[] } | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [adjustMode, setAdjustMode] = useState(false);
  const [zoom, setZoom] = useState(9);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const moveWorkshop = async (w: MapWorkshop, lat: number, lng: number) => {
    const ok = window.confirm(
      `¿Fijar la posición de "${w.name}" en ${lat.toFixed(5)}, ${lng.toFixed(5)}?\n` +
      `La distancia/ETA de futuras asignaciones se calculará desde aquí.`,
    );
    if (!ok) { load(); return; }
    try {
      await boFetch(`/workshops/${w.id}`, { method: "PATCH", body: { latitude: lat, longitude: lng } });
      setNotice(`Posición de ${w.name} actualizada (${lat.toFixed(5)}, ${lng.toFixed(5)}).`);
      load();
    } catch (e: any) { setError(e.message); load(); }
  };

  const load = useCallback(() => {
    boFetch<{ assistances: MapAssistance[]; workshops: MapWorkshop[] }>("/map")
      .then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    if (adjustMode) return; // sin auto-refresco mientras se ajustan posiciones
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, adjustMode]);

  const center: [number, number] = data?.workshops[0]
    ? [data.workshops[0].latitude, data.workshops[0].longitude]
    : [41.1189, 1.2445];

  return (
    <div>
      <PageTitle
        title="Mapa operativo"
        subtitle="Asistencias en curso y talleres de la red."
        actions={
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[13px] text-slate-300">
              <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
              Mostrar cobertura
            </label>
            {canEdit && (
              <label className="flex items-center gap-1.5 text-[13px] text-amber-300">
                <input type="checkbox" checked={adjustMode} onChange={(e) => setAdjustMode(e.target.checked)} />
                Ajustar posición de talleres
              </label>
            )}
          </div>
        }
      />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {notice && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="ml-3 text-emerald-400 hover:text-emerald-200">✕</button>
        </div>
      )}
      {adjustMode && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
          Modo ajuste activo: arrastra el icono 🔧 de un taller hasta su ubicación real y confirma para guardar las coordenadas GPS.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-700" style={{ height: "calc(100vh - 220px)" }}>
        <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }}>
          <ZoomWatcher onZoom={setZoom} />
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {data?.workshops.map((w) => (
            <span key={`w${w.id}`}>
              <Marker
                position={[w.latitude, w.longitude]}
                icon={workshopIcon(zoom)}
                draggable={adjustMode}
                eventHandlers={adjustMode ? {
                  dragend: (e) => {
                    const p = (e.target as L.Marker).getLatLng();
                    moveWorkshop(w, p.lat, p.lng);
                  },
                } : undefined}
              >
                <Popup>
                  <b>{w.name}</b>{w.providerName ? ` · ${w.providerName}` : ""}<br />
                  Score {Math.round(w.currentScore)}/100 · radio {w.radiusKm} km<br />
                  {w.latitude.toFixed(5)}, {w.longitude.toFixed(5)}
                  {adjustMode && <><br /><i>Arrástrame para recolocar el taller</i></>}
                </Popup>
              </Marker>
              {showCoverage && (
                <GeoJSON
                  key={`cov-${w.id}-${w.latitude}-${w.longitude}-${w.radiusKm}`}
                  data={coveragePolygon(w.latitude, w.longitude, w.radiusKm) as any}
                  style={{ color: "#0e7490", weight: 1, fillOpacity: 0.05 }}
                />
              )}
            </span>
          ))}
          {data?.assistances.map((a) => (
            <Marker key={`a${a.id}`} position={[a.latitude, a.longitude]} icon={assistanceIcon(a.status, a.priority === "urgente", zoom)}>
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
