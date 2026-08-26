/**
 * Connect Pro — Mapa operativo: asistencias activas y talleres de la red
 * sobre Leaflet (misma librería que el resto del panel). Refresco 15 s.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { boFetch } from "../services/api";
import { useConnectAuth, hasRole } from "../contexts/ConnectAuthContext";
import { PageTitle, ErrorBanner, Badge, Input, Button, Th, Td } from "../components/ui";
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
  vehiclePlate: string | null; vehicleSource: "lite" | "assist" | "unit" | null;
  vehicleConnection: string | null;
};
/** Ruta en coche devuelta por el backend (Google Routes API v2). */
type RutaCarretera = {
  points: [number, number][];
  distanceKm: number;
  etaMinutes: number;
  computedAtMs: number;
};

/** Punto encontrado por la búsqueda de ubicación, con sus talleres cercanos. */
type Busqueda = {
  punto: { lat: number; lng: number };
  etiqueta: string;
  tipo: "coordenadas" | "enlace" | "codigo_postal" | "punto_kilometrico" | "texto";
  precision: "exacta" | "interpolada" | "aproximada";
  avisos: string[];
  workshops: Array<{
    id: number; name: string; providerName: string | null; phone: string | null;
    city: string | null; province: string | null; distanceKm: number; enCobertura: boolean;
    integrationType: string; connectStatus: string; networkParticipation: boolean;
  }>;
};

type MapWorkshop = {
  id: number; name: string; latitude: number; longitude: number; radiusKm: number;
  connectStatus: string; currentScore: number; providerName: string | null;
  companyType: string | null;
};

/**
 * El color del taller en el mapa es el tipo de su empresa. No es adorno: dice
 * de un vistazo a quién se le está cargando el trabajo, que no es lo mismo un
 * taller del grupo que uno colaborador o uno externo.
 */
export const TIPOS_EMPRESA: Record<string, { label: string; color: string }> = {
  grupo: { label: "Del grupo", color: "#22c55e" },
  colaboradora: { label: "Colaboradora", color: "#eab308" },
  externa: { label: "Externa", color: "#94a3b8" },
};
const TIPO_POR_DEFECTO = TIPOS_EMPRESA.colaboradora;

const colorEmpresa = (tipo: string | null) =>
  (tipo && TIPOS_EMPRESA[tipo] ? TIPOS_EMPRESA[tipo] : TIPO_POR_DEFECTO).color;

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
 * Debajo del pin va el estado con el color de la leyenda, igual que la
 * matrícula bajo la furgoneta: así el estado se lee en el propio mapa sin
 * tener que abrir el popup ni interpretar un color suelto. Las urgentes llevan
 * además aro rojo y signo de admiración.
 */
