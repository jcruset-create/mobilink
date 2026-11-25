/**
 * Movimientos y paradas de la furgoneta durante una asistencia: el mapa con el
 * recorrido y las paradas numeradas, y la línea de tiempo trayecto → parada →
 * trayecto con horas, kilómetros y duración. Los hitos de la asistencia
 * (llegada al punto, finalizada…) se marcan en la parada en que ocurrieron.
 *
 * Los datos son los de Webfleet, con la misma ventana que el PDF de
 * seguimiento, que se puede abrir desde aquí como informe aparte.
 */

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Tooltip, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FileText, X } from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";
import { apiFetch } from "../modules/apiFetch";
import { abrirPdfConSesion } from "../modules/pdfConSesion";

type Tramo =
  | { tipo: "trayecto"; inicioMs: number; finMs: number; segundos: number; km: number; desde: string | null; hasta: string | null; velocidadMax: number | null }
  | { tipo: "parada"; n: number; inicioMs: number; finMs: number; segundos: number; lugar: string; lat: number | null; lng: number | null; hitos: string[] };

type Respuesta = {
  disponible: boolean;
  motivo?: string;
  vehiculo?: string;
  desdeMs?: number;
  hastaMs?: number;
  resumen?: { km: number; conduccionSeg: number; paradoSeg: number; trayectos: number; paradas: number };
  tramos?: Tramo[];
  hitos?: { etiqueta: string; ms: number }[];
  track?: [number, number][];
};

const hora = (ms: number) => new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fecha = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });

