/**
 * Connect Pro — Mapa operativo: asistencias activas y talleres de la red
 * sobre Leaflet (misma librería que el resto del panel). Refresco 15 s.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, ErrorBanner, Badge } from "../components/ui";
import { ASSISTANCE_STATUS_LABELS, ASSISTANCE_STATUS_STYLES, fmtDateTime } from "../types";

/** De dónde sale la posición de la unidad, para saber en qué confiar. */
const VEHICLE_SOURCE_LABELS: Record<string, string> = {
  lite: "móvil del operario (Assist Lite)",
  assist: "móvil del técnico (Mobilink Assist)",
  unit: "GPS de la unidad",
};

type MapAssistance = {
  id: number; status: string; priority: string; serviceType: string; address: string;
  customerName: string; latitude: number; longitude: number;
  workshopName: string | null; assignedTechName: string | null;
  // Unidad asignada: móvil del operario Lite, móvil del técnico de Assist o GPS de la unidad
  vehicleLat: number | null; vehicleLng: number | null; vehicleAtMs: number | null;
  vehicleSpeedKmh: number | null; operatorName: string | null; vehicleName: string | null;
  vehicleSource: "lite" | "assist" | "unit" | null;
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

/**
 * Punto de la asistencia: se reutiliza el marcador rojo de avería de Mobilink
 * Assist (`public/marker-asistencia.png`, versión con transparencia del
 * `marker_averia.png` original, que venía sobre fondo blanco opaco), de modo
 * que el mismo hecho se dibuja igual en todo el ecosistema.
 *
 * El estado sigue siendo legible sin depender del icono: lleva el punto de
 * color de la leyenda en una esquina y el nombre del estado en el popup. Las
 * urgentes añaden un aro rojo y un signo de admiración, para no comunicarlo
 * solo con el color.
 */
function assistanceIcon(status: string, urgent: boolean, zoom: number) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  const f = zoomFactor(zoom);
  const s = Math.round(40 * f);          // lado del marcador (la imagen es cuadrada)
  const dot = Math.max(7, Math.round(14 * f));
  // La punta del pin está a ~el 90 % de la altura de la imagen: ahí va el anclaje
  const tipY = Math.round(s * 0.9);
  return L.divIcon({
    html: `
      <div style="position:relative;width:${s}px;height:${s}px">
        ${urgent ? `<div style="position:absolute;inset:${Math.round(s * 0.08)}px ${Math.round(s * 0.06)}px ${Math.round(s * 0.22)}px;
             border:${Math.max(2, Math.round(3 * f))}px solid #ef4444;border-radius:50%;opacity:.85"></div>` : ""}
        <img src="/marker-asistencia.png" alt="" width="${s}" height="${s}"
             style="display:block;width:${s}px;height:${s}px;max-width:none;
             filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))" />
        <span style="position:absolute;right:0;top:0;width:${dot}px;height:${dot}px;border-radius:50%;
             background:${color};border:${Math.max(1, Math.round(2 * f))}px solid #0f172a;
             box-shadow:0 1px 3px rgba(0,0,0,.6)"></span>
        ${urgent ? `<span style="position:absolute;left:0;top:0;width:${dot}px;height:${dot}px;border-radius:50%;
             background:#ef4444;border:${Math.max(1, Math.round(2 * f))}px solid #0f172a;color:#fff;
             font:700 ${Math.max(8, Math.round(dot * 0.8))}px/1 system-ui;display:flex;align-items:center;
             justify-content:center">!</span>` : ""}
      </div>`,
    className: "",
    iconSize: [s, s],
    iconAnchor: [s / 2, tipY],
    popupAnchor: [0, -tipY],
  });
}

/** Antigüedad a partir de la cual la posición deja de considerarse fiable. */
const POSICION_VIEJA_MS = 5 * 60_000;

/**
 * Unidad asignada a la asistencia, con el mismo aspecto que en «Localización
 * de flota»: la furgoneta y, debajo, la matrícula o el nombre de la unidad.
 *
 * Si la última posición es antigua se atenúa y la etiqueta lo dice, para no
 * dar por buena una posición que ya no lo es.
 */
function vehicleIcon(zoom: number, stale: boolean, label: string) {
  const f = zoomFactor(zoom);
  const w = Math.round(40 * f);
  const h = Math.round(60 * f);
  const font = Math.max(8, Math.round(10 * f));
  const badgeH = Math.round(font * 1.9);
  const texto = label.length > 14 ? `${label.slice(0, 13)}…` : label;
  return L.divIcon({
    html: `
      <div style="text-align:center;width:${Math.max(w, 70)}px">
        <img src="/van-icon.png" alt="" width="${w}" height="${h}"
             style="display:block;margin:0 auto;width:${w}px;height:${h}px;max-width:none;
             opacity:${stale ? 0.5 : 1};filter:drop-shadow(0 2px 6px rgba(0,0,0,.4))" />
        <div style="display:inline-block;background:${stale ? "#334155" : "#1e3a5f"};
             color:${stale ? "#cbd5e1" : "#f0c040"};font:900 ${font}px/1.5 system-ui;padding:1px 5px;
             border-radius:4px;margin-top:2px;white-space:nowrap;border:1px solid #2d4a6a;
             letter-spacing:.5px">${stale ? "? " : ""}${texto}</div>
      </div>`,
    className: "",
    iconSize: [Math.max(w, 70), h + badgeH],
    iconAnchor: [Math.max(w, 70) / 2, h],
    popupAnchor: [0, -h - 4],
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
                <Circle
                  center={[w.latitude, w.longitude]} radius={w.radiusKm * 1000}
                  pathOptions={{ color: "#0e7490", weight: 1, fillOpacity: 0.05 }}
                />
              )}
            </span>
          ))}
          {data?.assistances.map((a) => {
            const conUnidad = a.vehicleLat != null && a.vehicleLng != null;
            const vieja = conUnidad && (!a.vehicleAtMs || Date.now() - Number(a.vehicleAtMs) > POSICION_VIEJA_MS);
            return (
              <span key={`a${a.id}`}>
                <Marker position={[a.latitude, a.longitude]} icon={assistanceIcon(a.status, a.priority === "urgente", zoom)}>
                  <Popup>
                    <b>#{a.id} — {a.customerName}</b>{a.priority === "urgente" && " · URGENTE"}<br />
                    {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status} · {a.serviceType}<br />
                    {a.address}<br />
                    {a.workshopName && <>Taller: {a.workshopName}<br /></>}
                    {a.assignedTechName && <>Técnico: {a.assignedTechName}<br /></>}
                    <Link to={`/connect/asistencias/${a.id}`}>Abrir ficha</Link>
                  </Popup>
                </Marker>
                {conUnidad && (
                  <>
                    {/* Trayecto pendiente hasta el punto: discontinuo, no es la ruta real */}
                    <Polyline
                      positions={[[a.vehicleLat!, a.vehicleLng!], [a.latitude, a.longitude]]}
                      pathOptions={{ color: vieja ? "#64748b" : "#8b5cf6", weight: 2, dashArray: "6 6", opacity: 0.85 }}
                    />
                    <Marker
                      position={[a.vehicleLat!, a.vehicleLng!]}
                      icon={vehicleIcon(zoom, vieja, a.vehicleName ?? a.operatorName ?? `#${a.id}`)}
                    >
                      <Popup>
                        <b>{a.vehicleName ?? "Unidad asignada"}</b><br />
                        {a.operatorName && <>Operario: {a.operatorName}<br /></>}
                        Asistencia #{a.id} · {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}<br />
                        {a.vehicleSpeedKmh != null && <>{Math.round(a.vehicleSpeedKmh)} km/h<br /></>}
                        {vieja ? "⚠ Posición desactualizada" : "Posición actual"}
                        {a.vehicleAtMs ? ` (${fmtDateTime(Number(a.vehicleAtMs))})` : ""}<br />
                        <span style={{ color: "#64748b" }}>Origen: {VEHICLE_SOURCE_LABELS[a.vehicleSource ?? ""] ?? "desconocido"}</span>
                      </Popup>
                    </Marker>
                  </>
                )}
              </span>
            );
          })}
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
