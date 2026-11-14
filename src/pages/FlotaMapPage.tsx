import { apiFetch } from "../modules/apiFetch";
import { abrirPdfConSesion } from "../modules/pdfConSesion";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { sessionHeaders } from "../modules/sessionHeaders";

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
  // Multi-taller (fase 4)
  tallerId?: number | null;
  tallerNombre?: string | null;
  esPropio?: boolean;
  estado?: "trabajando" | "en_taller";
  techName?: string | null;
};

/** La última posición de la tablet de un operario: `server/tablets/posicionTablet.ts`. */
type Tablet = {
  techName: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  atMs: number;
  tallerNombre: string | null;
  esPropio: boolean;
  asistenciaId: number | null;
  asistenciaEstado: string | null;
  asistenciaMatricula: string | null;
  furgoneta: string | null;
};

/** Sin noticias de la tablet en este rato, el icono sale apagado. */
const TABLET_SIN_SENAL_MS = 10 * 60_000;

function haceCuanto(ms: number) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60} min`;
}

function escaparHtml(texto: string) {
  return texto.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function makeTabletIcon(nombre: string, activa: boolean, esPropio: boolean) {
  const apagada = !activa || !esPropio;
  const fondo = apagada ? "#3a3f46" : "#0f766e";
  const borde = apagada ? "#64748b" : "#5eead4";
  return L.divIcon({
    html: `
      <div style="text-align:center;${apagada ? "opacity:0.7;" : ""}">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:${fondo};border:2px solid ${borde};box-shadow:0 2px 6px rgba(0,0,0,0.4);font-size:16px;">📱</div>
        <div style="background:${fondo};color:#f8fafc;font-size:10px;font-weight:900;padding:1px 5px;border-radius:4px;margin-top:2px;white-space:nowrap;border:1px solid ${borde};">
          ${escaparHtml(nombre)}
        </div>
      </div>
    `,
    className: "",
    iconSize: [80, 50],
    iconAnchor: [40, 15],
    popupAnchor: [0, -18],
  });
}

function makeVanIcon(plate: string, esPropio = true) {
  // Furgonetas de otros talleres de la empresa: en gris (solo estado/técnico)
  const imgFilter = esPropio
    ? "drop-shadow(0 2px 6px rgba(0,0,0,0.4))"
    : "grayscale(1) opacity(0.75) drop-shadow(0 2px 6px rgba(0,0,0,0.4))";
  const badgeBg = esPropio ? "#1e3a5f" : "#3a3f46";
  const badgeColor = esPropio ? "#f0c040" : "#cbd5e1";
  return L.divIcon({
    html: `
      <div style="text-align:center">
        <img src="/van-icon.png" style="width:40px;height:60px;filter:${imgFilter};" />
        <div style="background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:900;padding:1px 5px;border-radius:4px;margin-top:2px;white-space:nowrap;border:1px solid #2d4a6a;letter-spacing:0.5px;">
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

