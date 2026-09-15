/**
 * La línea temporal: los eventos del histórico, en orden. Una lista
 * cronológica basta para saber qué pasó, cuándo y quién lo hizo.
 */

import { fmtFechaHora } from "../../administracion/types";
import { ETIQUETA_EVENTO, type Evento } from "../types";

const PUNTO: Record<string, string> = {
  RECEPCION_OK: "bg-emerald-400",
  RECEPCION_CON_INCIDENCIA: "bg-amber-400",
  INCIDENCIA_ABIERTA: "bg-rose-400",
  INCIDENCIA_RESUELTA: "bg-emerald-400",
  RECTIFICACION: "bg-rose-400",
  PEDIDO_CANCELADO: "bg-rose-400",
};

export default function Timeline({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) return <p className="text-sm text-slate-500">Sin historial todavía.</p>;
  return (
    <ol className="relative ml-2 border-l border-slate-700 pl-4">
      {eventos.map((e) => (
        <li key={e.id} className="mb-4">
          <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${PUNTO[e.tipo] ?? "bg-sky-400"}`} />
          <div className="text-[11px] text-slate-500">
            {fmtFechaHora(e.occurredAt)}
            {e.usuarioNombre ? ` · ${e.usuarioNombre}` : e.actorTipo === "sistema" ? " · sistema" : ""}
          </div>
          <div className="text-sm font-semibold text-slate-100">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}</div>
          {e.descripcion && <div className="text-[13px] text-slate-300">{e.descripcion}</div>}
        </li>
      ))}
    </ol>
  );
}
