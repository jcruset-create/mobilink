import { apiFetch } from "../modules/apiFetch";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type Vehicle = {
  objectno: string;
  objectname: string;
  lat: number;
  lng: number;
  postext?: string | null;
  timestamp?: string | null;
  plate?: string | null;
};

function makeVanIcon(plate: string) {
  return L.divIcon({
    html: `
      <div style="text-align:center">
        <img src="/van-icon.png" style="width:40px;height:60px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));" />
        <div style="background:#1e3a5f;color:#f0c040;font-size:10px;font-weight:900;padding:1px 5px;border-radius:4px;margin-top:2px;white-space:nowrap;border:1px solid #2d4a6a;letter-spacing:0.5px;">
          ${plate}
        </div>
      </div>
    `,
    className: "",
    iconSize: [60, 84],
    iconAnchor: [30, 60],
    popupAnchor: [0, -64],
  });
}

function FitAll({ vehicles }: { vehicles: Vehicle[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || vehicles.length === 0) return;
    const valid = vehicles.filter(v => isFinite(v.lat) && isFinite(v.lng) && (v.lat !== 0 || v.lng !== 0));
    if (valid.length === 0) return;
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], 14);
    } else {
      map.fitBounds(L.latLngBounds(valid.map(v => [v.lat, v.lng])), { padding: [50, 50] });
    }
    fitted.current = true;
  }, [map, vehicles]);
  return null;
}

export default function FlotaMapPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [reportDate, setReportDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  function openTrackingReport(objectno: string) {
    const day = new Date(`${reportDate}T00:00:00`);
    const from = day.getTime();
    const to = from + 24 * 60 * 60 * 1000 - 1;
    const token =
      (typeof localStorage !== "undefined" && (localStorage.getItem("sea-admin-token") || localStorage.getItem("adminToken"))) || "";
    window.open(
      `${API_BASE}/api/webfleet/vehicle/${objectno}/tracking-report.pdf?from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
      "_blank"
    );
  }

  async function load() {
    try {
      const res = await apiFetch(`${API_BASE}/api/webfleet/vehicles`, {
        headers: getAdminHeaders(),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data: Vehicle[] = await res.json();
      setVehicles(data.filter(v => isFinite(v.lat) && isFinite(v.lng) && (v.lat !== 0 || v.lng !== 0)));
      setLastUpdate(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Error cargando posiciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // actualiza cada minuto
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0d1b2a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#162232] border-b border-[#2d4a6a]">
        <div className="flex items-center gap-3">
          <span className="text-xl">🚐</span>
          <div>
            <h1 className="text-base font-black text-white">Localización de flota</h1>
            <p className="text-xs text-slate-400">
              {loading ? "Cargando…" : error ? `Error: ${error}` : `${vehicles.length} furgoneta${vehicles.length !== 1 ? "s" : ""} · Webfleet`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-400">
            Informe del día:
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="rounded bg-[#1e3a5f] px-2 py-1 text-xs text-white border border-[#2d4a6a]"
            />
          </label>
          {lastUpdate && (
            <span className="text-xs text-slate-500">
              Actualizado {lastUpdate.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); load(); }}
            className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-bold text-[#8bafd4] hover:bg-[#2d4a6a]"
          >
            ↺ Actualizar
          </button>
          <a href="/" className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-bold text-[#8bafd4] hover:bg-[#2d4a6a]">
            ← Volver
          </a>
        </div>
      </div>

      {/* Mapa */}
      <div className="flex-1 relative">
        {loading && vehicles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-400">Cargando posiciones Webfleet…</div>
        ) : error && vehicles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-red-400">{error}</div>
        ) : (
          <MapContainer
            center={[41.12, 1.25]}
            zoom={10}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitAll vehicles={vehicles} />
            {vehicles.map(v => (
              <Marker
                key={v.objectno}
                position={[v.lat, v.lng]}
                icon={makeVanIcon(v.plate ?? v.objectname ?? v.objectno)}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-bold">{v.plate ?? v.objectname}</div>
                    {v.postext && <div className="text-gray-600 mt-1">{v.postext}</div>}
                    {v.timestamp && (
                      <div className="text-gray-400 text-xs mt-1">
                        {new Date(v.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    <button
                      onClick={() => openTrackingReport(v.objectno)}
                      className="mt-2 w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      🛰️ Informe seguimiento (día)
                    </button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Lista lateral compacta */}
      {vehicles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2 bg-[#162232] border-t border-[#2d4a6a]">
          {vehicles.map(v => (
            <div key={v.objectno} className="flex-shrink-0 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-center border border-[#2d4a6a]">
              <div className="text-xs font-black text-[#f0c040]">{v.plate ?? v.objectname}</div>
              {v.postext && <div className="text-[10px] text-slate-400 max-w-[120px] truncate">{v.postext}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
