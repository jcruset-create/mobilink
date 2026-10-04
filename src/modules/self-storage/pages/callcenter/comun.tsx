/**
 * Piezas comunes de las pantallas del Call Center: si está activo (global y
 * para la empresa), chips de estado y prioridad y formatos.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CallStatus, EstadoCallCenter, IncidentStatus, Priority } from "../../types";
import { useEstadoCallCenter } from "./useEstadoCallCenter";
import { Aviso, Cargando, Pill } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";

/** Enseña el contenido sólo si el Call Center está activo; si no, explica por qué y dónde activarlo. */
export function SiCallCenterActivo({ children }: { children: (e: EstadoCallCenter) => ReactNode }) {
  const { puede } = useSelfStorage();
  const { estado, error } = useEstadoCallCenter();
  if (error) return <Aviso tono="mal">{error}</Aviso>;
  if (!estado) return <Cargando />;
  if (!estado.global) return <Aviso tono="aviso">El Call Center está desactivado en este servidor (SELF_STORAGE_CALL_CENTER_ENABLED).</Aviso>;
  if (!estado.empresa) {
    return (
      <Aviso tono="info">
        El Call Center no está activado para esta empresa.{" "}
        {puede("ss.settings.manage") ? (
          <Link className="underline" to="/self-storage/call-center/configuracion">
            Actívalo en su configuración
          </Link>
        ) : (
          "Pídeselo a un administrador."
        )}
      </Aviso>
    );
  }
  return <>{children(estado)}</>;
}

const COLOR_ESTADO: Record<CallStatus, string> = {
  started: "bg-slate-600/40 text-slate-200",
  in_progress: "bg-sky-500/20 text-sky-300",
  finished: "bg-slate-600/40 text-slate-300",
  escalated: "bg-rose-500/20 text-rose-300",
  follow_up: "bg-amber-500/20 text-amber-300",
  closed: "bg-emerald-500/20 text-emerald-300",
};
export function ChipLlamada({ estado }: { estado: CallStatus }) {
  const { etqEstadoLlamada } = useSelfStorage();
  return <Pill className={COLOR_ESTADO[estado]}>{etqEstadoLlamada(estado)}</Pill>;
}

export function ChipPrioridad({ p }: { p: Priority }) {
  const { etqPrioridad } = useSelfStorage();
  if (p === "normal") return <span className="text-[11px] text-slate-400">{etqPrioridad(p)}</span>;
  return <Pill className={p === "urgent" ? "bg-rose-600 text-white" : "bg-amber-500/20 text-amber-300"}>{p === "urgent" ? "⚠ " : ""}{etqPrioridad(p)}</Pill>;
}

const COLOR_INCIDENCIA: Record<IncidentStatus, string> = {
  open: "bg-rose-500/20 text-rose-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  resolved: "bg-emerald-500/20 text-emerald-300",
  closed: "bg-slate-600/40 text-slate-300",
  cancelled: "bg-slate-700/60 text-slate-400",
};
export function ChipIncidencia({ estado }: { estado: IncidentStatus }) {
  const { etqEstadoIncidencia } = useSelfStorage();
  return <Pill className={COLOR_INCIDENCIA[estado]}>{etqEstadoIncidencia(estado)}</Pill>;
}

