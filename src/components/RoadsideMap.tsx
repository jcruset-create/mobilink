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

function makeVehicleIcon(plate?: string | null) {
  if (!plate) {
    return L.divIcon({
      html: `<img src="/van-icon.png" style="width:60px;height:90px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));" />`,
      className: "",
      iconSize: [60, 90],
      iconAnchor: [30, 90],
      popupAnchor: [0, -90],
    });
  }
  return L.divIcon({
    html: `
      <div style="text-align:center">
        <img src="/van-icon.png" style="width:60px;height:90px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));" />
        <div style="background:#1e3a5f;color:#f0c040;font-size:11px;font-weight:900;padding:2px 6px;border-radius:4px;margin-top:2px;white-space:nowrap;border:1px solid #2d4a6a;letter-spacing:0.5px;">
          ${plate}
        </div>
      </div>
    `,
    className: "",
    iconSize: [70, 110],
    iconAnchor: [35, 90],
    popupAnchor: [0, -94],
  });
}

const workshopIcon = L.divIcon({
  html: `<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">🏭</div>`,
  className: "",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20],
});

type Props = {
  assistanceLat: number;
  assistanceLng: number;
  vehicleLat?: number | null;
  vehicleLng?: number | null;
  vehiclePlate?: string | null;
  etaMinutos?: number | null;
  etaKm?: string | null;
  // Para modo "vuelta al taller": muestra el taller como destino
  workshopLat?: number | null;
  workshopLng?: number | null;
  workshopLabel?: string;
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
  vehiclePlate,
  etaMinutos,
  etaKm,
  workshopLat,
  workshopLng,
  workshopLabel = "Taller SEA",
}: Props) {
  const hasVehicle =
    vehicleLat != null &&
    vehicleLng != null &&
    Number.isFinite(vehicleLat) &&
    Number.isFinite(vehicleLng);

  const hasWorkshop =
    workshopLat != null &&
    workshopLng != null &&
    Number.isFinite(workshopLat) &&
    Number.isFinite(workshopLng);

  // En modo "vuelta al taller", el centro es el taller; si no, el punto de asistencia
  const centerLat = hasWorkshop ? workshopLat! : assistanceLat;
  const centerLng = hasWorkshop ? workshopLng! : assistanceLng;

  const points: [number, number][] = [];
  if (hasWorkshop) {
    points.push([workshopLat!, workshopLng!]);
  } else {
    points.push([assistanceLat, assistanceLng]);
  }
  if (hasVehicle) points.push([vehicleLat!, vehicleLng!]);

  return (
    <MapContainer
      center={[centerLat, centerLng]}
      zoom={13}
      className="h-64 w-full rounded-lg"
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={points} />

      {/* Pin del taller (destino de vuelta) o punto de asistencia */}
      {hasWorkshop ? (
        <Marker position={[workshopLat!, workshopLng!]} icon={workshopIcon}>
          <Popup><strong>{workshopLabel}</strong><br /><span className="text-xs text-gray-500">Destino</span></Popup>
        </Marker>
      ) : (
        <Marker position={[assistanceLat, assistanceLng]}>
          <Popup><strong>Punto de asistencia</strong></Popup>
        </Marker>
      )}

      {/* Pin de la furgoneta */}
      {hasVehicle && (
        <Marker position={[vehicleLat!, vehicleLng!]} icon={makeVehicleIcon(vehiclePlate)}>
          <Popup>
            <strong>Furgoneta</strong>
            {etaMinutos != null && etaKm != null && (
              <div>ETA: {etaMinutos} min · {etaKm} km</div>
            )}
            <div className="text-xs text-gray-500">Posición {hasWorkshop ? "Webfleet" : "aproximada"}</div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
