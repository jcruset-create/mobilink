/**
 * Mobilink Assist — alta/edición de bases de cliente (lugares conocidos) con
 * el pin marcado en el mapa, al estilo Google Maps.
 *
 * Tres formas de fijar la ubicación:
 *  1. Clic en el mapa (o arrastrar el pin).
 *  2. Buscar una dirección (geocodificador del backend) y afinar el pin.
 *  3. Pegar un enlace de Google Maps o unas coordenadas "lat, lng".
 */

import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, MapPin, Search, Save } from "lucide-react";
import type { KnownPlace } from "../modules/roadsideAssistanceTypes";
import { createKnownPlace, updateKnownPlace, geocodeAddress } from "../modules/roadsideAssistanceApi";

// Icono por defecto de Leaflet (igual arreglo que en el mapa de flota)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const TIPOS = [
  { value: "base_cliente", label: "Base de cliente" },
  { value: "taller", label: "Taller" },
  { value: "otro", label: "Otro" },
];

// Centro por defecto: Tarragona
const DEFAULT_CENTER: [number, number] = [41.1189, 1.2445];

/** Extrae lat/lng de un enlace de Google Maps o de un texto "lat, lng". */
export function parseCoordsFromText(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  if (!t) return null;
  // @41.123,1.234  (URL de Google Maps)
  let m = t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  // !3d41.123!4d1.234  (URL de lugar de Google Maps)
  if (!m) m = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  // q=41.123,1.234 | query=41.123,1.234 | ll=41.123,1.234
  if (!m) m = t.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  // Texto plano "41.123, 1.234"
  if (!m) m = t.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

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
  // Se re-renderiza al cambiar pos y centra el mapa (zoom cercano para afinar)
  if (pos) map.flyTo(pos, Math.max(map.getZoom(), 16), { duration: 0.6 });
  return null;
}

type Props = {
  /** Lugar existente para editar; null/undefined = crear nuevo. */
  place?: KnownPlace | null;
  onClose: () => void;
  /** Se llama con el lugar guardado (creado o actualizado). */
  onSaved: (place: KnownPlace) => void;
};

export default function KnownPlaceMapModal({ place, onClose, onSaved }: Props) {
  const [nombre, setNombre] = useState(place?.nombre ?? "");
  const [tipo, setTipo] = useState(place?.tipo ?? "base_cliente");
  const [direccion, setDireccion] = useState(place?.direccion ?? "");
  const [clientName, setClientName] = useState(place?.clientName ?? "");
  const [pin, setPin] = useState<[number, number] | null>(
    place?.lat != null && place?.lng != null ? [place.lat, place.lng] : null
  );
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [saving, setSaving] = useState(false);
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
    // ¿Es un enlace de Google Maps o unas coordenadas pegadas?
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
        if (!direccion) setDireccion(r.formattedAddress ?? q);
      } else {
        setError("No se encontró la dirección. Prueba a hacer clic en el mapa.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo buscar la dirección.");
    } finally {
      setBuscando(false);
    }
  }

  async function guardar() {
    if (!nombre.trim()) { setError("Pon un nombre a la base."); return; }
    if (!pin) { setError("Marca la ubicación en el mapa (clic) o busca la dirección."); return; }
    setSaving(true);
    setError("");
    try {
      const body = {
        nombre: nombre.trim(),
        tipo,
        direccion: direccion.trim() || null,
        clientName: clientName.trim() || null,
        // El PUT del backend sobreescribe estos campos: enviarlos siempre
        clientId: place?.clientId ?? null,
        notas: place?.notas ?? null,
        lat: pin[0],
        lng: pin[1],
      };
      const saved = place?.id
        ? await updateKnownPlace(place.id, body)
        : await createKnownPlace(body);
      onSaved(saved as KnownPlace);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la base.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-8">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-red-400" />
            <h2 className="text-base font-bold">{place?.id ? "Editar base" : "Nueva base de cliente"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-700">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-y-auto md:grid-cols-[280px_1fr]">
          {/* Formulario */}
          <div className="space-y-3 border-b border-slate-700 p-4 md:border-b-0 md:border-r">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-400">Nombre *</span>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="P. ej. La Ponderosa"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-400">Tipo</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
              >
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                {!TIPOS.some((t) => t.value === tipo) && <option value={tipo}>{tipo}</option>}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-400">Cliente</span>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nombre del cliente (opcional)"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-slate-400">Dirección</span>
              <input
                value={direccion ?? ""}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Se rellena al buscar (opcional)"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
              />
            </label>

            <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
              <div className="font-bold uppercase text-slate-400">Coordenadas</div>
              {pin ? (
                <div className="mt-1 font-mono text-emerald-300">{pin[0]}, {pin[1]}</div>
              ) : (
                <div className="mt-1 text-slate-500">Haz clic en el mapa para marcar el punto</div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void guardar()}
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-500 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Guardando…" : "Guardar base"}
            </button>
          </div>

          {/* Mapa */}
          <div className="flex min-h-[380px] flex-col">
            <div className="flex gap-2 border-b border-slate-700 p-2">
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }}
                placeholder="Buscar dirección, pegar enlace de Google Maps o «lat, lng»"
                className="flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
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
            <div className="relative flex-1">
              <MapContainer center={center} zoom={pin ? 16 : 10} style={{ height: "100%", width: "100%", minHeight: 340 }} scrollWheelZoom>
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
          </div>
        </div>
      </div>
    </div>
  );
}
