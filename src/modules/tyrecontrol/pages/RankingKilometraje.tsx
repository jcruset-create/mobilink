import { useEffect, useMemo, useState } from "react";
import { Download, Gauge, Search, TriangleAlert } from "lucide-react";
import { rankingKilometraje, type Ranking, type VehiculoDelRanking } from "../services/kilometrajeMensual";

/**
 * Qué autobuses ruedan más, de más a menos.
 *
 * ── Por qué la columna «meses» no se puede esconder ─────────────────────────
 *
 * La cifra es la media mensual llevada a doce meses, no el total acumulado: si
 * se ordenara por total ganaría el vehículo con más meses sincronizados, no el
 * que más rueda. El precio de esa decisión es que una cifra hecha sobre tres
 * meses vale menos que una hecha sobre doce, y eso tiene que estar a la vista
 * en la propia fila, no en una nota al pie.
 *
 * ── «Sin datos» es una sección, no un cero ──────────────────────────────────
 *
 * Un vehículo activo sin ningún mes con dato casi nunca es un autobús que no
 * rueda: es uno que no está enlazado con el proveedor. Mezclarlo en la lista
 * con un 0 escondería trabajo de conciliación pendiente, así que va abajo y
 * con su nombre.
 *
 * Los números salen del backend ya calculados, y de la misma función que la
 * ficha de cada vehículo. Aquí no se suma nada.
 */
export default function RankingKilometraje() {
  const [datos, setDatos] = useState<Ranking | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await rankingKilometraje();
        if (vivo) { setDatos(r); setError(""); }
      } catch (e: any) {
        if (vivo) setError(e?.message ?? "No se pudo cargar el ranking");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!datos) return [];
    if (!q) return datos.vehiculos;
    return datos.vehiculos.filter(
      (v) =>
        (v.matricula ?? "").toLowerCase().includes(q) ||
        (v.numeroUnidad ?? "").toLowerCase().includes(q),
    );
  }, [datos, busqueda]);

  function exportar() {
    if (!datos) return;
    const cab = "puesto;matricula;unidad;km_anual;meses;km_anio_actual;meses_del_anio;meses_sin_dato;meses_con_error";
    const filas = datos.vehiculos.map((v, i) =>
      [i + 1, v.matricula ?? "", v.numeroUnidad ?? "", v.kmAnual ?? "", v.meses,
       v.kmAnioActual, v.mesesDelAnio, v.mesesSinDato, v.mesesConError].join(";"),
    );
    const csv = [cab, ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `kilometros-por-vehiculo-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const num = (n: number | null | undefined) =>
    n == null ? "—" : `${Math.round(n).toLocaleString("es-ES")}`;

  return (
    <div className="p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Gauge className="h-5 w-5" /> Kilómetros por vehículo
        </h1>
        {datos && (
          <span className="text-xs text-slate-400">
            {datos.totales.vehiculosConDato} vehículos con dato
            {datos.totales.kmAnualMedio != null && <> · media {num(datos.totales.kmAnualMedio)} km/año</>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Matrícula o unidad"
              className="rounded-lg border border-slate-600 bg-slate-900 py-1.5 pl-7 pr-2 text-xs text-slate-200"
            />
          </div>
          <button
            onClick={exportar}
            disabled={!datos?.vehiculos.length}
            className="flex items-center gap-1 rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {cargando && <div className="text-sm text-slate-400">Cargando…</div>}

      {datos && !cargando && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-right">#</th>
                  <th className="px-3 py-2 text-left">Matrícula</th>
                  <th className="px-3 py-2 text-left">Unidad</th>
                  <th className="px-3 py-2 text-right">km / año</th>
                  {/* La columna que impide que la cifra engañe. Ver la cabecera. */}
                  <th className="px-3 py-2 text-right">sobre</th>
                  <th className="px-3 py-2 text-right">Año en curso</th>
                  <th className="px-3 py-2 text-right">Mes actual</th>
                  <th className="px-3 py-2 text-left">Huecos</th>
                </tr>
              </thead>
              <tbody>
                {/* El puesto es el del ranking completo, no el de la lista
                    filtrada: buscar una matrícula no puede cambiar en qué
                    posición va ese autobús. */}
                {filtrados.map((v) => (
                  <Fila key={v.vehiculoId} v={v} puesto={datos.vehiculos.indexOf(v) + 1} num={num} />
                ))}
                {filtrados.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    {busqueda ? "Ningún vehículo con esa matrícula o unidad." : "Todavía no hay kilómetros sincronizados."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {datos.sinDatos.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-700/50 bg-amber-500/5 p-3 text-xs">
              <div className="mb-2 flex items-center gap-2 font-bold text-amber-300">
                <TriangleAlert className="h-4 w-4" />
                {datos.sinDatos.length} vehículos activos sin ningún kilómetro
              </div>
              <p className="mb-2 text-slate-400">
                No es que no rueden: casi siempre es que no están enlazados con la telemática, o que su
                mes todavía no se ha sincronizado. Se enlazan desde Conciliación telemática.
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-slate-300">
                {datos.sinDatos.map((v) => (
                  <span key={v.vehiculoId}>{v.matricula ?? v.numeroUnidad ?? v.vehiculoId}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Fila({ v, puesto, num }: {
  v: VehiculoDelRanking;
  puesto: number;
  num: (n: number | null | undefined) => string;
}) {
  // Pocos meses detrás de la cifra: se avisa en la propia fila, en vez de
  // dejar que un 96.000 sobre dos meses parezca lo mismo que sobre doce.
  const flojo = v.meses < 3;
  return (
    <tr className="border-t border-slate-800 hover:bg-slate-800/40">
      <td className="px-3 py-1.5 text-right text-slate-500">{puesto}</td>
      <td className="px-3 py-1.5 font-bold">{v.matricula ?? "—"}</td>
      <td className="px-3 py-1.5 text-slate-400">{v.numeroUnidad ?? "—"}</td>
      <td className="px-3 py-1.5 text-right font-bold">{num(v.kmAnual)}</td>
      <td className={`px-3 py-1.5 text-right ${flojo ? "text-amber-300" : "text-slate-400"}`}>
        {v.meses} {v.meses === 1 ? "mes" : "meses"}
      </td>
      <td className="px-3 py-1.5 text-right text-slate-300">
        {num(v.kmAnioActual)} <span className="text-slate-500">({v.mesesDelAnio})</span>
      </td>
      <td className="px-3 py-1.5 text-right text-slate-400">{num(v.kmMesActual)}</td>
      <td className="px-3 py-1.5 text-slate-400">
        {v.mesesSinDato > 0 && <span className="mr-2">{v.mesesSinDato} sin dato</span>}
        {v.mesesConError > 0 && <span className="text-amber-300">{v.mesesConError} con error</span>}
        {v.mesesSinDato === 0 && v.mesesConError === 0 && "—"}
      </td>
    </tr>
  );
}