function FitAll({ vehicles }: { vehicles: Array<{ lat: number; lng: number }> }) {
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
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [verFurgonetas, setVerFurgonetas] = useState(true);
  const [verTablets, setVerTablets] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [reportDate, setReportDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  function openTrackingReport(objectno: string) {
    const day = new Date(`${reportDate}T00:00:00`);
    const from = day.getTime();
    const to = from + 24 * 60 * 60 * 1000 - 1;
    // Con la sesión en la cabecera: ver `modules/pdfConSesion.ts`.
    void abrirPdfConSesion(
      apiFetch,
      `${API_BASE}/api/webfleet/vehicle/${objectno}/tracking-report.pdf?from=${from}&to=${to}`,
      `seguimiento_${objectno}_${reportDate}.pdf`
    ).catch((e) =>
      window.alert(e instanceof Error ? e.message : "No se pudo abrir el informe.")
    );
  }

  // Las tablets van aparte: si Webfleet falla, siguen saliendo.
  // El recorrido de la tablet, igual que el de la furgoneta: el día elegido arriba.
  function openTabletReport(techName: string) {
    const day = new Date(`${reportDate}T00:00:00`);
    const from = day.getTime();
    const to = from + 24 * 60 * 60 * 1000 - 1;
    void abrirPdfConSesion(
      apiFetch,
      `${API_BASE}/api/tablets/${encodeURIComponent(techName)}/recorrido.pdf?from=${from}&to=${to}`,
      `recorrido_tablet_${techName}_${reportDate}.pdf`
    ).catch((e) =>
      window.alert(e instanceof Error ? e.message : "No se pudo abrir el informe.")
    );
  }

  async function loadTablets() {
    try {
      const res = await apiFetch(`${API_BASE}/api/tablets/posiciones`, {
        headers: await sessionHeaders(getAdminHeaders() as Record<string, string>),
      });
      if (!res.ok) return;
      const data: Tablet[] = await res.json();
      setTablets(data.filter(t => isFinite(t.lat) && isFinite(t.lng)));
    } catch {
      /* el mapa de furgonetas sigue funcionando */
    }
  }

  async function load() {
    void loadTablets();
    try {
      const res = await apiFetch(`${API_BASE}/api/webfleet/vehicles`, {
        headers: await sessionHeaders(getAdminHeaders() as Record<string, string>),
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
              {loading
                ? "Cargando…"
                : `${error ? `Webfleet: ${error}` : `${vehicles.length} furgoneta${vehicles.length !== 1 ? "s" : ""} · Webfleet`} · ${tablets.length} tablet${tablets.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={verFurgonetas} onChange={(e) => setVerFurgonetas(e.target.checked)} />
            🚐 Furgonetas
          </label>
          <label className="flex items-center gap-1 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={verTablets} onChange={(e) => setVerTablets(e.target.checked)} />
            📱 Tablets
          </label>
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
          <a href="/asistencias" className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-bold text-[#8bafd4] hover:bg-[#2d4a6a]">
            ← Volver
          </a>
        </div>
      </div>

      {/* Mapa */}
      <div className="flex-1 relative">
        {loading && vehicles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-400">Cargando posiciones Webfleet…</div>
        ) : error && vehicles.length === 0 && tablets.length === 0 ? (
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
            <FitAll vehicles={[...vehicles, ...tablets]} />
            {verTablets && tablets.map(t => {
              const activa = Date.now() - t.atMs <= TABLET_SIN_SENAL_MS;
              return (
                <Marker
                  key={`tablet-${t.techName}`}
                  position={[t.lat, t.lng]}
                  icon={makeTabletIcon(t.techName, activa, t.esPropio)}
                  zIndexOffset={500}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-bold">📱 Tablet de {t.techName}</div>
                      {t.tallerNombre && (
                        <div className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${t.esPropio ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                          {t.tallerNombre}{t.esPropio ? "" : " · otro taller"}
                        </div>
                      )}
                      <div className={`mt-1 text-xs font-bold ${activa ? "text-emerald-600" : "text-red-600"}`}>
                        {activa ? "● Enviando posición" : "● Sin señal"} · {haceCuanto(t.atMs)}
                      </div>
                      {t.asistenciaId != null ? (
                        <div className="mt-1 text-xs text-amber-700">
                          Asistencia #{t.asistenciaId}
                          {t.asistenciaMatricula ? ` · ${t.asistenciaMatricula}` : ""}
                          {t.furgoneta ? ` · ${t.furgoneta}` : ""}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-gray-600">Sin asistencia en curso</div>
                      )}
                      {t.speedKmh != null && t.speedKmh >= 3 && (
                        <div className="text-xs text-gray-600">{Math.round(t.speedKmh)} km/h</div>
                      )}
                      {t.accuracyM != null && (
                        <div className="text-[10px] text-gray-400">Precisión ±{Math.round(t.accuracyM)} m</div>
                      )}
                      {t.esPropio && (
                        <button
                          onClick={() => openTabletReport(t.techName)}
                          className="mt-2 w-full rounded bg-teal-600 px-2 py-1 text-xs font-bold text-white hover:bg-teal-700"
                        >
                          🛰️ Recorrido tablet (día)
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
            {verFurgonetas && vehicles.map(v => (
              <Marker
                key={v.objectno}
                position={[v.lat, v.lng]}
                icon={makeVanIcon(v.plate ?? v.objectname ?? v.objectno, v.esPropio !== false)}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-bold">{v.plate ?? v.objectname}</div>
                    {v.tallerNombre && (
                      <div className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${v.esPropio === false ? "bg-slate-200 text-slate-600" : "bg-blue-100 text-blue-700"}`}>
                        {v.tallerNombre}{v.esPropio === false ? " · otro taller" : ""}
                      </div>
                    )}
                    <div className={`mt-1 text-xs font-bold ${v.estado === "trabajando" ? "text-amber-600" : "text-emerald-600"}`}>
                      {v.estado === "trabajando" ? "● Trabajando" : "● En taller"}
                      {v.techName && <span className="ml-1 font-normal text-gray-600">· {v.techName}</span>}
                    </div>
                    {v.postext && <div className="text-gray-600 mt-1">{v.postext}</div>}
                    {v.timestamp && (
                      <div className="text-gray-400 text-xs mt-1">
                        {new Date(v.timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    {v.esPropio !== false && (
                      <button
                        onClick={() => openTrackingReport(v.objectno)}
                        className="mt-2 w-full rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        🛰️ Informe seguimiento (día)
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>

      {/* Lista lateral compacta */}
      {(vehicles.length > 0 || tablets.length > 0) && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2 bg-[#162232] border-t border-[#2d4a6a]">
          {verTablets && tablets.map(t => {
            const activa = Date.now() - t.atMs <= TABLET_SIN_SENAL_MS;
            return (
              <div key={`tablet-${t.techName}`} className="flex-shrink-0 rounded-lg px-3 py-1.5 text-center border bg-[#123c3a] border-[#0f766e]">
                <div className="text-xs font-black text-teal-200">📱 {t.techName}</div>
                <div className={`text-[10px] font-bold ${activa ? "text-emerald-400" : "text-red-400"}`}>
                  {activa ? "Enviando" : "Sin señal"} · {haceCuanto(t.atMs)}
                </div>
              </div>
            );
          })}
          {verFurgonetas && vehicles.map(v => (
            <div key={v.objectno} className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-center border ${v.esPropio === false ? "bg-[#22262c] border-[#3a3f46] opacity-80" : "bg-[#1e3a5f] border-[#2d4a6a]"}`}>
              <div className={`text-xs font-black ${v.esPropio === false ? "text-slate-300" : "text-[#f0c040]"}`}>{v.plate ?? v.objectname}</div>
              <div className={`text-[10px] font-bold ${v.estado === "trabajando" ? "text-amber-400" : "text-emerald-400"}`}>
                {v.estado === "trabajando" ? "Trabajando" : "En taller"}
                {v.techName ? ` · ${v.techName}` : ""}
              </div>
              {v.tallerNombre && <div className="text-[10px] text-slate-500">{v.tallerNombre}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