function assistanceIcon(status: string, urgent: boolean, zoom: number) {
  const color = STATUS_COLORS[status] ?? "#94a3b8";
  const label = ASSISTANCE_STATUS_LABELS[status] ?? status;
  const f = zoomFactor(zoom);
  const s = Math.round(40 * f);          // lado del marcador (la imagen es cuadrada)
  const dot = Math.max(7, Math.round(14 * f));
  const font = Math.max(8, Math.round(10 * f));
  const badgeH = Math.round(font * 1.9);
  const w = Math.max(s, 110);
  // La punta del pin está a ~el 90 % de la altura de la imagen: ahí va el anclaje
  const tipY = Math.round(s * 0.9);
  return L.divIcon({
    html: `
      <div style="text-align:center;width:${w}px">
        <div style="position:relative;width:${s}px;height:${s}px;margin:0 auto">
          ${urgent ? `<div style="position:absolute;inset:${Math.round(s * 0.08)}px ${Math.round(s * 0.06)}px ${Math.round(s * 0.22)}px;
               border:${Math.max(2, Math.round(3 * f))}px solid #ef4444;border-radius:50%;opacity:.85"></div>` : ""}
          <img src="/marker-asistencia.png" alt="" width="${s}" height="${s}"
               style="display:block;width:${s}px;height:${s}px;max-width:none;
               filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))" />
          ${urgent ? `<span style="position:absolute;left:0;top:0;width:${dot}px;height:${dot}px;border-radius:50%;
               background:#ef4444;border:${Math.max(1, Math.round(2 * f))}px solid #0f172a;color:#fff;
               font:700 ${Math.max(8, Math.round(dot * 0.8))}px/1 system-ui;display:flex;align-items:center;
               justify-content:center">!</span>` : ""}
        </div>
        <div style="display:inline-block;background:rgba(15,23,42,.92);color:${color};
             border:1px solid ${color};font:900 ${font}px/1.5 system-ui;padding:1px 5px;border-radius:4px;
             margin-top:${Math.round(s * 0.06)}px;white-space:nowrap">${urgent ? "! " : ""}${label}</div>
      </div>`,
    className: "",
    iconSize: [w, s + badgeH],
    iconAnchor: [w / 2, tipY],
    popupAnchor: [0, -tipY],
  });
}

/**
 * Antigüedad a partir de la cual la posición deja de considerarse fiable.
 * Depende de cada cuánto reporta la fuente: el móvil del operario manda
 * posición cada 15-60 s mientras se desplaza, mientras que un GPS de flota
 * (Webfleet) reporta cada varios minutos, así que exigirle lo mismo marcaría
 * como dudosas unidades que están perfectamente conectadas.
 */
const POSICION_VIEJA_MS: Record<string, number> = {
  lite: 5 * 60_000,
  assist: 10 * 60_000,
  unit: 20 * 60_000,
};

/** ¿Hay que avisar de que la posición ya no es de fiar? */
function posicionDesactualizada(a: MapAssistance): boolean {
  if (a.vehicleConnection === "offline" || a.vehicleConnection === "no_connection") return true;
  if (!a.vehicleAtMs) return true;
  const limite = POSICION_VIEJA_MS[a.vehicleSource ?? "unit"] ?? POSICION_VIEJA_MS.unit;
  return Date.now() - Number(a.vehicleAtMs) > limite;
}

/** Antigüedad en texto, para decirlo en vez de insinuarlo con un icono. */
function haceCuanto(ms: number | null): string {
  if (!ms) return "sin fecha";
  const min = Math.round((Date.now() - Number(ms)) / 60000);
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.round(min / 60)} h`;
}

/**
 * Unidad asignada a la asistencia, con el mismo aspecto que en «Localización
 * de flota»: la furgoneta y, debajo, la matrícula. Si el vehículo no tiene
 * matrícula registrada se cae al nombre de la unidad o al operario, para no
 * dejar la etiqueta vacía.
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

/**
 * Taller de la red: mismo tratamiento que el punto de la asistencia pero con
 * el marcador verde de Mobilink Assist y el nombre del taller debajo.
 */
// A partir de este zoom se muestra el nombre del taller; por debajo se oculta
// para que las etiquetas no se solapen con el mapa alejado.
const WORKSHOP_LABEL_MIN_ZOOM = 9;

function workshopIcon(zoom: number, nombre: string, color: string) {
  const f = zoomFactor(zoom);
  const s = Math.round(40 * f);
  const font = Math.max(8, Math.round(10 * f));
  const showLabel = zoom >= WORKSHOP_LABEL_MIN_ZOOM;
  const badgeH = showLabel ? Math.round(font * 1.9) : 0;
  const w = showLabel ? Math.max(s, 110) : s;
  const tipY = Math.round(s * 0.9);
  const texto = nombre.length > 20 ? `${nombre.slice(0, 19)}…` : nombre;
  const labelHtml = showLabel
    ? `<div style="display:inline-block;background:rgba(15,23,42,.92);color:${color};border:1px solid ${color};
             font:900 ${font}px/1.5 system-ui;padding:1px 5px;border-radius:4px;
             margin-top:${Math.round(s * 0.06)}px;white-space:nowrap">${texto}</div>`
    : "";
  return L.divIcon({
    html: `
      <div style="text-align:center;width:${w}px">
        <div style="position:relative;width:${s}px;height:${s}px;margin:0 auto">
          <div style="position:absolute;inset:0;border-radius:50%;
               background:${color};opacity:.30;border:2px solid ${color}"></div>
          <img src="/marker-taller.png" alt="" width="${s}" height="${s}"
               style="position:relative;display:block;width:${s}px;height:${s}px;max-width:none;
               filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))" />
        </div>
        ${labelHtml}
      </div>`,
    className: "",
    iconSize: [w, s + badgeH],
    iconAnchor: [w / 2, tipY],
    popupAnchor: [0, -tipY],
  });
}