export function duracion(seg: number) {
  const m = Math.round(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

function Encuadre({ puntos }: { puntos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (puntos.length === 0) return;
    map.fitBounds(L.latLngBounds(puntos), { padding: [24, 24] });
  }, [map, puntos]);
  return null;
}

export default function MovimientosFurgonetaModal({
  assistanceId,
  titulo,
  conTablet,
  onClose,
}: {
  assistanceId: number;
  titulo?: string;
  /** Si hay operario asignado: el recorrido con el GPS de la tablet, como alternativa. */
  conTablet?: boolean;
  onClose: () => void;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    apiFetch(`${API_BASE}/api/roadside-assistances/${assistanceId}/movimientos`, { headers: getAdminHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "Error de servidor");
        if (vivo) setDatos(d);
      })
      .catch((e) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [assistanceId]);

  const paradas = useMemo(
    () => (datos?.tramos ?? []).filter((t): t is Extract<Tramo, { tipo: "parada" }> => t.tipo === "parada" && t.lat != null && t.lng != null),
    [datos],
  );
  const puntos = useMemo<[number, number][]>(() => {
    const track = datos?.track ?? [];
    return track.length > 0 ? track : paradas.map((p) => [p.lat!, p.lng!]);
  }, [datos, paradas]);

  const abrir = (ruta: string, nombre: string) =>
    abrirPdfConSesion(apiFetch, `${API_BASE}/api/roadside-assistances/${assistanceId}/${ruta}`, nombre).catch((e) =>
      setError(e instanceof Error ? e.message : "No se pudo abrir el informe."),
    );

  const r = datos?.resumen;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-black">🛰️ Movimientos de la furgoneta</div>
            <div className="truncate text-xs text-slate-400">
              {titulo ?? `Asistencia #${assistanceId}`}
              {datos?.vehiculo ? ` · ${datos.vehiculo}` : ""}
              {datos?.desdeMs ? ` · ${fecha(datos.desdeMs)} ${hora(datos.desdeMs)} – ${hora(datos.hastaMs!)}` : ""}
            </div>
          </div>
          {datos?.disponible && (
            <button
              type="button"
              onClick={() => void abrir("tracking-report.pdf", `seguimiento_${assistanceId}.pdf`)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold hover:bg-slate-700"
            >
              <FileText className="h-4 w-4" /> Informe con plano (PDF)
            </button>
          )}
          {conTablet && (
            <button
              type="button"
              onClick={() => void abrir("tablet-report.pdf", `recorrido_tablet_${assistanceId}.pdf`)}
              className="inline-flex items-center gap-2 rounded-lg border border-teal-600/50 bg-teal-600/15 px-3 py-2 text-sm font-bold text-teal-300 hover:bg-teal-600/25"
            >
              📱 Recorrido tablet
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-800" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <div className="m-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {!datos && !error && <div className="p-8 text-center text-sm text-slate-400">Cargando movimientos de Webfleet…</div>}
        {datos && !datos.disponible && (
          <div className="p-8 text-center text-sm text-slate-400">
            {datos.motivo}
            {conTablet ? ". Puedes ver el recorrido con el GPS de la tablet." : "."}
          </div>
        )}

        {datos?.disponible && r && (
          <>
            <div className="grid grid-cols-2 gap-2 border-b border-slate-800 px-5 py-3 sm:grid-cols-4">
              {[
                ["Kilómetros", `${r.km.toLocaleString("es-ES")} km`],
                ["Conduciendo", duracion(r.conduccionSeg)],
                ["Parada", duracion(r.paradoSeg)],
                ["Paradas", String(r.paradas)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{k}</div>
                  <div className="text-lg font-black">{v}</div>
                </div>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_420px]">
              <div className="h-[320px] lg:h-auto">
                {puntos.length > 0 ? (
                  <MapContainer center={puntos[0]} zoom={11} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                      attribution="&copy; OpenStreetMap"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Encuadre puntos={puntos} />
                    {(datos.track?.length ?? 0) > 1 && <Polyline positions={datos.track!} pathOptions={{ color: "#3b82f6", weight: 4 }} />}
                    {puntos.length > 0 && (
                      <CircleMarker center={puntos[0]} radius={7} pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 1 }}>
                        <Tooltip>Salida</Tooltip>
                      </CircleMarker>
                    )}
                    {paradas.map((p) => (
                      <CircleMarker
                        key={p.n}
                        center={[p.lat!, p.lng!]}
                        radius={sel === p.n ? 12 : 9}
                        pathOptions={{ color: "#b45309", fillColor: sel === p.n ? "#f59e0b" : "#fbbf24", fillOpacity: 1 }}
                        eventHandlers={{ click: () => setSel(p.n) }}
                      >
                        <Tooltip permanent direction="center" className="!border-0 !bg-transparent !p-0 !text-[10px] !font-black !shadow-none">
                          {p.n}
                        </Tooltip>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Sin posiciones para dibujar el mapa</div>
                )}
              </div>

              <div className="min-h-0 overflow-y-auto border-l border-slate-800 px-4 py-3">
                {(datos.tramos ?? []).length === 0 && (
                  <div className="py-6 text-center text-sm text-slate-500">La furgoneta no se movió en este periodo.</div>
                )}
                <ol className="space-y-2">
                  {(datos.tramos ?? []).map((t, i) =>
                    t.tipo === "trayecto" ? (
                      <li key={i} className="flex gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                        <div className="text-lg">🚐</div>
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-bold">
                            Trayecto · {hora(t.inicioMs)} – {hora(t.finMs)}
                          </div>
                          <div className="text-xs text-slate-400">
                            {duracion(t.segundos)} · {t.km.toLocaleString("es-ES")} km
                            {t.velocidadMax ? ` · máx. ${Math.round(t.velocidadMax)} km/h` : ""}
                          </div>
                          {(t.desde || t.hasta) && (
                            <div className="truncate text-xs text-slate-500" title={`${t.desde ?? ""} → ${t.hasta ?? ""}`}>
                              {t.desde ?? "?"} → {t.hasta ?? "?"}
                            </div>
                          )}
                        </div>
                      </li>
                    ) : (
                      <li
                        key={i}
                        onClick={() => setSel(t.n)}
                        className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2 ${
                          sel === t.n ? "border-amber-400 bg-amber-500/15" : "border-amber-500/30 bg-amber-500/5"
                        }`}
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-slate-900">
                          {t.n}
                        </div>
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-bold">
                            Parada · {hora(t.inicioMs)} – {hora(t.finMs)} · {duracion(t.segundos)}
                          </div>
                          <div className="truncate text-xs text-slate-400" title={t.lugar}>
                            {t.lugar}
                          </div>
                          {t.hitos.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.hitos.map((h) => (
                                <span key={h} className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  {h}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
