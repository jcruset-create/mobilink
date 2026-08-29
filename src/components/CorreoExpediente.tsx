/**
 * El correo de la asistencia.
 *
 * No es un cliente de correo: no hay carpetas ni bandeja general. Es el hilo de
 * ESTA asistencia y los botones para pedir lo que falta, porque el correo es
 * parte del expediente y no una aplicación aparte.
 *
 * Los correos que no salieron se ven igual, con su error. Si se ocultaran,
 * nadie sabría que el taller nunca recibió la petición y el albarán se
 * esperaría eternamente.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Mensaje = {
  uuid: string;
  direccion: "saliente" | "entrante";
  motivo: string | null;
  de: string | null;
  para: string | null;
  asunto: string;
  resumen: string;
  adjuntos: number;
  estado: string;
  error: string | null;
  occurredAtMs: number;
};

/** Qué pide cada correo, en una frase que se entienda en el botón. */
const MOTIVOS: [string, string][] = [
  ["solicitud_albaran", "Pedir albarán"],
  ["solicitud_factura", "Pedir factura"],
  ["solicitud_aceptacion", "Pedir aceptación"],
  ["confirmacion", "Confirmar servicio"],
];

function hora(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

async function pedir(ruta: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${ruta}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
  return data;
}

export default function CorreoExpediente({ assistanceId }: { assistanceId: number }) {
  const [hilo, setHilo] = useState<Mensaje[]>([]);
  const [para, setPara] = useState("");
  const [motivo, setMotivo] = useState("solicitud_albaran");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await pedir(`/api/correo/asistencias/${assistanceId}/hilo`);
      setHilo(d.data);
    } catch (e: any) { setError(e.message); }
  }, [assistanceId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const enviar = async () => {
    if (!para.trim()) return;
    setBusy(true); setError("");
    try {
      const r = await pedir(`/api/correo/asistencias/${assistanceId}/enviar`, {
        method: "POST",
        body: JSON.stringify({ motivo, para: para.trim() }),
      });
      // El envío puede fallar y aun así quedar en el hilo: se dice, no se calla.
      if (r.estado === "fallido") setError(`No se pudo enviar: ${r.error}`);
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">
          Correo del expediente
        </span>
        <span className="text-[11px] text-slate-500">
          Las respuestas se enganchan solas
        </span>
      </div>

      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {hilo.length === 0 ? (
        <p className="mb-2 text-[12px] text-slate-500">Todavía no se ha escrito nada.</p>
      ) : (
        <ul className="mb-3 space-y-1.5 text-[13px]">
          {hilo.map((m) => (
            <li
              key={m.uuid}
              className={`rounded-lg border px-2.5 py-1.5 ${
                m.direccion === "entrante"
                  ? "border-sky-500/30 bg-sky-500/5"
                  : "border-slate-700 bg-slate-950/40"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tabular-nums text-[11px] text-slate-500">{hora(m.occurredAtMs)}</span>
                <span className="font-semibold text-slate-100">
                  {m.direccion === "entrante" ? `De ${m.de}` : `Para ${m.para}`}
                </span>
                {m.adjuntos > 0 && (
                  <span className="rounded border border-teal-500/40 bg-teal-500/10 px-1.5 text-[10px] text-teal-300">
                    {m.adjuntos} adjunto{m.adjuntos > 1 ? "s" : ""}
                  </span>
                )}
                {m.estado === "fallido" && (
                  <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 text-[10px] font-bold text-red-300">
                    No salió
                  </span>
                )}
              </div>
              <div className="truncate text-slate-400">{m.asunto}</div>
              {m.error && <div className="text-[11px] text-red-300/80">{m.error}</div>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
        >
          {MOTIVOS.map(([v, etiqueta]) => (
            <option key={v} value={v}>{etiqueta}</option>
          ))}
        </select>
        <input
          value={para}
          onChange={(e) => setPara(e.target.value)}
          placeholder="Correo del taller o proveedor"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
        />
        <button
          onClick={() => void enviar()}
          disabled={busy || !para.trim()}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-orange-500 disabled:opacity-50"
        >
          {busy ? "Enviando…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
