import { useEffect, useMemo, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { previsionPorMedida } from "../../services/informes";
import { nombreDeTramo, pivotar, type FilaPrevision } from "../../services/previsionMedida";
import type { PrevisionMedida } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

type Vista = "tramo" | "acumulado";

export default function InformePrevision() {
  const { filtros } = useInformesFiltros();
  const [filas, setFilas] = useState<PrevisionMedida[]>([]);
  const [vista, setVista] = useState<Vista>("tramo");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    previsionPorMedida(filtros)
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al calcular la previsión"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  const { tramos, filas: medidas, total } = useMemo(() => pivotar(filas), [filas]);
  const valor = (f: FilaPrevision, d: number) =>
    (vista === "tramo" ? f.enElTramo[d] : f.acumulado[d]) ?? 0;

  if (cargando && filas.length === 0) return <div className="text-slate-400">Calculando la previsión…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Ya vencidas" value={miles(total.vencidos)} tono={total.vencidos > 0 ? "danger" : "ok"} hint="Se les pasó la fecha prevista" />
        <KpiCard title="En 30 días" value={miles(total.enElTramo[30] ?? 0)} tono="warn" />
        <KpiCard title="Hasta 90 días" value={miles(total.acumulado[90] ?? 0)} hint="Vencidas incluidas" />
        <KpiCard title="Fuera de la previsión" value={miles(total.sinDatos + total.sinFecha)} tono="info" hint={`${miles(total.sinDatos)} sin una sola medición · ${miles(total.sinFecha)} medidas pero sin fecha`} />
      </div>

      <details className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-[12px] text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200">Qué cuenta esto, y qué no</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Sale de las fechas del informe <b>«Desgaste»</b>, que calcula el ritmo de cada goma sobre su
            vida actual y, cuando aún es corta, le presta el de su modelo y su eje. Aquí no se recalcula
            nada: se agrupa. Si cambia el criterio de predicción, esta previsión cambia con él.
          </p>
          <p>
            <b>Por tramo</b> son las gomas que caen entre un plazo y el siguiente: lo que se compra ese mes.
            <b> Acumulado</b> son las vencidas más todo lo que cae hasta ese plazo: lo que hay que tener
            disponible para entonces.
          </p>
          <p>
            La medida se normaliza al patrón <b>ancho/perfil R llanta</b>, porque «385/65R22.5» y
            «385/65R22.5 158L» son la misma goma para quien compra. Casa en el 98,9 % de las montadas; el
            resto se agrupa en «(sin medida)» en vez de desaparecer, que es catálogo pendiente y tiene que
            verse.
          </p>
          <p>
            <b>Salen todas las medidas que hay montadas, tengan datos o no.</b> Hoy hay 346 gomas de
            385/55R22.5 y 115 de 385/65R22.5 en la calle sin una sola medición: si la tabla saliera solo
            de lo medido, esas 461 no aparecerían y quien hiciera el pedido entendería que esas medidas no
            existen. Salen con su recuento y ceros en los plazos.
          </p>
          <p className="text-slate-400">
            <b>Las dos últimas columnas son la letra pequeña.</b> «Sin datos» son las que no tienen
            ninguna medición —el arco no las lee o no han pasado por él—. «Sin fecha» son las que sí se
            han medido pero no se les ha podido calcular el ritmo ni prestarles el de su modelo. Ninguna
            de las dos está en las columnas de plazo: la previsión se queda corta justo en esa cantidad.
          </p>
        </div>
      </details>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Sustituciones previstas por medida</div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setVista("tramo")}
              title="Las que caen entre un plazo y el siguiente"
              className={`rounded border px-2 py-1 text-[11px] ${vista === "tramo" ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
            >Por tramo</button>
            <button
              onClick={() => setVista("acumulado")}
              title="Las vencidas más todo lo que cae hasta ese plazo"
              className={`rounded border px-2 py-1 text-[11px] ${vista === "acumulado" ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
            >Acumulado</button>
            <button
              onClick={() => descargarCSV(
                "prevision-por-medida",
                ["Medida", "Montadas", "Vencidas", ...tramos.map((d) => `${vista === "tramo" ? "En" : "Hasta"} ${nombreDeTramo(d)}`), "Sin datos", "Sin fecha"],
                [...medidas, total].map((f) => [f.medida, f.montados, f.vencidos, ...tramos.map((d) => valor(f, d)), f.sinDatos, f.sinFecha]),
              )}
              className="ml-1 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            >Exportar CSV</button>
          </div>
        </div>

        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Medida</th>
            <th className={thCls + " text-right"}>Montadas</th>
            <th className={thCls + " text-right"}>Vencidas</th>
            {tramos.map((d) => (
              <th key={d} className={thCls + " text-right"}>{vista === "tramo" ? "En" : "Hasta"} {nombreDeTramo(d)}</th>
            ))}
            <th className={thCls + " text-right"}>Sin datos</th>
            <th className={thCls + " text-right"}>Sin fecha</th>
          </tr></thead>
          <tbody>
            {medidas.length === 0 ? (
              <tr><td className={tdCls + " text-slate-500"} colSpan={5 + tramos.length}>
                Todavía no hay ninguna goma con fecha prevista. Hacen falta neumáticos montados con
                revisiones y kilometraje.
              </td></tr>
            ) : <>
              {medidas.map((f) => (
                <tr key={f.medida} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold text-slate-200"}>{f.medida}</td>
                  <td className={tdCls + " text-right text-slate-400"}>{miles(f.montados)}</td>
                  <td className={tdCls + " text-right " + (f.vencidos > 0 ? "font-semibold text-rose-300" : "text-slate-500")}>{miles(f.vencidos)}</td>
                  {tramos.map((d) => (
                    <td key={d} className={tdCls + " text-right tabular-nums " + (valor(f, d) > 0 ? "text-slate-100" : "text-slate-600")}>
                      {miles(valor(f, d))}
                    </td>
                  ))}
                  <td className={tdCls + " text-right " + (f.sinDatos > 0 ? "text-amber-300/80" : "text-slate-600")}>{miles(f.sinDatos)}</td>
                  <td className={tdCls + " text-right " + (f.sinFecha > 0 ? "text-sky-300" : "text-slate-600")}>{miles(f.sinFecha)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-600 bg-slate-900/40 font-bold">
                <td className={tdCls + " text-slate-200"}>Total</td>
                <td className={tdCls + " text-right text-slate-300"}>{miles(total.montados)}</td>
                <td className={tdCls + " text-right text-rose-300"}>{miles(total.vencidos)}</td>
                {tramos.map((d) => (
                  <td key={d} className={tdCls + " text-right tabular-nums text-slate-100"}>{miles(valor(total, d))}</td>
                ))}
                <td className={tdCls + " text-right text-amber-300/80"}>{miles(total.sinDatos)}</td>
                <td className={tdCls + " text-right text-sky-300"}>{miles(total.sinFecha)}</td>
              </tr>
            </>}
          </tbody>
        </TableWrap>

        <p className="mt-2 text-[11px] text-slate-500">
          El total de un plazo suma gomas de medidas distintas: dice cuánta flota se mueve, pero para pedir
          al proveedor la columna que vale es la de cada medida.
        </p>
      </div>
    </div>
  );
}
