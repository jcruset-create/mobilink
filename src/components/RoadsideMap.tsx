import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon paths broken by bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const vehicleIcon = L.divIcon({
  html: `
    <div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));line-height:0;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 62" width="56" height="35">
        <!-- carrocería -->
        <path d="M6 42 L6 20 Q6 12 14 10 L62 10 Q72 10 78 18 L90 34 L94 36 L94 44 Q94 48 90 48 L84 48" fill="#fff" stroke="#1a2744" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="M84 48 L26 48" fill="none" stroke="#1a2744" stroke-width="3.5"/>
        <path d="M6 48 L6 42" fill="none" stroke="#1a2744" stroke-width="3.5"/>
        <!-- franja lateral inferior -->
        <rect x="6" y="38" width="88" height="4" rx="1" fill="#e8eaf0"/>
        <!-- llave inglesa naranja -->
        <g transform="translate(38,20) rotate(38)">
          <rect x="-3" y="-13" width="6" height="26" rx="3" fill="#E8620A"/>
          <ellipse cx="0" cy="-13" rx="6" ry="5" fill="#E8620A"/>
          <ellipse cx="0" cy="13" rx="5" ry="4" fill="#E8620A"/>
          <ellipse cx="0" cy="-13" rx="3" ry="2.5" fill="#fff" opacity="0.3"/>
        </g>
        <!-- rueda trasera -->
        <circle cx="26" cy="48" r="10" fill="#1a2744" stroke="#1a2744" stroke-width="1"/>
        <circle cx="26" cy="48" r="5.5" fill="#fff"/>
        <circle cx="26" cy="48" r="2" fill="#1a2744"/>
        <!-- rueda delantera -->
        <circle cx="76" cy="48" r="10" fill="#1a2744" stroke="#1a2744" stroke-width="1"/>
        <circle cx="76" cy="48" r="5.5" fill="#fff"/>
        <circle cx="76" cy="48" r="2" fill="#1a2744"/>
        <!-- parachoques delantero -->
        <path d="M90 36 L96 38 L96 46 L90 46" fill="#ccc" stroke="#1a2744" stroke-width="2"/>
        <!-- faro -->
        <ellipse cx="92" cy="34" rx="3" ry="2" fill="#fffde0" stroke="#1a2744" stroke-width="1"/>
      </svg>
    </div>
  `,
  className: "",
  iconSize: [56, 35],
  iconAnchor: [28, 35],
  popupAnchor: [0, -35],
});

type Props = {
  assistanceLat: number;
  assistanceLng: number;
  vehicleLat?: number | null;
  vehicleLng?: number | null;
  etaMinutos?: number | null;
  etaKm?: string | null;
};

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [map, points]);

  return null;
}

export default function RoadsideMap({
  assistanceLat,
  assistanceLng,
  vehicleLat,
  vehicleLng,
  etaMinutos,
  etaKm,
}: Props) {
  const hasVehicle =
    vehicleLat != null &&
    vehicleLng != null &&
    Number.isFinite(vehicleLat) &&
    Number.isFinite(vehicleLng);

  const points: [number, number][] = [[assistanceLat, assistanceLng]];
  if (hasVehicle) points.push([vehicleLat!, vehicleLng!]);

  return (
    <MapContainer
      center={[assistanceLat, assistanceLng]}
      zoom={13}
      className="h-64 w-full rounded-lg"
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={points} />

      {/* Pin de la asistencia */}
      <Marker position={[assistanceLat, assistanceLng]}>
        <Popup>
          <strong>Punto de asistencia</strong>
        </Popup>
      </Marker>

      {/* Pin de la furgoneta (posición aproximada) */}
      {hasVehicle && (
        <Marker position={[vehicleLat!, vehicleLng!]} icon={vehicleIcon}>
          <Popup>
            <strong>Furgoneta</strong>
            {etaMinutos != null && etaKm != null && (
              <div>ETA: {etaMinutos} min · {etaKm} km</div>
            )}
            <div className="text-xs text-gray-500">Posición aproximada</div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
