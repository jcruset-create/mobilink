import { useCallback, useEffect, useState } from "react";
import { Download, Route } from "lucide-react";

import { totalFlotaKm, type TotalFlotaKm as Datos } from "../services/kilometrajeMensual";
import { mesCorto } from "../services/mesesEtiqueta";
import { TableWrap, tdCls, thCls } from "./ui";

/**
 * Los kilómetros de TODA la flota entre dos meses.
 *
 * ── Por qué el filtro pide meses y no días ──────────────────────────────────
 *
 * Porque el dato es mensual. El proveedor da un total por vehículo y mes
 * natural, así que «del 15 de marzo al 20 de junio» obligaría a repartir
 * marzo y junio a ojo. Un calendario de días daría a entender una precisión
 * que no existe, y el error no se vería: saldría un número redondo y
 * equivocado. Se piden meses y se dice que son meses.
 *
 * ── El total es lo medido ───────────────────────────────────────────────────
 *
 * Los meses sin dato no se suman como cero: un equipo apagado no es un
 * autobús parado, y contarlo a cero bajaría el total sin avisar. Se cuentan
 * aparte y se enseña, al lado, cuánto representarían al ritmo del resto. Esa
 * estimación va separada del total y nunca dentro.
 */

const nf = (n: number) => Math.round(n).toLocaleString("es-ES");

