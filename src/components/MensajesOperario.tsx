import { useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { apiFetch } from "../modules/apiFetch";
import { API_BASE } from "../modules/workshopApi";

/*
 * Mensajes de la oficina a la tablet del operario de una asistencia, y sus
 * respuestas. Reglas (normal/urgente, en rojo a los 3 min sin leer): en
 * `server/mensajes/mensajesAsistencia.ts`.
 */

type Mensaje = {
  id: number;
  de: "oficina" | "operario";
  texto: string;
  urgente: boolean;
  autor: string | null;
  creadoAtMs: number;
  recibidoAtMs: number | null;
  leidoAtMs: number | null;
  estado: "enviado" | "recibido" | "leido" | "respuesta";
  escalado: boolean;
  sinLeerMin: number | null;
};

function hora(ms: number) {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function estadoTexto(m: Mensaje) {
  if (m.estado === "leido" && m.leidoAtMs) return `✓✓ Leído ${hora(m.leidoAtMs)}`;
  const espera = m.sinLeerMin != null && m.sinLeerMin >= 1 ? ` (${m.sinLeerMin} min)` : "";
  if (m.estado === "recibido") return `✓ Recibido, sin leer${espera}`;
  return `Enviado, la tablet aún no lo ha recogido${espera}`;
}

export default function MensajesOperario({
  assistanceId,
  techName,
}: {
  assistanceId: number;
  techName: string;
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [textosRapidos, setTextosRapidos] = useState<string[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  function cargar() {
    apiFetch(`${API_BASE}/api/roadside-assistances/${assistanceId}/mensajes`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMensajes(d.mensajes ?? []);
        setTextosRapidos(d.textosRapidos ?? []);
      })
      .catch(() => {});
  }

  useEffect(() => {
    cargar();
    // Cada 15 s: para ver llegar el «Leído» y las respuestas.
    const intervalo = setInterval(cargar, 15_000);
    return () => clearInterval(intervalo);
  }, [assistanceId]);

  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      const r = await apiFetch(`${API_BASE}/api/roadside-assistances/${assistanceId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, urgente }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.error || "No se pudo enviar el mensaje.");
      }
      setTexto("");
      setUrgente(false);
      setAbierto(false);
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el mensaje.");
    } finally {
      setEnviando(false);
    }
  }

  const sinLeerEnRojo = mensajes.some((m) => m.de === "oficina" && m.estado !== "leido" && (m.escalado || m.urgente));

  return (
    <>
      {mensajes.length > 0 && (
        <div
          className={`mt-4 flex flex-col gap-2 rounded-lg border p-3 ${
            sinLeerEnRojo ? "border-red-500 bg-red-950/40" : "border-slate-700 bg-slate-900"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-400">
            <span>MENSAJES CON {techName.toUpperCase()}</span>
            {sinLeerEnRojo && <span className="text-red-300">● Sin leer</span>}
          </div>
          {mensajes.map((m) =>
            m.de === "oficina" ? (
              <div
                key={m.id}
                className={`max-w-[80%] self-end rounded-xl rounded-br-sm px-3 py-2 text-sm text-white ${
                  m.estado !== "leido" && (m.escalado || m.urgente) ? "bg-red-700" : "bg-blue-700"
                }`}
              >
                {m.urgente && <div className="text-[10px] font-black text-red-100">URGENTE</div>}
                <div className="whitespace-pre-wrap">{m.texto}</div>
                <div className="mt-1 text-right text-[11px] text-blue-100">
                  {m.autor || "Oficina"} · {hora(m.creadoAtMs)} · <strong>{estadoTexto(m)}</strong>
                </div>
              </div>
            ) : (
              <div key={m.id} className="max-w-[80%] self-start rounded-xl rounded-bl-sm bg-slate-700 px-3 py-2 text-sm text-slate-100">
                <div className="whitespace-pre-wrap">{m.texto}</div>
                <div className="mt-1 text-[11px] text-slate-400">{techName} · {hora(m.creadoAtMs)}</div>
              </div>
            )
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-amber-500 bg-amber-950/60 px-3 py-2 text-sm font-bold text-amber-200 hover:bg-amber-900/60"
      >
        <MessageSquare className="h-4 w-4" />
        Mensaje al operario
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Mensaje a ${techName}`}>
          <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-black">Mensaje a {techName}</div>
                <div className="text-sm text-slate-600">Asistencia #{assistanceId} · le sonará en la tablet</div>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setAbierto(false)} className="rounded-lg bg-slate-100 p-2 text-slate-700 hover:bg-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {textosRapidos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {textosRapidos.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTexto(t)}
                    className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs hover:bg-slate-100"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            <label htmlFor={`mensaje-${assistanceId}`} className="text-xs font-bold text-slate-600">MENSAJE</label>
            <textarea
              id={`mensaje-${assistanceId}`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={1000}
              rows={4}
              className="resize-none rounded-lg border border-slate-400 p-2 text-sm"
              placeholder="Escribe el mensaje…"
            />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-bold text-slate-600">AVISO EN LA TABLET</legend>
              <label className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${!urgente ? "border-blue-600 bg-blue-50" : "border-slate-300"}`}>
                <input type="radio" name={`tipo-${assistanceId}`} checked={!urgente} onChange={() => setUrgente(false)} className="mt-1" />
                <span><strong>Normal</strong><br /><span className="text-slate-600">Suena y queda en pantalla. Si en 3 min no lo lee, pasa a sonar cada 15 s y sale en rojo aquí.</span></span>
              </label>
              <label className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${urgente ? "border-red-600 bg-red-50" : "border-slate-300"}`}>
                <input type="radio" name={`tipo-${assistanceId}`} checked={urgente} onChange={() => setUrgente(true)} className="mt-1" />
                <span><strong className="text-red-700">Urgente</strong><br /><span className="text-slate-600">Suena cada 15 s hasta que pulse «Entendido».</span></span>
              </label>
            </fieldset>

            {error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}

            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || !texto.trim()}
              className="h-12 rounded-xl bg-blue-700 font-black text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {enviando ? "Enviando…" : "Enviar a la tablet"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
