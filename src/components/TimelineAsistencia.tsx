/**
 * Timeline de una asistencia.
 *
 * Se construye ENTERAMENTE desde el diario de eventos: aquí no hay ninguna
 * lista de hitos calculada a mano ni mantenida en paralelo. Si la hubiera, las
 * dos se desincronizarían y nadie sabría cuál mirar — que es justo lo que
 * pasaba antes, con las horas repartidas entre columnas de la asistencia y el
 * historial del envío.
 *
 * Dos interruptores, y los dos apagados por defecto:
 *
 *  · «técnicos» — los fallos y recuperaciones de sincronización. Son ruido
 *    para quien solo quiere saber por dónde va la grúa, pero imprescindibles
 *    cuando algo no llega.
 *  · «cadena completa» — lo que anotó también la plataforma de destino. Útil
 *    para investigar, confuso en el día a día.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Evento = {
  uuid: string;
  tipo: string;
  etiqueta: string;
  sistema: string;
  origen: string | null;
  actor: string;
  actorNombre: string | null;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  tecnico: boolean;
};

/** Color por familia de evento: se lee la fase de un vistazo. */
const TONO: Record<string, string> = {
  ASSISTANCE_CREATED: "bg-slate-500",
  EXTERNAL_DISPATCH_CREATED: "bg-violet-500",
  EXTERNAL_DISPATCH_SENT: "bg-violet-500",
  EXTERNAL_ASSISTANCE_RECEIVED: "bg-indigo-500",
  ASSISTANCE_ACCEPTED: "bg-emerald-500",
  ASSISTANCE_REJECTED: "bg-red-500",
  INFORMATION_REQUESTED: "bg-amber-500",
  PROVIDER_ASSIGNED: "bg-sky-500",
  EN_ROUTE: "bg-sky-500",
  ON_SITE: "bg-sky-500",
  SERVICE_STARTED: "bg-orange-500",
  SERVICE_COMPLETED: "bg-emerald-500",
  SERVICE_CANCELLED: "bg-slate-500",
  DOCUMENT_UPLOADED: "bg-teal-500",
  DELIVERY_NOTE_RECEIVED: "bg-teal-500",
  SUPPLIER_INVOICE_RECEIVED: "bg-teal-500",
  COST_CONFIRMED: "bg-lime-500",
  READY_TO_BILL: "bg-lime-500",
  CUSTOMER_INVOICED: "bg-lime-500",
  SYNC_FAILED: "bg-red-500",
  SYNC_RECOVERED: "bg-emerald-500",
};

function hora(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/** Un resumen legible del payload, sin volcar el JSON en la pantalla. */
function detalle(e: Evento): string {
  const p = e.payload ?? {};
  const trozos: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === "migrado" || v == null || v === "") continue;
    if (typeof v === "object") continue;
    trozos.push(`${k}: ${v}`);
  }
  return trozos.slice(0, 3).join(" · ");
}

export default function TimelineAsistencia({ assistanceId }: { assistanceId: number }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tecnicos, setTecnicos] = useState(false);
  const [cadena, setCadena] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams();
      if (tecnicos) qs.set("tecnicos", "true");
      if (cadena) qs.set("cadena", "true");
      const res = await fetch(
        `${API_BASE}/api/roadside-assistances/${assistanceId}/timeline?${qs}`,
        { headers: getAdminHeaders() },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
      setEventos(data.data);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [assistanceId, tecnicos, cadena]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">
          Historial
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input type="checkbox" checked={cadena} onChange={(e) => setCadena(e.target.checked)} />
          Incluir la plataforma externa
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input type="checkbox" checked={tecnicos} onChange={(e) => setTecnicos(e.target.checked)} />
          Ver incidencias técnicas
        </label>
      </div>

      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {cargando && eventos.length === 0 ? (
        <p className="text-[12px] text-slate-500">Cargando…</p>
      ) : eventos.length === 0 ? (
        <p className="text-[12px] text-slate-500">Todavía no hay nada registrado.</p>
      ) : (
        <ol className="relative ml-1 border-l border-slate-700 pl-4">
          {eventos.map((e) => (
            <li key={e.uuid} className="relative pb-2.5 last:pb-0">
              <span
                className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900 ${
                  TONO[e.tipo] ?? "bg-slate-500"
                }`}
              />
              <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="tabular-nums text-slate-500">{hora(e.occurredAtMs)}</span>
                <span className="font-semibold text-slate-100">{e.etiqueta}</span>
                {/* Solo se marca el sistema ajeno: en la timeline de Assist,
                    decir «assist» en cada línea es ruido. */}
                {e.sistema !== "assist" && (
                  <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 text-[10px] font-bold uppercase text-indigo-300">
                    {e.sistema}
                  </span>
                )}
                {e.actorNombre && <span className="text-[11px] text-slate-500">{e.actorNombre}</span>}
              </div>
              {detalle(e) && <div className="text-[11px] text-slate-500">{detalle(e)}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
