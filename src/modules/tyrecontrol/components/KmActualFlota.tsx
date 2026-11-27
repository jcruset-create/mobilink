import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { kmActualFlota, type KmActualVehiculo } from "../services/data";

const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("es-ES"));

const PROCEDENCIA: Record<KmActualVehiculo["procedencia"], { texto: string; cls: string }> = {
  movertis: { texto: "Movertis fiable", cls: "bg-emerald-500/15 text-emerald-300" },
  reconstruido: { texto: "reconstruido", cls: "bg-sky-500/15 text-sky-300" },
  ultimo: { texto: "último conocido", cls: "bg-amber-500/15 text-amber-300" },
  sin_ancla: { texto: "sin lectura real", cls: "bg-rose-500/15 text-rose-300" },
};

/**
 * El km actual de cada vehículo con telemática y de dónde sale.
 *
 * El odómetro de Movertis no vale para la mayoría de la flota; la distancia
 * de sus viajes, sí. El km se reconstruye desde la última lectura real
 * (revisión o montaje) más los viajes. Los «sin lectura real» son la lista de
 * vehículos a los que basta UNA revisión con el km del salpicadero para que
 * se reconstruyan solos.
 */
export default function KmActualFlota({ empresaId }: { empresaId: string }) {
  const [filas, setFilas] = useState<KmActualVehiculo[] | null>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<KmActualVehiculo["procedencia"] | "todos" | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    setFilas(null); setError("");
    kmActualFlota(empresaId)
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => { if (vivo) setError(e?.message ?? "Error"); });
    return () => { vivo = false; };
  }, [empresaId]);

  const cuenta = useMemo(() => {
    const c = { movertis: 0, reconstruido: 0, ultimo: 0, sin_ancla: 0 };
    for (const f of filas ?? []) c[f.procedencia]++;
    return c;
  }, [filas]);

  if (error) return <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">Km actual de la flota: {error}</div>;
  if (!filas) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-[11px] text-slate-400">
        <b className="uppercase text-slate-400">Km actual de la flota</b> · calculando…
      </div>
    );
  }
  if (filas.length === 0) return null;
  // Plegado: la lista solo se enseña al pulsar un grupo (o «Ver todos»).
  const vista = filtro === "todos" ? filas : filtro ? filas.filter((f) => f.procedencia === filtro) : [];

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-bold uppercase text-slate-400">Km actual de la flota</div>
        <span className="text-[11px] text-slate-500">{filas.length} vehículos con telemática</span>
      </div>
      <div className={`${vista.length ? "mb-3" : ""} flex flex-wrap gap-1.5`}>
        {(Object.keys(PROCEDENCIA) as KmActualVehiculo["procedencia"][]).map((p) => cuenta[p] > 0 && (
          <button key={p} onClick={() => setFiltro((f) => (f === p ? null : p))}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${PROCEDENCIA[p].cls} ${filtro === p ? "ring-2 ring-sky-400" : ""}`}>
            {PROCEDENCIA[p].texto} · {cuenta[p]}
          </button>
        ))}
        <button onClick={() => setFiltro((f) => (f ? null : "todos"))}
          className={`rounded-full border border-slate-600 px-2.5 py-1 text-[11px] font-bold text-slate-300 ${filtro === "todos" ? "ring-2 ring-sky-400" : ""}`}>
          {filtro ? "Ocultar lista" : "Ver todos"}
        </button>
      </div>
      {vista.length > 0 && <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead className="text-[10px] text-slate-500">
            <tr className="text-left">
              <th className="pb-1 pr-3 font-normal">Matrícula</th>
              <th className="pb-1 pr-3 text-right font-normal">Km actual</th>
              <th className="pb-1 pr-3 font-normal">Procedencia</th>
              <th className="pb-1 text-right font-normal">Odómetro Movertis</th>
            </tr>
          </thead>
          <tbody>
            {vista.map((f) => (
              <tr key={f.vehiculoId} className="border-t border-slate-700/60">
                <td className="py-1 pr-3">
                  <Link to={`/tyrecontrol/vehiculos/${f.vehiculoId}`} className="font-bold text-sky-300 hover:underline">{f.matricula}</Link>
                </td>
                <td className="py-1 pr-3 text-right font-bold tabular-nums text-slate-100">
                  {f.km != null && f.procedencia !== "ultimo" ? "≈ " : ""}{num(f.km)}
                </td>
                <td className="py-1 pr-3">
                  <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${PROCEDENCIA[f.procedencia].cls}`}>{PROCEDENCIA[f.procedencia].texto}</span>
                  <span className="text-[11px] text-slate-400">{f.detalle}</span>
                </td>
                <td className={`py-1 text-right tabular-nums ${f.movertisCuadra === false ? "text-slate-600 line-through" : "text-slate-300"}`}
                  title={f.movertisCuadra === false ? "No cuadra con las lecturas reales" : undefined}>
                  {num(f.odometroMovertis)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {cuenta.sin_ancla > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          «Sin lectura real»: basta UNA revisión o montaje con el km del salpicadero y desde ahí el km se reconstruye solo con los viajes.
        </p>
      )}
    </div>
  );
}
