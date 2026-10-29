/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Resumen IA de la ficha de vehículo.
 *
 * Lo que la persona ve aquí son HECHOS que ya constan en la ficha, cada uno
 * con el enlace al registro que lo respalda. No es un diagnóstico y no dice
 * si el vehículo es seguro: eso se decide mirando los neumáticos.
 *
 * Reglas de esta pantalla:
 *   · No se genera nada al abrir la ficha. Solo al pulsar.
 *   · Los enlaces vienen del servidor. Nunca se construye una ruta a partir
 *     de lo que haya escrito el modelo.
 *   · Si la IA falla, esta tarjeta enseña el error y la ficha sigue entera.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { pedirResumenVehiculo, type HechoResumen, type ResumenVehiculoIA as Resumen } from "../services/data";

const SECCIONES: { clave: keyof Pick<Resumen, "ultimas_actuaciones" | "incidencias_abiertas" | "trabajos_pendientes">; titulo: string }[] = [
  { clave: "ultimas_actuaciones", titulo: "Últimas actuaciones" },
  { clave: "incidencias_abiertas", titulo: "Incidencias abiertas" },
  { clave: "trabajos_pendientes", titulo: "Trabajos pendientes" },
];

function Hechos({ hechos }: { hechos: HechoResumen[] }) {
  const navigate = useNavigate();
  if (hechos.length === 0) {
    return <div className="text-[12px] italic text-slate-500">Sin datos registrados.</div>;
  }
  return (
    <ul className="space-y-2">
      {hechos.map((h, i) => (
        <li key={i} className="text-[13px] leading-snug text-slate-200">
          {h.texto}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {h.evidencias.map((e) => (
              <button
                key={e.ref}
                type="button"
                onClick={() => navigate(e.ruta)}
                title={e.etiqueta}
                className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-sky-500 hover:text-sky-300"
              >
                {e.etiqueta}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ResumenVehiculoIA({ vehiculoId }: { vehiculoId: string }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generar = async (refrescar: boolean) => {
    setCargando(true);
    setError(null);
    try {
      setResumen(await pedirResumenVehiculo(vehiculoId, refrescar));
    } catch (e: any) {
      setError(e?.message || "No se ha podido generar el resumen");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Resumen IA</div>
        <button
          type="button"
          onClick={() => void generar(false)}
          disabled={cargando}
          className="ml-auto rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {cargando ? "Generando…" : resumen ? "✨ Volver a generar" : "✨ Generar resumen"}
        </button>
        {resumen && !cargando && (
          <button
            type="button"
            onClick={() => void generar(true)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-[12px] font-semibold text-slate-300 hover:border-violet-500 hover:text-violet-300"
            title="Ignorar lo guardado y volver a pedirlo"
          >
            ↻ Rehacer
          </button>
        )}
      </div>

      {!resumen && !error && !cargando && (
        <div className="text-[12px] text-slate-400">
          Reúne lo que ya consta en la ficha —actuaciones recientes, incidencias abiertas,
          trabajos pendientes y datos que faltan— con el enlace a cada registro.
          No valora el estado de los neumáticos ni sustituye a una revisión.
        </div>
      )}

      {error && (
        <div className="rounded border border-amber-600/50 bg-amber-500/10 p-2 text-[12px] text-amber-200">
          {error}
        </div>
      )}

      {resumen && (
        <div className="space-y-3">
          {/* Cuándo y de qué periodo. Primero, porque un resumen sin fecha se
              lee como si fuera de hoy aunque sea de ayer. */}
          <div className="text-[11px] text-slate-500">
            Generado el {new Date(resumen.generado_at).toLocaleString("es-ES")}
            {" · "}histórico de los últimos {resumen.ventana.meses} meses (desde {resumen.ventana.desde})
            {resumen.origen === "cache" ? " · resumen guardado, no se ha vuelto a pedir" : ""}
          </div>

          {resumen.titular && (
            <div className="text-[13px] font-semibold text-slate-100">{resumen.titular}</div>
          )}

          {resumen.avisos.length > 0 && (
            <div className="rounded border border-amber-600/50 bg-amber-500/10 p-2">
              <div className="mb-1 text-[10px] font-bold uppercase text-amber-300">Avisos sobre los datos</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-amber-100">
                {resumen.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {SECCIONES.map((s) => (
            <div key={s.clave}>
              <div className="mb-1 text-[10px] font-bold uppercase text-slate-400">{s.titulo}</div>
              <Hechos hechos={resumen[s.clave] ?? []} />
            </div>
          ))}

          {resumen.datos_que_faltan.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase text-slate-400">Datos que faltan</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-slate-300">
                {resumen.datos_que_faltan.map((d) => <li key={d.clave}>{d.texto}</li>)}
              </ul>
            </div>
          )}

          <div className="border-t border-slate-700 pt-2 text-[10px] text-slate-500">
            Resumen redactado por IA a partir de los registros enlazados. Puede estar
            incompleto si falta información en la ficha; no es una valoración técnica
            ni una comprobación de seguridad.
          </div>
        </div>
      )}
    </div>
  );
}
