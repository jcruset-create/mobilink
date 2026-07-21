import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Home,
  Images,
  LocateFixed,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Send,
  X,
  XCircle,
  Briefcase,
  Settings,
  Map,
  List,
  Truck,
} from "lucide-react";
import RoadsideBackofficeModal, { type BackofficeData } from "./RoadsideBackofficeModal";
import WhatsAppCaptureSection from "./WhatsAppCaptureSection";
import type { RoadsideAssistanceFile } from "../modules/roadsideAssistanceTypes";
import RoadsideMap from "./RoadsideMap";
import {
  geocodeAddress,
  fetchKnownPlaces,
  updateKnownPlace,
  deleteKnownPlace,
} from "../modules/roadsideAssistanceApi";

import type { Tech } from "../modules/workshopTypes";
import { API_BASE } from "../modules/workshopApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceDraft,
  RoadsideAssistanceEditDraft,
  RoadsideAssistanceStatus,
  RoadsideVehicle,
  KnownPlace,
} from "../modules/roadsideAssistanceTypes";
import {
  ROADSIDE_ASSISTANCE_STATUS_FLOW,
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "../modules/roadsideAssistanceTypes";

const INITIAL_DRAFT: RoadsideAssistanceDraft = {
  customerName: "",
  customerPhone: "",
  conductorNombre: "",
  address: "",
  googleMapsUrl: "",
  latitude: "",
  longitude: "",
  plate: "",
  plateRemolque: "",
  esRemolque: false,
  descripcionAveria: "",
  trabajosARealizar: "",
  vehicleDescription: "",
  webfleetVehicleId: "",
  assignedTechName: "",
  assignedVehicleName: "",
  priority: "normal",
  notes: "",
  sendTrackingWhatsapp: true,
};

const INITIAL_EDIT_DRAFT: RoadsideAssistanceEditDraft = {
  ...INITIAL_DRAFT,
  status: "pendiente",
  webfleetVehicleId: "",
  latitude: "",
  longitude: "",
};

const STATUS_BADGES: Record<RoadsideAssistanceStatus, string> = {
  pendiente: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  asignada: "border-sky-500/30 bg-sky-500/15 text-sky-300",
  en_camino: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  en_punto: "border-violet-500/30 bg-violet-500/15 text-violet-300",
  inicio_reparacion: "border-orange-500/30 bg-orange-500/15 text-orange-300",
  finalizada: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  en_camino_base: "border-teal-500/30 bg-teal-500/15 text-teal-300",
  llegada_taller: "border-slate-500/30 bg-slate-500/20 text-slate-300",
  redirigida: "border-orange-500/30 bg-orange-500/15 text-orange-300",
  cancelada: "border-red-500/30 bg-red-500/15 text-red-300",
};

// Etiquetas cortas para la línea de estados de la tarjeta
const STEP_LABELS: Partial<Record<RoadsideAssistanceStatus, string>> = {
  pendiente: "Pendiente",
  asignada: "Asignada",
  en_camino: "En camino",
  en_punto: "En punto",
  inicio_reparacion: "Reparando",
  finalizada: "Finalizada",
  en_camino_base: "A taller",
  llegada_taller: "En taller",
};

/** Línea de estados: verde = completado, naranja = en curso, gris = pendiente. */
function StatusStepper({ status }: { status: RoadsideAssistanceStatus }) {
  const currentIndex = ROADSIDE_ASSISTANCE_STATUS_FLOW.indexOf(status);
  // Estados fuera del flujo (cancelada / redirigida): badge simple
  if (currentIndex === -1) {
    return (
      <span className={`inline-block rounded-full border px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGES[status]}`}>
        {ROADSIDE_ASSISTANCE_STATUS_LABELS[status]}
      </span>
    );
  }
  const last = ROADSIDE_ASSISTANCE_STATUS_FLOW.length - 1;
  return (
    <div className="flex items-start">
      {ROADSIDE_ASSISTANCE_STATUS_FLOW.map((st, i) => {
        const done = i < currentIndex;
        const current = i === currentIndex;
        const circle = done
          ? "bg-emerald-500 text-emerald-950"
          : current
          ? "bg-orange-500 text-orange-950 ring-4 ring-orange-500/25"
          : "border border-slate-600 bg-slate-900 text-slate-600";
        const label = done
          ? "text-emerald-300"
          : current
          ? "text-orange-300 font-bold"
          : "text-slate-500";
        return (
          <div key={st} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : i <= currentIndex ? "bg-emerald-500" : "bg-slate-700"}`} />
              <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${circle}`}>
                {done ? "✓" : i + 1}
              </div>
              <div className={`h-0.5 flex-1 ${i === last ? "opacity-0" : i < currentIndex ? "bg-emerald-500" : "bg-slate-700"}`} />
            </div>
            <span className={`mt-1 text-center text-[9px] leading-tight ${label}`}>
              {STEP_LABELS[st] ?? ROADSIDE_ASSISTANCE_STATUS_LABELS[st]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(value?: number | string | null) {
  if (!value) return "-";
  const d = new Date(value as number);
  if (isNaN(d.getTime())) return "-";

  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderWaStatus(waStatus?: string | null, atMs?: number | null) {
  if (!waStatus) return null;
  const hora = atMs ? ` ${formatTime(atMs)}` : "";
  switch (waStatus) {
    case "queued":
    case "sent":
      return <span className="text-slate-500">· ✓ Enviado{hora}</span>;
    case "delivered":
      return <span className="text-slate-600">· ✓✓ Entregado{hora}</span>;
    case "read":
      return <span className="text-sky-600">· ✓✓ Leído{hora}</span>;
    case "failed":
    case "undelivered":
      return <span className="text-red-600">· ✗ No entregado</span>;
    default:
      return <span className="text-slate-500">· {waStatus}</span>;
  }
}

function getNextStatus(
  status: RoadsideAssistanceStatus
): RoadsideAssistanceStatus | null {
  const index = ROADSIDE_ASSISTANCE_STATUS_FLOW.indexOf(status);
  if (index === -1) return null;

  return ROADSIDE_ASSISTANCE_STATUS_FLOW[index + 1] ?? null;
}

function getActionLabel(status: RoadsideAssistanceStatus) {
  if (status === "pendiente") return "Asignar";
  if (status === "asignada") return "En camino";
  if (status === "en_camino") return "Llegada";
  if (status === "en_punto") return "Finalizar";
  if (status === "finalizada") return "Taller";
  return "";
}

function getActionIcon(status: RoadsideAssistanceStatus) {
  if (status === "asignada") return Navigation;
  if (status === "en_camino") return MapPin;
  if (status === "en_punto") return CheckCircle2;
  if (status === "finalizada") return Home;
  return Send;
}

function isClosed(status: RoadsideAssistanceStatus) {
  return status === "llegada_taller" || status === "cancelada" || status === "redirigida";
}

function getTrackingUrl(assistance: RoadsideAssistance) {
  const path = `/seguimiento/${assistance.trackingToken}`;

  if (typeof window === "undefined") return path;

  return `${window.location.origin}${path}`;
}

function getMapUrl(assistance: RoadsideAssistance) {
  if (assistance.googleMapsUrl) return assistance.googleMapsUrl;

  if (assistance.latitude != null && assistance.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${assistance.latitude},${assistance.longitude}`;
  }

  if (assistance.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      assistance.address
    )}`;
  }

  return "";
}

function buildEditDraft(
  assistance: RoadsideAssistance
): RoadsideAssistanceEditDraft {
  return {
    customerName: assistance.customerName || "",
    customerPhone: assistance.customerPhone || "",
    conductorNombre: assistance.conductorNombre || "",
    address: assistance.address || "",
    googleMapsUrl: assistance.googleMapsUrl || "",
    plate: assistance.plate || "",
    plateRemolque: assistance.plateRemolque || "",
    esRemolque: assistance.esRemolque === true,
    descripcionAveria: assistance.descripcionAveria || "",
    trabajosARealizar: assistance.trabajosARealizar || "",
    vehicleDescription: assistance.vehicleDescription || "",
    assignedTechName: assistance.assignedTechName || "",
    assignedVehicleName: assistance.assignedVehicleName || "",
    priority: assistance.priority || "normal",
    notes: assistance.notes || "",
    status: assistance.status || "pendiente",
    webfleetVehicleId: assistance.webfleetVehicleId || "",
    latitude:
      assistance.latitude == null ? "" : String(assistance.latitude),
    longitude:
      assistance.longitude == null ? "" : String(assistance.longitude),
    sendTrackingWhatsapp: false,
  };
}

function getVehicleLabel(vehicle: RoadsideVehicle) {
  return [vehicle.name, vehicle.plate].filter(Boolean).join(" - ");
}

type WebfleetVehicle = { id: string; name: string };

type Props = {
  assistances: RoadsideAssistance[];
  techs: Tech[];
  vehicles: RoadsideVehicle[];
  webfleetVehicles: WebfleetVehicle[];
  currentBase?: string;
  loading: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => void;
  onOpenSettings?: () => void;
  onCreate: (draft: RoadsideAssistanceDraft) => Promise<void>;
  onUpdate: (
    assistance: RoadsideAssistance,
    draft: RoadsideAssistanceEditDraft
  ) => Promise<void>;
  onSendTrackingWhatsapp: (assistance: RoadsideAssistance) => Promise<void>;
  onEnCamino: (assistance: RoadsideAssistance) => Promise<void>;
  onStatusChange: (
    assistance: RoadsideAssistance,
    status: RoadsideAssistanceStatus
  ) => Promise<void>;
};

function ClosedAssistanceCard({
  assistance,
  onOpenBackoffice,
}: {
  assistance: RoadsideAssistance;
  onOpenBackoffice: (a: RoadsideAssistance) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="truncate text-sm font-bold text-slate-100">
          {assistance.plate || assistance.customerName}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_BADGES[assistance.status]}`}>
          {ROADSIDE_ASSISTANCE_STATUS_LABELS[assistance.status]}
        </span>
      </div>
      {assistance.customerName && (
        <div className="mt-0.5 truncate text-xs text-slate-400">{assistance.customerName}</div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">
          {formatTime(assistance.arrivedAtWorkshopMs || assistance.cancelledAtMs || assistance.finishedAtMs)}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="shrink-0 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/25"
            onClick={() => onOpenBackoffice(assistance)}
          >
            Back Office
          </button>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
            onClick={() => {
              const token = localStorage.getItem("sea-admin-token") ?? "";
              window.open(`/api/roadside-assistances/${assistance.id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
            }}
          >
            Ver informe
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoadsideAssistanceView({
  assistances,
  techs,
  vehicles,
  webfleetVehicles,
  currentBase,
  loading,
  error,
  onBack,
  onRefresh,
  onOpenSettings,
  onCreate,
  onUpdate,
  onSendTrackingWhatsapp,
  onEnCamino,
  onStatusChange,
}: Props) {
  const [draft, setDraft] = useState<RoadsideAssistanceDraft>(INITIAL_DRAFT);
  const [editingAssistance, setEditingAssistance] =
    useState<RoadsideAssistance | null>(null);
  const [editDraft, setEditDraft] =
    useState<RoadsideAssistanceEditDraft>(INITIAL_EDIT_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [localError, setLocalError] = useState("");
  const [editError, setEditError] = useState("");
  const [changingId, setChangingId] = useState<number | null>(null);
  const [redirectingId, setRedirectingId] = useState<number | null>(null);
  const [sendingWhatsappId, setSendingWhatsappId] = useState<number | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [photosAssistance, setPhotosAssistance] = useState<RoadsideAssistance | null>(null);
  const [photos, setPhotos] = useState<RoadsideAssistanceFile[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [mapAssistance, setMapAssistance] = useState<RoadsideAssistance | null>(null);
  const [workshopCoords, setWorkshopCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [livePos, setLivePos] = useState<{
    lat: number; lng: number; speedKmh: number | null; moving: boolean | null;
    etaMinutos: number | null; etaKm: string | null; destino: string;
  } | null>(null);
  const [reportAssistance, setReportAssistance] = useState<RoadsideAssistance | null>(null);
  const [reportChannels, setReportChannels] = useState<{ whatsapp: boolean; email: boolean }>({
    whatsapp: true,
    email: false,
  });
  const [reportEmail, setReportEmail] = useState("");
  const [sendingReport, setSendingReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState("");
  const [geocodingCreate, setGeocodingCreate] = useState(false);
  const [geocodeCreateError, setGeocodeCreateError] = useState("");
  const [geocodingEdit, setGeocodingEdit] = useState(false);
  const [geocodeEditError, setGeocodeEditError] = useState("");

  const [backofficeAssistance, setBackofficeAssistance] = useState<RoadsideAssistance | null>(null);
  const [showNewBackoffice, setShowNewBackoffice] = useState(false);
  const [knownPlaces, setKnownPlaces] = useState<KnownPlace[]>([]);
  const [showPlacesManager, setShowPlacesManager] = useState(false);

  useEffect(() => {
    fetchKnownPlaces().then(setKnownPlaces).catch(() => {});
  }, []);

  function applyKnownPlaceToDraft(placeId: string, edit: boolean) {
    const place = knownPlaces.find((p) => String(p.id) === placeId);
    if (!place) return;
    const patch = {
      address: place.direccion || place.nombre,
      latitude: place.lat != null ? String(place.lat) : "",
      longitude: place.lng != null ? String(place.lng) : "",
    };
    if (edit) setEditDraft((prev) => ({ ...prev, ...patch }));
    else setDraft((prev) => ({ ...prev, ...patch }));
  }
  const [whatsappCaptureId, setWhatsappCaptureId] = useState<number | null>(null);

  // ── Pestañas panel derecho ──────────────────────────────────────────────────
  type PanelTab = "nueva" | "activas" | "cerradas" | "historial";
  const [panelTab, setPanelTab] = useState<PanelTab>(() => {
    // Permite abrir directamente en una pestaña con ?tab=nueva|activas|... (p.ej. desde el hub)
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "nueva" || t === "activas" || t === "cerradas" || t === "historial") return t;
    }
    return "nueva";
  });

  // ── Historial ───────────────────────────────────────────────────────────────
  type HistorialItem = { id: number; plate: string; customerName: string; customerPhone: string; assignedTechName: string | null; status: RoadsideAssistanceStatus; createdAtMs: number; finishedAtMs: number | null; cancelledAtMs: number | null; arrivedAtWorkshopMs: number | null };
  const [historialItems, setHistorialItems] = useState<HistorialItem[]>([]);
  const [historialTotal, setHistorialTotal] = useState(0);
  const [historialPage, setHistorialPage] = useState(1);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [historialQ, setHistorialQ] = useState("");
  const [historialStatus, setHistorialStatus] = useState("");
  const [historialTech, setHistorialTech] = useState("");
  const [historialQInput, setHistorialQInput] = useState("");

  useEffect(() => {
    if (!photosAssistance) return;
    setPhotosLoading(true);
    fetch(`${API_BASE}/api/roadside-assistances/${photosAssistance.id}/files`)
      .then((r) => r.json())
      .then((data) => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => setPhotos([]))
      .finally(() => setPhotosLoading(false));
  }, [photosAssistance]);

  useEffect(() => {
    if (!mapAssistance) { setLivePos(null); return; }

    // Cargar coordenadas del taller si estamos en modo "vuelta al taller"
    if (mapAssistance.status === "en_camino_base" && !workshopCoords) {
      const token = localStorage.getItem("sea-admin-token") ?? "";
      fetch(`${API_BASE}/api/workshop-config`, { headers: { "x-admin-token": token } })
        .then((r) => r.json())
        .then((cfg) => {
          const lat = parseFloat(cfg.taller_lat);
          const lng = parseFloat(cfg.taller_lng);
          if (isFinite(lat) && isFinite(lng)) setWorkshopCoords({ lat, lng });
        })
        .catch(() => {});
    }

    const token = localStorage.getItem("sea-admin-token") ?? "";

    const refresh = () => {
      fetch(`${API_BASE}/api/roadside-assistances/${mapAssistance.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data?.assistance) setMapAssistance(data.assistance);
        })
        .catch(() => {});
    };

    // Posición en vivo (Webfleet) + velocidad + ETA
    const refreshLive = () => {
      fetch(`${API_BASE}/api/roadside-assistances/${mapAssistance.id}/live-position`, {
        headers: { "x-admin-token": token },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.available) {
            setLivePos({
              lat: d.lat, lng: d.lng, speedKmh: d.speedKmh, moving: d.moving,
              etaMinutos: d.etaMinutos, etaKm: d.etaKm, destino: d.destino,
            });
          }
        })
        .catch(() => {});
    };
    refreshLive();

    // Refrescar cada 15s
    const interval = setInterval(() => { refresh(); refreshLive(); }, 15000);
    return () => clearInterval(interval);
  }, [mapAssistance?.id]);

  useEffect(() => {
    if (panelTab !== "historial") return;
    setHistorialLoading(true);
    const params = new URLSearchParams();
    if (historialQ) params.set("q", historialQ);
    if (historialStatus) params.set("status", historialStatus);
    if (historialTech) params.set("techName", historialTech);
    params.set("page", String(historialPage));
    const token = localStorage.getItem("sea-admin-token") ?? "";
    fetch(`${API_BASE}/api/roadside-assistances/historial?${params}`, {
      headers: { "x-admin-token": token },
    })
      .then((r) => r.json())
      .then((d) => {
        setHistorialItems(Array.isArray(d.items) ? d.items : []);
        setHistorialTotal(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setHistorialLoading(false));
  }, [panelTab, historialQ, historialStatus, historialTech, historialPage]);

  function searchHistorial() {
    setHistorialQ(historialQInput);
    setHistorialPage(1);
  }

  const roadsideCapableTechs = useMemo(
    () => techs.filter((tech) => tech.roadsideCapable),
    [techs]
  );

  const editAssignableTechs = useMemo(() => {
    if (
      editDraft.assignedTechName &&
      !roadsideCapableTechs.some((tech) => tech.name === editDraft.assignedTechName)
    ) {
      const current = techs.find((tech) => tech.name === editDraft.assignedTechName);
      return current ? [current, ...roadsideCapableTechs] : roadsideCapableTechs;
    }
    return roadsideCapableTechs;
  }, [roadsideCapableTechs, techs, editDraft.assignedTechName]);

  const activeAssistances = useMemo(
    () => assistances.filter((item) => !isClosed(item.status)),
    [assistances]
  );

  const closedAssistances = useMemo(
    () => assistances.filter((item) => isClosed(item.status)).slice(0, 8),
    [assistances]
  );

  const statusCounts = useMemo(() => {
    return ROADSIDE_ASSISTANCE_STATUS_FLOW.map((status) => ({
      status,
      count: assistances.filter((item) => item.status === status).length,
    }));
  }, [assistances]);

  const activeVehicles = useMemo(
    () =>
      vehicles.filter((vehicle) => {
        if (!vehicle.active) return false;
        // Solo furgonetas de la base de la sede actual (las sin base se muestran igual)
        if (!currentBase || !vehicle.base) return true;
        return vehicle.base.trim().toLowerCase() === currentBase.trim().toLowerCase();
      }),
    [vehicles, currentBase]
  );

  async function handleRedirect(assistance: RoadsideAssistance) {
    setLocalError("");
    setRedirectingId(assistance.id);
    try {
      const token = localStorage.getItem("sea-admin-token") ?? "";
      const res = await fetch(
        `${API_BASE}/api/roadside-assistances/${assistance.id}/redirect`,
        { method: "POST", headers: { "x-admin-token": token, "Content-Type": "application/json" } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo redirigir");

      // Pre-rellenar el formulario de nueva asistencia con operario + furgoneta
      setDraft({
        ...INITIAL_DRAFT,
        assignedTechName: data.prefill?.assignedTechName ?? "",
        assignedVehicleName: data.prefill?.assignedVehicleName ?? "",
        webfleetVehicleId: data.prefill?.webfleetVehicleId ?? "",
        redirectedFromId: assistance.id,
      });
      onRefresh();
      // Llevar a la pantalla de nueva asistencia
      setPanelTab("nueva");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Error redirigiendo");
    } finally {
      setRedirectingId(null);
    }
  }

  async function handleCreate() {
    setLocalError("");

    const hasCustomer =
      draft.customerName.trim() || draft.customerPhone.trim();

    if (!hasCustomer) {
      setLocalError("Indica el nombre del cliente o teléfono.");
      return;
    }

    setSaving(true);

    try {
      await onCreate(draft);
      setDraft(INITIAL_DRAFT);
      setPanelTab("activas");
    } catch (createError) {
      setLocalError(
        createError instanceof Error
          ? createError.message
          : "No se pudo crear la asistencia."
      );
    } finally {
      setSaving(false);
    }
  }

  function applyVehicleToDraft(vehicleName: string) {
    const vehicle = activeVehicles.find((item) => item.name === vehicleName);

    setDraft((prev) => ({
      ...prev,
      assignedVehicleName: vehicleName,
      webfleetVehicleId: vehicle?.webfleetVehicleId ?? prev.webfleetVehicleId,
    }));
  }

  function applyVehicleToEditDraft(vehicleName: string) {
    const vehicle = activeVehicles.find((item) => item.name === vehicleName);

    setEditDraft((prev) => ({
      ...prev,
      assignedVehicleName: vehicleName,
      webfleetVehicleId: vehicle?.webfleetVehicleId || prev.webfleetVehicleId,
    }));
  }

  async function handleStatusChange(
    assistance: RoadsideAssistance,
    status: RoadsideAssistanceStatus
  ) {
    setChangingId(assistance.id);

    try {
      await onStatusChange(assistance, status);
    } finally {
      setChangingId(null);
    }
  }

  async function handleEnCamino(assistance: RoadsideAssistance) {
    if (!assistance.webfleetVehicleId) {
      setLocalError(
        "Asigna una furgoneta Webfleet antes de marcar como En camino."
      );
      return;
    }

    setChangingId(assistance.id);

    try {
      await onEnCamino(assistance);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Error al calcular ETA."
      );
    } finally {
      setChangingId(null);
    }
  }

  function openEditor(assistance: RoadsideAssistance) {
    setEditingAssistance(assistance);
    setEditDraft(buildEditDraft(assistance));
    setEditError("");
  }

  function closeEditor() {
    setEditingAssistance(null);
    setEditDraft(INITIAL_EDIT_DRAFT);
    setEditError("");
  }

  async function handleUpdate() {
    if (!editingAssistance) return;

    setEditError("");

    const hasCustomer =
      editDraft.customerName.trim() || editDraft.customerPhone.trim();
    if (!hasCustomer) {
      setEditError("Indica cliente o telefono.");
      return;
    }

    setSavingEdit(true);

    try {
      await onUpdate(editingAssistance, editDraft);
      closeEditor();
    } catch (updateError) {
      setEditError(
        updateError instanceof Error
          ? updateError.message
          : "No se pudo guardar la asistencia."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function copyTrackingLink(assistance: RoadsideAssistance) {
    const url = getTrackingUrl(assistance);

    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(assistance.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setLocalError("No se pudo copiar el enlace.");
    }
  }

  async function handleSendTrackingWhatsapp(assistance: RoadsideAssistance) {
    setLocalError("");
    setSendingWhatsappId(assistance.id);

    try {
      await onSendTrackingWhatsapp(assistance);
    } catch (sendError) {
      setLocalError(
        sendError instanceof Error
          ? sendError.message
          : "No se pudo enviar el WhatsApp."
      );
    } finally {
      setSendingWhatsappId(null);
    }
  }

  async function handleGeocodeCreate() {
    const query = draft.googleMapsUrl.trim() || draft.address.trim();
    if (!query) {
      setGeocodeCreateError("Indica una dirección o un enlace de Google Maps primero.");
      return;
    }
    setGeocodingCreate(true);
    setGeocodeCreateError("");
    try {
      const result = await geocodeAddress(query);
      setDraft((prev) => ({
        ...prev,
        latitude: String(result.lat),
        longitude: String(result.lng),
      }));
    } catch (geoError) {
      setGeocodeCreateError(
        geoError instanceof Error ? geoError.message : "Error geocodificando"
      );
    } finally {
      setGeocodingCreate(false);
    }
  }

  async function handleGeocodeEdit() {
    const query = editDraft.googleMapsUrl.trim() || editDraft.address.trim();
    if (!query) {
      setGeocodeEditError("Indica una dirección o un enlace de Google Maps primero.");
      return;
    }
    setGeocodingEdit(true);
    setGeocodeEditError("");
    try {
      const result = await geocodeAddress(query);
      setEditDraft((prev) => ({
        ...prev,
        latitude: String(result.lat),
        longitude: String(result.lng),
      }));
    } catch (geoError) {
      setGeocodeEditError(
        geoError instanceof Error ? geoError.message : "Error geocodificando"
      );
    } finally {
      setGeocodingEdit(false);
    }
  }

  function openReportModal(assistance: RoadsideAssistance) {
    setReportAssistance(assistance);
    setReportChannels({ whatsapp: !!assistance.customerPhone, email: false });
    setReportEmail("");
    setReportFeedback("");
  }

  async function handleSendReport() {
    if (!reportAssistance) return;
    const channels = Object.entries(reportChannels)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);

    if (channels.length === 0) {
      setReportFeedback("Selecciona al menos un canal de envío.");
      return;
    }
    if (reportChannels.email && !reportEmail.trim()) {
      setReportFeedback("Indica un email de destino.");
      return;
    }

    setSendingReport(true);
    setReportFeedback("");
    try {
      const res = await fetch(
        `${API_BASE}/api/roadside-assistances/${reportAssistance.id}/send-report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels, email: reportEmail.trim() }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error enviando informe");

      const parts: string[] = [];
      if (data.result?.whatsapp) parts.push(`WhatsApp: ${data.result.whatsapp}`);
      if (data.result?.email) parts.push(`Email: ${data.result.email}`);
      setReportFeedback(parts.join(" · ") || "Informe enviado");
    } catch (sendError) {
      setReportFeedback(
        sendError instanceof Error ? sendError.message : "Error enviando informe"
      );
    } finally {
      setSendingReport(false);
    }
  }

  const tabTitle =
    panelTab === "nueva"
      ? "Nueva asistencia"
      : panelTab === "activas"
      ? "Asistencias activas"
      : panelTab === "cerradas"
      ? "Últimas cerradas"
      : "Historial";

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      {/* ── Barra lateral ── */}
      <aside className="flex w-52 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 pt-3 text-sm">
          {([
            ["nueva", "Nueva asistencia", Plus, null],
            ["activas", "Activas", Clock3, activeAssistances.length],
            ["cerradas", "Últimas cerradas", CheckCircle2, null],
            ["historial", "Historial", FileText, null],
          ] as const).map(([tab, label, Icon, badge]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPanelTab(tab as PanelTab)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium transition-colors ${
                panelTab === tab
                  ? "bg-red-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {badge != null && badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    panelTab === tab ? "bg-red-800 text-white" : "bg-red-600 text-white"
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          ))}

          <div className="my-2 border-t border-slate-800" />
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Herramientas
          </div>
          <a
            href="/flota"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-slate-300 hover:bg-slate-800"
          >
            <Map className="h-4 w-4 shrink-0" /> Mapa flota
          </a>
          <button
            type="button"
            onClick={() => setShowPlacesManager(true)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium text-slate-300 hover:bg-slate-800"
          >
            <MapPin className="h-4 w-4 shrink-0" /> Lugares
          </button>
          <a
            href="/otf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-slate-300 hover:bg-slate-800"
          >
            <Truck className="h-4 w-4 shrink-0" /> OTF
          </a>
          <a
            href="/vehiculo"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-slate-300 hover:bg-slate-800"
          >
            <List className="h-4 w-4 shrink-0" /> Historial vehículo
          </a>
          <a
            href="/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-slate-300 hover:bg-slate-800"
          >
            <Home className="h-4 w-4 shrink-0" /> Panel
          </a>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left font-medium text-slate-300 hover:bg-slate-800"
            >
              <Settings className="h-4 w-4 shrink-0" /> Configuración
            </button>
          )}
        </nav>
        <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          Mobilink Assist
        </div>
      </aside>

      {/* ── Columna principal ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
              <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
            </div>
            <div>
              <h1 className="text-base font-bold">{tabTitle}</h1>
              <div className="text-xs text-slate-400">{activeAssistances.length} activas</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" /> Actualizar
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <Home className="h-4 w-4" /> Inicio
            </button>
          </div>
        </header>

        <main className="flex-1 space-y-4 overflow-auto p-4">
          <section className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {statusCounts.map(({ status, count }) => (
              <div
                key={status}
                className={`rounded-lg border px-2 py-1.5 ${STATUS_BADGES[status]}`}
              >
                <div className="text-[9px] font-bold uppercase leading-tight">
                  {ROADSIDE_ASSISTANCE_STATUS_LABELS[status]}
                </div>
                <div className="text-lg font-black leading-none">{count}</div>
              </div>
            ))}
          </section>

        <div className="space-y-5">
          {panelTab === "nueva" && (
          <div className="mx-auto w-full max-w-3xl">
          <section className="rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-300">
                Nueva asistencia
              </h2>
              <button
                type="button"
                onClick={() => setShowNewBackoffice(true)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                  draft.backoffice
                    ? "border-indigo-500/50 bg-indigo-500/25 text-indigo-200 hover:bg-indigo-500/35"
                    : "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                }`}
              >
                <Briefcase className="h-4 w-4" />
                {draft.backoffice ? "Back Office ✓" : "Back Office"}
              </button>
            </div>

            {draft.redirectedFromId && (
              <div className="mb-4 rounded-lg border border-orange-500/40 bg-orange-500/15 px-3 py-2 text-xs font-bold text-orange-300">
                ↪ Redirección de la asistencia #{draft.redirectedFromId}. Operario y furgoneta ya asignados.
              </div>
            )}

            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Cliente
                  </span>
                  <input
                    value={draft.customerName}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        customerName: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Telefono WhatsApp
                  </span>
                  <input
                    value={draft.customerPhone}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        customerPhone: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Conductor{" "}
                  <span className="font-normal text-slate-400">(opcional · la IA puede rellenarlo)</span>
                </span>
                <input
                  value={draft.conductorNombre}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      conductorNombre: event.target.value,
                    }))
                  }
                  placeholder="Nombre del conductor"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={draft.sendTrackingWhatsapp}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      sendTrackingWhatsapp: event.target.checked,
                    }))
                  }
                  className="accent-emerald-500"
                />
                <span className="text-sm font-bold text-emerald-300">
                  Enviar WhatsApp con enlace privado al crear
                </span>
              </label>

              {knownPlaces.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    📍 Lugar conocido{" "}
                    <span className="font-normal text-slate-400">(parking, base de cliente…)</span>
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => { applyKnownPlaceToDraft(e.target.value, false); e.target.value = ""; }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">— Elegir lugar conocido —</option>
                    {knownPlaces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}{p.clientName ? ` · ${p.clientName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Direccion{" "}
                  <span className="font-normal text-slate-400">(opcional · se puede recibir por WhatsApp)</span>
                </span>
                <input
                  value={draft.address}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      address: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Enlace Google Maps
                </span>
                <input
                  value={draft.googleMapsUrl}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      googleMapsUrl: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              <button
                type="button"
                onClick={handleGeocodeCreate}
                disabled={geocodingCreate}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
              >
                <LocateFixed className="h-4 w-4" />
                {geocodingCreate ? "Geocodificando..." : "Geocodificar dirección"}
              </button>
              {geocodeCreateError && (
                <div className="text-xs font-bold text-red-400">{geocodeCreateError}</div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Latitud
                  </span>
                  <input
                    value={draft.latitude}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, latitude: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Longitud
                  </span>
                  <input
                    value={draft.longitude}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, longitude: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Matricula camión
                  </span>
                  <input
                    value={draft.plate}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        plate: event.target.value.toUpperCase(),
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Matrícula remolque
                  </span>
                  <input
                    value={draft.plateRemolque}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        plateRemolque: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={draft.esRemolque}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        esRemolque: event.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-xs font-bold text-slate-600">
                    Asistencia al remolque (la matrícula del remolque será la principal)
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Vehiculo
                  </span>
                  <input
                    value={draft.vehicleDescription}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        vehicleDescription: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Operario
                  </span>
                  <select
                    value={draft.assignedTechName}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        assignedTechName: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">Sin asignar</option>
                    {roadsideCapableTechs.map((tech) => (
                      <option key={tech.name} value={tech.name}>
                        {tech.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Furgoneta
                  </span>
                  <select
                    value={draft.assignedVehicleName}
                    onChange={(event) =>
                      applyVehicleToDraft(event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">Sin asignar</option>
                    {activeVehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.name}>
                        {getVehicleLabel(vehicle)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {webfleetVehicles.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Furgoneta Webfleet
                  </span>
                  <select
                    value={draft.webfleetVehicleId}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        webfleetVehicleId: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">Sin asignar</option>
                    {webfleetVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                {(["normal", "urgente"] as const).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        priority,
                      }))
                    }
                    className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                      draft.priority === priority
                        ? "border-red-500/50 bg-red-500/20 text-red-300"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {priority === "urgente" ? "Urgente" : "Normal"}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Descripción de la avería
                </span>
                <textarea
                  value={draft.descripcionAveria}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, descripcionAveria: event.target.value }))
                  }
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Trabajos a realizar (instrucciones para el técnico)
                </span>
                <textarea
                  value={draft.trabajosARealizar}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, trabajosARealizar: event.target.value }))
                  }
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-400">
                  Observaciones
                </span>
                <textarea
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              </label>

              {(localError || error) && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300">
                  {localError || error}
                </div>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {saving ? "Guardando..." : "Crear asistencia"}
              </button>
            </div>
          </section>
          </div>
          )}

          <section className="space-y-3">
            {loading && panelTab !== "historial" && panelTab !== "nueva" && (
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                <Clock3 className="h-4 w-4 shrink-0" /> Cargando…
              </div>
            )}

            {/* ── Tab: Activas ── */}
            {panelTab === "activas" && activeAssistances.length === 0 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-8 text-center text-sm font-bold text-slate-400">
                Sin asistencias activas.
              </div>
            )}
            {panelTab === "activas" && activeAssistances.length > 0 && (

            <div className="grid gap-3 lg:grid-cols-2">
              {activeAssistances.map((assistance) => {
                const nextStatus = getNextStatus(assistance.status);
                const ActionIcon = getActionIcon(assistance.status);
                const mapUrl = getMapUrl(assistance);
                const trackingUrl = getTrackingUrl(assistance);

                return (
                  <article
                    key={assistance.id}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-lg font-black">
                            {assistance.plate ? (
                              <a
                                href={`/vehiculo?plate=${encodeURIComponent(assistance.plate)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-100 underline decoration-dotted hover:text-red-400"
                                title="Ver historial del vehículo"
                              >
                                {assistance.plate}
                              </a>
                            ) : "Sin matricula"}
                          </h3>
                          {assistance.priority === "urgente" && (
                            <span className="shrink-0 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
                              Urgente
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-slate-400">
                          {assistance.customerName || "Cliente sin nombre"}
                        </div>
                      </div>

                      <div className="shrink-0 text-right text-xs font-bold text-slate-500">
                        #{assistance.id}
                        <div>{formatTime(assistance.createdAtMs)}</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <StatusStepper status={assistance.status} />
                    </div>

                    <div className="mt-4 grid gap-2 text-sm">
                      {assistance.customerPhone && (
                        <a
                          href={`tel:${assistance.customerPhone}`}
                          className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 font-semibold text-slate-200"
                        >
                          <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">
                            {assistance.customerPhone}
                          </span>
                        </a>
                      )}

                      {mapUrl && (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 font-semibold text-slate-200"
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-emerald-400" />
                          <span className="truncate">
                            {assistance.address ||
                              assistance.googleMapsUrl ||
                              "Ubicacion"}
                          </span>
                        </a>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-slate-950 px-3 py-2">
                          <div className="text-[11px] font-bold uppercase text-slate-500">
                            Operario
                          </div>
                          <div className="truncate font-bold text-slate-200">
                            {assistance.assignedTechName || "Sin asignar"}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-950 px-3 py-2">
                          <div className="text-[11px] font-bold uppercase text-slate-500">
                            Furgoneta
                          </div>
                          <div className="truncate font-bold text-slate-200">
                            {assistance.assignedVehicleName || "-"}
                          </div>
                          {assistance.webfleetVehicleId && (
                            <div className="mt-0.5 truncate text-[10px] font-bold text-blue-400">
                              Webfleet: {assistance.webfleetVehicleId}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300">
                        WhatsApp seguimiento:{" "}
                        {assistance.trackingWhatsappSentAtMs
                          ? `enviado ${formatTime(
                              assistance.trackingWhatsappSentAtMs
                            )}`
                          : "pendiente"}
                        {assistance.trackingWhatsappSentAtMs && (
                          <span className="ml-2">{renderWaStatus(assistance.waStatus, assistance.waStatusAtMs)}</span>
                        )}
                      </div>
                    </div>

                    {assistance.status === "en_camino" && (
                      <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300">
                        <img src="/van-icon.png" style={{height:24,width:"auto",flexShrink:0}} alt="furgoneta" />
                        <span>
                          En camino
                          {assistance.etaMinutos != null && assistance.etaKm != null
                            ? ` — ETA: ${assistance.etaMinutos} min · ${assistance.etaKm} km`
                            : ""}
                        </span>
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                      <div>Salida: {formatTime(assistance.departedAtMs)}</div>
                      <div>Punto: {formatTime(assistance.arrivedAtPointMs)}</div>
                      <div>Fin: {formatTime(assistance.finishedAtMs)}</div>
                      <div>Taller: {formatTime(assistance.arrivedAtWorkshopMs)}</div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEditor(assistance)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
                      >
                        <Edit3 className="h-4 w-4" />
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => copyTrackingLink(assistance)}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300 hover:bg-blue-500/25"
                      >
                        <Copy className="h-4 w-4" />
                        {copiedId === assistance.id ? "Copiado" : "Copiar enlace"}
                      </button>

                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Seguimiento
                      </a>

                      <a
                        href={`${API_BASE}/api/roadside-assistances/${assistance.id}/report.pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
                      >
                        <FileText className="h-4 w-4" />
                        Informe PDF
                      </a>

                      {assistance.webfleetVehicleId && (
                        <button
                          type="button"
                          onClick={() => {
                            const token = localStorage.getItem("sea-admin-token") ?? "";
                            window.open(
                              `${API_BASE}/api/roadside-assistances/${assistance.id}/tracking-report.pdf?token=${encodeURIComponent(token)}`,
                              "_blank"
                            );
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
                        >
                          🛰️ Seguimiento furgoneta
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openReportModal(assistance)}
                        className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-sm font-bold text-indigo-300 hover:bg-indigo-500/25"
                      >
                        <Send className="h-4 w-4" />
                        Enviar informe
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSendTrackingWhatsapp(assistance)}
                        disabled={
                          sendingWhatsappId === assistance.id ||
                          !assistance.customerPhone
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-slate-800 px-3 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        {sendingWhatsappId === assistance.id
                          ? "Enviando..."
                          : "Enviar WhatsApp"}
                      </button>

                      {nextStatus && (
                        assistance.status === "asignada" ? (
                          <button
                            type="button"
                            onClick={() => handleEnCamino(assistance)}
                            disabled={
                              changingId === assistance.id ||
                              !assistance.webfleetVehicleId
                            }
                            title={
                              !assistance.webfleetVehicleId
                                ? "Asigna una furgoneta Webfleet primero"
                                : undefined
                            }
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-black text-white hover:bg-blue-800 disabled:opacity-50"
                          >
                            <ActionIcon className="h-4 w-4" />
                            En camino + ETA
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              handleStatusChange(assistance, nextStatus)
                            }
                            disabled={changingId === assistance.id}
                            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
                          >
                            <ActionIcon className="h-4 w-4" />
                            {getActionLabel(assistance.status)}
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        onClick={() => { setPhotosAssistance(assistance); setPhotos([]); }}
                        className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-sm font-bold text-violet-300 hover:bg-violet-500/25"
                      >
                        <Images className="h-4 w-4" />
                        Fotos
                      </button>

                      <button
                        type="button"
                        onClick={() => setBackofficeAssistance(assistance)}
                        className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-sm font-bold text-indigo-300 hover:bg-indigo-500/25"
                      >
                        <Briefcase className="h-4 w-4" />
                        Back Office
                      </button>

                      <button
                        type="button"
                        onClick={() => setWhatsappCaptureId(whatsappCaptureId === assistance.id ? null : assistance.id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-bold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        📲 Captura WhatsApp
                      </button>

                      {(assistance.status === "en_camino" ||
                        assistance.status === "en_punto" ||
                        assistance.status === "en_camino_base") &&
                        assistance.latitude != null &&
                        assistance.longitude != null && (
                          <button
                            type="button"
                            onClick={() => setMapAssistance(assistance)}
                            className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300 hover:bg-blue-500/25"
                          >
                            <LocateFixed className="h-4 w-4" />
                            Ubicación en vivo
                          </button>
                        )}

                      {assistance.status === "en_camino_base" && (
                        <button
                          type="button"
                          onClick={() => handleRedirect(assistance)}
                          disabled={redirectingId === assistance.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/20 px-3 py-2 text-sm font-bold text-orange-300 hover:bg-orange-500/30 disabled:opacity-50"
                        >
                          ↪ {redirectingId === assistance.id ? "Redirigiendo…" : "Redirigir a nueva asistencia"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(assistance, "cancelada")
                        }
                        disabled={changingId === assistance.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-slate-800 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/15 disabled:opacity-60"
                      >
                        <XCircle className="h-4 w-4" />
                        Cancelar
                      </button>
                    </div>

                    {/* WhatsApp Capture Section (inline) */}
                    {whatsappCaptureId === assistance.id && (
                      <WhatsAppCaptureSection
                        jobId={assistance.id}
                        jobPlate={assistance.plate}
                        onAssistanceUpdated={onRefresh}
                      />
                    )}
                  </article>
                );
              })}
            </div>
            )}

            {/* ── Tab: Últimas cerradas ── */}
            {panelTab === "cerradas" && (
              <div className="space-y-3">
                {closedAssistances.length === 0 ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-8 text-center text-sm font-bold text-slate-400">
                    Sin asistencias cerradas recientes.
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {closedAssistances.map((assistance) => (
                      <ClosedAssistanceCard
                        key={`closed-${assistance.id}`}
                        assistance={assistance}
                        onOpenBackoffice={setBackofficeAssistance}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Historial ── */}
            {panelTab === "historial" && (
              <div className="space-y-3">
                {/* Filtros */}
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
                  <div className="flex flex-wrap gap-2">
                    <div className="flex min-w-48 flex-1 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2">
                      <input
                        type="text"
                        placeholder="Buscar matrícula, cliente, teléfono, dirección…"
                        value={historialQInput}
                        onChange={(e) => setHistorialQInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchHistorial()}
                        className="w-full bg-transparent py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
                      />
                    </div>
                    <select
                      value={historialStatus}
                      onChange={(e) => { setHistorialStatus(e.target.value); setHistorialPage(1); setHistorialQ(historialQInput); }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    >
                      <option value="">Todos los estados</option>
                      <option value="pendiente">Pendiente</option>
                      <option value="asignada">Asignada</option>
                      <option value="en_camino">En camino</option>
                      <option value="en_punto">En punto</option>
                      <option value="finalizada">Finalizada</option>
                      <option value="en_camino_base">En camino a taller</option>
                      <option value="llegada_taller">En taller</option>
                      <option value="cancelada">Cancelada</option>
                    </select>
                    <select
                      value={historialTech}
                      onChange={(e) => { setHistorialTech(e.target.value); setHistorialPage(1); setHistorialQ(historialQInput); }}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    >
                      <option value="">Todos los operarios</option>
                      {techs.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={searchHistorial}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-500"
                    >
                      Buscar
                    </button>
                    {(historialQ || historialStatus || historialTech) && (
                      <button
                        type="button"
                        onClick={() => { setHistorialQ(""); setHistorialQInput(""); setHistorialStatus(""); setHistorialTech(""); setHistorialPage(1); }}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-slate-700"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                </div>

                {historialLoading ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-8 text-center text-sm font-bold text-slate-400">
                    Cargando…
                  </div>
                ) : historialItems.length === 0 ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-8 text-center text-sm font-bold text-slate-400">
                    Sin resultados.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-950 text-xs font-bold uppercase text-slate-500">
                          <th className="px-3 py-2 text-left">Fecha</th>
                          <th className="px-3 py-2 text-left">Matrícula</th>
                          <th className="px-3 py-2 text-left">Cliente</th>
                          <th className="px-3 py-2 text-left">Operario</th>
                          <th className="px-3 py-2 text-left">Estado</th>
                          <th className="px-3 py-2 text-left"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/60">
                        {historialItems.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-700/40">
                            <td className="px-3 py-2 text-xs text-slate-400">
                              {new Date(item.createdAtMs).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                              <div className="text-[10px] text-slate-500">{formatTime(item.createdAtMs)}</div>
                            </td>
                            <td className="px-3 py-2 font-bold text-slate-100">{item.plate || "—"}</td>
                            <td className="px-3 py-2 text-slate-300 max-w-[140px] truncate">{item.customerName || "—"}</td>
                            <td className="px-3 py-2 text-slate-400">{item.assignedTechName || "—"}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGES[item.status]}`}>
                                {ROADSIDE_ASSISTANCE_STATUS_LABELS[item.status]}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  className="rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/25"
                                  onClick={() => setBackofficeAssistance(item as any)}
                                >
                                  Back Office
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
                                  onClick={() => {
                                    const token = localStorage.getItem("sea-admin-token") ?? "";
                                    window.open(`/api/roadside-assistances/${item.id}/report.pdf?token=${encodeURIComponent(token)}`, "_blank");
                                  }}
                                >
                                  PDF
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Paginación */}
                    {historialTotal > 50 && (
                      <div className="flex items-center justify-between border-t border-slate-700 px-3 py-2 text-xs font-semibold text-slate-400">
                        <span>{historialTotal} resultados · pág. {historialPage} de {Math.ceil(historialTotal / 50)}</span>
                        <div className="flex gap-1">
                          <button type="button" disabled={historialPage <= 1} onClick={() => setHistorialPage((p) => p - 1)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300 disabled:opacity-40">←</button>
                          <button type="button" disabled={historialPage * 50 >= historialTotal} onClick={() => setHistorialPage((p) => p + 1)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300 disabled:opacity-40">→</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
        </main>
      </div>

      {editingAssistance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
                  <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">
                    Editar asistencia #{editingAssistance.id}
                  </h2>
                  <div className="mt-0.5 text-sm font-semibold text-slate-400">
                    {editingAssistance.plate || editingAssistance.customerName}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-700"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Estado
                  </span>
                  <select
                    value={editDraft.status}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        status: event.target.value as RoadsideAssistanceStatus,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    {[
                      ...ROADSIDE_ASSISTANCE_STATUS_FLOW,
                      "cancelada" as RoadsideAssistanceStatus,
                    ].map((status) => (
                      <option key={status} value={status}>
                        {ROADSIDE_ASSISTANCE_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Prioridad
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["normal", "urgente"] as const).map((priority) => (
                      <button
                        key={priority}
                        type="button"
                        onClick={() =>
                          setEditDraft((prev) => ({
                            ...prev,
                            priority,
                          }))
                        }
                        className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                          editDraft.priority === priority
                            ? "border-red-500/50 bg-red-500/20 text-red-300"
                            : "border-slate-700 bg-slate-950 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {priority === "urgente" ? "Urgente" : "Normal"}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Cliente
                  </span>
                  <input
                    value={editDraft.customerName}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        customerName: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Telefono WhatsApp
                  </span>
                  <input
                    value={editDraft.customerPhone}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        customerPhone: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                {knownPlaces.length > 0 && (
                  <label className="block md:col-span-2">
                    <span className="mb-1 block text-xs font-semibold text-slate-400">📍 Lugar conocido</span>
                    <select
                      defaultValue=""
                      onChange={(e) => { applyKnownPlaceToDraft(e.target.value, true); e.target.value = ""; }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                    >
                      <option value="">— Elegir lugar conocido —</option>
                      {knownPlaces.map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}{p.clientName ? ` · ${p.clientName}` : ""}</option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Direccion
                  </span>
                  <input
                    value={editDraft.address}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        address: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Enlace Google Maps
                  </span>
                  <input
                    value={editDraft.googleMapsUrl}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        googleMapsUrl: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={handleGeocodeEdit}
                    disabled={geocodingEdit}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                  >
                    <LocateFixed className="h-4 w-4" />
                    {geocodingEdit ? "Geocodificando..." : "Geocodificar dirección"}
                  </button>
                  {geocodeEditError && (
                    <div className="mt-1 text-xs font-bold text-red-600">{geocodeEditError}</div>
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Latitud
                  </span>
                  <input
                    value={editDraft.latitude}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        latitude: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Longitud
                  </span>
                  <input
                    value={editDraft.longitude}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        longitude: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Matricula camión
                  </span>
                  <input
                    value={editDraft.plate}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        plate: event.target.value.toUpperCase(),
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Matrícula remolque
                  </span>
                  <input
                    value={editDraft.plateRemolque}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        plateRemolque: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm uppercase text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={editDraft.esRemolque}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        esRemolque: event.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                  <span className="text-xs font-bold text-slate-600">
                    Asistencia al remolque (la matrícula del remolque será la principal)
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Vehiculo cliente
                  </span>
                  <input
                    value={editDraft.vehicleDescription}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        vehicleDescription: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Operario
                  </span>
                  <select
                    value={editDraft.assignedTechName}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        assignedTechName: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">Sin asignar</option>
                    {editAssignableTechs.map((tech) => (
                      <option key={tech.name} value={tech.name}>
                        {tech.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Furgoneta
                  </span>
                  <select
                    value={editDraft.assignedVehicleName}
                    onChange={(event) =>
                      applyVehicleToEditDraft(event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  >
                    <option value="">Sin asignar</option>
                    {activeVehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.name}>
                        {getVehicleLabel(vehicle)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Furgoneta Webfleet
                  </span>
                  {webfleetVehicles.length > 0 ? (
                    <select
                      value={editDraft.webfleetVehicleId}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          webfleetVehicleId: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                    >
                      <option value="">Sin asignar</option>
                      {webfleetVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={editDraft.webfleetVehicleId}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          webfleetVehicleId: event.target.value,
                        }))
                      }
                      placeholder="ID Webfleet"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                    />
                  )}
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Enlace privado cliente
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={getTrackingUrl(editingAssistance)}
                      readOnly
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => copyTrackingLink(editingAssistance)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-300 hover:bg-blue-500/25"
                    >
                      <Copy className="h-4 w-4" />
                      Copiar
                    </button>
                  </div>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={editDraft.sendTrackingWhatsapp}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        sendTrackingWhatsapp: event.target.checked,
                      }))
                    }
                    className="accent-emerald-500"
                  />
                  <span className="text-sm font-bold text-emerald-300">
                    Enviar WhatsApp con enlace privado al guardar
                  </span>
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Descripción de la avería
                  </span>
                  <textarea
                    value={editDraft.descripcionAveria}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, descripcionAveria: event.target.value }))
                    }
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Trabajos a realizar (instrucciones para el técnico)
                  </span>
                  <textarea
                    value={editDraft.trabajosARealizar}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, trabajosARealizar: event.target.value }))
                    }
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">
                    Observaciones
                  </span>
                  <textarea
                    value={editDraft.notes}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                    rows={3}
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                  />
                </label>
              </div>

              {editError && (
                <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-300">
                  {editError}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-5 py-4">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-700"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleUpdate}
                disabled={savingEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {savingEdit ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal fotos y firma */}
      {photosAssistance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
                  <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase text-slate-500">
                    Fotos y firma
                  </div>
                  <div className="font-bold text-slate-100">
                    #{photosAssistance.id} · {photosAssistance.plate || "Sin matrícula"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPhotosAssistance(null)}
                className="rounded-full p-2 hover:bg-slate-700"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {photosAssistance.plateMismatch && (
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-300">
                  ⚠️ La matrícula leída por IA en la foto no coincide con la matrícula
                  registrada ({photosAssistance.plate || "sin matrícula"}). Revísalo.
                </div>
              )}
              {photosLoading ? (
                <div className="py-12 text-center text-sm font-bold text-slate-400">
                  Cargando fotos...
                </div>
              ) : photos.length === 0 ? (
                <div className="py-12 text-center text-sm font-bold text-slate-400">
                  Sin fotos adjuntas
                </div>
              ) : (
                <div className="space-y-6">
                  {[
                    { kind: "matricula_camion", label: "Matrícula camión" },
                    { kind: "matricula_remolque", label: "Matrícula remolque" },
                    { kind: "averia", label: "Avería" },
                    { kind: "foto_averia", label: "Avería (antes de reparar)" },
                    { kind: "trabajo_realizado", label: "Trabajo realizado" },
                    { kind: "foto_reparacion", label: "Reparación finalizada" },
                    { kind: "foto_or", label: "OR manual (técnico)" },
                    { kind: "foto_extra", label: "Fotos adicionales" },
                    { kind: "firma", label: "Firma cliente" },
                    { kind: "foto", label: "Otras fotos" },
                  ].map(({ kind, label }) => {
                    const group = photos.filter((f) => f.kind === kind);
                    if (group.length === 0) return null;
                    return (
                      <div key={kind}>
                        <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                          {label}
                        </div>
                        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                          {group.map((file) => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => setLightboxUrl(file.url)}
                              className="overflow-hidden rounded-lg border border-slate-700 hover:opacity-90"
                            >
                              <img
                                src={file.url}
                                alt={label}
                                className="h-32 w-full object-cover"
                              />
                              {file.detectedPlate && (
                                <div className="bg-slate-900 px-2 py-1 text-center text-xs font-black text-white">
                                  IA: {file.detectedPlate}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal enviar informe */}
      {reportAssistance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
                  <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase text-slate-500">
                    Enviar informe
                  </div>
                  <div className="font-bold text-slate-100">
                    #{reportAssistance.id} · {reportAssistance.plate || "Sin matrícula"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReportAssistance(null)}
                className="rounded-full p-2 hover:bg-slate-700"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={reportChannels.whatsapp}
                  onChange={(e) =>
                    setReportChannels((prev) => ({ ...prev, whatsapp: e.target.checked }))
                  }
                  className="accent-red-500"
                />
                <Send className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-bold text-slate-200">
                  WhatsApp ({reportAssistance.customerPhone || "sin teléfono"})
                </span>
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={reportChannels.email}
                  onChange={(e) =>
                    setReportChannels((prev) => ({ ...prev, email: e.target.checked }))
                  }
                  className="accent-red-500"
                />
                <Mail className="h-4 w-4 text-indigo-400" />
                <span className="text-sm font-bold text-slate-200">Email</span>
              </label>

              {reportChannels.email && (
                <input
                  type="email"
                  placeholder="cliente@email.com"
                  value={reportEmail}
                  onChange={(e) => setReportEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40"
                />
              )}

              {reportFeedback && (
                <div className="text-sm font-bold text-slate-300">{reportFeedback}</div>
              )}

              <button
                type="button"
                onClick={handleSendReport}
                disabled={sendingReport}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {sendingReport ? "Enviando..." : "Enviar informe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal ubicación en vivo */}
      {mapAssistance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
                  <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase text-slate-500">
                    Ubicación en vivo
                  </div>
                  <div className="font-bold text-slate-100">
                    #{mapAssistance.id} · {mapAssistance.plate || "Sin matrícula"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMapAssistance(null)}
                className="rounded-full p-2 hover:bg-slate-700"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            <div className="p-5">
              {mapAssistance.latitude != null && mapAssistance.longitude != null ? (
                <>
                  <RoadsideMap
                    assistanceLat={mapAssistance.latitude}
                    assistanceLng={mapAssistance.longitude}
                    vehicleLat={livePos?.lat ?? mapAssistance.operatorLat ?? null}
                    vehicleLng={livePos?.lng ?? mapAssistance.operatorLng ?? null}
                    vehiclePlate={
                      vehicles.find(
                        (v) => v.webfleetVehicleId && v.webfleetVehicleId === mapAssistance.webfleetVehicleId
                      )?.plate || null
                    }
                    workshopLat={mapAssistance.status === "en_camino_base" ? workshopCoords?.lat : null}
                    workshopLng={mapAssistance.status === "en_camino_base" ? workshopCoords?.lng : null}
                  />

                  {/* Panel velocidad / km restantes / ETA */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Velocidad</div>
                      <div className="text-lg font-black text-slate-100">
                        {livePos?.speedKmh != null ? `${Math.round(livePos.speedKmh)}` : "-"}
                        <span className="text-xs font-bold text-slate-500"> km/h</span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">
                        {livePos?.destino === "taller" ? "Faltan (taller)" : "Faltan"}
                      </div>
                      <div className="text-lg font-black text-slate-100">
                        {livePos?.etaKm ?? mapAssistance.etaKm ?? "-"}
                        <span className="text-xs font-bold text-slate-500"> km</span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center">
                      <div className="text-[10px] font-bold uppercase text-slate-500">Llegada en</div>
                      <div className="text-lg font-black text-slate-100">
                        {(livePos?.etaMinutos ?? mapAssistance.etaMinutos) != null
                          ? `${livePos?.etaMinutos ?? mapAssistance.etaMinutos}`
                          : "-"}
                        <span className="text-xs font-bold text-slate-500"> min</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 text-xs font-bold text-slate-500">
                    {mapAssistance.status === "en_camino_base" && (
                      <span className="mr-2 rounded-full bg-teal-500/20 px-2 py-0.5 text-teal-300">🚐 Vuelta al taller · posición Webfleet</span>
                    )}
                    {livePos
                      ? `Actualizado: ${new Date().toLocaleTimeString()}`
                      : "Obteniendo posición…"}
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-sm font-bold text-slate-400">
                  Sin coordenadas de la asistencia
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Back Office */}
      {backofficeAssistance && (
        <RoadsideBackofficeModal
          assistance={backofficeAssistance}
          onClose={() => setBackofficeAssistance(null)}
        />
      )}

      {/* Modal gestión de Lugares Conocidos */}
      {showPlacesManager && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-10">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-[#101a33] px-2">
                  <img src="/logo_horizontal.png" alt="Mobilink Assist" className="h-7" />
                </div>
                <h2 className="text-lg font-bold text-slate-100">📍 Lugares conocidos</h2>
              </div>
              <button type="button" onClick={() => setShowPlacesManager(false)} className="rounded-full p-1 hover:bg-slate-700">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {knownPlaces.length === 0 ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  Aún no hay lugares. Se crean automáticamente cuando el operario llega a un punto nuevo.
                </div>
              ) : (
                <div className="space-y-2">
                  {knownPlaces.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <input
                          defaultValue={p.nombre}
                          onBlur={async (e) => {
                            const nombre = e.target.value.trim();
                            if (nombre && nombre !== p.nombre) {
                              await updateKnownPlace(p.id, { nombre });
                              setKnownPlaces((prev) => prev.map((x) => x.id === p.id ? { ...x, nombre } : x));
                            }
                          }}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-bold text-slate-100 outline-none focus:border-red-500"
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          {p.tipo}{p.direccion ? ` · ${p.direccion}` : ""}{p.clientName ? ` · ${p.clientName}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`¿Eliminar "${p.nombre}"?`)) return;
                          await deleteKnownPlace(p.id);
                          setKnownPlaces((prev) => prev.filter((x) => x.id !== p.id));
                        }}
                        className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/25"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Back Office en creación (borrador) */}
      {showNewBackoffice && (
        <RoadsideBackofficeModal
          draftMode
          initialData={(draft.backoffice as BackofficeData) ?? {}}
          onClose={() => setShowNewBackoffice(false)}
          onSaveDraft={(data) =>
            setDraft((prev) => ({ ...prev, backoffice: data as Record<string, unknown> }))
          }
        />
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Foto ampliada"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 hover:bg-white/30"
          >
            <X className="h-6 w-6 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