/** Observa el zoom del mapa y lo propaga al estado de React. */
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

/**
 * Punto buscado: chincheta amarilla con la etiqueta de lo que se buscó, para
 * que no se confunda con una asistencia real ni con un taller.
 */
function searchIcon(zoom: number, etiqueta: string) {
  const f = zoomFactor(zoom);
  const s = Math.round(30 * f);
  const font = Math.max(9, Math.round(11 * f));
  const w = Math.max(s, 160);
  const texto = etiqueta.length > 34 ? `${etiqueta.slice(0, 33)}…` : etiqueta;
  return L.divIcon({
    html: `
      <div style="text-align:center;width:${w}px">
        <div style="width:${s}px;height:${s}px;margin:0 auto;border-radius:50% 50% 50% 0;
             transform:rotate(-45deg);background:#facc15;border:${Math.max(2, Math.round(3 * f))}px solid #0f172a;
             box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>
        <div style="display:inline-block;background:rgba(15,23,42,.95);color:#facc15;border:1px solid #facc15;
             font:800 ${font}px/1.5 system-ui;padding:1px 6px;border-radius:4px;margin-top:3px;
             white-space:nowrap">📍 ${texto}</div>
      </div>`,
    className: "",
    iconSize: [w, s + Math.round(font * 1.9)],
    iconAnchor: [w / 2, s],
    popupAnchor: [0, -s],
  });
}

/** Lleva el mapa al punto buscado cada vez que cambia. */
function IrAlPunto({ punto }: { punto: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (punto) map.flyTo([punto.lat, punto.lng], Math.max(map.getZoom(), 12), { duration: 0.8 });
  }, [punto, map]);
  return null;
}

const PRECISION_TEXTO: Record<string, string> = {
  exacta: "posición exacta",
  interpolada: "posición interpolada en la vía",
  aproximada: "posición aproximada",
};

