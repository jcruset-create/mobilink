/**
 * Connect Pro — tarjeta de operario, compartida por la ficha de taller y la
 * de empresa: nombre, rol, estado en vivo y teléfono con botón de llamada.
 */

import { Link } from "react-router-dom";
import { Card, Badge } from "./ui";
import { fmtDateTime } from "../types";

export type Operator = {
  source: "assist" | "lite" | "contact";
  id: number; name: string; phone: string | null; role: string;
  status: string | null; expedientNumber: string | null; connectAssistanceId: number | null;
  email?: string | null; lastLoginAtMs?: number | null; devices?: number; notes?: string | null;
};

export const OPERATOR_STATUS: Record<string, { label: string; cls: string }> = {
  libre: { label: "Libre", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  free: { label: "Libre", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  working: { label: "En trabajo", cls: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
  on_assistance: { label: "En asistencia", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  blocked: { label: "Bloqueado", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

export default function TarjetaOperario({ op }: { op: Operator }) {
  const st = op.status
    ? OPERATOR_STATUS[op.status] ?? { label: op.status, cls: "border-slate-600 text-slate-400" }
    : null;
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold text-slate-100">{op.name}</div>
          <div className="text-[12px] text-slate-400">{op.role}</div>
        </div>
        {st && <Badge className={st.cls}>{st.label}</Badge>}
      </div>
      {op.expedientNumber && (
        <div className="text-[12px] text-slate-400">
          En asistencia:{" "}
          {op.connectAssistanceId
            ? <Link className="text-cyan-300 hover:underline" to={`/connect/asistencias/${op.connectAssistanceId}`}>{op.expedientNumber}</Link>
            : op.expedientNumber}
        </div>
      )}
      {op.source === "lite" && (
        <div className="text-[12px] text-slate-500">
          Último acceso: {fmtDateTime(op.lastLoginAtMs)} · {op.devices ?? 0} dispositivo{(op.devices ?? 0) !== 1 ? "s" : ""}
        </div>
      )}
      {op.notes && <div className="text-[12px] text-slate-500">{op.notes}</div>}
      <div className="mt-1 flex items-center gap-2">
        {op.phone ? (
          <a
            href={`tel:${op.phone}`}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[14px] font-bold text-white hover:bg-emerald-500"
          >
            📞 {op.phone}
          </a>
        ) : (
          <span className="text-[12px] text-slate-500">Sin teléfono registrado</span>
        )}
        {op.email && <a className="text-[12px] text-cyan-300 hover:underline" href={`mailto:${op.email}`}>{op.email}</a>}
      </div>
    </Card>
  );
}
