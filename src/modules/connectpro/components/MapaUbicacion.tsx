/**
 * Connect Pro — ajustar a mano el punto de la asistencia.
 *
 * El buscador deja el punto donde el geocodificador cree que está, y eso a
 * veces es "el municipio" o "la calle", no el sitio. Quien atiende la llamada
 * sí sabe dónde está el camión —"en el parking de detrás de la nave", "pasado
 * el desvío"—, así que aquí puede moverlo: se arrastra la chincheta, o se
 * pulsa en el mapa y salta al punto pulsado.
 *
 * Es la misma capacidad que ya tiene el mapa operativo para colocar talleres,
 * traída al alta: de esta posición salen la distancia, el ETA y a qué taller
 * se manda, así que afinarla aquí vale más que corregirla después.
 */

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* Chincheta propia: los iconos por defecto de Leaflet se pierden al empaquetar
 * y saldría un hueco donde tiene que haber un punto. */
const CHINCHETA = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;
           transform:rotate(-45deg);background:#f43f5e;border:2px solid #fff;
           box-shadow:0 2px 5px rgba(0,0,0,.5)"></div>`,
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 18],
});

/** Recentra cuando el punto cambia desde fuera (una búsqueda nueva). */
function Recentrar({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], map.getZoom()); }, [lat, lng, map]);
  return null;
}

/** Pulsar en el mapa mueve el punto: más rápido que arrastrar en distancias largas. */
function PulsarParaMover({ onMover }: { onMover: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMover(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function MapaUbicacion({ lat, lng, onMover }: {
  lat: number;
  lng: number;
  onMover: (lat: number, lng: number) => void;
}) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-lg border border-slate-700" style={{ height: 260 }}>
        <MapContainer
          center={[lat, lng]}
          zoom={15}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recentrar lat={lat} lng={lng} />
          <PulsarParaMover onMover={onMover} />
          <Marker
            position={[lat, lng]}
            icon={CHINCHETA}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onMover(p.lat, p.lng);
              },
            }}
          />
        </MapContainer>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Arrastra la chincheta o pulsa en el mapa para afinar el punto. De aquí salen la
        distancia, el tiempo de llegada y el taller al que se manda.
      </p>
    </div>
  );
}
