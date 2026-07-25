/**
 * Centro de Inteligencia Operacional — asistente conversacional.
 *
 * Panel lateral disponible en todas las pantallas del módulo. Solo consulta
 * datos del ámbito del usuario y nunca ejecuta acciones: cuando una respuesta
 * implica actuar, ofrece el enlace a la pantalla donde confirmarlo.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Send, X, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { oiFetch, type AssistantAnswer } from "../../services/oiApi";

type Turn = { question: string; answer: AssistantAnswer | null; error?: string };

export default function AsistenteIA({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || suggestions.length) return;
    oiFetch<{ data: string[] }>("/assistant/suggestions").then((r) => setSuggestions(r.data)).catch(() => {});
  }, [open, suggestions.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setText("");
    setLoading(true);
    setTurns((t) => [...t, { question: q, answer: null }]);
    try {
      const answer = await oiFetch<AssistantAnswer>("/assistant/query", { method: "POST", body: { question: q } });
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    } catch (e: any) {
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: e.message } : turn)));
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-cyan-400" />
          <div>
            <div className="text-sm font-black text-slate-100">Asistente operacional</div>
            <div className="text-[11px] text-slate-400">Solo consulta datos de tu ámbito</div>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-slate-400">Pregunta sobre la operación, por ejemplo:</p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-[13px] text-slate-300 hover:border-cyan-500/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-8 rounded-lg bg-cyan-600/20 px-3 py-2 text-[13px] text-cyan-100">{turn.question}</div>

            {turn.error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{turn.error}</div>
            )}

            {turn.answer && (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2">
                <p className="text-[13px] leading-relaxed text-slate-200">{turn.answer.answer}</p>

                {turn.answer.columns && turn.answer.rows && turn.answer.rows.length > 0 && (
                  <div className="max-h-64 overflow-auto rounded border border-slate-700">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr>
                          {turn.answer.columns.map((c) => (
                            <th key={c} className="px-2 py-1 text-left text-[10px] uppercase tracking-wide text-slate-400">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {turn.answer.rows.slice(0, 30).map((row, ri) => (
                          <tr key={ri} className="border-t border-slate-700/60">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1 text-[11px] text-slate-300">{cell ?? "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {turn.answer.dataUsed.length > 0 && (
                  <p className="text-[10px] text-slate-500">Datos utilizados: {turn.answer.dataUsed.join(" · ")}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {turn.answer.link && (
                    <button
                      onClick={() => { navigate(turn.answer!.link!); onClose(); }}
                      className="flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
                    >
                      <ExternalLink className="h-3 w-3" /> Ver en pantalla
                    </button>
                  )}
                  {turn.answer.followUps?.map((f) => (
                    <button
                      key={f}
                      onClick={() => ask(f)}
                      className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && <div className="text-[13px] text-slate-500">Consultando…</div>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(text); }}
        className="flex items-center gap-2 border-t border-slate-700 p-3"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="¿Cuántos servicios están retrasados?"
          className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="rounded-lg bg-cyan-600 p-2 text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
