import { useEffect, useState } from "react";
import { AlertTriangle, Ruler } from "lucide-react";
import { listarUltimasMedicionesVehiculo } from "../services/data";
import { profundidadVigente } from "../utils/profundidad";
import { profundidadMinimaPorLlanta } from "../services/umbralProfundidad";
import { veredictoEnLaFicha } from "../services/protocoloProfundidad";
import type { Medicion } from "../services/ultimaMedicion";
import { fechaCorta } from "../services/alertasPorVehiculo";
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
 * ── Rojo solo con el desgaste confirmado ───────────────────────────────────
 *
 * El arco suelta de vez en cuando una lectura imposible (una goma de 8,5 mm
 * que un día «mide» 1,8). La profundidad que llega aquí ya es la del protocolo
 * —su última lectura, y solo si esa da alerta la mediana de las tres últimas,
 * `services/protocoloProfundidad.ts`—
 * y el rojo solo sale si está confirmada. Una lectura baja sin respaldo va en
 * una banda aparte, violeta, que no dice «cámbiala» sino «mídela con la
 * sonda»: lo que mida el técnico manda y la resuelve en un sentido o en otro.
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
  const [mediciones, setMediciones] = useState<Record<string, Medicion>>({});

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
  const juzgadas = montajes
    .map((m) => {
      const neu = m.neumatico;
      if (!neu) return null;
      const med = mediciones[neu.id];
      const prof = profundidadVigente(med, neu);
      const minimo = profundidadMinimaPorLlanta(neu.medida);
      const juicio = veredictoEnLaFicha(prof, med, minimo);
      if (juicio === "ok" || prof == null) return null;
      return {
        id: m.id,
        juicio,
        posicion: m.posicion?.codigo_posicion ?? "Posición desconocida",
        codigo: neu.numero_interno ?? neu.codigo_interno ?? null,
        medida: neu.medida ?? null,
        prof,
        minimo,
        // Solo en las «por confirmar»: la lectura que está en duda.
        pendiente: juicio === "por_confirmar" ? med?.pendiente_mm ?? null : null,
        pendienteEl: juicio === "por_confirmar" ? med?.pendiente_en ?? null : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // La más gastada primero: es la que hay que cambiar antes.
  const paraCambiar = juzgadas.filter((g) => g.juicio === "cambiar").sort((a, b) => a.prof - b.prof);
  const porConfirmar = juzgadas.filter((g) => g.juicio === "por_confirmar")
    .sort((a, b) => (a.pendiente ?? a.prof) - (b.pendiente ?? b.prof));

  if (paraCambiar.length === 0 && porConfirmar.length === 0) return null;

  return (
    <>
      {paraCambiar.length > 0 && (
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
      )}

      {porConfirmar.length > 0 && (
        <div className="mb-3 rounded-lg border border-violet-500/40 bg-violet-500/10 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase text-violet-200">
            <Ruler className="h-4 w-4" />
            {porConfirmar.length === 1
              ? "Desgaste por confirmar: medir con sonda"
              : `${porConfirmar.length} desgastes por confirmar: medir con sonda`}
          </div>

          <div className="flex flex-col gap-2">
            {porConfirmar.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[12px] font-bold text-violet-100">
                  {g.posicion}
                </span>
                {g.pendiente != null ? (
                  <span className="text-[13px] text-slate-200">
                    el arco ha leído <b className="text-violet-100">{g.pendiente} mm</b>
                    {g.pendienteEl ? ` el ${fechaCorta(g.pendienteEl)}` : ""} y las anteriores decían {g.prof} mm
                  </span>
                ) : (
                  <span className="text-[13px] text-slate-200">
                    <b className="text-violet-100">{g.prof} mm</b> con una sola lectura
                  </span>
                )}
                <span className="text-[13px] text-slate-400">mínimo {g.minimo} mm</span>
                {g.codigo && <span className="text-[11px] text-slate-400">· {g.codigo}</span>}
              </div>
            ))}
          </div>

          <div className="mt-2 text-[11px] text-slate-400">
            Una lectura suelta del arco no basta para dar una goma por gastada. Se confirma midiéndola a mano en una
            revisión —la medición del técnico manda— o sola, si la siguiente pasada del arco lee lo mismo.
          </div>
        </div>
      )}
    </>
  );
}
