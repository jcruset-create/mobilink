export type WhatsAppCaptureStatus = "ACTIVE" | "CLOSED";

export type WhatsAppMessageType =
  | "text"
  | "location"
  | "contact"
  | "image"
  | "video"
  | "audio"
  | "document";

export type WhatsAppCaptureSession = {
  id: number;
  job_id: number;
  status: WhatsAppCaptureStatus;
  started_at: number;
  ended_at: number | null;
  created_by: string | null;
  ai_suggestions: WhatsAppAiSuggestions | null;
};

export type WhatsAppCaptureMessage = {
  id: number;
  session_id: number;
  job_id: number;
  message_sid: string | null;
  from_phone: string | null;
  message_type: WhatsAppMessageType;
  text_content: string | null;
  media_url: string | null;
  media_stored_url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  received_at: number;
  processed: boolean;
};

export type WhatsAppAiSuggestions = {
  // Cliente
  customerName?: string | null;
  empresa?: string | null;
  conductorNombre?: string | null;
  // Contacto
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  // Vehículo
  plate?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleDescription?: string | null;
  // Ubicación
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  municipio?: string | null;
  provincia?: string | null;
  // Avería
  tipoAveria?: string | null;
  descripcionAveria?: string | null;
  // Resumen
  resumen?: string | null;
  // Meta
  confidence?: "high" | "medium" | "low";
};

export type WhatsAppCaptureSessionWithMessages = WhatsAppCaptureSession & {
  messages: WhatsAppCaptureMessage[];
};
