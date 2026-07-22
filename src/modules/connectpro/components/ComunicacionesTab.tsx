/** Connect Pro — pestaña Comunicaciones: notas internas y registro de llamadas. */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Input, Select, Button, ErrorBanner, EmptyState } from "./ui";
import { fmtDateTime } from "../types";

type Comm = {
  id: number; channel: string; direction: string; toRef: string | null;
  body: string; byName: string | null; createdAtMs: number;
};

const CHANNEL_LABELS: Record<string, string> = { note: "📝 Nota", call: "📞 Llamada", whatsapp: "💬 WhatsApp", email: "✉️ Email" };

export default function ComunicacionesTab({ assistanceId, canOperate }: { assistanceId: number; canOperate: boolean }) {
  const [rows, setRows] = useState<Comm[]>([]);
  const [channel, setChannel] = useState("note");
  const [toRef, setToRef] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    boFetch<{ data: Comm[] }>(`/assistances/${assistanceId}/communications`).then((r) => setRows(r.data)).catch((e) => setError(e.message));
  }, [assistanceId]);
  useEffect(load, [load]);

  const enviar = async () => {
    if (!body.trim()) return;
    setBusy(true); setError(null);
    try {
      await boFetch(`/assistances/${assistanceId}/communications`, {
        method: "POST",
        body: { channel, direction: channel === "note" ? "internal" : "outbound", toRef: toRef || null, body },
      });
      setBody(""); setToRef("");
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {canOperate && (
        <div className="flex flex-wrap gap-2">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="note">Nota interna</option>
            <option value="call">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </Select>
          {channel !== "note" && (
            <Input placeholder="Destinatario (tel./email)" value={toRef} onChange={(e) => setToRef(e.target.value)} className="w-48" />
          )}
          <Input placeholder="Escribe la nota o el resumen de la comunicación…" value={body} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviar()} className="min-w-64 flex-1" />
          <Button onClick={enviar} disabled={busy || !body.trim()}>Registrar</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState message="Sin comunicaciones registradas." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((c) => (
            <Card key={c.id} className="p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
                {c.toRef && <span>→ {c.toRef}</span>}
                <span>· {c.byName ?? "sistema"}</span>
                <span>· {fmtDateTime(c.createdAtMs)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-slate-200">{c.body}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
