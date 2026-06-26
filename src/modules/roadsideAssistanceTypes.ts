import type { WorkshopId } from "./workshops";

export type RoadsideAssistanceStatus =
  | "pendiente"
  | "asignada"
  | "en_camino"
  | "en_punto"
  | "inicio_reparacion"
  | "finalizada"
  | "en_camino_base"
  | "llegada_taller"
  | "redirigida"
  | "cancelada";

export type RoadsideAssistancePriority = "normal" | "urgente";

export type RoadsideVehicle = {
  id: number;
  workshopId?: WorkshopId | string | null;
  name: string;
  plate?: string | null;
  webfleetVehicleId?: string | null;
  base?: string | null;
  marca?: string | null;
  modelo?: string | null;
  esTaller: boolean;
  notes?: string | null;
  active: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RoadsideVehicleDraft = {
  name: string;
  plate: string;
  webfleetVehicleId: string;
  base: string;
  marca: string;
  modelo: string;
  esTaller: boolean;
  notes: string;
  active: boolean;
};

export type RoadsideOperatorCode = {
  techName: string;
  code: string;
  hasCustomCode: boolean;
};

export type RoadsideAssistance = {
  id: number;
  workshopId?: WorkshopId | string | null;
  status: RoadsideAssistanceStatus;
  priority: RoadsideAssistancePriority;
  customerName: string;
  customerPhone: string;
  address: string;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  plate: string;
  plateRemolque?: string | null;
  descripcionAveria?: string | null;
  trabajosARealizar?: string | null;
  redirectionLat?: number | null;
  redirectionLng?: number | null;
  redirectedAtMs?: number | null;
  redirectedToId?: number | null;
  redirectedFromId?: number | null;
  vehicleDescription?: string | null;
  webfleetVehicleId?: string | null;
  assignedTechName?: string | null;
  assignedVehicleName?: string | null;
  trackingToken: string;
  trackingWhatsappSentAtMs?: number | null;
  trackingWhatsappSid?: string | null;
  waStatus?: string | null;
  waStatusAtMs?: number | null;
  notes?: string | null;
  createdAtMs: number;
  assignedAtMs?: number | null;
  departedAtMs?: number | null;
  etaMinutos?: number | null;
  etaKm?: string | null;
  etaActualizadoAt?: number | null;
  operatorLat?: number | null;
  operatorLng?: number | null;
  operatorLocationAtMs?: number | null;
  plateMismatch?: boolean;
  conductorNombre?: string | null;
  conductorDni?: string | null;
  reportToken?: string | null;
  whatsappAsignadaSentAtMs?: number | null;
  whatsappFinalizadaSentAtMs?: number | null;
  arrivedAtPointMs?: number | null;
  inicioReparacionAtMs?: number | null;
  finishedAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
  cancelledAtMs?: number | null;
  updatedAtMs: number;
};

export type RoadsideAssistanceDraft = {
  customerName: string;
  customerPhone: string;
  conductorNombre: string;
  address: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
  plate: string;
  plateRemolque: string;
  descripcionAveria: string;
  trabajosARealizar: string;
  vehicleDescription: string;
  webfleetVehicleId: string;
  assignedTechName: string;
  assignedVehicleName: string;
  priority: RoadsideAssistancePriority;
  notes: string;
  sendTrackingWhatsapp: boolean;
  redirectedFromId?: number | null;
  backoffice?: Record<string, unknown> | null;
};

export type RoadsideAssistanceEditDraft = RoadsideAssistanceDraft & {
  status: RoadsideAssistanceStatus;
  webfleetVehicleId: string;
  latitude: string;
  longitude: string;
};

export type RoadsideAssistanceFile = {
  id: number;
  assistanceId: number;
  kind: string;
  url: string;
  fileName?: string | null;
  detectedPlate?: string | null;
  createdAtMs: number;
};

export type RoadsideTrackingResponse = {
  assistance: RoadsideAssistance;
  vanPlate?: string | null;
  workshop?: { lat: number; lng: number } | null;
  events: Array<{
    status: RoadsideAssistanceStatus;
    createdAtMs: number;
  }>;
  files: RoadsideAssistanceFile[];
  vehiclePosition?: {
    lat: number;
    lng: number;
    speedKmh?: number | null;
    moving?: boolean | null;
  } | null;
  etaWarning?: string | null;
  expired: boolean;
};

export const ROADSIDE_ASSISTANCE_STATUS_LABELS: Record<
  RoadsideAssistanceStatus,
  string
> = {
  pendiente: "Pendiente",
  asignada: "Asignada",
  en_camino: "En camino",
  en_punto: "En punto",
  inicio_reparacion: "Reparando",
  finalizada: "Finalizada",
  en_camino_base: "En camino a taller",
  llegada_taller: "En taller ✓",
  redirigida: "Redirigida",
  cancelada: "Cancelada",
};

export const ROADSIDE_ASSISTANCE_STATUS_FLOW: RoadsideAssistanceStatus[] = [
  "pendiente",
  "asignada",
  "en_camino",
  "en_punto",
  "inicio_reparacion",
  "finalizada",
  "en_camino_base",
  "llegada_taller",
];
