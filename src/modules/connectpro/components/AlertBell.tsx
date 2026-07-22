/**
 * Connect Pro — campana de alertas del topbar: contador de no leídas en
 * tiempo real (SSE) con panel desplegable y marcado de lectura.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { boFetch } from "../services/api";
import { useConnectEvents } from "../services/events";
import { fmtDateTime } from "../types";

type Alert = {
  id: number; type: string; severity: string; title: string; body: string | null;
  assistanceId: number | null; status: string; createdAtMs: number;
};

const SEV_DOT: Record<string, string> = { info: "bg-sky-400", warning: "bg-amber-400", critical: "bg-red-500" };

export default function AlertBell() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(() => {
    boFetch<{ data: Alert[]; unread: number }>("/alerts?limit=15")
      .then((r) => { setAlerts(r.data); setUnread(r.unread); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // respaldo si el SSE cae
    return () => clearInterval(t);
  }, [load]);

  useConnectEvents((push) => {
    if (push.kind === "alert") load();
  });

  const openAlert = async (a: Alert) => {
    if (a.status === "unread") {
      boFetch(`/alerts/${a.id}/read`, { method: "POST" }).catch(() => {});
    }
    setOpen(false);
    if (a.assistanceId) navigate(`/connect/asistencias/${a.assistanceId}`);
    load();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
        title="Alertas"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-40 w-96 rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <span className="text-[12px] font-bold text-slate-200">Alertas</span>
            {unread > 0 && (
              <button
                onClick={() => boFetch("/alerts/read-all", { method: "POST" }).then(load)}
                className="text-[11px] text-cyan-300 hover:underline"
              >
                Marcar todas leídas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="p-4 text-center text-[12px] text-slate-500">Sin alertas.</p>
            ) : alerts.map((a) => (
              <button
                key={a.id}
                onClick={() => openAlert(a)}
                className={`flex w-full items-start gap-2 border-b border-slate-700/50 px-3 py-2 text-left hover:bg-slate-700/40 ${
                  a.status === "unread" ? "bg-slate-700/20" : ""
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[a.severity] ?? "bg-slate-500"}`} />
                <span className="min-w-0">
                  <span className={`block truncate text-[12px] ${a.status === "unread" ? "font-bold text-slate-100" : "text-slate-300"}`}>
                    {a.title}
                  </span>
                  {a.body && <span className="block truncate text-[11px] text-slate-500">{a.body}</span>}
                  <span className="block text-[10px] text-slate-600">{fmtDateTime(a.createdAtMs)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
