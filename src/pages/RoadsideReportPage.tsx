import { apiFetch } from "../modules/apiFetch";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Clock3,
  FileText,
  ImageIcon,
  MapPin,
  PenLine,
  Truck,
} from "lucide-react";
import type {
  RoadsideAssistance,
  RoadsideAssistanceFile,
  RoadsideAssistanceStatus,
} from "../modules/roadsideAssistanceTypes";
import {
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "../modules/roadsideAssistanceTypes";

interface ReportResponse {
  assistance: RoadsideAssistance;
  events: { status: RoadsideAssistanceStatus; createdAtMs: number }[];
  files: RoadsideAssistanceFile[];
  pdfUrl: string;
}

function formatDateTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

export default function RoadsideReportPage() {
  const { token } = useParams();
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Enlace de informe no válido.");
      setLoading(false);
      return;
    }

    apiFetch(`/api/roadside-report/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("Informe no encontrado.");
        return r.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Error cargando informe."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-black shadow-sm">
          <Clock3 className="h-5 w-5 text-slate-500" />
          Cargando informe
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black">Informe no disponible</h1>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            {error || "No se ha encontrado este informe."}
          </p>
        </div>
      </div>
    );
  }

  const { assistance, events, files } = data;
  const photos = files.filter((f) => f.kind !== "firma");
  const signature = files.find((f) => f.kind === "firma");

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <main className="mx-auto max-w-2xl space-y-4">

        {/* Header */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 text-emerald-700">
            <CheckCircle2 className="h-8 w-8" />
            <div>
              <h1 className="text-xl font-black">Asistencia finalizada</h1>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                {assistance.plate || assistance.vehicleDescription || "Vehículo"}
              </div>
            </div>
          </div>
        </section>

        {/* Datos */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
            <Truck className="h-4 w-4" />
            Datos de la asistencia
          </div>
          <div className="space-y-2 text-sm font-semibold text-slate-700">
            {assistance.customerName && <div>Cliente: {assistance.customerName}</div>}
            <div>Operario: {assistance.assignedTechName || "-"}</div>
            <div>Furgoneta: {assistance.assignedVehicleName || "-"}</div>
            <div>Inicio: {formatDateTime(assistance.departedAtMs)}</div>
            <div>Llegada al punto: {formatDateTime(assistance.arrivedAtPointMs)}</div>
            <div>Finalización: {formatDateTime(assistance.finishedAtMs)}</div>
            {assistance.conductorNombre && <div>Conductor: {assistance.conductorNombre}</div>}
            {assistance.conductorDni && <div>DNI/NIE: {assistance.conductorDni}</div>}
          </div>
        </section>

        {/* Dirección */}
        {assistance.address && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
              <MapPin className="h-4 w-4" />
              Ubicación
            </div>
            <div className="text-sm font-semibold text-slate-700">{assistance.address}</div>
          </section>
        )}

        {/* Descargar PDF */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
            <FileText className="h-4 w-4" />
            Informe completo
          </div>
          <a
            href={data.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800"
          >
            <FileText className="h-4 w-4" />
            Descargar PDF
          </a>
          <p className="mt-2 text-xs font-semibold text-slate-400">
            El informe incluye fotos, firma del conductor y mapa de ubicación.
          </p>
        </section>

        {/* Fotos */}
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

        {/* Firma */}
        {signature && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-slate-500">
              <PenLine className="h-4 w-4" />
              Firma del conductor
            </div>
            <div className="flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4">
              <img
                src={signature.url}
                alt="firma conductor"
                className="max-h-36 object-contain"
              />
            </div>
          </section>
        )}

        {/* Historial */}
        {events.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 text-sm font-black uppercase text-slate-500">
              Historial de estados
            </div>
            <div className="space-y-2">
              {events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="font-black text-slate-700">
                    {ROADSIDE_ASSISTANCE_STATUS_LABELS[ev.status]}
                  </span>
                  <span className="shrink-0 font-semibold text-slate-500">
                    {formatDateTime(ev.createdAtMs)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

      </main>

      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
