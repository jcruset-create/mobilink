/**
 * Mobilink Assist — selector de punto en el mapa (al estilo del alta de
 * bases): clic o arrastrar el pin, buscar dirección o pegar un enlace de
 * Google Maps. Devuelve lat/lng al confirmar; no guarda nada por sí mismo.
 */

import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, MapPin, Search, Check } from "lucide-react";
import { geocodeAddress } from "../modules/roadsideAssistanceApi";
import { parseCoordsFromText } from "./KnownPlaceMapModal";

// Icono por defecto de Leaflet (mismo arreglo que en el resto de mapas)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const DEFAULT_CENTER: [number, number] = [41.1189, 1.2445]; // Tarragona

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap();
  if (pos) map.flyTo(pos, Math.max(map.getZoom(), 16), { duration: 0.6 });
  return null;
}

type Props = {
  /** Posición inicial (p. ej. la ya escrita en el formulario). */
  initialLat?: number | null;
  initialLng?: number | null;
  /** Texto para pre-cargar la búsqueda (p. ej. la dirección del formulario). */
  initialQuery?: string;
  onClose: () => void;
  /** Confirmación: coordenadas elegidas (y la dirección si vino del geocoder). */
  onPick: (lat: number, lng: number, direccion?: string | null) => void;
};

export default function LocationPickerModal({ initialLat, initialLng, initialQuery, onClose, onPick }: Props) {
  const [pin, setPin] = useState<[number, number] | null>(
    initialLat != null && initialLng != null ? [initialLat, initialLng] : null
  );
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [busqueda, setBusqueda] = useState(initialQuery ?? "");
  const [buscando, setBuscando] = useState(false);
  const [direccion, setDireccion] = useState<string | null>(null);
  const [error, setError] = useState("");

  const center = useMemo<[number, number]>(() => pin ?? DEFAULT_CENTER, []);

  function ponPin(lat: number, lng: number, volar = false) {
    const p: [number, number] = [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
    setPin(p);
    if (volar) setFlyTarget(p);
    setError("");
  }

  async function buscar() {
    const q = busqueda.trim();
    if (!q) return;
    const coords = parseCoordsFromText(q);
    if (coords) {
      ponPin(coords.lat, coords.lng, true);
      return;
    }
    setBuscando(true);
    setError("");
    try {
      const r = await geocodeAddress(q);
      if (r?.lat != null && r?.lng != null) {
        ponPin(Number(r.lat), Number(r.lng), true);
        setDireccion(r.formattedAddress ?? q);
      } else {
        setError("No se encontró la dirección. Haz clic en el mapa.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar la dirección.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-8">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-red-400" />
            <h2 className="text-base font-bold">Marcar la posición de la asistencia</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-700">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-700 p-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
            placeholder="Buscar dirección, pegar enlace de Google Maps o «lat, lng»"
            className="flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-orange-500"
          />
          <button
            type="button"
            onClick={() => void buscar()}
            disabled={buscando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-bold hover:bg-slate-600 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {buscando ? "…" : "Buscar"}
          </button>
        </div>

        <div className="relative min-h-[380px] flex-1">
          <MapContainer center={center} zoom={pin ? 16 : 10} style={{ height: "100%", width: "100%", minHeight: 380 }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPlace onPick={(lat, lng) => ponPin(lat, lng)} />
            <FlyTo pos={flyTarget} />
            {pin && (
              <Marker
                position={pin}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    ponPin(ll.lat, ll.lng);
                  },
                }}
              />
            )}
          </MapContainer>
          <div className="pointer-events-none absolute bottom-2 left-2 z-[500] rounded-lg bg-slate-900/85 px-2.5 py-1.5 text-[11px] font-bold text-slate-300">
            Clic para poner el pin · arrástralo para afinar
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-700 px-4 py-3">
          <div className="min-w-0 text-xs">
            {error ? (
              <span className="font-bold text-red-300">{error}</span>
            ) : pin ? (
              <span className="font-mono text-emerald-300">{pin[0]}, {pin[1]}</span>
            ) : (
              <span className="text-slate-500">Marca el punto en el mapa</span>
            )}
          </div>
          <button
            type="button"
            disabled={!pin}
            onClick={() => { if (pin) { onPick(pin[0], pin[1], direccion); onClose(); } }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-500 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Usar esta posición
          </button>
        </div>
      </div>
    </div>
  );
}
