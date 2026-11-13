import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { listarAlertasPresionVehiculo, resolverAlertaPresion } from "../services/data";
import {
  fechaYHoraCorta, nombreDelTipo, textoDePresion, textoDeRepeticion,
} from "../services/alertasPresion";
import type { AlertaPresion } from "../types";

/**
 * Los avisos de presión abiertos de un vehículo, arriba del todo de su ficha.
 *
 * ── Por qué arriba y por qué sólo los abiertos ─────────────────────────────
 *
 * Es lo primero que hay que saber al abrir un vehículo: si tiene una rueda a
 * media presión ahora mismo, eso cambia lo que se va a hacer con él. Los
 * resueltos no cambian nada hoy, así que no se enseñan aquí.
 *
 * Cuando no hay ninguno, esto NO pinta nada. Una banda verde diciendo «sin
 * avisos» en todas las fichas de la flota es ruido que acaba haciendo que
 * tampoco se lea la roja.
 *
 * ── «Dar por resuelto» es a mano, y tiene que serlo ────────────────────────
 *
 * Goodyear avisa de que la presión está baja; NO avisa de que se ha
 * arreglado. Mientras no haya un aviso de «presión recuperada» —se ha
 * buscado y no ha aparecido en las muestras— el aviso lo cierra una persona
 * que ha inflado la rueda, o lo cerrará una revisión posterior que mida bien
 * esa rueda. Cerrarlo solo por que pase el tiempo sería dar por buena una
 * rueda que nadie ha tocado.
 */
export default function AvisosPresionVehiculo(
  {
    vehiculoId,
    /*
     * Se avisa al cerrar un aviso porque el plano del vehículo también los
     * pinta —la rueda en rojo y su triángulo—. Sin esto, cerrar desde aquí
     * haría desaparecer la banda y dejaría el plano en rojo hasta recargar la
     * página, que parece que no ha funcionado.
     */
    onResuelto,
  }: { vehiculoId: string; onResuelto?: () => void },
) {
  const [avisos, setAvisos] = useState<AlertaPresion[]>([]);
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listarAlertasPresionVehiculo(vehiculoId)
      .then((a) => { if (vivo) setAvisos(a); })
      // La tabla puede no existir todavía en una instalación sin la migración.
      // Un vehículo que no se abre por no poder leer sus avisos sería peor.
      .catch(() => { if (vivo) setAvisos([]); });
    return () => { vivo = false; };
  }, [vehiculoId]);

  if (avisos.length === 0) return null;

  async function resolver(a: AlertaPresion) {
    setResolviendo(a.id);
    try {
      await resolverAlertaPresion(a.id, "Resuelto a mano desde la ficha del vehículo");
      setAvisos((prev) => prev.filter((x) => x.id !== a.id));
      onResuelto?.();
    } catch (e: unknown) {
      alert((e as Error)?.message ?? "No se ha podido cerrar el aviso");
    } finally {
      setResolviendo(null);
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase text-rose-200">
        <AlertTriangle className="h-4 w-4" />
        {avisos.length === 1 ? "Aviso de presión" : `${avisos.length} avisos de presión`}
      </div>

      <div className="flex flex-col gap-2">
        {avisos.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[12px] font-bold text-rose-100">
              {a.posicion?.codigo_posicion ?? "Posición desconocida"}
            </span>
            <span className="text-[13px] font-semibold text-rose-100">
              {nombreDelTipo(a.tipo)}
            </span>
            <span className="text-[13px] text-slate-200">{textoDePresion(a)}</span>
            {/* Que una rueda lleve días avisando es el dato que de verdad
                vale: eso ya no es poca presión, es una fuga. */}
            {textoDeRepeticion(a) && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-200">
                {textoDeRepeticion(a)}
              </span>
            )}
            <span className="text-[11px] text-slate-400">último: {fechaYHoraCorta(a.ultimo_aviso_at) ?? "—"}</span>
            {a.neumatico?.codigo_interno && (
              <span className="text-[11px] text-slate-400">· {a.neumatico.codigo_interno}</span>
            )}
            <button
              onClick={() => void resolver(a)}
              disabled={resolviendo === a.id}
              className="ml-auto rounded border border-slate-500 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              title="El sensor no avisa de que se ha arreglado: esto lo cierra quien lo arregla"
            >
              {resolviendo === a.id ? "Cerrando…" : "Dar por resuelto"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-slate-400">
        Los manda el sensor de Goodyear por correo, no salen de una revisión.
      </div>
    </div>
  );
}
