import type { WorkshopId } from "./workshops";

export type RoadsideAssistanceStatus =
  | "pendiente"
  | "asignada"
  | "en_camino"
  | "en_punto"
  | "finalizada"
  | "llegada_taller"
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
  vehicleDescription?: string | null;
  webfleetVehicleId?: string | null;
  assignedTechName?: string | null;
  assignedVehicleName?: string | null;
  trackingToken: string;
  trackingWhatsappSentAtMs?: number | null;
  trackingWhatsappSid?: string | null;
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
  arrivedAtPointMs?: number | null;
  finishedAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
  cancelledAtMs?: number | null;
  updatedAtMs: number;
};

export type RoadsideAssistanceDraft = {
  customerName: string;
  customerPhone: string;
  address: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
  plate: string;
  vehicleDescription: string;
  webfleetVehicleId: string;
  assignedTechName: string;
  assignedVehicleName: string;
  priority: RoadsideAssistancePriority;
  notes: string;
  sendTrackingWhatsapp: boolean;
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
  events: Array<{
    status: RoadsideAssistanceStatus;
    createdAtMs: number;
  }>;
  files: RoadsideAssistanceFile[];
  vehiclePosition?: { lat: number; lng: number } | null;
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
  finalizada: "Finalizada",
  llegada_taller: "En taller",
  cancelada: "Cancelada",
};

export const ROADSIDE_ASSISTANCE_STATUS_FLOW: RoadsideAssistanceStatus[] = [
  "pendiente",
  "asignada",
  "en_camino",
  "en_punto",
  "finalizada",
  "llegada_taller",
];
