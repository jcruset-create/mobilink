/**
 * El patio de una base en mapa, en el panel. El mismo mapa que la tablet
 * (`mapa_base_screen.dart`): cada autobús con la revisión pendiente es una
 * etiqueta con su matrícula.
 *
 * - Rojo, sin revisión; ámbar, vencida; amarillo, próxima.
 * - Borde discontinuo y reloj: la posición tiene más de una hora.
 * - Los que se pisan se apilan (hasta tres); «+N más» abre la lista del grupo.
 * - Al pulsar una etiqueta sale abajo su ficha: «Iniciar revisión», «Ficha» y
 *   «Cómo llegar».
 *
 * Fondo: satélite de Google (la clave se queda en el servidor, ver
 * server/tyrecontrol/satelite/) o el plano de OpenStreetMap. Si Google no da
 * imágenes con la clave que hay, el satélite cae a Esri, que no pide clave, y
 * se dice cuál se está viendo.
 */

import { useEffect, useMemo, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Clock, Crosshair, Footprints, X } from "lucide-react";

import type { BaseGeo } from "../services/presenciaBases";
import {
  MAX_A_LA_VISTA,
  agruparPines,
  cuentaPorEstado,
  estadoMasUrgente,
  posicionUtil,
  rutaHasta,
  type GrupoDePines,
  type PinDeMapa,
} from "../services/mapaBase";
import { minutosEnPalabras } from "../services/presenciaVista";
import { authHeaders } from "../services/data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";

const COLOR: Record<string, string> = { sin_revision: "#ef4444", vencida: "#f59e0b", proxima: "#fde047" };
const TEXTO_SOBRE: Record<string, string> = { sin_revision: "#fff", vencida: "#1c1917", proxima: "#1c1917" };
const NOMBRE: Record<string, string> = { sin_revision: "Sin revisión", vencida: "Vencida", proxima: "Próxima" };

type Fondo = "satelite" | "plano";
type Satelite = { tipo: "google"; url: string } | { tipo: "esri" } | null;

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Pide al servidor la firma para las teselas de Google. Sin ella, Esri. */
async function pedirSatelite(): Promise<Satelite> {
  try {
    const r = await fetch(`${API}/api/tyrecontrol/satelite/sesion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    });
    if (!r.ok) return { tipo: "esri" };
    const d = (await r.json()) as { firma: string; expira: number };
    return { tipo: "google", url: `${API}/api/tyrecontrol/satelite/{z}/{x}/{y}?f=${d.firma}&e=${d.expira}` };
  } catch {
    return { tipo: "esri" };
  }
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function chip(p: PinDeMapa, elegido: boolean): string {
  const c = COLOR[p.rev.estado] ?? "#94a3b8";
  const t = TEXTO_SOBRE[p.rev.estado] ?? "#111";
  const borde = p.vieja ? `2px dashed ${elegido ? "#fff" : "#0f172a"}` : `2px solid ${elegido ? "#fff" : "#0f172a"}`;
  const sombra = elegido ? "box-shadow:0 0 0 3px #38bdf8;" : "";
  return (
    `<div data-id="${escapar(p.v.vehiculo_id)}" style="background:${c};color:${t};border:${borde};${sombra}` +
    `border-radius:7px;padding:2px 7px;font:800 13px/1.25 system-ui,sans-serif;letter-spacing:.3px;` +
    `white-space:nowrap;cursor:pointer;text-align:center">` +
    `${p.vieja ? "🕑 " : ""}${escapar(p.v.vehiculo?.matricula ?? "—")}</div>`
  );
}

/** La etiqueta de un grupo: hasta tres matrículas apiladas y «+N más». */
function iconoGrupo(g: GrupoDePines, elegido: string | null): L.DivIcon {
  const vista = g.pines.slice(0, MAX_A_LA_VISTA);
  const ocultos = g.pines.length - vista.length;
  const filas = vista.map((p) => chip(p, p.v.vehiculo_id === elegido)).join('<div style="height:2px"></div>');
  const mas = ocultos > 0
    ? `<div data-mas="1" style="margin-top:2px;background:#0f172a;color:#e2e8f0;border-radius:7px;padding:2px 7px;` +
      `font:700 12px system-ui,sans-serif;cursor:pointer;text-align:center">+${ocultos} más</div>`
    : "";
  const punta = `<div style="width:0;height:0;margin:0 auto;border-left:7px solid transparent;` +
    `border-right:7px solid transparent;border-top:8px solid ${COLOR[estadoMasUrgente(g)] ?? "#94a3b8"}"></div>`;
  const alto = vista.length * 24 + (ocultos > 0 ? 24 : 0) + 8;
  return L.divIcon({
    className: "",
    html: `<div style="width:118px">${filas}${mas}${punta}</div>`,
    iconSize: [118, alto],
    // La punta, y no el centro de la etiqueta, es el sitio del autobús.
    iconAnchor: [59, alto],
  });
}

function Zoom({ onZoom }: { onZoom: (z: number) => void }) {
  const mapa = useMapEvents({ zoomend: () => onZoom(mapa.getZoom()) });
  return null;
}

function Encuadre({ limites, pulso }: { limites: L.LatLngBounds | null; pulso: number }) {
  const mapa = useMap();
  useEffect(() => {
    if (limites) mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 18 });
  }, [mapa, limites, pulso]);
  return null;
}

