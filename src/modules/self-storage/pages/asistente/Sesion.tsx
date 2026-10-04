/**
 * Asistente IA → una sesión: la CONSOLA de conversación (si está en curso),
 * las herramientas que ha usado, el resumen, el escalado y la revisión de
 * calidad (correcta / parcialmente correcta / incorrecta) que alimenta la
 * mejora de la base de conocimiento.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../../services/api";
import type { SesionIADetalle } from "../../types";
import { Aviso, Cabecera, Cargando, ErrorBox, SelectField, TableWrap, TextAreaField, btnDanger, btnMini, btnPrimary, btnSecondary, fechaHora, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { duracion, etqIdioma } from "../callcenter/formato";
import { ChipResultado, ChipRiesgo, ChipSesion, ConEstadoAsistente } from "./comun";
import { REVISION } from "./etiquetas";

type Burbuja = { quien: "user" | "assistant" | "tool"; texto: string; herramientas?: { tool: string; outcome: string; error?: string }[] };

function Contenido() {
  const { id = "" } = useParams();
  const { puede } = useSelfStorage();
  const [s, setS] = useState<SesionIADetalle | null>(null);
  const [chat, setChat] = useState<Burbuja[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState({ reviewStatus: "", notes: "" });
  const fin = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const x = await api.sesionIA(id);
      setS(x);
      setChat(x.messages.filter((m) => m.role !== "system").map((m) => ({ quien: m.role as Burbuja["quien"], texto: m.content })));
      setRevision({ reviewStatus: x.reviewStatus ?? "", notes: x.reviewNotes ?? "" });
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [id]);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  useEffect(() => {
    fin.current?.scrollIntoView({ block: "end" });
  }, [chat]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !s) return;
    setEnviando(true);
    setTexto("");
    setChat((c) => [...c, { quien: "user", texto: t }]);
    try {
      const r = await api.mensajeIA(s.id, t);
      setChat((c) => [...c, { quien: "assistant", texto: r.reply, herramientas: r.tools }]);
      setS(r.session);
    } catch (e) {
      setError(msgError(e));
    } finally {
      setEnviando(false);
    }
  };
  const accion = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };
  if (error && !s) return <ErrorBox>{error}</ErrorBox>;
  if (!s) return <Cargando />;
  const viva = s.status === "active";
  const dur = s.endedAt ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000) : null;

  return (
    <div className="space-y-3">
      <Cabecera titulo={s.mode === "call" ? `Sesión en llamada ${s.callPhone ?? ""}` : "Sesión de consola"} descripcion={`${fechaHora(s.startedAt)} · ${s.provider} · ${s.model ?? "—"} · ${etqIdioma(s.language)} · ${s.turns} turnos · ${duracion(dur)}`}>
        <ChipSesion estado={s.status} />
        <Link className={btnSecondary} to="/self-storage/asistente/sesiones">
          Volver
        </Link>
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      {s.status === "escalated" && (
        <Aviso tono="aviso">
          Escalada a una persona {fechaHora(s.escalatedAt)}: {s.escalationReason}.{" "}
          {s.callId && (
            <Link className="underline" to={`/self-storage/call-center/llamada/${s.callId}`}>
              Abrir la llamada
            </Link>
          )}
        </Aviso>
      )}
      {s.error && <Aviso tono="mal">Proveedor: {s.error}</Aviso>}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="flex min-h-[24rem] flex-col rounded-xl border border-slate-700 bg-slate-800 p-3">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Conversación</h2>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {chat.length === 0 && <p className="text-[12px] text-slate-500">{viva ? "Escribe como si fueras quien llama (en castellano o en catalán)." : "La conversación no se guardó (protección de datos). Queda el resumen."}</p>}
            {chat.map((b, i) =>
              b.quien === "tool" ? (
                <div key={i} className="mx-6 rounded-lg border border-dashed border-slate-600 px-2 py-1 font-mono text-[11px] text-slate-400">
                  {b.texto.slice(0, 300)}
                </div>
              ) : (
                <div key={i} className={`flex ${b.quien === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${b.quien === "user" ? "bg-orange-600 text-white" : "bg-slate-700 text-slate-100"}`}>
                    {b.texto}
                    {b.herramientas && b.herramientas.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {b.herramientas.map((h, j) => (
                          <span key={j} className="rounded bg-slate-900/60 px-1.5 py-0.5 text-slate-300" title={h.error}>
                            {h.tool} · {h.outcome === "success" ? "bien" : h.outcome === "blocked" ? "bloqueada" : "error"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
            <div ref={fin} />
          </div>
          {viva && (
            <div className="mt-2 flex gap-2">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !enviando && void enviar()}
                placeholder="¿Cuánto cuesta un trastero?"
                disabled={enviando}
                className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button className={btnPrimary} disabled={enviando || !texto.trim()} onClick={() => void enviar()}>
                {enviando ? "…" : "Enviar"}
              </button>
            </div>
          )}
          {viva && (
            <div className="mt-2 flex gap-2 text-[12px]">
              <button className={btnSecondary} onClick={() => void accion(() => api.finalizarSesionIA(s.id))}>
                Terminar
              </button>
              <button className={btnDanger} onClick={() => void accion(() => api.escalarSesionIA(s.id, "Escalado manual desde la consola"))}>
                Pasar a una persona
              </button>
            </div>
          )}
        </section>

        <div className="space-y-3">
          <section className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-[13px]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Resumen</h2>
            <p className="whitespace-pre-wrap text-slate-200">{s.summary ?? "—"}</p>
            <div className="mt-2 text-[12px] text-slate-400">
              Tokens: {s.inputTokens} entrada · {s.outputTokens} salida
              {s.costEstimate != null ? ` · coste estimado ${s.costEstimate.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €` : ""}
            </div>
            {s.flagReason && <div className="mt-1 text-[12px] text-amber-300">Marcada para revisión: {s.flagReason}</div>}
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Herramientas usadas</h2>
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Herramienta</th>
                  <th className={thCls}>Resultado</th>
                  <th className={thCls}>ms</th>
                </tr>
              </thead>
              <tbody>
                {s.toolCalls.length === 0 && (
                  <tr>
                    <td className={`${tdCls} text-slate-500`} colSpan={3}>
                      Ninguna.
                    </td>
                  </tr>
                )}
                {s.toolCalls.map((t) => (
                  <tr key={t.id} className="border-t border-slate-700 align-top">
                    <td className={tdCls}>
                      <span className="font-mono text-[12px]">{t.tool}</span> <ChipRiesgo r={t.risk} />
                      {t.error && <div className="text-[11px] text-rose-300">{t.error}</div>}
                    </td>
                    <td className={tdCls}>
                      <ChipResultado o={t.outcome} />
                    </td>
                    <td className={tdCls}>{t.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </section>

          <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-800 p-3">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Revisión de calidad</h2>
            {s.reviewStatus && (
              <p className="text-[12px] text-slate-300">
                {REVISION[s.reviewStatus]} · {s.reviewedByName ?? ""} {fechaHora(s.reviewedAt)}
              </p>
            )}
            {puede("ss.ai.review") ? (
              <>
                <SelectField label="Valoración" value={revision.reviewStatus} onChange={(v) => setRevision((r) => ({ ...r, reviewStatus: v }))}>
                  <option value="">— Elige —</option>
                  <option value="correct">Correcta</option>
                  <option value="partial">Parcialmente correcta</option>
                  <option value="incorrect">Incorrecta</option>
                </SelectField>
                <TextAreaField label="Notas (qué mejorar en el conocimiento)" value={revision.notes} onChange={(v) => setRevision((r) => ({ ...r, notes: v }))} rows={3} />
                <button
                  className={btnMini}
                  disabled={!revision.reviewStatus}
                  onClick={() => void accion(() => api.revisarSesionIA(s.id, { reviewStatus: revision.reviewStatus, notes: revision.notes.trim() || null }))}
                >
                  Guardar revisión
                </button>
              </>
            ) : (
              !s.reviewStatus && <p className="text-[12px] text-slate-500">Pendiente de revisión por un supervisor.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function Sesion() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
