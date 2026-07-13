import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { listarAlertasWebfleet, marcarAlertaLeida, marcarAlertasLeidas } from "../services/data";
import type { WebfleetAlerta } from "../types";

// Campana de notificaciones internas de "vehículos en base": avisa cuando un
// vehículo entra en su base con una revisión pendiente/vencida.
export default function AlertasWebfleet() {
  const [alertas, setAlertas] = useState<WebfleetAlerta[]>([]);
  const [abierto, setAbierto] = useState(false);

  async function cargar() {
    try { setAlertas(await listarAlertasWebfleet(true, 30)); } catch { /* módulo aún no migrado */ }
  }
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60000); // refresco cada minuto
    return () => clearInterval(t);
  }, []);

  async function leerUna(a: WebfleetAlerta) {
    await marcarAlertaLeida(a.id);
    setAlertas((prev) => prev.filter((x) => x.id !== a.id));
  }
  async function leerTodas() {
    await marcarAlertasLeidas();
    setAlertas([]);
  }

  const n = alertas.length;

  return (
    <div className="relative">
      <button onClick={() => { setAbierto((v) => !v); if (!abierto) cargar(); }} className="relative rounded-lg p-1.5 hover:bg-slate-800" title="Avisos">
        <Bell className="h-5 w-5 text-slate-200" />
        {n > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {n > 9 ? "9+" : n}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
              <span className="text-[12px] font-bold text-slate-200">Avisos {n > 0 ? `(${n})` : ""}</span>
              {n > 0 && <button onClick={leerTodas} className="text-[11px] text-sky-300 hover:underline">Marcar todas leídas</button>}
            </div>
            <div className="max-h-96 overflow-auto">
              {n === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-slate-500">Sin avisos nuevos.</div>
              ) : (
                alertas.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 border-b border-slate-800 px-3 py-2 last:border-0">
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-rose-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-slate-200">{a.mensaje}</div>
                      {a.created_at && <div className="mt-0.5 text-[10px] text-slate-500">{new Date(a.created_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>}
                    </div>
                    <button onClick={() => leerUna(a)} className="shrink-0 text-[11px] text-slate-400 hover:text-slate-200" title="Marcar leída">✓</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
