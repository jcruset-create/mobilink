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

export type KnownPlace = {
  id: number;
  nombre: string;
  tipo: string;
  direccion?: string | null;
  lat: number | null;
  lng: number | null;
  clientId?: number | null;
  clientName?: string | null;
  notas?: string | null;
  active?: boolean;
  createdAtMs?: number | null;
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
  /**
   * El servicio lo hace un taller de la red y nadie va a ir mandando los ocho
   * estados. Marca ORTOGONAL: el estado operativo sigue siendo el que era.
   */
  sinSeguimiento?: boolean;
  sinSeguimientoAtMs?: number | null;
  /**
   * La autorización que damos NOSOTROS al taller subcontratado, para que la
   * ponga en su albarán y su factura. No confundir con `solicitanteAutorizacion`,
   * que es la que nos dan a nosotros la aseguradora o el gestor de flota.
   */
  autorizacionTaller?: string | null;
  esRemolque?: boolean;
  origen?: "central" | "taller";
  expedienteCentral?: string | null;
  descripcionAveria?: string | null;
  trabajosARealizar?: string | null;
  /**
   * Fotos para la tira de la tarjeta, sin la firma ni los adjuntos que no son
   * imagen. Las manda el LISTADO con cada asistencia; el resto de respuestas
   * no las traen y aquí llegan vacías, que se pinta igual que «no hay fotos».
   *
   * `fotosTotal` cuenta TODAS y `fotosMiniaturas` solo las primeras: el «+N»
   * de la tarjeta se calcula con el total, no con lo recibido.
   */
  fotosTotal?: number;
  fotosMiniaturas?: { id: number; url: string; kind: string }[];
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
  // Quién solicita la asistencia (puede ser distinto del cliente servido)
  solicitanteEmpresa?: string | null;
  solicitanteNombre?: string | null;
  /**
   * El ENLACE con la ficha del cliente que solicita, no una copia de su
   * nombre. Es lo que ata la asistencia al maestro y al ERP; el texto de
   * `solicitanteEmpresa` se conserva al lado porque es lo que se escribió ese
   * día, y si mañana el cliente cambia de nombre la asistencia antigua tiene
   * que seguir contando lo que pasó.
   *
   * No confundir con `clienteFacturacionId`: quien pide el servicio y a quien
   * se le factura no siempre son el mismo.
   */
  solicitanteClienteId?: number | null;
  /** Qué persona de esa ficha llamó (contacto con ownerType='client'). */
  solicitanteContactoId?: number | null;
  solicitanteTelefono?: string | null;
  // Nº de autorización o de cita que da quien solicita: es lo que luego pide
  // la aseguradora o el gestor de flota para pagar el servicio.
  solicitanteAutorizacion?: string | null;
  // Subcontratación: a quién se le ha mandado el trabajo. Los ids apuntan a las
  // mismas tablas que usa Connect Pro; el snapshot congela nombres y teléfonos
  // tal y como estaban el día del servicio.
  proveedorId?: number | null;
  proveedorTallerId?: number | null;
  proveedorContactoId?: number | null;
  clienteFacturacionId?: number | null;
  subcontrataSnapshot?: Record<string, string> | null;
  reportToken?: string | null;
  whatsappAsignadaSentAtMs?: number | null;
  whatsappFinalizadaSentAtMs?: number | null;
  arrivedAtPointMs?: number | null;
  inicioReparacionAtMs?: number | null;
  finishedAtMs?: number | null;
  enCaminoBaseAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
  cancelledAtMs?: number | null;
  updatedAtMs: number;
};

export type RoadsideAssistanceDraft = {
  solicitanteEmpresa: string;
  solicitanteClienteId: number | null;
  solicitanteContactoId: number | null;
  solicitanteNombre: string;
  solicitanteTelefono: string;
  solicitanteAutorizacion: string;
  customerName: string;
  customerPhone: string;
  conductorNombre: string;
  address: string;
  googleMapsUrl: string;
  latitude: string;
  longitude: string;
  plate: string;
  plateRemolque: string;
  esRemolque: boolean;
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
  vanMarca?: string | null;
  vanModelo?: string | null;
  workshop?: { lat: number; lng: number } | null;
  /** Teléfono del técnico asignado (para que el cliente pueda llamarle). */
  techPhone?: string | null;
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
  // El estado interno sigue llamándose `pendiente` en la base de datos y en
  // la API. Lo que cambia es cómo se llama de cara a quien lo lee: una
  // asistencia recién dada de alta ya está gestionada, no pendiente.
  pendiente: "Gestionada",
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