export default function MapaOperativo() {
  const { user } = useConnectAuth();
  const canEdit = hasRole(user, "cc_admin");
  const [data, setData] = useState<{ assistances: MapAssistance[]; workshops: MapWorkshop[] } | null>(null);
  const [rutas, setRutas] = useState<Record<number, RutaCarretera>>({});
  const [showCoverage, setShowCoverage] = useState(false);
  const [adjustMode, setAdjustMode] = useState(false);
  const [zoom, setZoom] = useState(9);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");
  const [busqueda, setBusqueda] = useState<Busqueda | null>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = async () => {
    if (!consulta.trim()) return;
    setBuscando(true); setError(null);
    try {
      setBusqueda(await boFetch<Busqueda>(`/geo/search?q=${encodeURIComponent(consulta.trim())}`));
    } catch (e: any) { setError(e.message); setBusqueda(null); } finally { setBuscando(false); }
  };

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

  /**
   * Rutas por carretera de cada unidad en camino. Se piden aparte del mapa
   * porque el backend las cachea: así el refresco cada 15 s no dispara una
   * llamada facturable a Google por cada unidad.
   */
  const cargarRutas = useCallback(async (asistencias: MapAssistance[]) => {
    const conUnidad = asistencias.filter((a) => a.vehicleLat != null && a.vehicleLng != null);
    const resultados = await Promise.all(
      conUnidad.map((a) =>
        boFetch<{ route: RutaCarretera | null }>(`/assistances/${a.id}/route`)
          .then((r) => [a.id, r.route] as const)
          .catch(() => [a.id, null] as const),
      ),
    );
    setRutas((previas) => {
      const siguiente = { ...previas };
      for (const [id, ruta] of resultados) {
        // Si esta vez no hay ruta, se conserva la anterior: mejor una ruta de
        // hace un minuto que volver de golpe a la línea recta.
        if (ruta) siguiente[id] = ruta;
      }
      for (const id of Object.keys(siguiente)) {
        if (!conUnidad.some((a) => String(a.id) === id)) delete siguiente[Number(id)];
      }
      return siguiente;
    });
  }, []);

  const load = useCallback(() => {
    boFetch<{ assistances: MapAssistance[]; workshops: MapWorkshop[] }>("/map")
      .then((d) => { setData(d); void cargarRutas(d.assistances); })
      .catch((e) => setError(e.message));
  }, [cargarRutas]);

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
          Modo ajuste activo: arrastra el marcador verde de un taller hasta su ubicación real y confirma para guardar las coordenadas GPS.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
          placeholder="Localidad, código postal, AP-7 km 234, coordenadas o enlace de Google Maps"
          className="w-[520px] max-w-full"
        />
        <Button onClick={buscar} disabled={buscando}>{buscando ? "Buscando…" : "Buscar en el mapa"}</Button>
        {busqueda && (
          <Button variant="ghost" onClick={() => { setBusqueda(null); setConsulta(""); }}>Quitar</Button>
        )}
      </div>

      {busqueda && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold text-amber-200">📍 {busqueda.etiqueta}</span>
            <span className="text-slate-400">
              {busqueda.punto.lat.toFixed(5)}, {busqueda.punto.lng.toFixed(5)} · {PRECISION_TEXTO[busqueda.precision]}
            </span>
          </div>
          {busqueda.avisos.map((a, i) => (
            <p key={i} className="mb-1 text-[12px] text-amber-300">⚠ {a}</p>
          ))}

          {busqueda.workshops.length === 0 ? (
            <p className="text-[13px] text-slate-400">No hay talleres en la red para comparar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-slate-700">
                  <Th>Taller más cercano</Th><Th>Empresa</Th><Th>Distancia</Th><Th>Cobertura</Th><Th>Teléfono</Th>
                </tr></thead>
                <tbody>
                  {busqueda.workshops.map((w) => (
                    <tr key={w.id} className="border-b border-slate-700/50">
                      <Td className="font-semibold text-slate-100">
                        {w.name}
                        {[w.city, w.province].filter(Boolean).length > 0 && (
                          <div className="text-[11px] font-normal text-slate-500">
                            {[w.city, w.province].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </Td>
                      <Td>{w.providerName ?? "-"}</Td>
                      <Td className="whitespace-nowrap">{w.distanceKm} km</Td>
                      <Td>
                        {!w.networkParticipation || w.connectStatus !== "active" ? (
                          <Badge className="border-slate-600 text-slate-400">No disponible</Badge>
                        ) : w.enCobertura ? (
                          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Dentro del radio</Badge>
                        ) : (
                          <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Fuera del radio</Badge>
                        )}
                      </Td>
                      <Td>{w.phone ? <a className="text-cyan-300 hover:underline" href={`tel:${w.phone}`}>{w.phone}</a> : "-"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Distancia en línea recta, para ordenar. La ETA real por carretera se calcula al asignar.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-700" style={{ height: "calc(100vh - 220px)" }}>
        <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }}>
          <ZoomWatcher onZoom={setZoom} />
          <IrAlPunto punto={busqueda?.punto ?? null} />
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {busqueda && (
            <>
              <Marker position={[busqueda.punto.lat, busqueda.punto.lng]} icon={searchIcon(zoom, busqueda.etiqueta)}>
                <Popup>
                  <b>{busqueda.etiqueta}</b><br />
                  {busqueda.punto.lat.toFixed(5)}, {busqueda.punto.lng.toFixed(5)} · {PRECISION_TEXTO[busqueda.precision]}<br />
                  {busqueda.workshops[0]
                    ? <>Taller más cercano: {busqueda.workshops[0].name} ({busqueda.workshops[0].distanceKm} km)</>
                    : "Sin talleres con los que comparar"}
                </Popup>
              </Marker>
              {/* Líneas al punto buscado desde los tres talleres más cercanos */}
              {busqueda.workshops.slice(0, 3).map((w) => {
                const taller = data?.workshops.find((x) => x.id === w.id);
                if (!taller) return null;
                return (
                  <Polyline
                    key={`b${w.id}`}
                    positions={[[busqueda.punto.lat, busqueda.punto.lng], [taller.latitude, taller.longitude]]}
                    pathOptions={{ color: w.enCobertura ? "#facc15" : "#64748b", weight: 2, dashArray: "4 6", opacity: 0.8 }}
                  />
                );
              })}
            </>
          )}
          {data?.workshops.map((w) => (
            <span key={`w${w.id}`}>
              <Marker
                position={[w.latitude, w.longitude]}
                icon={workshopIcon(zoom, w.name, colorEmpresa(w.companyType))}
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
            const vieja = conUnidad && posicionDesactualizada(a);
            const ruta = rutas[a.id];
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
                    {/* Ruta real por carretera; si no hay, línea recta discontinua
                        (y el popup avisa de que es una aproximación) */}
                    {ruta ? (
                      <Polyline
                        positions={ruta.points}
                        pathOptions={{ color: vieja ? "#64748b" : "#8b5cf6", weight: 4, opacity: 0.85 }}
                      />
                    ) : (
                      <Polyline
                        positions={[[a.vehicleLat!, a.vehicleLng!], [a.latitude, a.longitude]]}
                        pathOptions={{ color: vieja ? "#64748b" : "#8b5cf6", weight: 2, dashArray: "6 6", opacity: 0.85 }}
                      />
                    )}
                    <Marker
                      position={[a.vehicleLat!, a.vehicleLng!]}
                      icon={vehicleIcon(zoom, vieja, a.vehiclePlate ?? a.vehicleName ?? a.operatorName ?? `#${a.id}`)}
                    >
                      <Popup>
                        <b>{a.vehiclePlate ?? a.vehicleName ?? "Unidad asignada"}</b>
                        {a.vehiclePlate && a.vehicleName ? ` · ${a.vehicleName}` : ""}<br />
                        {a.operatorName && <>Operario: {a.operatorName}<br /></>}
                        Asistencia #{a.id} · {ASSISTANCE_STATUS_LABELS[a.status] ?? a.status}<br />
                        {ruta
                          ? <>Por carretera: {ruta.distanceKm} km · {ruta.etaMinutes} min<br /></>
                          : <>Sin ruta disponible: la línea es una aproximación en recta<br /></>}
                        {a.vehicleSpeedKmh != null && <>{Math.round(a.vehicleSpeedKmh)} km/h<br /></>}
                        {vieja ? "⚠ Posición desactualizada" : "Posición actual"}
                        {a.vehicleAtMs ? ` · ${haceCuanto(Number(a.vehicleAtMs))} (${fmtDateTime(Number(a.vehicleAtMs))})` : ""}
                        {a.vehicleConnection ? ` · ${a.vehicleConnection}` : ""}<br />
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

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-slate-400">
        <span className="text-slate-500">Talleres:</span>
        {Object.entries(TIPOS_EMPRESA).map(([tipo, { label, color }]) => (
          <span key={tipo} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full"
                  style={{ background: color, opacity: 0.4, border: `2px solid ${color}` }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
