import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { montajesInforme } from "../../services/informes";
import type { MontajesInforme, OrigenMontajes } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { BarList, ColumnChart } from "../../components/informes/charts";
import { descargarCSV } from "../../utils/exportar";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { etiquetaMotivo, numero, textoCobertura } from "../../../../../shared/recorridoEstimado";

/**
 * Montajes de neumáticos: cuántas gomas se pusieron.
 *
 * NO es inventario (no dice cuántas hay) ni rendimiento (no dice cuánto
 * duran). Cuenta la unidad que ENTRA: una sustitución son dos filas en la
 * base, la que entra y la que sale, y aquí solo cuenta la primera. Las
 * salidas se enseñan aparte para que el total de registros cuadre.
 */
const ORIGENES: { v: OrigenMontajes; label: string }[] = [
  { v: "ambos", label: "Ambos" },
  { v: "normal", label: "Operaciones normales" },
  { v: "historico", label: "Histórico importado" },
];

const CONDICION_LABEL: Record<string, string> = {
  nueva: "Nuevos", usada: "Usados", recauchutada: "Recauchutados",
};
const POSICION_LABEL: Record<string, string> = {
  registrada: "Posición registrada", deducida: "Posición deducida", desconocida: "Sin posición",
};

export default function InformeMontajes() {
  const { filtros } = useInformesFiltros();
  const [origen, setOrigen] = useState<OrigenMontajes>("ambos");
  const [data, setData] = useState<MontajesInforme | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    montajesInforme(filtros, origen)
      .then((d) => { if (vivo) setData(d); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar los montajes"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros, origen]);

  if (cargando && !data) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!data) return null;

  const cond = (c: string) => data.por_condicion.find((x) => x.condicion === c)?.n ?? 0;
  const pos = (c: string) => data.por_posicion.find((x) => x.clase === c)?.n ?? 0;
  const exc = data.excluidas;
  const hayExcluidas = exc.anuladas + exc.correcciones + exc.declaradas + exc.no_completadas > 0;
  const cob = data.recorridos_estimados ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase text-slate-400">Origen</span>
        {ORIGENES.map((o) => (
          <button key={o.v} onClick={() => setOrigen(o.v)}
            className={"rounded-lg border px-3 py-1 text-xs " + (origen === o.v
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
              : "border-slate-600 text-slate-300 hover:bg-slate-700")}>{o.label}</button>
        ))}
        <span className="ml-auto text-[11px] text-slate-500">
          Cuenta la goma que entra. Una sustitución es un montaje, no dos.
        </span>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Unidades montadas" value={data.total} />
        <KpiCard title="Unidades desmontadas" value={data.desmontajes} />
        <KpiCard title="Registros de operación" value={data.registros} />
        <KpiCard title="Nuevos · usados · recauchutados"
          value={`${cond("nueva")} · ${cond("usada")} · ${cond("recauchutada")}`} />
      </div>

      {origen === "ambos" && (
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-300">
          <b className="text-slate-100">{data.total_normal}</b> de operaciones normales ·{" "}
          <b className="text-slate-100">{data.total_historico}</b> del histórico importado
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase text-slate-400">Por condición</div>
            <button onClick={() => descargarCSV("montajes_por_condicion", ["Condición", "Nº", "Histórico", "Normal"],
              data.por_condicion.map((c) => [CONDICION_LABEL[c.condicion] ?? c.condicion, c.n, c.historico, c.normal]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">CSV</button>
          </div>
          <BarList color="#10b981" items={data.por_condicion.map((c) => ({ etiqueta: CONDICION_LABEL[c.condicion] ?? c.condicion, valor: c.n }))} />
        </div>
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">Evolución mensual</div>
          <ColumnChart color="#10b981" items={data.evolucion.map((e) => ({ etiqueta: e.mes.slice(5), valor: e.n }))} />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Posición del montaje</div>
          <span className="text-[11px] text-slate-500">Una posición deducida no es una posición confirmada</span>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-slate-200">
          {(["registrada", "deducida", "desconocida"] as const).map((c) => (
            <span key={c}><b className="text-slate-100">{pos(c)}</b> {POSICION_LABEL[c]}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Por marca, modelo y medida</div>
          <button onClick={() => descargarCSV("montajes_por_referencia",
            ["Marca", "Modelo", "Medida", "Condición", "Nº", "Histórico", "Normal"],
            data.por_referencia.map((r) => [r.marca, r.modelo, r.medida, CONDICION_LABEL[r.condicion] ?? r.condicion, r.n, r.historico, r.normal]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">CSV</button>
        </div>
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead><tr>
              <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th>
              <th className={thCls}>Condición</th><th className={thCls}>Nº</th>
              <th className={thCls}>Histórico</th><th className={thCls}>Normal</th>
            </tr></thead>
            <tbody>
              {data.por_referencia.map((r, i) => (
                <tr key={i} className="border-t border-slate-700">
                  <td className={tdCls}>{r.marca}</td><td className={tdCls}>{r.modelo}</td><td className={tdCls}>{r.medida}</td>
                  <td className={tdCls}>{CONDICION_LABEL[r.condicion] ?? r.condicion}</td>
                  <td className={tdCls + " font-semibold text-slate-100"}>{r.n}</td>
                  <td className={tdCls + " text-slate-400"}>{r.historico}</td>
                  <td className={tdCls + " text-slate-400"}>{r.normal}</td>
                </tr>
              ))}
              {data.por_referencia.length === 0 && <tr><td className={tdCls} colSpan={7}>Sin montajes en el periodo.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Por vehículo</div>
          <button onClick={() => descargarCSV("montajes_por_vehiculo", ["Matrícula", "Nº", "Nuevos", "Usados", "Recauchutados"],
            data.por_vehiculo.map((v) => [v.matricula, v.n, v.nuevas, v.usadas, v.recauchutadas]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">CSV</button>
        </div>
        <BarList color="#6366f1" items={data.por_vehiculo.slice(0, 20).map((v) => ({ etiqueta: v.matricula, valor: v.n }))} />
      </div>

      {hayExcluidas && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs text-slate-400">
          Fuera del recuento: {exc.anuladas} anuladas · {exc.correcciones} correcciones ·{" "}
          {exc.declaradas} declaradas en el parte · {exc.no_completadas} sin completar. No se borran: no son montajes.
        </div>
      )}

      {/* Recorridos ESTIMADOS de la reconstrucción histórica, con su
          cobertura. Van aparte del recuento de montajes y aparte de los
          informes de rendimiento confirmado: son otra cosa. Las ocupaciones
          de posición no se promedian con las unidades identificadas. */}
      {cob && cob.poblacion.intervalos > 0 && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-xs">
          <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">
            Recorrido estimado del histórico · no es rendimiento confirmado
          </div>
          <div className="text-slate-400">{cob.aviso}</div>
          <div className="mt-2 text-slate-300">{textoCobertura(cob)}</div>
          {/* Tres grupos, nunca en un solo número. Y una ficha reconstruida no
              es una goma identificada, pero tampoco es «sin ficha». */}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([
              ["identidad_respaldada", "Identidad respaldada por una persona", "Ningún intervalo con el neumático identificado entra en la media."],
              ["ficha_reconstruida", "Ficha reconstruida por la importación", "Ninguna ficha reconstruida entra en la media."],
              ["ocupacion_sin_ficha", "Ocupación de posición sin ficha", "Ninguna ocupación sin ficha entra en la media."],
            ] as const).map(([k, titulo, vacio]) => {
              const r = cob.recorrido[k];
              return (
                <div key={k} className="rounded border border-slate-700 p-2">
                  <div className="text-[11px] uppercase text-slate-400">{titulo}</div>
                  {r.n > 0 ? (
                    <div className="text-slate-200">
                      media {numero(r.media)} km · mediana {numero(r.mediana)} km
                      <div className="text-[11px] text-slate-500">
                        {r.n} intervalo(s) · de {numero(r.minimo)} a {numero(r.maximo)} km · {r.que_es}
                      </div>
                    </div>
                  ) : <div className="text-slate-500">{vacio}</div>}
                </div>
              );
            })}
          </div>
          {cob.embudo && cob.embudo.con_recorrido_aritmetico !== cob.embudo.elegibles_tras_filtros && (
            <div className="mt-2 text-slate-400">
              De los <span className="text-slate-200">{cob.embudo.con_recorrido_aritmetico}</span> intervalos con recorrido
              calculable, solo <span className="text-slate-200">{cob.embudo.elegibles_tras_filtros}</span> pasan todos los
              filtros. {cob.embudo.que_es}
            </div>
          )}
          {cob.excluidos.n > 0 && (
            <div className="mt-2 text-slate-400">
              <div className="text-[11px] uppercase text-slate-500">Fuera de la media ({cob.excluidos.n})</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {cob.excluidos.motivos.map((m) => (
                  <span key={m.motivo}>{etiquetaMotivo(m.motivo)}: <span className="text-slate-200">{m.n}</span></span>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{cob.excluidos.nota}</div>
            </div>
          )}
          <div className="mt-2 text-[11px] text-slate-500">
            Revisión humana · kilómetros: {cob.revision.km_pendientes} pendiente(s), {cob.revision.km_aceptados} aceptado(s),{" "}
            {cob.revision.km_rechazados} rechazado(s) · continuidad: {cob.revision.continuidad_pendientes} pendiente(s),{" "}
            {cob.revision.continuidad_aceptadas} aceptada(s), {cob.revision.continuidad_rechazadas} rechazada(s).
            {cob.limite_km_dia != null && <> Límite de plausibilidad aplicado: {numero(cob.limite_km_dia)} km/día.</>}
          </div>
        </div>
      )}
    </div>
  );
}
