import { useState, useEffect, useCallback } from "react";
import type {
  WhatsAppCaptureSessionWithMessages,
  WhatsAppAiSuggestions,
  WhatsAppCaptureMessage,
} from "../modules/whatsappCaptureTypes";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

function getAdminHeaders(): Record<string, string> {
  const token = localStorage.getItem("sea-admin-token") ?? "";
  return {
    "Content-Type": "application/json",
    "x-admin-token": token,
  };
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  location: "Ubicación GPS",
  contact: "Contacto",
  image: "Imagen",
  video: "Vídeo",
  audio: "Audio",
  document: "Documento",
};

const TYPE_ICONS: Record<string, string> = {
  text: "💬",
  location: "📍",
  contact: "👤",
  image: "🖼️",
  video: "🎥",
  audio: "🎵",
  document: "📄",
};

function MessageRow({ msg }: { msg: WhatsAppCaptureMessage }) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
      <span className="text-base leading-none mt-0.5">{TYPE_ICONS[msg.message_type] ?? "📩"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500">{fmtTime(msg.received_at)}</span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {TYPE_LABELS[msg.message_type] ?? msg.message_type}
          </span>
        </div>
        {msg.text_content && (
          <p className="mt-1 text-slate-800 whitespace-pre-wrap break-words">{msg.text_content}</p>
        )}
        {msg.message_type === "location" && msg.latitude != null && (
          <a
            href={`https://maps.google.com/?q=${msg.latitude},${msg.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-blue-600 underline text-xs"
          >
            {msg.address || `${msg.latitude}, ${msg.longitude}`} ↗
          </a>
        )}
        {msg.message_type === "contact" && (msg.contact_name || msg.contact_phone) && (
          <p className="mt-1 text-slate-700">
            {msg.contact_name} {msg.contact_phone ? `· ${msg.contact_phone}` : ""}
          </p>
        )}
        {(msg.media_stored_url || msg.media_url) && msg.message_type === "image" && (
          <a href={msg.media_stored_url || msg.media_url!} target="_blank" rel="noreferrer">
            <img
              src={msg.media_stored_url || msg.media_url!}
              alt="adjunto"
              className="mt-2 max-h-40 rounded-lg object-cover border border-slate-200"
            />
          </a>
        )}
        {(msg.media_stored_url || msg.media_url) && msg.message_type === "audio" && (
          <audio controls className="mt-2 w-full" src={msg.media_stored_url || msg.media_url!} />
        )}
        {(msg.media_stored_url || msg.media_url) && !["image", "audio"].includes(msg.message_type) && (msg.media_stored_url || msg.media_url) && (
          <a
            href={msg.media_stored_url || msg.media_url!}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-blue-600 underline text-xs"
          >
            Ver adjunto ↗
          </a>
        )}
      </div>
    </div>
  );
}

const AI_FIELD_LABELS: { key: keyof WhatsAppAiSuggestions; label: string; applyKey?: string }[] = [
  { key: "customerName", label: "Nombre cliente", applyKey: "customerName" },
  { key: "conductorNombre", label: "Conductor", applyKey: "conductorNombre" },
  { key: "empresa", label: "Empresa" },
  { key: "contactoNombre", label: "Contacto / Conductor", applyKey: "conductorNombre" },
  { key: "contactoTelefono", label: "Contacto teléfono", applyKey: "customerPhone" },
  { key: "plate", label: "Matrícula", applyKey: "plate" },
  { key: "vehicleBrand", label: "Marca vehículo" },
  { key: "vehicleModel", label: "Modelo vehículo" },
  { key: "vehicleDescription", label: "Descripción vehículo", applyKey: "vehicleDescription" },
  { key: "address", label: "Dirección (+ GPS)", applyKey: "location" },
  { key: "municipio", label: "Municipio" },
  { key: "provincia", label: "Provincia" },
  { key: "tipoAveria", label: "Tipo avería" },
  { key: "descripcionAveria", label: "Descripción avería", applyKey: "notes" },
  { key: "resumen", label: "Resumen" },
];

type Props = {
  jobId: number;
  jobPlate?: string;
  onAssistanceUpdated?: () => void;
};

export default function WhatsAppCaptureSection({ jobId, jobPlate, onAssistanceUpdated }: Props) {
  const [session, setSession] = useState<WhatsAppCaptureSessionWithMessages | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingField, setApplyingField] = useState<string | null>(null);
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp-capture/by-job/${jobId}`, {
        headers: getAdminHeaders(),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSession(data);
    } catch {
      // no session yet
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Poll messages when session is ACTIVE
  useEffect(() => {
    if (!session || session.status !== "ACTIVE") return;
    const interval = setInterval(fetchSession, 8000);
    return () => clearInterval(interval);
  }, [session, fetchSession]);

  async function startCapture() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp-capture/sessions`, {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({ job_id: jobId, created_by: "backoffice" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error iniciando captura");
        return;
      }
      await fetchSession();
    } finally {
      setActionLoading(false);
    }
  }

  async function closeCapture() {
    if (!session) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp-capture/sessions/${session.id}/close`, {
        method: "POST",
        headers: getAdminHeaders(),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Error cerrando captura");
        return;
      }
      await fetchSession();
      // Poll for AI results
      let attempts = 0;
      const poll = setInterval(async () => {
        await fetchSession();
        attempts++;
        if (attempts > 10) clearInterval(poll);
      }, 3000);
    } finally {
      setActionLoading(false);
    }
  }

  async function applyField(field: string, value: unknown) {
    if (!session) return;
    setApplyingField(field);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp-capture/sessions/${session.id}/apply`, {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({ field, value }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Error aplicando campo");
        return;
      }
      setAppliedFields((prev) => new Set([...prev, field]));
      onAssistanceUpdated?.();
    } finally {
      setApplyingField(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-400">Cargando captura WhatsApp…</div>
      </div>
    );
  }

  const isActive = session?.status === "ACTIVE";
  const isClosed = session?.status === "CLOSED";
  const suggestions: WhatsAppAiSuggestions | null = session?.ai_suggestions ?? null;
  const messages = session?.messages ?? [];

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-[#16213e] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📲</span>
          <span className="text-sm font-black text-white">Captura WhatsApp</span>
          {jobPlate && <span className="text-xs text-white/60">{jobPlate}</span>}
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-xs font-black text-white animate-pulse">
              ● ACTIVA
            </span>
          )}
          {isClosed && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500 px-3 py-1 text-xs font-black text-white">
              ✓ CERRADA
            </span>
          )}
          {!session && (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60">Sin sesión</span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {!session && (
            <button
              onClick={startCapture}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {actionLoading ? "…" : "▶ Iniciar captura WhatsApp"}
            </button>
          )}
          {isActive && (
            <>
              <button
                onClick={closeCapture}
                disabled={actionLoading}
                className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {actionLoading ? "…" : "⏹ Finalizar captura + Analizar IA"}
              </button>
              <button
                onClick={fetchSession}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                ↻ Actualizar
              </button>
            </>
          )}
          {isClosed && !suggestions && (
            <span className="text-xs text-slate-400 self-center">Analizando con IA…</span>
          )}
        </div>

        {/* Session info */}
        {session && (
          <div className="text-xs text-slate-500 space-y-0.5">
            <div>Inicio: {fmtTime(session.started_at)}</div>
            {session.ended_at && <div>Fin: {fmtTime(session.ended_at)}</div>}
            <div>{messages.length} mensaje{messages.length !== 1 ? "s" : ""} recibido{messages.length !== 1 ? "s" : ""}</div>
          </div>
        )}

        {/* Messages list */}
        {messages.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
              Mensajes recibidos
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {messages.map((m) => (
                <MessageRow key={m.id} msg={m} />
              ))}
            </div>
          </div>
        )}

        {/* AI Suggestions */}
        {suggestions && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-400">
                Información detectada por IA
              </span>
              {suggestions.confidence && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    suggestions.confidence === "high"
                      ? "bg-emerald-100 text-emerald-700"
                      : suggestions.confidence === "medium"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  Confianza: {suggestions.confidence}
                </span>
              )}
            </div>

            {suggestions.resumen && (
              <div className="mb-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
                {suggestions.resumen}
              </div>
            )}

            <div className="space-y-1.5">
              {AI_FIELD_LABELS.filter((f) => {
                // "address" row also shows when only lat/lng available (no text address)
                if (f.applyKey === "location") return (suggestions.address != null && suggestions.address !== "") || suggestions.latitude != null;
                return suggestions[f.key] != null && suggestions[f.key] !== "";
              }).map((f) => {
                const isEditing = editingField === f.applyKey;
                const displayValue = f.applyKey === "location"
                  ? (suggestions.address || `${suggestions.latitude}, ${suggestions.longitude}`)
                  : suggestions[f.key];
                const currentValue = isEditing ? (editValues[f.applyKey!] ?? "") : String(displayValue);
                return (
                  <div
                    key={f.key}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <div className="text-xs text-slate-400 font-semibold mb-1">{f.label}</div>
                    {isEditing ? (
                      <input
                        className="w-full rounded border border-blue-300 px-2 py-1 text-sm font-bold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 mb-2"
                        value={currentValue}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, [f.applyKey!]: e.target.value }))}
                        autoFocus
                      />
                    ) : (
                      <div className="text-sm font-bold text-slate-800 break-words mb-1">{currentValue}</div>
                    )}
                    {f.applyKey && !appliedFields.has(f.applyKey) && (
                      <div className="flex gap-1.5 flex-wrap">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => {
                                const val = f.applyKey === "location"
                                  ? { address: editValues["location"] ?? suggestions.address, latitude: suggestions.latitude, longitude: suggestions.longitude }
                                  : (editValues[f.applyKey!] ?? suggestions[f.key]);
                                applyField(f.applyKey!, val);
                                setEditingField(null);
                              }}
                              disabled={applyingField === f.applyKey}
                              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {applyingField === f.applyKey ? "…" : "Aplicar"}
                            </button>
                            <button
                              onClick={() => setEditingField(null)}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                const val = f.applyKey === "location"
                                  ? { address: suggestions.address, latitude: suggestions.latitude, longitude: suggestions.longitude }
                                  : suggestions[f.key];
                                applyField(f.applyKey!, val);
                              }}
                              disabled={applyingField === f.applyKey}
                              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {applyingField === f.applyKey ? "…" : "Aplicar"}
                            </button>
                            <button
                              onClick={() => {
                                setEditValues((prev) => ({ ...prev, [f.applyKey!]: String(suggestions[f.key]) }));
                                setEditingField(f.applyKey!);
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                            >
                              Editar
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {f.applyKey && appliedFields.has(f.applyKey) && (
                      <span className="text-xs font-bold text-emerald-600">✓ Aplicado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
