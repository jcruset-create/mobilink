import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  Reply,
} from "lucide-react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

/* ── Types ─────────────────────────────────────────────── */

type ExtractedData = {
  cliente?: string | null;
  telefonoWhatsapp?: string | null;
  direccion?: string | null;
  googleMapsUrl?: string | null;
  latitud?: string | null;
  longitud?: string | null;
  matricula?: string | null;
  vehiculo?: string | null;
  tipoAsistencia?: string | null;
  tipoVehiculo?: string | null;
  estadoVehiculo?: string | null;
  empresaSolicitante?: string | null;
  numeroExpedienteExterno?: string | null;
  conductor?: string | null;
  telefonoConductor?: string | null;
  observaciones?: string | null;
  confidence?: string;
  warnings?: string[];
};

type DraftStatus = "pending" | "converted" | "ignored";

type Message = {
  id: number;
  message_sid: string;
  from_phone: string;
  profile_name: string | null;
  body: string | null;
  num_media: number;
  media_urls: string | null;
  processed: boolean;
  assistance_draft_id: number | null;
  created_at: number;
  // joined from draft
  draft_id: number | null;
  draft_status: DraftStatus | null;
  confidence: string | null;
  extracted_json: string | null;
};

type Props = {
  onBack: () => void;
  onCreateAssistance: (draft: ExtractedData, fromPhone: string) => void;
};

/* ── Helpers ────────────────────────────────────────────── */

