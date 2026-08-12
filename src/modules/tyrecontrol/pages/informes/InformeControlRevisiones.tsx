import { useEffect, useMemo, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { controlRevisiones } from "../../services/informes";
import type { ControlRevision } from "../../types/informes";
import { descargarCSV } from "../../utils/exportar";
import { TableWrap, tdCls, thCls } from "../../components/ui";

/**
 * La flota entera por fecha de revisión, incluidos los que no se han revisado
 * nunca — que son justamente los que hay que ver y los que se caen de
 * "Histórico de revisiones", que lista revisiones y no vehículos.
 *
 * El rango de fechas de la barra de arriba filtra por la fecha de la última
 * revisión: sin rango salen todos.
 */

const ETIQUETA: Record<string, string> = {
  sin_revision: "Sin revisar",
  vencido: "Vencida",
  proximo: "Próxima",
  al_dia: "Al día",
  sin_intervalo: "Sin periodicidad",
};

// El orden es el de urgencia, que es el que se mira primero.
const ORDEN_ESTADO = ["sin_revision", "vencido", "proximo", "al_dia", "sin_intervalo"];

const COLOR: Record<string, string> = {
  sin_revision: "bg-slate-600 text-slate-100",
  vencido: "bg-rose-900 text-rose-100",
  proximo: "bg-amber-900 text-amber-100",
  al_dia: "bg-emerald-900 text-emerald-100",
  sin_intervalo: "bg-slate-700 text-slate-300",
};

const fecha = (s: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString("es-ES") : "—";

export default function InformeControlRevisiones() {
  const { filtros } = useInformesFiltros();
  const [filas, setFilas] = useState<ControlRevision[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloEstado, setSoloEstado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    controlRevisiones(filtros)
      .then((r) => { if (vivo) setFilas(r); })
      .catch((e) => { if (vivo) setError(e?.message || "No se ha podido cargar"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  const porEstado = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of filas) m[f.estado] = (m[f.estado] ?? 0) + 1;
    return m;
  }, [filas]);

  const visibles = soloEstado ? filas.filter((f) => f.estado === soloEstado) : filas;

  function exportar() {
    descargarCSV(
      `control-revisiones-${new Date().toISOString().slice(0, 10)}`,
      ["Matrícula", "Nº unidad", "Base", "Tipo", "Última revisión", "Días desde",
       "Origen", "Neumáticos", "Mínimo mm", "Próxima", "Días vencido", "Estado"],
      visibles.map((f) => [
        f.matricula, f.numero_unidad, f.base, f.tipo, f.ultima_revision, f.dias_desde,
        f.origen === "checkpoint" ? "CheckPoint" : f.origen === "tecnico" ? "Técnico" : "",
        f.n_neumaticos, f.min_mm, f.proxima_revision,
        f.dias_vencido != null && f.dias_vencido > 0 ? f.dias_vencido : "",
        ETIQUETA[f.estado] ?? f.estado,
      ]),
    );
  }

  if (cargando) return <div className="text-sm text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg bg-rose-950 p-3 text-sm text-rose-200">{error}</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {ORDEN_ESTADO.filter((e) => porEstado[e]).map((e) => (
            <button
              key={e}
              onClick={() => setSoloEstado(soloEstado === e ? null : e)}
              className={`rounded-full px-3 py-1 text-[11px] font-bold ${COLOR[e]} ${
                soloEstado === e ? "ring-2 ring-sky-400" : "opacity-80 hover:opacity-100"}`}
            >
              {ETIQUETA[e]} · {porEstado[e]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            {visibles.length === filas.length
              ? `${filas.length} vehículos`
              : `${visibles.length} de ${filas.length}`}
          </span>
          <button
            onClick={exportar}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {!filtros.desde && !filtros.hasta ? null : (
        <div className="rounded-lg bg-slate-900 p-2 text-[11px] text-slate-400">
          Filtrado por la fecha de la última revisión. Los vehículos que no se han
          revisado nunca no tienen fecha, así que no salen mientras haya un rango puesto.
        </div>
      )}

      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={thCls}>Matrícula</th>
              <th className={thCls}>Nº unidad</th>
              <th className={thCls}>Base</th>
              <th className={thCls}>Tipo</th>
              <th className={thCls}>Última revisión</th>
              <th className={thCls}>Hace</th>
              <th className={thCls}>Origen</th>
              <th className={thCls}>Neum.</th>
              <th className={thCls}>Mín. mm</th>
              <th className={thCls}>Próxima</th>
              <th className={thCls}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.vehiculo_id} className="border-t border-slate-700/60">
                <td className={`${tdCls} font-mono font-bold`}>{f.matricula}</td>
                <td className={tdCls}>{f.numero_unidad ?? "—"}</td>
                <td className={tdCls}>{f.base ?? "—"}</td>
                <td className={tdCls}>{f.tipo ?? "—"}</td>
                <td className={tdCls}>{fecha(f.ultima_revision)}</td>
                <td className={tdCls}>{f.dias_desde != null ? `${f.dias_desde} días` : "—"}</td>
                <td className={tdCls}>
                  {f.origen === "checkpoint" ? "CheckPoint" : f.origen === "tecnico" ? "Técnico" : "—"}
                </td>
                <td className={tdCls}>{f.n_neumaticos || "—"}</td>
                <td className={tdCls}>{f.min_mm != null ? f.min_mm.toFixed(1) : "—"}</td>
                <td className={tdCls}>
                  {fecha(f.proxima_revision)}
                  {f.dias_vencido != null && f.dias_vencido > 0 && (
                    <span className="ml-1 text-[11px] text-rose-300">+{f.dias_vencido}d</span>
                  )}
                </td>
                <td className={tdCls}>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${COLOR[f.estado]}`}>
                    {ETIQUETA[f.estado] ?? f.estado}
                  </span>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td className={tdCls} colSpan={11}>
                No hay vehículos con esos filtros.
              </td></tr>
            )}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
