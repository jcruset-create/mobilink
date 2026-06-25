import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  Home,
  ImageIcon,
  MapPin,
  Navigation,
  PenLine,
  Phone,
  Truck,
} from "lucide-react";

import { loadRoadsideTrackingFromBackend } from "../modules/roadsideAssistanceApi";
const RoadsideMap = lazy(() => import("../components/RoadsideMap"));
import type {
  RoadsideAssistance,
  RoadsideAssistanceFile,
  RoadsideAssistanceStatus,
  RoadsideTrackingResponse,
} from "../modules/roadsideAssistanceTypes";
import {
  ROADSIDE_ASSISTANCE_STATUS_FLOW,
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "../modules/roadsideAssistanceTypes";

const STATUS_STYLES: Record<RoadsideAssistanceStatus, string> = {
  pendiente: "border-amber-200 bg-amber-50 text-amber-800",
  asignada: "border-sky-200 bg-sky-50 text-sky-800",
  en_camino: "border-blue-200 bg-blue-50 text-blue-800",
  en_punto: "border-violet-200 bg-violet-50 text-violet-800",
  inicio_reparacion: "border-violet-200 bg-violet-50 text-violet-800",
  finalizada: "border-emerald-200 bg-emerald-50 text-emerald-800",
  en_camino_base: "border-teal-200 bg-teal-50 text-teal-800",
  llegada_taller: "border-slate-200 bg-slate-100 text-slate-700",
  redirigida: "border-orange-200 bg-orange-50 text-orange-800",
  cancelada: "border-red-200 bg-red-50 text-red-800",
};

function formatTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeWithSeconds(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getCurrentStep(status: RoadsideAssistanceStatus) {
  const index = ROADSIDE_ASSISTANCE_STATUS_FLOW.indexOf(status);
  return index === -1 ? 0 : index;
}

function getMapUrl(assistance: RoadsideAssistance) {
  if (assistance.googleMapsUrl) return assistance.googleMapsUrl;
  if (assistance.latitude != null && assistance.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${assistance.latitude},${assistance.longitude}`;
  }
  if (assistance.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(assistance.address)}`;
  }
  return "";
}

// ── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <img
        src={url}
        alt="foto asistencia"
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Photos section ───────────────────────────────────────────────────────────

function PhotosSection({ files }: { files: RoadsideAssistanceFile[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const photos = files.filter((f) => f.kind !== "firma");
  const signature = files.find((f) => f.kind === "firma");

  if (photos.length === 0 && !signature) return null;

  return (
    <>
      {photos.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
            <ImageIcon className="h-4 w-4" />
            Fotografías ({photos.length})
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setLightbox(f.url)}
                className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus:outline-none"
              >
                <img
                  src={f.url}
                  alt="foto asistencia"
                  className="h-32 w-full object-cover transition-opacity hover:opacity-90"
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {signature && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
            <PenLine className="h-4 w-4" />
            Firma del cliente
          </div>
          <div className="flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4">
            <img
              src={signature.url}
              alt="firma cliente"
              className="max-h-36 object-contain"
            />
          </div>
        </section>
      )}

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function RoadsideTrackingPage() {
  const { token } = useParams();
  const [data, setData] = useState<RoadsideTrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadTracking() {
      if (!token) {
        setError("Enlace de seguimiento no valido.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const response = await loadRoadsideTrackingFromBackend(token);
        if (!cancelled) setData(response);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No se pudo cargar el seguimiento."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTracking();

    const timer = window.setInterval(() => void loadTracking(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  const assistance = data?.assistance ?? null;
  const mapUrl = assistance ? getMapUrl(assistance) : "";

  const currentStep = useMemo(
    () => (assistance ? getCurrentStep(assistance.status) : 0),
    [assistance]
  );

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-black shadow-sm">
          <Clock3 className="h-5 w-5 text-slate-500" />
          Cargando seguimiento
        </div>
      </div>
    );
  }

  if (error || !assistance) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black">Seguimiento no disponible</h1>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            {error || "No se ha encontrado esta asistencia."}
          </p>
        </div>
      </div>
    );
  }

  const files: RoadsideAssistanceFile[] = data?.files ?? [];
  const isFinished =
    assistance.status === "llegada_taller" ||
    assistance.status === "cancelada";

  if (data?.expired) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
        <main className="mx-auto max-w-2xl space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-100">
              <CheckCircle2 className="h-7 w-7 text-slate-700" />
            </div>
            <h1 className="mt-4 text-2xl font-black">Seguimiento finalizado</h1>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Esta asistencia ya no muestra seguimiento activo.
            </p>
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
              Estado final: {ROADSIDE_ASSISTANCE_STATUS_LABELS[assistance.status]}
            </div>
          </div>

          {files.length > 0 && <PhotosSection files={files} />}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Cabecera con logo */}
      <header className="bg-[#16213e] px-6 py-3 flex items-center justify-center">
        <img src="/logo_horizontal.png" alt="SEA Assist" style={{height: 56}} />
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">

        {/* Header */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${STATUS_STYLES[assistance.status]}`}>
                {ROADSIDE_ASSISTANCE_STATUS_LABELS[assistance.status]}
              </div>
              <h1 className="mt-4 text-2xl font-black">Seguimiento asistencia</h1>
              <div className="mt-2 text-sm font-semibold text-slate-500">
                {assistance.plate || assistance.vehicleDescription || "Vehiculo"}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
              Actualizado: {formatTimeWithSeconds(assistance.updatedAtMs)}
            </div>
          </div>
        </section>

        {/* ETA banner */}
        {(assistance.status === "en_camino" || assistance.status === "en_camino_base") && (
          <section className={`rounded-lg border p-5 shadow-sm ${assistance.status === "en_camino_base" ? "border-teal-200 bg-teal-600" : "border-blue-200 bg-blue-600"}`}>
            <div className="flex items-center gap-3">
              <img src="/van-icon.png" style={{height:48,width:"auto",flexShrink:0}} alt="furgoneta" />
              <div className="text-white flex-1">
                <div className="text-lg font-black">
                  {assistance.status === "en_camino_base"
                    ? "El técnico vuelve al taller"
                    : "El técnico está en camino"}
                </div>
                {assistance.etaMinutos != null && assistance.etaKm != null ? (
                  <div className="mt-1 text-sm font-semibold text-blue-100">
                    Tiempo estimado de llegada:{" "}
                    <span className="font-black text-white">
                      {assistance.etaMinutos} min · {assistance.etaKm} km
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-sm font-semibold text-blue-100">
                    En camino hacia tu ubicación
                  </div>
                )}
                {assistance.etaActualizadoAt != null && (
                  <div className="mt-1 text-xs text-blue-200">
                    Actualizado: {formatTimeWithSeconds(assistance.etaActualizadoAt)}
                    {data?.etaWarning ? " · (usando último ETA guardado)" : ""}
                  </div>
                )}
                {data?.vehiclePosition?.moving != null && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-black text-white">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        data.vehiclePosition.moving
                          ? "bg-emerald-400"
                          : "bg-amber-300"
                      }`}
                    />
                    {data.vehiclePosition.moving
                      ? `En marcha${
                          data.vehiclePosition.speedKmh != null
                            ? ` · ${Math.round(data.vehiclePosition.speedKmh)} km/h`
                            : ""
                        }`
                      : "Parado"}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Mapa */}
        {assistance.latitude != null && assistance.longitude != null && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <Suspense
              fallback={
                <div className="flex h-64 items-center justify-center bg-slate-50 text-sm font-bold text-slate-400">
                  Cargando mapa…
                </div>
              }
            >
              <RoadsideMap
                assistanceLat={assistance.latitude}
                assistanceLng={assistance.longitude}
                vehicleLat={data?.vehiclePosition?.lat}
                vehicleLng={data?.vehiclePosition?.lng}
                vehiclePlate={data?.vanPlate || null}
                etaMinutos={assistance.etaMinutos}
                etaKm={assistance.etaKm}
                workshopLat={assistance.status === "en_camino_base" ? data?.workshop?.lat ?? null : null}
                workshopLng={assistance.status === "en_camino_base" ? data?.workshop?.lng ?? null : null}
              />
            </Suspense>
            {assistance.etaActualizadoAt != null && (
              <div className="px-4 py-2 text-xs font-semibold text-slate-400">
                Última actualización: {formatTimeWithSeconds(assistance.etaActualizadoAt)}
                {data?.etaWarning ? " · usando último ETA guardado" : ""}
              </div>
            )}
          </section>
        )}

        {/* Progress steps */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-2 grid-cols-2 md:grid-cols-7">
            {ROADSIDE_ASSISTANCE_STATUS_FLOW.map((status, index) => {
              const done = index <= currentStep;
              return (
                <div
                  key={status}
                  className={`rounded-lg border px-3 py-3 ${
                    done
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Clock3 className="h-4 w-4" />
                    )}
                    <div className="text-xs font-black">
                      {ROADSIDE_ASSISTANCE_STATUS_LABELS[status]}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Info cards */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
              <Truck className="h-4 w-4" />
              Asistencia
            </div>
            <div className="space-y-2 text-sm font-semibold text-slate-700">
              <div>Operario: {assistance.assignedTechName || "Pendiente"}</div>
              <div>Furgoneta: {assistance.assignedVehicleName || "Pendiente"}</div>
              <div>Salida: {formatTime(assistance.departedAtMs)}</div>
              <div>Llegada al punto: {formatTime(assistance.arrivedAtPointMs)}</div>
              {isFinished && (
                <div>Finalización: {formatTime(assistance.finishedAtMs)}</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
              <MapPin className="h-4 w-4" />
              Ubicacion
            </div>
            <div className="text-sm font-semibold text-slate-700">
              {assistance.address || "Ubicacion recibida"}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
                >
                  <Navigation className="h-4 w-4" />
                  Ver mapa
                </a>
              )}

              {assistance.customerPhone && (
                <a
                  href={`tel:${assistance.customerPhone}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                >
                  <Phone className="h-4 w-4" />
                  Llamar
                </a>
              )}
            </div>
          </div>
        </section>

        {/* Photos + signature — solo visibles si hay contenido */}
        {files.length > 0 && <PhotosSection files={files} />}

        {/* Events timeline */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
            <Home className="h-4 w-4" />
            Ultimos eventos
          </div>
          <div className="space-y-2">
            {data.events.length === 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-400">
                Sin eventos registrados.
              </div>
            )}

            {data.events.map((event, index) => (
              <div
                key={`${event.status}-${event.createdAtMs}-${index}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="font-black text-slate-700">
                  {ROADSIDE_ASSISTANCE_STATUS_LABELS[event.status]}
                </span>
                <span className="shrink-0 font-semibold text-slate-500">
                  {formatTime(event.createdAtMs)}
                </span>
              </div>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