function confidenceBadge(c: string | null) {
  if (c === "high") return "bg-emerald-100 text-emerald-800";
  if (c === "low") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function confidenceLabel(c: string | null) {
  if (c === "high") return "Alta confianza";
  if (c === "low") return "Baja confianza";
  return "Confianza media";
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const FIELD_LABELS: Record<keyof ExtractedData, string> = {
  cliente: "Cliente",
  telefonoWhatsapp: "Teléfono WA",
  direccion: "Dirección",
  googleMapsUrl: "Google Maps",
  latitud: "Latitud",
  longitud: "Longitud",
  matricula: "Matrícula",
  vehiculo: "Vehículo",
  tipoAsistencia: "Tipo asistencia",
  tipoVehiculo: "Tipo vehículo",
  estadoVehiculo: "Estado vehículo",
  empresaSolicitante: "Empresa solicitante",
  numeroExpedienteExterno: "Expediente externo",
  conductor: "Conductor",
  telefonoConductor: "Tel. conductor",
  observaciones: "Observaciones",
  confidence: "Confianza",
  warnings: "Avisos",
};

const DISPLAY_FIELDS: (keyof ExtractedData)[] = [
  "cliente", "telefonoWhatsapp", "matricula", "vehiculo", "direccion",
  "tipoAsistencia", "tipoVehiculo", "estadoVehiculo", "empresaSolicitante",
  "numeroExpedienteExterno", "conductor", "telefonoConductor", "observaciones",
];

/* ── Preview modal ──────────────────────────────────────── */

function PreviewModal({
  draft,
  onConfirm,
  onCancel,
}: {
  draft: ExtractedData;
  onConfirm: (edited: ExtractedData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ExtractedData>({ ...draft });

  function setField(key: keyof ExtractedData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value || null }));
  }

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-black">Vista previa de la asistencia</h2>
          <p className="text-xs text-slate-500">Revisa y edita los datos antes de crear la asistencia</p>
        </div>

        <div className="space-y-3 px-5 py-4">
          {DISPLAY_FIELDS.map((key) => (
            <label key={key} className="block">
              <span className="mb-0.5 block text-xs font-bold text-slate-500">
                {FIELD_LABELS[key]}
              </span>
              <input
                className={inputCls}
                value={(form[key] as string) ?? ""}
                onChange={(e) => setField(key, e.target.value)}
                placeholder="—"
              />
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(form)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
          >
            <Send className="h-4 w-4" />
            Crear asistencia
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Message card ───────────────────────────────────────── */

function MessageCard({
  msg,
  onCreateAssistance,
  onIgnore,
}: {
  msg: Message;
  onCreateAssistance: (msg: Message) => void;
  onIgnore: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyDone, setReplyDone] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  async function sendReply() {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/send`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ to: msg.from_phone, body: replyText.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setReplyText("");
      setReplying(false);
      setReplyDone(true);
    } catch (e: any) {
      alert(`Error enviando respuesta: ${e.message}`);
    } finally {
      setSendingReply(false);
    }
  }
  const extracted: ExtractedData = msg.extracted_json
    ? JSON.parse(msg.extracted_json)
    : {};

  const isDone = msg.draft_status === "converted" || msg.draft_status === "ignored";
  const detectedFields = DISPLAY_FIELDS.filter((k) => extracted[k]);

  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${isDone ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-900">
                {msg.profile_name || msg.from_phone}
              </span>
              {msg.profile_name && (
                <span className="text-xs text-slate-400">{msg.from_phone}</span>
              )}
              {msg.confidence && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${confidenceBadge(msg.confidence)}`}>
                  {confidenceLabel(msg.confidence)}
                </span>
              )}
              {msg.draft_status === "converted" && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                  ✓ Convertida
                </span>
              )}
              {msg.draft_status === "ignored" && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                  Ignorada
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">{formatDate(msg.created_at)}</div>
            {msg.body && (
              <p className="mt-1 text-sm text-slate-700 line-clamp-2">{msg.body}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-lg p-2 hover:bg-slate-100"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {/* Full body */}
          {msg.body && (
            <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
              {msg.body}
            </div>
          )}

          {/* Extracted fields */}
          {detectedFields.length > 0 ? (
            <div className="mb-3">
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
                Datos detectados por IA
              </div>
              <div className="grid grid-cols-2 gap-2">
                {detectedFields.map((key) => (
                  <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-bold text-slate-400">{FIELD_LABELS[key]}</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900">
                      {String(extracted[key])}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              No se detectaron datos estructurados en este mensaje
            </div>
          )}

          {/* Warnings */}
          {extracted.warnings && extracted.warnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-xs font-bold text-amber-700">Avisos</div>
              {extracted.warnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-700">{w}</div>
              ))}
            </div>
          )}

          {/* Media */}
          {msg.num_media > 0 && (
            <div className="mb-3 text-xs text-slate-500">
              📎 {msg.num_media} adjunto{msg.num_media > 1 ? "s" : ""}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {!isDone && (
              <>
                <button
                  type="button"
                  onClick={() => onCreateAssistance(msg)}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Crear asistencia
                </button>
                <button
                  type="button"
                  onClick={() => onIgnore(msg.draft_id ?? 0)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  <XCircle className="h-4 w-4" />
                  Ignorar
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { setReplying((v) => !v); setTimeout(() => replyRef.current?.focus(), 50); }}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
            >
              <Reply className="h-4 w-4" />
              {replyDone ? "Enviado ✓" : "Responder"}
            </button>
          </div>

          {/* Reply box */}
          {replying && (
            <div className="mt-3 flex gap-2">
              <textarea
                ref={replyRef}
                rows={2}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply(); }}
                placeholder="Escribe tu respuesta… (Ctrl+Enter para enviar)"
                className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-300"
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={sendingReply || !replyText.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => setReplying(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main view ──────────────────────────────────────────── */

export default function WhatsAppInboxView({ onBack, onCreateAssistance }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "converted" | "ignored">("pending");
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/whatsapp/messages?limit=100`, {
        headers: getAdminHeaders() as HeadersInit,
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } catch (e) {
      console.error("Error loading messages:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleIgnore(draftId: number) {
    if (!draftId) return;
    await fetch(`${API_BASE}/api/assistance-drafts/${draftId}/ignore`, {
      method: "POST",
      headers: getAdminHeaders() as HeadersInit,
    });
    setMessages((prev) =>
      prev.map((m) =>
        m.draft_id === draftId ? { ...m, draft_status: "ignored" } : m
      )
    );
  }

  function handleCreateAssistance(msg: Message) {
    setPreviewMsg(msg);
  }

  async function handleConfirmCreate(edited: ExtractedData) {
    if (!previewMsg) return;
    // Mark draft as converted
    if (previewMsg.draft_id) {
      await fetch(`${API_BASE}/api/assistance-drafts/${previewMsg.draft_id}`, {
        method: "PATCH",
        headers: getAdminHeaders({ "Content-Type": "application/json" }) as HeadersInit,
        body: JSON.stringify({ status: "converted" }),
      });
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === previewMsg.id ? { ...m, draft_status: "converted" } : m
      )
    );
    setPreviewMsg(null);
    onCreateAssistance(edited, previewMsg.from_phone);
  }

  const filtered = messages.filter((m) => {
    if (filter === "all") return true;
    return m.draft_status === filter;
  });

  const pendingCount = messages.filter((m) => m.draft_status === "pending").length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-xl font-black flex items-center gap-2">
                📥 WhatsApp entrante
                {pendingCount > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-black text-white">
                    {pendingCount}
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-500">{total} mensajes totales</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {(["pending", "all", "converted", "ignored"] as const).map((f) => {
            const labels = { pending: "Pendientes", all: "Todos", converted: "Convertidos", ignored: "Ignorados" };
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
                  filter === f
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>

        {/* Messages */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm font-bold text-slate-400">
            {filter === "pending" ? "No hay mensajes pendientes" : "Sin mensajes"}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((msg) => (
              <MessageCard
                key={msg.id}
                msg={msg}
                onCreateAssistance={handleCreateAssistance}
                onIgnore={handleIgnore}
              />
            ))}
          </div>
        )}

        {/* Twilio config hint */}
        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
          <strong>Configuración Twilio:</strong> configura el webhook de entrada en
          <code className="mx-1 rounded bg-blue-100 px-1 py-0.5">{window.location.origin}/api/whatsapp/inbound</code>
          y el webhook de estado en
          <code className="mx-1 rounded bg-blue-100 px-1 py-0.5">/api/whatsapp/status</code>
        </div>
      </div>

      {/* Preview modal */}
      {previewMsg && (
        <PreviewModal
          draft={previewMsg.extracted_json ? JSON.parse(previewMsg.extracted_json) : {}}
          onConfirm={handleConfirmCreate}
          onCancel={() => setPreviewMsg(null)}
        />
      )}
    </div>
  );
}
