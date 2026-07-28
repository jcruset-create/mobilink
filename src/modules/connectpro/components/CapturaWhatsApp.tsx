/**
 * Captura de WhatsApp en Central Pro.
 *
 * Se abre la captura, el cliente manda al MISMO número de WhatsApp que usa
 * Mobilink Assist (fotos, ubicación, audios, contacto) y los mensajes van
 * apareciendo aquí. Al cerrarla, la IA lee todo -incluido el texto de las
 * fotos- y rellena el formulario.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Button, Badge } from "./ui";
import { fmtDateTime } from "../types";

type CaptureMessage = {
  id: number;
  message_type: "text" | "location" | "contact" | "image" | "video" | "audio" | "document";
  text_content: string | null;
  media_stored_url: string | null;
  media_url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  transcript: string | null;
  from_phone: string | null;
  received_at: number;
};

type CaptureSession = {
  id: number;
  job_id: number | null;
  connect_assistance_id: number | null;
  status: "ACTIVE" | "CLOSED";
  started_at: number;
  created_by: string | null;
  ai_suggestions: Record<string, any> | null;
  messages: CaptureMessage[];
};

const TIPO_ICONO: Record<string, string> = {
  text: "💬", location: "📍", contact: "👤", image: "🖼️", video: "🎥", audio: "🎵", document: "📄",
};

/** Sugerencias de la captura → claves del formulario de Nueva asistencia. */
function aFormulario(s: Record<string, any>): Record<string, any> {
  const extras = Array.isArray(s.datosDetectados) ? [...s.datosDetectados] : [];
  if (s.municipio) extras.push({ campo: "Municipio", valor: s.municipio });
  if (s.provincia) extras.push({ campo: "Provincia", valor: s.provincia });
  if (s.tipoAveria) extras.push({ campo: "Tipo de avería", valor: s.tipoAveria });
  if (s.resumen) extras.push({ campo: "Resumen de la conversación", valor: s.resumen });
  return {
    customerName: s.customerName ?? s.conductorNombre ?? s.contactoNombre,
    customerPhone: s.contactoTelefono ?? s.conductorTelefono,
    requesterName: s.conductorNombre ?? s.contactoNombre,
    requesterPhone: s.conductorTelefono,
    clientName: s.empresa,
    plate: s.plate,
    make: s.vehicleBrand,
    model: s.vehicleModel,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    description: s.descripcionAveria ?? s.vehicleDescription,
    datosDetectados: extras,
  };
}

