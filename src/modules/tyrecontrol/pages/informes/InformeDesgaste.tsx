import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { desgaste } from "../../services/informes";
import type { DesgasteNeumatico } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

function fmtFecha(f: string | null): string {
  if (!f) return "—";
  return new Date(f).toLocaleDateString("es-ES");
}

const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

export default function InformeDesgaste() {
  const { filtros } = useInformesFiltros();
  const [items, setItems] = useState<DesgasteNeumatico[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    desgaste(filtros)
      .then((r) => { if (vivo) setItems(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al calcular el desgaste"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && items.length === 0) return <div className="text-slate-400">Calculando desgaste…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const hoy = new Date();
  const en60 = new Date(); en60.setDate(hoy.getDate() + 60);
  const vencidos = items.filter((i) => i.fecha_prevista && new Date(i.fecha_prevista) <= hoy).length;
  const proximos = items.filter((i) => i.fecha_prevista && new Date(i.fecha_prevista) > hoy && new Date(i.fecha_prevista) <= en60).length;
  const prestados = items.filter((i) => i.origen_ritmo === "modelo").length;

  const filaColor = (i: DesgasteNeumatico) => {
    if (i.fecha_prevista && new Date(i.fecha_prevista) <= hoy) return "text-rose-300";
    if (i.fecha_prevista && new Date(i.fecha_prevista) <= en60) return "text-amber-300";
    return "text-slate-200";
  };

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Con predicción" value={items.length} hint="Neumáticos montados con mediciones" />
        <KpiCard title="Sustitución vencida" value={vencidos} tono={vencidos > 0 ? "danger" : "ok"} />
        <KpiCard title="Sustituir en 60 días" value={proximos} tono={proximos > 0 ? "warn" : "ok"} />
        <KpiCard title="Con ritmo del modelo" value={prestados} tono="info" hint="Aún no llevan rodado lo bastante para medirles el suyo" />
      </div>

      <details className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-[12px] text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200">Cómo se calcula, y qué significa «del modelo»</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            El ritmo se mide sobre el <b>último tramo</b> del neumático, que es la goma que está puesta hoy,
            y no sobre todo su historial. La diferencia no es teórica: de las <b>2.563 gomas montadas</b> con
            mediciones, <b>677 tienen más de un tramo</b> —una sustitución que nadie registró—. Midiendo del
            principio al final, <b>411 se quedaban sin predicción</b> porque la resta daba cero o negativo, y
            otras <b>266 recibían un ritmo demasiado optimista</b>, que es peor: el desgaste de dos vidas
            repartido entre los kilómetros de las dos da un neumático que parece durar el doble.
          </p>
          <p>
            Cuando la vida actual de una goma todavía es corta, no se le puede medir el ritmo sin
            inventarlo: entre dos revisiones pasan 305 km y el ruido de medida es de ±0,6 mm. A ésas se les
            presta el ritmo de <b>su modelo y su eje</b>, el del informe «Km por mm», y la columna lo dice.
            <b> Lo medido y lo supuesto no se mezclan en silencio.</b>
          </p>
          <p className="text-slate-400">
            Los kilómetros restantes van hasta el <b>mínimo legal de 1,6 mm</b>. La fecha prevista proyecta
            esos kilómetros al ritmo de uso del propio vehículo; si no se le conoce, queda en blanco en vez
            de inventarse.
          </p>
        </div>
      </details>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Predicción de sustitución ({items.length})</div>
          <button
            onClick={() => descargarCSV("desgaste", ["Neumático", "Matrícula", "Marca", "Modelo", "Medida", "Última prof (mm)", "Última medición", "Desgaste (mm/1000km)", "Origen del ritmo", "Km restantes", "Fecha prevista", "Nº medidas"],
              items.map((i) => [i.codigo, i.matricula, i.marca, i.modelo, i.medida, i.ultima_prof ?? "", i.ultima_fecha ?? "", i.mm_por_1000km ?? "", i.origen_ritmo ?? "", i.km_restantes ?? "", i.fecha_prevista ?? "", i.n_medidas]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >Exportar CSV</button>
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Neumático</th><th className={thCls}>Vehículo</th><th className={thCls}>Marca / modelo</th>
            <th className={thCls}>Última prof.</th><th className={thCls}>Desgaste</th><th className={thCls}>Km restantes</th>
            <th className={thCls}>Sustitución prevista</th><th className={thCls}>Medidas</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin datos: hacen falta neumáticos montados con revisiones y kilometraje.</td></tr>
            : items.map((i) => (
              <tr key={i.neumatico_id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}><Link to={`/tyrecontrol/neumaticos/${i.neumatico_id}`} className="text-sky-300 hover:underline">{i.codigo ?? "—"}</Link></td>
                <td className={tdCls + " text-slate-300"}>{i.matricula ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{[i.marca, i.modelo].filter(Boolean).join(" ") || "—"}</td>
                <td className={tdCls + " text-slate-200"}>
                  {i.ultima_prof != null ? `${i.ultima_prof} mm` : "—"}
                  {i.ultima_fecha && <span className="block text-[10px] text-slate-500">{fmtFecha(i.ultima_fecha)}</span>}
                </td>
                <td className={tdCls + " text-slate-400"}>
                  {i.mm_por_1000km != null ? `${i.mm_por_1000km} mm/1000km` : "—"}
                  {i.origen_ritmo === "modelo" && (
                    <span className="ml-1 rounded bg-sky-500/15 px-1 text-[10px] text-sky-300" title="Esta goma todavía no lleva rodado lo bastante para medirle su propio ritmo; se usa el de su modelo y su eje.">
                      del modelo
                    </span>
                  )}
                </td>
                <td className={tdCls + " text-slate-400"}>{i.km_restantes != null ? miles(Number(i.km_restantes)) : "—"}</td>
                <td className={tdCls + " font-semibold " + filaColor(i)}>{fmtFecha(i.fecha_prevista)}</td>
                <td className={tdCls + " text-slate-500"}>{i.n_medidas}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
