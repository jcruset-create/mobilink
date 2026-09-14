/**
 * Las dudas del sistema, y los botones para resolverlas.
 *
 * Es la contrapartida de la regla que gobierna el módulo: cuando la ingesta no
 * sabe si un correo es de un expediente que ya existe, no elige — lo deja aquí.
 * Si esta pantalla no existiera, esos correos se quedarían en la base para
 * siempre y el trabajo que traen no lo vería nadie.
 *
 * ── Por qué se enseñan los motivos y no la puntuación ───────────────────────
 *
 * «60 puntos» no ayuda a decidir. «Misma factura 0000123514 · albarán 806295 ya
 * en INC-452 · factura distinta» sí: son los hechos que el motor encontró, cada
 * uno con lo que sumó o restó. Quien decide puede ver dónde se equivocó el
 * sistema, que es lo que permite ajustar los pesos con criterio en vez de a ojo.
 *
 * Y se enseñan TAL Y COMO se calcularon, porque así se guardaron: si mañana se
 * cambian los pesos, esta pantalla sigue diciendo por qué se preguntó entonces.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import * as api from "../services/api";
import { useTherefore } from "../contexts/ThereforeContext";
import { Aviso, ChipEstado, ErrorBox, Pill, btnMini, btnPrimary, btnSecondary } from "../components/ui";
import { ETIQUETA_DECISION, OPCIONES_DECISION, type Decision } from "../types";

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

/**
 * El desglose de una candidatura.
 *
 * Los sumandos en verde y los castigos en rosa, con el número al lado. Es la
 * misma convención de color del resto del panel: rosa lo que va en contra.
 */
function Motivos({ motivos }: { motivos: { clave: string; puntos: number; texto: string }[] }) {
  if (motivos.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {motivos.map((m) => (
        <li key={m.clave} className="flex items-baseline gap-2 text-[12px]">
          <span
            className={`w-10 shrink-0 text-right font-mono ${
              m.puntos < 0 ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {m.puntos > 0 ? `+${m.puntos}` : m.puntos}
          </span>
          <span className="text-slate-300">{m.texto}</span>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  decision: Decision;
  puedeResolver: boolean;
  onResolver: (id: string, respuesta: { decision: string; expedienteId?: string; motivo?: string }) => Promise<void>;
};

function Tarjeta({ decision, puedeResolver, onResolver }: Props) {
  const opciones = OPCIONES_DECISION[decision.tipo] ?? [];
  const [elegido, setElegido] = useState<string>(decision.candidatos[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detalle = (decision.detalle ?? {}) as Record<string, string>;

  async function responder(valor: string) {
    setEnviando(true);
    setError(null);
    try {
      await onResolver(decision.id, {
        decision: valor,
        // Sólo se manda cuando la respuesta lo pide: el servidor rechaza un
        // expediente que no estuviera entre los candidatos, y mandarlo de más
        // en «es otro asunto» sería ruido.
        expedienteId: valor === "FUSIONAR" ? elegido : undefined,
        motivo: motivo.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar la decisión");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-bold">{ETIQUETA_DECISION[decision.tipo] ?? decision.tipo}</span>
        <span className="text-[12px] text-slate-500">{fechaCorta(decision.createdAt)}</span>
        {decision.expedienteId && (
          <Link
            to={`/therefore/expedientes/${decision.expedienteId}`}
            className="text-[12px] text-sky-300 underline-offset-2 hover:underline"
          >
            Ver el expediente
          </Link>
        )}
      </header>

      {decision.tipo === "CAMBIO_INSTRUCCION" && (
        <p className="mb-3 text-[13px] text-slate-300">
          El correo pide <b>{detalle.accionNueva}</b> sobre el albarán <b>{detalle.albaran}</b>, que
          estaba como <b>{detalle.accionAnterior}</b>. La actuación no se ha tocado.
        </p>
      )}

      {decision.tipo === "REQUIERE_REVISION" && (
        <p className="mb-3 text-[13px] text-slate-300">{detalle.motivo}</p>
      )}

      {decision.candidatos.length > 0 && (
        <div className="mb-3 space-y-2">
          {decision.candidatos.map((c) => (
            <label
              key={c.id}
              className={`block cursor-pointer rounded-xl border p-3 ${
                elegido === c.id ? "border-sky-500 bg-sky-500/5" : "border-slate-700"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* Sólo hay que elegir cuando se puede fusionar en varios. */}
                {decision.tipo === "POSIBLE_DUPLICADO" && (
                  <input
                    type="radio"
                    name={`candidato-${decision.id}`}
                    checked={elegido === c.id}
                    onChange={() => setElegido(c.id)}
                    className="accent-sky-500"
                  />
                )}
                <Link
                  to={`/therefore/expedientes/${c.id}`}
                  className="text-[13px] font-bold text-sky-300 underline-offset-2 hover:underline"
                >
                  {c.numero}
                </Link>
                <ChipEstado estado={c.estado} />
                <Pill className="bg-slate-700 text-slate-300">{c.score} puntos</Pill>
              </div>
              <Motivos motivos={c.motivos} />
            </label>
          ))}
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      {puedeResolver ? (
        <div className="space-y-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué (obligatorio al dejar algo bloqueado)"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-[13px] outline-none focus:border-sky-500"
          />
          <div className="flex flex-wrap gap-2">
            {opciones.map((o, i) => (
              <button
                key={o.valor}
                onClick={() => void responder(o.valor)}
                disabled={enviando}
                className={i === 0 ? btnPrimary : btnSecondary}
              >
                {o.texto}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">
          Tu usuario puede verlo pero no decidirlo. Pídeselo a quien lleva la cola.
        </p>
      )}
    </article>
  );
}

export default function Revision() {
  const { permisos, refrescar } = useTherefore();
  const [decisiones, setDecisiones] = useState<Decision[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const puedeResolver = permisos.includes("therefore.decision.resolve");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.listarDecisiones({ estado: "PENDIENTE" });
      setDecisiones(r.decisiones);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar las decisiones");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const resolver = useCallback(
    async (id: string, respuesta: { decision: string; expedienteId?: string; motivo?: string }) => {
      await api.resolverDecision(id, respuesta);
      // Se recarga entera en vez de quitar la tarjeta: resolver un cambio de
      // instrucción puede desbloquear un expediente y dejar otra decisión
      // suya sin sentido, y una lista que se actualiza a medias miente.
      await cargar();
      // El bootstrap otra vez: resolver una decisión puede quitarle a un
      // expediente la marca de revisión, y el contador de la pestaña se
      // quedaría alto enseñando trabajo que ya no existe.
      await refrescar();
    },
    [cargar, refrescar]
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-black">Revisión</h1>
        <button onClick={() => void cargar()} className={btnMini} disabled={cargando}>
          <RefreshCw className={`mr-1 inline h-3 w-3 ${cargando ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {!cargando && decisiones.length === 0 && (
        <Aviso tono="bien">
          No hay nada esperando. Cuando el sistema no sepa si un correo es de un expediente que ya
          existe, lo dejará aquí en vez de elegir por su cuenta.
        </Aviso>
      )}

      <div className="space-y-3">
        {decisiones.map((d) => (
          <Tarjeta
            key={d.id}
            decision={d}
            puedeResolver={puedeResolver}
            onResolver={resolver}
          />
        ))}
      </div>
    </div>
  );
}
