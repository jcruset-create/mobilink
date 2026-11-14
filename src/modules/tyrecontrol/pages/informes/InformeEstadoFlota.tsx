import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerEstadoFlota } from "../../services/informes";
import { descargarEstadoFlotaExcel } from "../../services/data";
import type { EstadoDeFlota, EstadoFlota } from "../../types/informes";
import { Donut, ColumnChart } from "../../components/informes/charts";
import { FiltroActivo } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";
import { vehiculosDeEstado, NOMBRE_ESTADO_FLOTA } from "../../services/cuadrosInformes";

const COLOR_ESTADO: Record<EstadoDeFlota, string> = {
  urgente: "text-rose-300", revisar: "text-amber-300", pendiente: "text-slate-400", correcto: "text-emerald-300",
};

// Con `onClick` el semáforo es un botón que deja en la lista los vehículos de
// su estado; `activo` marca el que manda. Sin `onClick` —la base aún no manda
// la lista— es el cuadro de siempre.
function Semaforo({ color, label, valor, activo = false, onClick }: {
  color: string; label: string; valor: number; activo?: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={onClick ? activo : undefined}
      className={`rounded-lg bg-slate-800 p-4 text-left transition ${onClick ? "cursor-pointer hover:bg-slate-700/70" : "cursor-default"} ${
        activo ? "ring-2 ring-sky-400" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase text-slate-400">{label}</span>
      </div>
      <div className="mt-1 text-3xl font-black text-slate-100">{valor}</div>
    </button>
  );
}

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const mm = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`);

export default function InformeEstadoFlota() {
  const { filtros } = useInformesFiltros();
  const [bajando, setBajando] = useState(false);
  const [errorExcel, setErrorExcel] = useState("");

  /*
   * El Excel sale de la MISMA clasificación que estos semáforos: la hace la
   * base. Si se recalculara en el servidor del Excel, la hoja y la pantalla
   * acabarían diciendo cosas distintas el día que alguien toque una.
   */
  async function bajarExcel() {
    if (bajando) return;
    setBajando(true); setErrorExcel("");
    try {
      await descargarEstadoFlotaExcel(filtros.empresaId);
    } catch (e: unknown) {
      setErrorExcel(e instanceof Error && e.message ? e.message : "No se ha podido generar el Excel");
    } finally {
      setBajando(false);
    }
  }
  const [flota, setFlota] = useState<EstadoFlota | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloEstado, setSoloEstado] = useState<EstadoDeFlota | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    obtenerEstadoFlota(filtros)
      .then((f) => { if (vivo) setFlota(f); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar el estado de la flota"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  // La lista de vehículos, con lo peor primero. Solo si la base la manda.
  const lista = flota?.vehiculos;
  const visibles = useMemo(() => (lista ? vehiculosDeEstado(lista, soloEstado) : []), [lista, soloEstado]);
  const alternar = (e: EstadoDeFlota) => setSoloEstado((actual) => (actual === e ? null : e));
  const clic = (e: EstadoDeFlota) => (lista ? () => alternar(e) : undefined);

  if (cargando && !flota) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!flota) return null;

  const meses = flota.evolucion.map((e) => ({ etiqueta: e.mes.slice(5), valor: e.revisiones }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-slate-400">
          {flota.total} vehículo(s) activos{filtros.empresaId ? "" : " de todos los clientes"}
        </span>
        <div className="flex items-center gap-2">
          {errorExcel && <span className="text-[12px] text-rose-300">{errorExcel}</span>}
          <button onClick={() => void bajarExcel()} disabled={bajando}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700/40 disabled:opacity-50">
            {bajando ? "Generando…" : "Excel por vehículo"}
          </button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Semaforo color="#22c55e" label="🟢 Correcto" valor={flota.correcto} activo={soloEstado === "correcto"} onClick={clic("correcto")} />
        <Semaforo color="#f59e0b" label="🟡 Revisar" valor={flota.revisar} activo={soloEstado === "revisar"} onClick={clic("revisar")} />
        <Semaforo color="#ef4444" label="🔴 Urgente" valor={flota.urgente} activo={soloEstado === "urgente"} onClick={clic("urgente")} />
        <Semaforo color="#475569" label="Pendientes" valor={flota.pendiente} activo={soloEstado === "pendiente"} onClick={clic("pendiente")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Distribución ({flota.total} vehículos)</div>
          <Donut
            segmentos={[
              { etiqueta: "Correcto", valor: flota.correcto, color: "#22c55e" },
              { etiqueta: "Revisar", valor: flota.revisar, color: "#f59e0b" },
              { etiqueta: "Urgente", valor: flota.urgente, color: "#ef4444" },
              { etiqueta: "Pendiente", valor: flota.pendiente, color: "#475569" },
            ]}
          />
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Revisiones por mes</div>
          <ColumnChart items={meses} />
        </div>
      </div>

      {lista && (
        <div className="mt-3 rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">Vehículos ({visibles.length})</div>
            {soloEstado && <FiltroActivo texto={NOMBRE_ESTADO_FLOTA[soloEstado]} onQuitar={() => setSoloEstado(null)} />}
            <span className="flex-1" />
            <button
              onClick={() => descargarCSV(soloEstado ? `estado-flota-${soloEstado}` : "estado-flota",
                ["Matrícula", "Unidad", "Estado", "Profundidad mínima (mm)", "Última revisión"],
                visibles.map((v) => [v.matricula, v.numero_unidad, NOMBRE_ESTADO_FLOTA[v.estado] ?? v.estado, v.prof_min ?? "", v.fecha_revision ?? ""]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            >Exportar CSV</button>
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Matrícula</th><th className={thCls}>Unidad</th><th className={thCls}>Estado</th>
              <th className={thCls}>Profundidad mínima</th><th className={thCls}>Última revisión</th>
            </tr></thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td className={tdCls + " text-slate-500"} colSpan={5}>
                  {soloEstado ? `Ningún vehículo en «${NOMBRE_ESTADO_FLOTA[soloEstado]}».` : "Sin vehículos en seguimiento."}
                </td></tr>
              ) : visibles.map((v) => (
                <tr key={v.vehiculo_id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}>
                    <Link to={`/tyrecontrol/vehiculos/${v.vehiculo_id}`} className="text-sky-300 hover:underline">{v.matricula || "sin matrícula"}</Link>
                  </td>
                  <td className={tdCls + " text-slate-400"}>{v.numero_unidad ?? "—"}</td>
                  <td className={tdCls + " font-semibold " + (COLOR_ESTADO[v.estado] ?? "text-slate-300")}>{NOMBRE_ESTADO_FLOTA[v.estado] ?? v.estado}</td>
                  <td className={tdCls + " tabular-nums text-slate-200"}>{mm(v.prof_min)}</td>
                  <td className={tdCls + " text-slate-400"}>{fecha(v.fecha_revision)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-2 text-[11px] text-slate-500">
            Lo peor primero. La profundidad es la más baja de la última revisión del vehículo, que es la que decide su estado.
            «Revisar» sin profundidad es un vehículo cuya última revisión no trae ninguna; «Pendiente», uno que no ha pasado ninguna.
          </div>
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-500">
        Clasificación por la profundidad mínima de la última revisión de cada vehículo: urgente ≤ 1,6 mm · revisar ≤ 3,0 mm.
        Cada vehículo se clasifica por su neumático en peor estado. Los umbrales son configurables por empresa y por medida en la ficha de la empresa (Empresas → ficha → Umbrales de profundidad).
      </div>
    </div>
  );
}