/** `AAAA-MM` de hace n meses, para los atajos. */
function mesRelativo(n: number): string {
  const d = new Date();
  const i = d.getUTCFullYear() * 12 + d.getUTCMonth() - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export default function TotalFlotaKm({ empresaId }: { empresaId?: string }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [d, setD] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async (de = desde, a = hasta) => {
    setCargando(true); setError("");
    try {
      setD(await totalFlotaKm({ empresaId, desde: de || undefined, hasta: a || undefined }));
    } catch (e: any) {
      setError(e?.message || "No se ha podido calcular"); setD(null);
    } finally { setCargando(false); }
  }, [empresaId, desde, hasta]);

  // Al abrir, los doce últimos meses. Es lo que se quiere ver sin pedir nada.
  useEffect(() => { void cargar("", ""); /* eslint-disable-next-line */ }, [empresaId]);

  const atajo = (de: string, a: string) => { setDesde(de); setHasta(a); void cargar(de, a); };
  const anio = new Date().getUTCFullYear();

  function exportar() {
    if (!d) return;
    const filas = [
      ["Mes", "Kilómetros", "Vehículos con dato", "Meses con error", "Meses vacíos"],
      ...d.porMes.map((m) => [`${String(m.month).padStart(2, "0")}/${m.year}`,
        Math.round(m.km), m.vehiculos, m.conError, m.vacios]),
      [], ["TOTAL", Math.round(d.km), d.vehiculosConDato, d.filasConError, d.filasVacias],
    ];
    const csv = filas.map((f) => f.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `km-flota-${d.rango.desde.year}-${String(d.rango.desde.month).padStart(2, "0")}`
      + `_${d.rango.hasta.year}-${String(d.rango.hasta.month).padStart(2, "0")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  const huecos = d ? d.filasConError + d.filasVacias : 0;

  return (
    <section className="mb-4 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black">
            <Route size={16} /> Kilómetros de toda la flota
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            El dato del proveedor es <b className="text-slate-300">mensual</b>, así que el filtro va
            por meses completos. Un «15 de marzo» habría que repartirlo a ojo.
          </p>
        </div>
        <button
          onClick={exportar}
          disabled={!d}
          className="flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-2
                     text-[12px] font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          <Download size={14} /> Excel
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Desde</span>
          <input type="month" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200" />
        </label>
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Hasta</span>
          <input type="month" value={hasta} onChange={(e) => setHasta(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200" />
        </label>
        <button onClick={() => cargar()} disabled={cargando}
          className="rounded-lg border border-sky-600 px-3 py-2 text-sm font-bold text-sky-300
                     hover:bg-sky-500/10 disabled:opacity-50">
          {cargando ? "Calculando…" : "Calcular"}
        </button>
        <div className="flex flex-wrap gap-1">
          {[
            { t: "Últimos 12 meses", de: "", a: "" },
            { t: `Año ${anio}`, de: `${anio}-01`, a: mesRelativo(0) },
            { t: "Últimos 3 meses", de: mesRelativo(2), a: mesRelativo(0) },
          ].map((x) => (
            <button key={x.t} onClick={() => atajo(x.de, x.a)}
              className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px]
                         text-slate-300 hover:bg-slate-700">
              {x.t}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {d && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total recorrido</div>
              <div className="text-2xl font-black tabular-nums text-sky-300">{nf(d.km)}<span className="text-sm"> km</span></div>
              <div className="text-[11px] text-slate-400">
                {String(d.rango.desde.month).padStart(2, "0")}/{d.rango.desde.year} –
                {" "}{String(d.rango.hasta.month).padStart(2, "0")}/{d.rango.hasta.year}
                {" · "}{d.mesesDelRango} mes(es)
              </div>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Vehículos con dato</div>
              <div className="text-2xl font-black tabular-nums">{nf(d.vehiculosConDato)}</div>
              <div className="text-[11px] text-slate-400">{nf(d.filasOk)} meses-vehículo</div>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Media por vehículo y mes</div>
              <div className="text-2xl font-black tabular-nums">
                {d.mediaVehiculoMes == null ? "—" : nf(d.mediaVehiculoMes)}
                <span className="text-sm"> km</span>
              </div>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Meses sin dato</div>
              <div className={`text-2xl font-black tabular-nums ${huecos > 0 ? "text-amber-300" : ""}`}>
                {nf(huecos)}
              </div>
              <div className="text-[11px] text-slate-400">
                {nf(d.filasConError)} con error · {nf(d.filasVacias)} vacíos
              </div>
            </div>
          </div>

          {/*
            La estimación va SEPARADA del total y se dice que es una
            estimación. Sumarla daría un número más bonito y menos cierto.
          */}
          {d.kmEstimadosEnHuecos != null && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[12px] text-amber-200">
              Faltan {nf(huecos)} meses-vehículo. Si hubieran rodado como la media, serían unos{" "}
              <b>{nf(d.kmEstimadosEnHuecos)} km más</b> — el total real estaría cerca de{" "}
              <b>{nf(d.km + d.kmEstimadosEnHuecos)}</b>. Es una estimación: el total de arriba
              es solo lo medido.
            </p>
          )}

          {d.porMes.length > 0 && (
            <TableWrap>
              <thead><tr>
                <th className={thCls}>Mes</th>
                <th className={thCls}>Kilómetros</th>
                <th className={thCls}>Vehículos</th>
                <th className={thCls}>Sin dato</th>
                <th className={thCls}>Reparto</th>
              </tr></thead>
              <tbody>
                {d.porMes.map((m) => {
                  const max = Math.max(...d.porMes.map((x) => x.km), 1);
                  return (
                    <tr key={`${m.year}-${m.month}`}>
                      <td className={`${tdCls} font-bold`}>{mesCorto(m.year, m.month)} {m.year}</td>
                      <td className={`${tdCls} tabular-nums`}>{nf(m.km)}</td>
                      <td className={`${tdCls} tabular-nums text-slate-400`}>{m.vehiculos}</td>
                      <td className={tdCls}>
                        {m.conError + m.vacios > 0
                          ? <span className="text-amber-300">{m.conError + m.vacios}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className={tdCls}>
                        <span className="block h-2 rounded bg-sky-500"
                              style={{ width: `${Math.max(2, (m.km / max) * 100)}%` }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}

          {d.porVehiculo.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-bold text-slate-300">
                Los que más han rodado ({d.porVehiculo.length} de {nf(d.vehiculosEnTotal)})
              </summary>
              <TableWrap>
                <thead><tr>
                  <th className={thCls}>Matrícula</th><th className={thCls}>Unidad</th>
                  <th className={thCls}>Kilómetros</th><th className={thCls}>Meses</th>
                </tr></thead>
                <tbody>
                  {d.porVehiculo.map((v) => (
                    <tr key={v.vehiculoId}>
                      <td className={`${tdCls} font-bold`}>{v.matricula ?? v.vehiculoId.slice(0, 8)}</td>
                      <td className={`${tdCls} text-slate-400`}>{v.unidad ?? "—"}</td>
                      <td className={`${tdCls} tabular-nums`}>{nf(v.km)}</td>
                      <td className={`${tdCls} tabular-nums text-slate-400`}>{v.meses}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </details>
          )}
        </>
      )}
    </section>
  );
}
