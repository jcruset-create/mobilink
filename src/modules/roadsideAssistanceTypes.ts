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
  notes?: string | null;
  active: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RoadsideVehicleDraft = {
  name: string;
  plate: string;
  webfleetVehicleId: string;
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

export type RoadsideTrackingResponse = {
  assistance: RoadsideAssistance;
  events: Array<{
    status: RoadsideAssistanceStatus;
    createdAtMs: number;
  }>;
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
