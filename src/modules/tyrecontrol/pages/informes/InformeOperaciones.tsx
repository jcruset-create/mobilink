import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { operacionesInforme } from "../../services/informes";
import type { OperacionesInforme } from "../../types/informes";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS } from "../../types";
import type { TipoOperacion, MotivoOperacion } from "../../types";
import { FiltroActivo, KpiCard } from "../../components/informes/KpiCard";
import { operacionesDeTipo, operacionesSePuedenFiltrar } from "../../services/cuadrosInformes";
import { BarList, ColumnChart } from "../../components/informes/charts";
import { descargarCSV } from "../../utils/exportar";

const tipoLabel = (t: string) => TIPO_OPERACION_LABELS[t as TipoOperacion] ?? t;
const CUADRO_DE_TIPO: Record<string, string> = { montaje: "Montajes", rotacion: "Cambios de posición", reparacion: "Reparaciones" };
const motivoLabel = (m: string) => (m === "—" ? "—" : (MOTIVO_OPERACION_LABELS[m as MotivoOperacion] ?? m));

export default function InformeOperaciones() {
  const { filtros } = useInformesFiltros();
  const [data, setData] = useState<OperacionesInforme | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloTipo, setSoloTipo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    operacionesInforme(filtros)
      .then((d) => { if (vivo) setData(d); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar operaciones"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !data) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!data) return null;

  const cont = (t: string) => data.por_tipo.find((x) => x.tipo === t)?.n ?? 0;
  // Un cuadro pulsado deja los motivos y la evolución en su tipo de operación.
  // Hace falta que la base mande el reparto por tipo; si no, no hay clic.
  const filtra = operacionesSePuedenFiltrar(data);
  const { por_motivo, evolucion } = operacionesDeTipo(data, soloTipo);
  const alternar = (t: string) => setSoloTipo((actual) => (actual === t ? null : t));
  // La etiqueta dice lo mismo que el cuadro que se ha pulsado, no el nombre interno del tipo.
  const etiqueta = soloTipo && <FiltroActivo texto={CUADRO_DE_TIPO[soloTipo] ?? tipoLabel(soloTipo)} onQuitar={() => setSoloTipo(null)} />;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Operaciones (periodo)" value={data.total} onClick={filtra ? () => setSoloTipo(null) : undefined} />
        <KpiCard title="Montajes" value={cont("montaje")}
                 activo={soloTipo === "montaje"} onClick={filtra ? () => alternar("montaje") : undefined} />
        <KpiCard title="Cambios de posición" value={cont("rotacion")}
                 activo={soloTipo === "rotacion"} onClick={filtra ? () => alternar("rotacion") : undefined} />
        <KpiCard title="Reparaciones" value={cont("reparacion")} tono={cont("reparacion") > 0 ? "warn" : "neutral"}
                 activo={soloTipo === "reparacion"} onClick={filtra ? () => alternar("reparacion") : undefined} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase text-slate-400">Por tipo de operación</div>
            <button onClick={() => descargarCSV("operaciones_por_tipo", ["Tipo", "Nº"], data.por_tipo.map((t) => [tipoLabel(t.tipo), t.n]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">CSV</button>
          </div>
          <BarList color="#6366f1" items={data.por_tipo.map((t) => ({ etiqueta: tipoLabel(t.tipo), valor: t.n }))} />
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">Evolución mensual</div>
            {etiqueta}
          </div>
          <ColumnChart color="#6366f1" items={evolucion.map((e) => ({ etiqueta: e.mes.slice(5), valor: e.n }))} />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Por motivo</div>
          {etiqueta}
        </div>
        <BarList color="#f59e0b" items={por_motivo.map((m) => ({ etiqueta: motivoLabel(m.motivo), valor: m.n }))} />
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Operaciones registradas en el rango de fechas del filtro. Los tiempos medios por operación no se muestran porque no se captura la duración.
      </div>
    </div>
  );
}