export default function CapturaWhatsApp({ assistanceId, onSugerencias, onSesion }: {
  /** Si ya existe la asistencia, la captura queda vinculada desde el principio. */
  assistanceId?: number;
  /** Datos extraídos, ya con las claves del formulario. */
  onSugerencias?: (datos: Record<string, any>) => void;
  /** Id de la sesión, para vincularla al crear la asistencia. */
  onSesion?: (sessionId: number | null) => void;
}) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await boFetch<{ session: CaptureSession | null }>("/whatsapp-capture/active");
      setSession(r.session);
      onSesion?.(r.session?.id ?? null);
    } catch (e: any) { setError(e.message); }
  }, [onSesion]);

  useEffect(() => { cargar(); }, [cargar]);

  // Mientras la captura está abierta se refresca sola: es una conversación en vivo
  useEffect(() => {
    if (session?.status !== "ACTIVE") return;
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, [session?.status, cargar]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session?.messages.length]);

  const abrir = async () => {
    setBusy(true); setError(null);
    try {
      const r = await boFetch<{ session: CaptureSession }>("/whatsapp-capture/start", {
        method: "POST", body: { assistanceId: assistanceId ?? null },
      });
      setSession(r.session);
      onSesion?.(r.session.id);
      setAviso("Captura abierta: los WhatsApp que lleguen al número de la central se recogerán aquí.");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const cerrarYAnalizar = async () => {
    if (!session) return;
    setBusy(true); setError(null); setAviso("Analizando la conversación…");
    try {
      await boFetch(`/whatsapp-capture/${session.id}/close`, { method: "POST" });
      // El análisis va en segundo plano: se espera a que aparezca
      let sugerencias: Record<string, any> | null = null;
      for (let intento = 0; intento < 12 && !sugerencias; intento++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await boFetch<{ session: CaptureSession }>(`/whatsapp-capture/${session.id}`);
        sugerencias = s.session.ai_suggestions;
        setSession(s.session);
      }
      if (sugerencias && Object.keys(sugerencias).length > 0) {
        onSugerencias?.(aFormulario(sugerencias));
        setAviso("Datos volcados al formulario. Revísalos antes de crear la asistencia.");
      } else {
        setAviso("La IA no ha podido extraer datos de la conversación.");
      }
      onSesion?.(session.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const activaDeAssist = session?.status === "ACTIVE" && session.job_id != null;
  const activaAqui = session?.status === "ACTIVE" && session.job_id == null;

  return (
    <Card className="mb-4 border-emerald-500/30 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-emerald-300">Recibir por WhatsApp</h2>
        {session?.status === "ACTIVE" && (
          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
            ● Captura abierta desde {fmtDateTime(session.started_at)}
          </Badge>
        )}
        {activaDeAssist && (
          <span className="text-[12px] text-amber-300">
            La captura activa es de Mobilink Assist (asistencia #{session!.job_id}); ciérrala allí para usarla aquí.
          </span>
        )}
      </div>

      {error && <p className="mb-2 text-[13px] text-red-300">{error}</p>}
      {aviso && <p className="mb-2 text-[13px] text-slate-400">{aviso}</p>}

      {!activaAqui ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={abrir} disabled={busy || activaDeAssist}>
            {busy ? "Abriendo…" : "Abrir captura de WhatsApp"}
          </Button>
          <span className="text-[12px] text-slate-500">
            Mismo número que Mobilink Assist. Todo lo que llegue mientras esté abierta
            (fotos, ubicación, audios) se recoge en esta asistencia.
          </span>
        </div>
      ) : (
        <>
          <div className="mb-2 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/60 p-2">
            {session!.messages.length === 0 ? (
              <p className="p-3 text-center text-[13px] text-slate-500">
                Esperando mensajes… Pide al cliente que escriba al WhatsApp de la central.
              </p>
            ) : (
              session!.messages.map((m) => {
                const url = m.media_stored_url || m.media_url;
                return (
                  <div key={m.id} className="border-b border-slate-700/40 px-2 py-1.5 text-[13px] last:border-0">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{TIPO_ICONO[m.message_type] ?? "•"}</span>
                      <span>{fmtDateTime(m.received_at)}</span>
                      {m.from_phone && <span>{m.from_phone.replace("whatsapp:", "")}</span>}
                    </div>
                    {m.message_type === "text" && <div className="text-slate-200">{m.text_content}</div>}
                    {m.message_type === "location" && (
                      <div className="text-cyan-300">
                        {m.address ?? `${m.latitude}, ${m.longitude}`}
                      </div>
                    )}
                    {m.message_type === "contact" && (
                      <div className="text-slate-200">{m.contact_name} · {m.contact_phone}</div>
                    )}
                    {m.message_type === "audio" && (
                      <div className="text-slate-300">{m.transcript ?? "(transcribiendo…)"}</div>
                    )}
                    {url && ["image", "document"].includes(m.message_type) && (
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="adjunto" className="mt-1 h-20 rounded-lg border border-slate-700 object-cover" />
                      </a>
                    )}
                  </div>
                );
              })
            )}
            <div ref={finRef} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={cerrarYAnalizar} disabled={busy}>
              {busy ? "Analizando…" : "Cerrar captura y rellenar con IA"}
            </Button>
            <span className="text-[12px] text-slate-500">
              {session!.messages.length} mensaje{session!.messages.length !== 1 ? "s" : ""} recibido
              {session!.messages.length !== 1 ? "s" : ""}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
