import { useEffect, useMemo, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { kmPorMm } from "../../services/informes";
import { agruparPorModelo, nombreDeEje, ordenar, type Orden } from "../../services/kmPorMm";
import type { KmPorMmFila } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

const miles = (n: number) => Math.round(n).toLocaleString("es-ES");

const ORDENES: { v: Orden; label: string; hint: string }[] = [
  { v: "evidencia", label: "Lo medido", hint: "Primero los modelos con más kilómetros detrás" },
  { v: "km_por_mm", label: "Km por mm", hint: "Primero el que más aguanta por milímetro" },
  { v: "vida", label: "Vida estimada", hint: "Primero el de más kilómetros de nuevo a retirada" },
];

export default function InformeKmPorMm() {
  const { filtros } = useInformesFiltros();
  const [filas, setFilas] = useState<KmPorMmFila[]>([]);
  const [orden, setOrden] = useState<Orden>("evidencia");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    kmPorMm(filtros)
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al calcular los kilómetros por milímetro"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  const modelos = useMemo(() => ordenar(agruparPorModelo(filas), orden), [filas, orden]);
  const kmAnalizados = modelos.reduce((a, m) => a + m.kmTotales, 0);
  const tramos = modelos.reduce((a, m) => a + m.tramos, 0);

  if (cargando && filas.length === 0) return <div className="text-slate-400">Calculando el desgaste por modelo…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <KpiCard title="Modelos con dato" value={modelos.length} hint="Los que llegan al mínimo medible" />
        <KpiCard title="Tramos analizados" value={miles(tramos)} hint="Una goma viviendo en un sitio" />
        <KpiCard title="Kilómetros medidos" value={miles(kmAnalizados)} hint="Recorridos con dibujo medido al principio y al final" />
      </div>

      <details className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-[12px] text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-200">Cómo se calcula, y por qué no es «la primera medición menos la última»</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>
            Entre dos revisiones pasan <b>305 km de mediana</b> —el arco mide casi cada vez que el autobús
            entra en base— y el ruido de medida es de <b>±0,6 mm</b>. A esa escala el desgaste real no se ve:
            el 39 % de las parejas consecutivas dice que el neumático <i>gana</i> dibujo. Por eso aquí no se
            miden parejas, sino tramos de <b>10.000 km o más</b>.
          </p>
          <p>
            En tramos largos el problema deja de ser el ruido y pasa a ser la identidad. De los 690
            historiales del AH51 de más de 10.000 km, <b>204 ganaban dibujo: +2,5 mm de mediana y hasta +9,9</b>.
            Eso no es error de medida, es <b>otro neumático montado en el mismo hueco</b> sin registrar el
            cambio. Así que la serie se corta cada vez que el dibujo sube más de 2 mm, cuando la goma cambia
            de vehículo, o cuando el odómetro va hacia atrás; y se mide dentro de cada tramo limpio.
          </p>
          <p>
            El km/mm de un modelo es <b>Σkm / Σmm</b>, no la media de los ritmos de sus ejes: un eje con 27
            tramos no puede pesar lo mismo que uno con 316. La <b>vida estimada</b> es el dibujo de entrada
            menos el de retirada, por el km/mm; los dos extremos salen de los percentiles 99 y 1 de lo medido
            de ese modelo, así que son una aproximación, no una ficha técnica.
          </p>
          <p className="text-slate-400">
            Un modelo y eje que no llegue a <b>3 tramos y 5 mm medidos</b> no sale: con medio milímetro
            gastado la cuenta da cifras de millones de kilómetros que solo miden el ruido.
          </p>
        </div>
      </details>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold uppercase text-slate-400">Kilómetros por milímetro ({modelos.length} modelos)</div>
          <div className="flex flex-wrap items-center gap-1">
            {ORDENES.map((o) => (
              <button
                key={o.v}
                title={o.hint}
                onClick={() => setOrden(o.v)}
                className={`rounded border px-2 py-1 text-[11px] ${orden === o.v ? "border-sky-500 bg-sky-500/10 text-sky-300" : "border-slate-600 text-slate-300 hover:bg-slate-700"}`}
              >{o.label}</button>
            ))}
            <button
              onClick={() => descargarCSV(
                "km-por-mm",
                ["Marca", "Modelo", "Eje", "Tramos", "Neumáticos", "Km medidos", "mm gastados", "Km por mm", "p25", "Mediana", "p75", "Dibujo nuevo (mm)", "Dibujo retirada (mm)"],
                filas.map((f) => [f.marca, f.modelo, f.eje ?? "", f.tramos, f.neumaticos, f.km_totales, f.mm_totales, f.km_por_mm, f.p25, f.mediana, f.p75, f.mm_nuevo ?? "", f.mm_retirada ?? ""]),
              )}
              className="ml-1 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            >Exportar CSV</button>
          </div>
        </div>

        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca / modelo</th>
            <th className={thCls}>Km por mm</th>
            <th className={thCls}>Vida estimada</th>
            <th className={thCls}>Dibujo</th>
            <th className={thCls}>Por eje</th>
            <th className={thCls}>Tramos</th>
            <th className={thCls}>Neumáticos</th>
          </tr></thead>
          <tbody>
            {modelos.length === 0 ? (
              <tr><td className={tdCls + " text-slate-500"} colSpan={7}>
                Todavía no hay ningún modelo con suficiente desgaste medido. Hacen falta neumáticos con tres
                revisiones o más y 10.000 km entre la primera y la última.
              </td></tr>
            ) : modelos.map((m) => (
              <tr key={m.clave} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold text-slate-200"}>
                  {m.marca} <span className="text-slate-400">{m.modelo}</span>
                </td>
                <td className={tdCls + " text-lg font-black text-sky-300"}>{miles(m.kmPorMm)}</td>
                <td className={tdCls + " text-slate-200"}>
                  {m.vidaKm !== null ? <>{miles(m.vidaKm)} km</> : <span className="text-slate-500">—</span>}
                </td>
                <td className={tdCls + " text-slate-400"}>
                  {m.mmNuevo !== null && m.mmRetirada !== null
                    ? `${m.mmNuevo} → ${m.mmRetirada} mm`
                    : "—"}
                </td>
                <td className={tdCls + " text-slate-400"}>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {m.ejes.map((e) => (
                      <span key={String(e.eje)} className="whitespace-nowrap">
                        {nombreDeEje(e.eje)} <b className="text-slate-300">{miles(e.kmPorMm)}</b>
                        <span className="text-slate-500"> ({e.tramos})</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className={tdCls + " text-slate-400"}>{miles(m.tramos)}</td>
                <td className={tdCls + " text-slate-400"}>{miles(m.neumaticos)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
