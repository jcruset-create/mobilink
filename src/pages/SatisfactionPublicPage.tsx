/**
 * La valoración, tal como la ve quien recibió el enlace.
 *
 * ── Fuera del panel ─────────────────────────────────────────────────────────
 *
 * Página suelta, sin barra lateral, sin sesión y sin nada del back-office. Al
 * otro lado hay un conductor en el arcén o alguien en una oficina, con el
 * móvil y probablemente con mala cobertura: una pregunta por pantalla, botones
 * grandes y nada que cargar de más.
 *
 * ── Lo que no se pierde ─────────────────────────────────────────────────────
 *
 * Si el envío falla, las respuestas se quedan en pantalla. Vaciar el
 * formulario ante un error de red es la forma más rápida de que alguien no
 * vuelva a intentarlo.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { API_BASE } from "../modules/workshopApi";
import {
  ENUNCIADO, ETIQUETA_ESTRELLA, ETIQUETA_VALOR, faltantes, pasosVisibles,
  puedeEnviarse, respuestasAEnviar, type Pregunta, type Valores,
} from "../modules/satisfaction/pasos";

type Asistencia = { referencia: string; matricula: string | null; finalizadaEnMs: number | null };

type Encuesta =
  | { estado: "ACTIVE"; recipientRole: string; preguntas: Pregunta[]; asistencia: Asistencia }
  | { estado: "COMPLETED"; asistencia?: Asistencia }
  | { estado: "EXPIRED"; asistencia?: Asistencia }
  | { estado: "UNAVAILABLE" }
  | { estado: "INVALID" };

const PRIVACIDAD =
  "Al enviar tu valoración, tus respuestas quedarán asociadas a esta asistencia " +
  "para mejorar la calidad del servicio.";

function fecha(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString("es-ES", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

export default function SatisfactionPublicPage() {
  const { token = "" } = useParams();
  const [encuesta, setEncuesta] = useState<Encuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [valores, setValores] = useState<Valores>({});
  const [paso, setPaso] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [camposMal, setCamposMal] = useState<string[]>([]);
  const [enviada, setEnviada] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/public/satisfaction/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((e) => { if (vivo) { setEncuesta(e); setCargando(false); } })
      .catch(() => { if (vivo) { setEncuesta({ estado: "INVALID" }); setCargando(false); } });
    return () => { vivo = false; };
  }, [token]);

  // En su propio useMemo para que la identidad del array no cambie en cada
  // render: si cambiara, `visibles` se recalcularía siempre y con él el paso.
  const preguntas = useMemo(
    () => (encuesta?.estado === "ACTIVE" ? encuesta.preguntas : []),
    [encuesta],
  );
  const visibles = useMemo(() => pasosVisibles(preguntas, valores), [preguntas, valores]);
  const actual = visibles[Math.min(paso, Math.max(0, visibles.length - 1))];
  const esUltimo = paso >= visibles.length - 1;

  function responder(code: string, value: Valores[string]) {
    // No se toca nada más del estado: si los motivos dejan de aplicar porque ha
    // subido la nota, se ocultan pero siguen guardados por si vuelve a bajarla.
    setValores((v) => ({ ...v, [code]: value }));
    setCamposMal((c) => c.filter((x) => x !== code));
  }

  async function enviar() {
    if (enviando) return;                      // el doble clic no manda dos veces
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/public/satisfaction/${encodeURIComponent(token)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ respuestas: respuestasAEnviar(preguntas, valores) }),
        },
      );
      const b = await r.json().catch(() => ({}));

      if (r.ok && b.estado === "COMPLETED") { setEnviada(true); return; }
      if (r.status === 410) { setEncuesta({ estado: "EXPIRED" }); return; }
      if (r.status === 409) { setEncuesta({ estado: "UNAVAILABLE" }); return; }
      if (r.status === 404) { setEncuesta({ estado: "INVALID" }); return; }
      if (r.status === 400) {
        setCamposMal(Array.isArray(b.campos) ? b.campos : []);
        setErrorEnvio("Revisa las respuestas marcadas.");
        return;
      }
      if (r.status === 429) {
        setErrorEnvio("Demasiados intentos seguidos. Espera un momento y vuelve a probar.");
        return;
      }
      setErrorEnvio("No hemos podido enviar tu valoración. Tus respuestas siguen aquí.");
    } catch {
      // Sin red. Lo escrito se queda donde está.
      setErrorEnvio("No hemos podido enviar tu valoración. Tus respuestas siguen aquí.");
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) return <Marco><p className="text-slate-500">Cargando…</p></Marco>;

  if (enviada || encuesta?.estado === "COMPLETED") {
    return (
      <Marco>
        <Final
          icono="✓"
          titulo="Gracias por tu valoración"
          texto="Tu opinión nos ayuda a mejorar nuestras asistencias."
        />
      </Marco>
    );
  }

  if (encuesta?.estado === "EXPIRED") {
    return (
      <Marco>
        <Final
          titulo="Esta encuesta ya no está disponible"
          texto="El periodo para valorar esta asistencia ha finalizado."
        />
      </Marco>
    );
  }

  if (encuesta?.estado === "INVALID") {
    return (
      <Marco>
        <Final
          titulo="No podemos acceder a esta encuesta"
          texto="Comprueba que has utilizado el enlace que recibiste en el mensaje original."
        />
      </Marco>
    );
  }

  if (encuesta?.estado !== "ACTIVE") {
    return <Marco><Final titulo="Esta encuesta no está disponible" /></Marco>;
  }

  const { asistencia } = encuesta;
  const cuando = fecha(asistencia.finalizadaEnMs);

  return (
    <Marco>
      <header className="mb-5">
        <div className="text-lg font-black tracking-tight text-slate-900">Mobilink Assist</div>
        <p className="text-sm text-slate-500">Tu opinión nos ayuda a mejorar</p>
        <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          <span className="font-bold">{asistencia.referencia}</span>
          {asistencia.matricula ? ` · ${asistencia.matricula}` : ""}
          {cuando ? ` · ${cuando}` : ""}
        </div>
      </header>

      {/* Progreso: sin porcentajes, solo cuántas quedan. */}
      <div className="mb-4 flex gap-1" aria-hidden="true">
        {visibles.map((p, i) => (
          <span
            key={p.code}
            className={`h-1 flex-1 rounded-full ${i <= paso ? "bg-orange-500" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {actual && (
        <fieldset className="mb-6 border-0 p-0">
          <legend className="mb-3 block text-base font-bold text-slate-900">
            {ENUNCIADO[actual.code] ?? actual.code}
            {!actual.obligatoria && (
              <span className="ml-2 text-xs font-semibold text-slate-400">(opcional)</span>
            )}
          </legend>
          <Campo
            pregunta={actual}
            valor={valores[actual.code]}
            malo={camposMal.includes(actual.code)}
            onCambio={(v) => responder(actual.code, v)}
          />
        </fieldset>
      )}

      {errorEnvio && (
        <p role="alert" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          {errorEnvio}
        </p>
      )}

      <div className="flex gap-2">
        {paso > 0 && (
          <button
            type="button"
            onClick={() => setPaso((p) => Math.max(0, p - 1))}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"
          >
            Atrás
          </button>
        )}
        {!esUltimo ? (
          <button
            type="button"
            onClick={() => setPaso((p) => p + 1)}
            disabled={actual?.obligatoria && faltantes([actual], valores).length > 0}
            className="flex-1 rounded-xl bg-orange-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            Siguiente
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || !puedeEnviarse(preguntas, valores)}
            className="flex-1 rounded-xl bg-orange-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {enviando ? "Enviando…" : errorEnvio ? "Reintentar" : "Enviar valoración"}
          </button>
        )}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-slate-400">{PRIVACIDAD}</p>
    </Marco>
  );
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <main className="mx-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-sm">
        {children}
      </main>
    </div>
  );
}

function Final({ icono, titulo, texto }: { icono?: string; titulo: string; texto?: string }) {
  return (
    <div className="py-8 text-center">
      {icono && <div className="mb-3 text-4xl text-emerald-600">{icono}</div>}
      <h1 className="text-lg font-black text-slate-900">{titulo}</h1>
      {texto && <p className="mt-2 text-sm text-slate-500">{texto}</p>}
    </div>
  );
}

function Campo({ pregunta, valor, malo, onCambio }: {
  pregunta: Pregunta;
  valor: Valores[string];
  malo: boolean;
  onCambio: (v: Valores[string]) => void;
}) {
  const borde = malo ? "border-red-400" : "border-slate-300";

  if (pregunta.tipo === "rating") {
    const conEtiqueta = pregunta.code === "overall_rating";
    return (
      <div>
        <div className="flex gap-2" role="radiogroup" aria-label={ENUNCIADO[pregunta.code]}>
          {[1, 2, 3, 4, 5].map((n) => {
            const puesta = typeof valor === "number" && n <= valor;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={valor === n}
                aria-label={`${n} de 5 · ${ETIQUETA_ESTRELLA[n]}`}
                onClick={() => onCambio(n)}
                className={`flex-1 rounded-xl border-2 py-3 text-2xl transition
                  ${puesta ? "border-orange-500 bg-orange-50" : borde}
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
              >
                {/* La estrella llena/vacía no depende solo del color: cambia el
                    glifo, así se distingue sin ver bien los tonos. */}
                <span aria-hidden="true">{puesta ? "★" : "☆"}</span>
              </button>
            );
          })}
        </div>
        {conEtiqueta && typeof valor === "number" && (
          <p className="mt-2 text-center text-sm font-bold text-orange-700">
            {ETIQUETA_ESTRELLA[valor]}
          </p>
        )}
      </div>
    );
  }

  if (pregunta.tipo === "enum") {
    return (
      <div className="space-y-2" role="radiogroup" aria-label={ENUNCIADO[pregunta.code]}>
        {(pregunta.valores ?? []).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={valor === v}
            onClick={() => onCambio(v)}
            className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-bold transition
              ${valor === v ? "border-orange-500 bg-orange-50 text-orange-900" : `${borde} text-slate-700`}
              focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500`}
          >
            {valor === v ? "● " : "○ "}{ETIQUETA_VALOR[v] ?? v}
          </button>
        ))}
      </div>
    );
  }

  if (pregunta.tipo === "multi") {
    const lista = Array.isArray(valor) ? valor : [];
    return (
      <div className="space-y-2">
        {(pregunta.valores ?? []).map((v) => {
          const marcado = lista.includes(v);
          return (
            <label
              key={v}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm font-semibold
                ${marcado ? "border-orange-500 bg-orange-50 text-orange-900" : `${borde} text-slate-700`}`}
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => onCambio(marcado ? lista.filter((x) => x !== v) : [...lista, v])}
                className="h-4 w-4 accent-orange-600"
              />
              {ETIQUETA_VALOR[v] ?? v}
            </label>
          );
        })}
      </div>
    );
  }

  const texto = typeof valor === "string" ? valor : "";
  const max = pregunta.maxLongitud ?? 2000;
  return (
    <div>
      <label className="sr-only" htmlFor={`c-${pregunta.code}`}>{ENUNCIADO[pregunta.code]}</label>
      <textarea
        id={`c-${pregunta.code}`}
        value={texto}
        maxLength={max}
        rows={4}
        onChange={(e) => onCambio(e.target.value)}
        placeholder="Escribe aquí si quieres…"
        className={`w-full rounded-xl border-2 ${borde} px-3 py-2 text-sm text-slate-800
          focus:border-orange-500 focus:outline-none`}
      />
      <p className="mt-1 text-right text-[11px] text-slate-400">{texto.length} / {max}</p>
    </div>
  );
}
