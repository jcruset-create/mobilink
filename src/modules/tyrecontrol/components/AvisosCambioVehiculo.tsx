import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { listarUltimasMedicionesVehiculo } from "../services/data";
import { profundidadVigente } from "../utils/profundidad";
import { hayQueCambiar, profundidadMinimaPorLlanta } from "../services/umbralProfundidad";
import type { MontajeActual } from "../types";

/**
 * Las gomas de un vehículo que están para cambiar, arriba del todo de su ficha.
 *
 * ── Por qué aquí y no solo en el informe ───────────────────────────────────
 *
 * El informe de alertas lo dice de toda la empresa, y está bien para quien
 * planifica. Pero quien abre la ficha de UN camión no va a cruzar 91 líneas
 * para ver si alguna es suya. Es la misma razón por la que los avisos de
 * presión tienen su banda: lo que cambia lo que se va a hacer con este
 * vehículo tiene que estar en este vehículo.
 *
 * ── El umbral depende de la llanta ─────────────────────────────────────────
 *
 * 22.5 → 4 mm, 19.5 y 17.5 → 3, 16 e inferiores → 2. La regla está en
 * `services/umbralProfundidad.ts`, con sus pruebas, y es un puerto de la que
 * usa el informe en la base. Tres milímetros es para cambiar en un camión y
 * es normal en una furgoneta: por eso no vale un solo número.
 *
 * ── Cuando no hay nada, no pinta nada ──────────────────────────────────────
 *
 * Ni un hueco ni una banda verde. Esa banda saldría en casi todas las fichas y
 * acabaría consiguiendo que tampoco se leyera la roja.
 */
export default function AvisosCambioVehiculo({ vehiculoId, montajes }: {
  vehiculoId: string;
  montajes: MontajeActual[];
}) {
  const [mediciones, setMediciones] = useState<Record<string, { profundidad_mm: number | null; presion_bar: number | null }>>({});

  useEffect(() => {
    if (!vehiculoId) return;
    let vivo = true;
    listarUltimasMedicionesVehiculo(vehiculoId)
      .then((m) => { if (vivo) setMediciones(m); })
      // Una ficha que no se abre porque no se han podido leer las mediciones
      // sería peor que una ficha sin esta banda.
      .catch(() => { if (vivo) setMediciones({}); });
    return () => { vivo = false; };
  }, [vehiculoId, montajes]);

  /*
   * Aquí NO se cae al catálogo cuando falta la medición, al revés que en el
   * plano. El plano pinta lo que lleva la rueda y para eso la profundidad de
   * fábrica vale; esto AFIRMA que hay que cambiarla, y eso no se dice de una
   * goma que nadie ha medido. Si no se ha medido, el vehículo ya sale en el
   * informe por «sin revisar», que es su problema de verdad.
   */
  const paraCambiar = montajes
    .map((m) => {
      const neu = m.neumatico;
      if (!neu) return null;
      const prof = profundidadVigente(mediciones[neu.id], neu);
      if (!hayQueCambiar(prof, neu.medida)) return null;
      return {
        id: m.id,
        posicion: m.posicion?.codigo_posicion ?? "Posición desconocida",
        codigo: neu.numero_interno ?? neu.codigo_interno ?? null,
        medida: neu.medida ?? null,
        prof: prof as number,
        minimo: profundidadMinimaPorLlanta(neu.medida),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // La más gastada primero: es la que hay que cambiar antes.
    .sort((a, b) => a.prof - b.prof);

  if (paraCambiar.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase text-rose-200">
        <AlertTriangle className="h-4 w-4" />
        {paraCambiar.length === 1
          ? "Neumático para cambiar"
          : `${paraCambiar.length} neumáticos para cambiar`}
      </div>

      <div className="flex flex-col gap-2">
        {paraCambiar.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[12px] font-bold text-rose-100">
              {g.posicion}
            </span>
            <span className="text-[13px] font-semibold text-rose-100">{g.prof} mm</span>
            <span className="text-[13px] text-slate-200">
              mínimo {g.minimo} mm{g.medida ? ` · ${g.medida}` : ""}
            </span>
            {g.codigo && <span className="text-[11px] text-slate-400">· {g.codigo}</span>}
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-slate-400">
        El mínimo depende de la llanta: 22.5 → 4 mm · 19.5 y 17.5 → 3 mm · 16 o menos → 2 mm.
      </div>
    </div>
  );
}
