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
    <div style="
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:30px;
      line-height:1;
      filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5));
    ">🚐</div>
  `,
  className: "",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
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
