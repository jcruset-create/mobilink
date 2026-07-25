// Lógica pura de recordatorios de caducidad (tacógrafo).
// Sin dependencias de React ni de red para poder probarla de forma aislada.

export type CaducidadEstado =
  | "PENDIENTE"
  | "LISTO_PARA_AVISAR"
  | "AVISADO"
  | "RESPONDIDO"
  | "CONVERTIDO_EN_CITA"
  | "CADUCADO"
  | "CANCELADO"
  | "ERROR_ENVIO";

export type CaducidadCanalEstado =
  | "pendiente"
  | "enviado"
  | "entregado"
  | "leido"
  | "error";

export type CaducidadReminder = {
  id: number;
  workshopId?: string | null;
  cliente_nombre: string;
  vehiculo: string;
  matricula: string;
  telefono: string;
  tipo_caducidad: string;
  fecha_caducidad: string;
  dias_antelacion: number;
  fecha_aviso: string;
  enviar_whatsapp: boolean;
  enviar_sms: boolean;
  estado: CaducidadEstado;
  whatsapp_estado: CaducidadCanalEstado;
  sms_estado: CaducidadCanalEstado;
  whatsapp_sid?: string | null;
  sms_sid?: string | null;
  whatsapp_enviado_en_ms?: number | null;
  sms_enviado_en_ms?: number | null;
  ultimo_error?: string | null;
  cita_id?: number | null;
  observaciones: string;
  creado_en_ms: number;
  actualizado_en_ms: number;
};

// Suma/resta días sobre una fecha 'YYYY-MM-DD' en UTC (sin efectos de DST).
export function addDaysToDateKey(dateKey: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || "").trim());
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const next = new Date(utc + days * 24 * 60 * 60 * 1000);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function calcularFechaAviso(
  fechaCaducidad: string,
  diasAntelacion: number
): string | null {
  const dias = Number.isFinite(diasAntelacion)
    ? Math.max(0, Math.trunc(diasAntelacion))
    : 15;
  return addDaysToDateKey(fechaCaducidad, -dias);
}

/**
 * Estado "visual" del recordatorio: añade LISTO_PARA_AVISAR (fecha de aviso
 * alcanzada pero aún sin enviar) y CADUCADO calculado en cliente aunque el
 * servidor todavía no haya pasado el checker diario.
 */
export function getEstadoVisual(
  rec: Pick<CaducidadReminder, "estado" | "fecha_aviso" | "fecha_caducidad">,
  todayKey: string
): CaducidadEstado {
  if (rec.estado === "PENDIENTE") {
    if (rec.fecha_caducidad < todayKey) return "CADUCADO";
    if (rec.fecha_aviso <= todayKey) return "LISTO_PARA_AVISAR";
  }
  if (rec.estado === "AVISADO" && rec.fecha_caducidad < todayKey) return "CADUCADO";
  return rec.estado;
}

// Colores por estado (paleta Tailwind ya usada en la agenda):
// gris pendiente · amarillo próximo a avisar · verde avisado · azul convertido
// · rojo caducado sin cita · morado error de envío.
export function getEstadoColorClass(estado: CaducidadEstado): string {
  switch (estado) {
    case "LISTO_PARA_AVISAR":
      return "bg-amber-500 border-amber-600 text-white";
    case "AVISADO":
    case "RESPONDIDO":
      return "bg-emerald-600 border-emerald-700 text-white";
    case "CONVERTIDO_EN_CITA":
      return "bg-blue-600 border-blue-700 text-white";
    case "CADUCADO":
      return "bg-red-600 border-red-700 text-white";
    case "ERROR_ENVIO":
      return "bg-purple-600 border-purple-700 text-white";
    case "CANCELADO":
      return "bg-slate-400 border-slate-500 text-white";
    default:
      return "bg-slate-600 border-slate-700 text-white";
  }
}

export function getEstadoLabel(estado: CaducidadEstado): string {
  switch (estado) {
    case "PENDIENTE": return "Pendiente";
    case "LISTO_PARA_AVISAR": return "Listo para avisar";
    case "AVISADO": return "Avisado";
    case "RESPONDIDO": return "Respondido";
    case "CONVERTIDO_EN_CITA": return "Convertido en cita";
    case "CADUCADO": return "Caducado";
    case "CANCELADO": return "Cancelado";
    case "ERROR_ENVIO": return "Error de envío";
    default: return estado;
  }
}

export function formatSpanishDateKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return dateKey;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