export default function MapaBaseModal({
  base,
  pines,
  onCerrar,
  onRevisar,
  onFicha,
}: {
  base: BaseGeo;
  pines: PinDeMapa[];
  onCerrar: () => void;
  onRevisar: (p: PinDeMapa) => void;
  onFicha: (p: PinDeMapa) => void;
}) {
  const [zoom, setZoom] = useState(17);
  const [elegido, setElegido] = useState<string | null>(null);
  const [grupoAbierto, setGrupoAbierto] = useState<GrupoDePines | null>(null);
  const [fondo, setFondo] = useState<Fondo>("satelite");
  const [satelite, setSatelite] = useState<Satelite>(null);
  const [pulso, setPulso] = useState(0);

  useEffect(() => {
    let vivo = true;
    void pedirSatelite().then((s) => vivo && setSatelite(s));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  const grupos = useMemo(() => agruparPines(pines, zoom, { zoomMaximo: Infinity, separacionPx: 110 }), [pines, zoom]);
  const cuenta = useMemo(() => cuentaPorEstado(pines), [pines]);
  const pinElegido = pines.find((p) => p.v.vehiculo_id === elegido) ?? null;

  const centro: [number, number] = posicionUtil(base.lat, base.lng)
    ? [base.lat, base.lng]
    : pines.length
      ? [pines[0].lat, pines[0].lng]
      : [41.1189, 1.2445];

  /** La geo-zona entera y los autobuses: lo que se ve al abrir. */
  const limites = useMemo(() => {
    const puntos: L.LatLng[] = pines.map((p) => L.latLng(p.lat, p.lng));
    if (posicionUtil(base.lat, base.lng)) {
      const c = L.latLng(base.lat, base.lng);
      const r = (base.radioM ?? 0) > 0 ? base.radioM! : 150;
      const b = c.toBounds(r * 2);
      puntos.push(b.getNorthWest(), b.getSouthEast());
    }
    return puntos.length >= 2 ? L.latLngBounds(puntos) : null;
  }, [base, pines]);

  function pulsarGrupo(g: GrupoDePines, e: L.LeafletMouseEvent) {
    const destino = (e.originalEvent.target as HTMLElement | null)?.closest("[data-id],[data-mas]") as HTMLElement | null;
    if (destino?.dataset.mas) return setGrupoAbierto(g);
    const id = destino?.dataset.id ?? g.pines[0].v.vehiculo_id;
    setElegido(id);
  }

  const capaSatelite =
    satelite?.tipo === "google" ? (
      <TileLayer key="google" url={satelite.url} maxZoom={21} maxNativeZoom={21}
        attribution="Imágenes &copy; Google" />
    ) : satelite?.tipo === "esri" ? (
      <TileLayer key="esri" url={ESRI} maxZoom={21} maxNativeZoom={19}
        attribution="Imágenes &copy; Esri, Maxar, Earthstar Geographics" />
    ) : null;

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col bg-slate-950/80 p-3 md:p-6" role="dialog" aria-modal="true"
      aria-label={`Mapa de ${base.nombre}`}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-slate-100">{base.nombre}</div>
            <div className="text-[13px] text-slate-400">
              {pines.length === 0
                ? "Ningún autobús pendiente dentro de la base"
                : `${pines.length} con revisión pendiente dentro de la base`}
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-slate-600 text-[13px] font-bold">
            {(["satelite", "plano"] as Fondo[]).map((f) => (
              <button key={f} onClick={() => setFondo(f)}
                className={`px-3 py-1.5 ${fondo === f ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                {f === "satelite" ? "Satélite" : "Mapa"}
              </button>
            ))}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar el mapa"
            className="rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <MapContainer center={centro} zoom={17} maxZoom={21} minZoom={12} className="h-full w-full"
            style={{ background: "#0f172a" }}>
            {fondo === "plano" ? (
              <TileLayer key="osm" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={21} maxNativeZoom={19}
                attribution="&copy; OpenStreetMap" />
            ) : capaSatelite}
            <Zoom onZoom={setZoom} />
            <Encuadre limites={limites} pulso={pulso} />
            {posicionUtil(base.lat, base.lng) && (base.radioM ?? 0) > 0 && (
              <Circle center={[base.lat, base.lng]} radius={base.radioM!}
                pathOptions={{ color: "#22c55e", weight: 2, fillOpacity: 0.07 }} />
            )}
            {grupos.map((g) => (
              <Marker key={g.pines.map((p) => p.v.vehiculo_id).join("|")} position={[g.lat, g.lng]}
                icon={iconoGrupo(g, elegido)} eventHandlers={{ click: (e) => pulsarGrupo(g, e) }} />
            ))}
          </MapContainer>

          {/* Leyenda */}
          <div className="pointer-events-none absolute left-14 top-3 z-[500] rounded-xl bg-slate-900/90 px-3 py-2 text-[12px] text-slate-200 shadow">
            {(["sin_revision", "vencida", "proxima"] as const).map((e) => (
              <div key={e} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded" style={{ background: COLOR[e] }} />
                {NOMBRE[e]} <b>{cuenta[e] ?? 0}</b>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-1 text-slate-400">
              <Clock size={12} /> posición de hace más de 1 h
            </div>
            {fondo === "satelite" && satelite && (
              <div className="mt-1 text-slate-400">
                Satélite: {satelite.tipo === "google" ? "Google" : "Esri (Google no disponible)"}
              </div>
            )}
          </div>

          <button onClick={() => setPulso((n) => n + 1)} title="Centrar en la base"
            className="absolute right-3 top-3 z-[500] rounded-xl bg-slate-900/90 p-2.5 text-slate-200 shadow hover:bg-slate-800">
            <Crosshair size={18} />
          </button>

          {/* La ficha del elegido */}
          {pinElegido && (
            <div className="absolute inset-x-3 bottom-3 z-[500] mx-auto max-w-xl rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-xl">
              <div className="flex items-start gap-3">
                <span className="rounded-md px-2 py-0.5 text-[15px] font-extrabold"
                  style={{ background: COLOR[pinElegido.rev.estado], color: TEXTO_SOBRE[pinElegido.rev.estado] }}>
                  {pinElegido.v.vehiculo?.matricula}
                </span>
                {pinElegido.v.vehiculo?.numero_unidad && (
                  <span className="text-[15px] font-extrabold text-slate-100">Nº {pinElegido.v.vehiculo.numero_unidad}</span>
                )}
                <div className="flex-1 text-[13px] text-slate-400">
                  {NOMBRE[pinElegido.rev.estado]}
                  {pinElegido.rev.estado === "vencida" && (pinElegido.rev.dias_vencido ?? 0) > 0
                    ? ` · ${pinElegido.rev.dias_vencido} d` : ""}
                  {" · posición de hace "}{minutosEnPalabras(pinElegido.v.antiguedad_min)}
                </div>
                <button onClick={() => setElegido(null)} aria-label="Cerrar la ficha" className="text-slate-400 hover:text-slate-200">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => onRevisar(pinElegido)}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-[13px] font-bold text-emerald-950 hover:bg-emerald-400">
                  Iniciar revisión
                </button>
                <button onClick={() => onFicha(pinElegido)}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-[13px] font-bold text-slate-200 hover:bg-slate-800">
                  Ficha del vehículo
                </button>
                <a href={rutaHasta(pinElegido.lat, pinElegido.lng)} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg border border-sky-600 px-3 py-2 text-[13px] font-bold text-sky-300 hover:bg-sky-500/10">
                  <Footprints size={14} /> Cómo llegar
                </a>
              </div>
            </div>
          )}

          {/* Un grupo que no cabe entero en su etiqueta */}
          {grupoAbierto && (
            <div className="absolute inset-0 z-[600] flex items-end justify-center bg-slate-950/60 p-3 md:items-center"
              onClick={() => setGrupoAbierto(null)}>
              <div className="max-h-[70%] w-full max-w-lg overflow-auto rounded-2xl border border-slate-700 bg-slate-900 p-4"
                onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 text-[16px] font-extrabold text-slate-100">{grupoAbierto.pines.length} autobuses juntos</div>
                <div className="flex flex-col gap-2">
                  {grupoAbierto.pines.map((p) => (
                    <div key={p.v.vehiculo_id} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2">
                      <button onClick={() => { setElegido(p.v.vehiculo_id); setGrupoAbierto(null); }}
                        className="rounded-md px-2 py-0.5 text-[14px] font-extrabold"
                        style={{ background: COLOR[p.rev.estado], color: TEXTO_SOBRE[p.rev.estado] }}>
                        {p.v.vehiculo?.matricula}
                      </button>
                      {p.v.vehiculo?.numero_unidad && (
                        <span className="text-[14px] font-bold text-slate-200">Nº {p.v.vehiculo.numero_unidad}</span>
                      )}
                      <span className="flex-1 text-[12px] text-slate-400">
                        {NOMBRE[p.rev.estado]}{p.vieja ? " · posición de hace más de 1 h" : ""}
                      </span>
                      <button onClick={() => onRevisar(p)}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-bold text-emerald-950">Revisar</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
