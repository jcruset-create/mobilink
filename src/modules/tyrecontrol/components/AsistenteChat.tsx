import { useEffect, useRef, useState } from "react";
import { Bot, Send, X, Loader2 } from "lucide-react";
import { apiFetch } from "../../apiFetch";

/**
 * Asistente virtual de TyreControl (fase 2): botón flotante + panel de chat.
 *
 * Todo el trabajo lo hace /api/tyrecontrol/asistente/preguntar, que llama a
 * herramientas de solo lectura ya acotadas a la empresa del usuario. Aquí no
 * hay lógica de negocio ni consultas: solo conversación.
 *
 * Cada respuesta muestra QUÉ herramientas se usaron y la fecha del dato. Eso
 * es lo que la hace auditable: el cliente puede ir a la pantalla y comprobar
 * la cifra.
 */

interface Mensaje {
  rol: "usuario" | "asistente";
  texto: string;
  fuentes?: string[];
  fecha?: string;
  error?: boolean;
}

const SUGERENCIAS = [
  "¿Cuál es el estado general de mi flota?",
  "¿Qué vehículos tengo que revisar?",
  "¿Tengo alertas urgentes?",
];

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  estado_flota: "Estado de flota",
  vehiculos_pendientes: "Vehículos pendientes",
  alertas_activas: "Alertas activas",
};

/** Negritas de markdown (**así**) → <strong>. El backend solo usa eso. */
function formatear(texto: string) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
    t.startsWith("**") && t.endsWith("**")
      ? <strong key={i} className="font-bold text-white">{t.slice(2, -2)}</strong>
      : <span key={i}>{t}</span>
  );
}

export default function AsistenteChat() {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  // Sin IA configurada en el servidor no se muestra el botón: mejor nada que
  // un botón que siempre falla.
  useEffect(() => {
    apiFetch("/api/tyrecontrol/asistente/estado")
      .then((r) => (r.ok ? r.json() : { disponible: false }))
      .then((d) => setDisponible(Boolean(d?.disponible)))
      .catch(() => setDisponible(false));
  }, []);

  useEffect(() => {
    if (abierto) finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, abierto, cargando]);

  async function preguntar(pregunta: string) {
    const q = pregunta.trim();
    if (!q || cargando) return;
    setTexto("");
    setMensajes((m) => [...m, { rol: "usuario", texto: q }]);
    setCargando(true);
    try {
      const r = await apiFetch("/api/tyrecontrol/asistente/preguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta: q }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
      setMensajes((m) => [...m, {
        rol: "asistente",
        texto: d.respuesta ?? "",
        fuentes: Array.isArray(d.herramientas_usadas) ? d.herramientas_usadas : [],
        fecha: d.fecha_datos,
      }]);
    } catch (e: any) {
      setMensajes((m) => [...m, {
        rol: "asistente",
        texto: e?.message || "No he podido consultar los datos.",
        error: true,
      }]);
    } finally {
      setCargando(false);
    }
  }

  if (!disponible) return null;

  return (
    <>
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          title="Asistente"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg transition hover:bg-sky-500"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {abierto && (
        <div className="fixed bottom-0 right-0 z-40 flex h-[85vh] w-full flex-col border-l border-t border-slate-700 bg-slate-900 shadow-2xl sm:bottom-5 sm:right-5 sm:h-[70vh] sm:w-[420px] sm:rounded-2xl sm:border">
          <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-sky-400" />
              <span className="text-sm font-black">Asistente</span>
            </div>
            <button onClick={() => setAbierto(false)} className="rounded-lg p-1 hover:bg-slate-800">
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {mensajes.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  Pregúntame sobre tu flota. Respondo solo con datos reales; si no
                  tengo el dato, te lo digo.
                </p>
                <div className="space-y-2">
                  {SUGERENCIAS.map((s) => (
                    <button
                      key={s}
                      onClick={() => preguntar(s)}
                      className="block w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm hover:border-sky-600"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensajes.map((m, i) => (
              <div key={i} className={m.rol === "usuario" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.rol === "usuario"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-sky-600 px-3 py-2 text-sm text-white"
                      : `max-w-[95%] rounded-2xl rounded-bl-sm border px-3 py-2 text-sm ${
                          m.error
                            ? "border-red-800 bg-red-950/40 text-red-200"
                            : "border-slate-700 bg-slate-800 text-slate-200"
                        }`
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{formatear(m.texto)}</p>
                  {/* Pie de fuentes: hace la respuesta comprobable. */}
                  {m.fuentes && m.fuentes.length > 0 && (
                    <p className="mt-2 border-t border-slate-700 pt-1.5 text-[11px] text-slate-500">
                      Fuentes: {m.fuentes.map((f) => NOMBRE_HERRAMIENTA[f] ?? f).join(" · ")}
                      {m.fecha && ` · datos a ${new Date(m.fecha).toLocaleDateString("es-ES")}`}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {cargando && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Consultando datos…
              </div>
            )}
            <div ref={finRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); preguntar(texto); }}
            className="flex items-center gap-2 border-t border-slate-700 p-3"
          >
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe tu pregunta…"
              maxLength={500}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-sky-600"
            />
            <button
              type="submit"
              disabled={cargando || !texto.trim()}
              className="rounded-xl bg-sky-600 p-2 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
