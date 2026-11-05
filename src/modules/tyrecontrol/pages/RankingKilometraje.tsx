import { useEffect, useMemo, useState } from "react";
import { Download, Gauge, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  rankingKilometraje, rehacerHuecosVehiculo, revisarCoherencia,
  type Ranking, type VehiculoDelRanking,
} from "../services/kilometrajeMensual";
import { detalleDeMeses, listaDeMeses } from "../services/mesesEtiqueta";
import { listarEmpresas } from "../services/data";
import TotalFlotaKm from "../components/TotalFlotaKm";
import type { Empresa } from "../types";

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
 * ── El selector de empresa no es un adorno ─────────────────────────────────
 *
 * Sin él, la pantalla se quedaba clavada en la empresa DEL PERFIL. Un
 * super-admin que gestiona varios clientes la abría, veía los dieciséis
 * vehículos de prueba de su propia empresa y concluía que no había datos.
 * Pasó en la primera prueba, y es el peor tipo de fallo: la pantalla no da
 * ningún error, simplemente contesta a otra pregunta.
 *
 * Un administrador normal solo verá la suya —`listarEmpresas` ya aplica ese
 * criterio— y para él el selector es una etiqueta con un solo valor.
 *
 * Los números salen del backend ya calculados, y de la misma función que la
 * ficha de cada vehículo. Aquí no se suma nada.
 */
export default function RankingKilometraje() {
  const [datos, setDatos] = useState<Ranking | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  /* Se incrementa cuando una fila rehace sus meses: el ranking se vuelve a
     pedir entero, porque al cambiar un vehículo cambia la media de la flota
     y el puesto de los demás. */
  const [recarga, setRecarga] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [avisoRevision, setAvisoRevision] = useState("");

  useEffect(() => {
    listarEmpresas()
      .then((e) => {
        setEmpresas(e);
        if (e.length) setEmpresaId((actual) => actual || e[0].id);
        else setCargando(false);
      })
      .catch((e) => { setError(e.message); setCargando(false); });
  }, []);

  // Se incrementa cuando una fila rehace sus meses: el ranking se vuelve a
  // pedir entero porque la media de la flota también se mueve.
  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    setCargando(true);
    (async () => {
      try {
        const r = await rankingKilometraje(empresaId);
        if (vivo) { setDatos(r); setError(""); }
      } catch (e: any) {
        if (vivo) { setError(e?.message ?? "No se pudo cargar el ranking"); setDatos(null); }
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [empresaId, recarga]);

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

  const nombreEmpresa = empresas.find((e) => e.id === empresaId)?.nombre ?? "";

  /**
   * Revisar coherencia: primero se cuenta, se enseña el número y solo entonces
   * se confirma. Descartar filas del histórico no es algo que deba pasar por
   * pulsar un botón sin saber cuántas son.
   */
  async function revisar() {
    setRevisando(true);
    setAvisoRevision("");
    setError("");
    try {
      const previa = await revisarCoherencia({ empresaId, aplicar: false });
      if (previa.filas === 0) {
        setAvisoRevision("Ningún mes guardado contradice a su odómetro. No hay nada que descartar.");
        return;
      }
      const peor = previa.muestra[0];
      const detalle = peor
        ? `\n\nLa peor: unidad ${peor.externalCode}, ${peor.year}-${String(peor.month).padStart(2, "0")}, ` +
          `${Math.round(peor.km).toLocaleString("es-ES")} km con el odómetro avanzando ` +
          `${Math.round(peor.avance).toLocaleString("es-ES")}.`
        : "";
      if (!confirm(
        `${previa.filas} meses de ${previa.vehiculos} vehículos dicen una distancia imposible: más del doble ` +
        `de lo que avanzó su odómetro en ese mismo mes.${detalle}\n\n` +
        "Se descartarán esas distancias. Los odómetros y el resto de meses no se tocan, y esos meses " +
        "quedarán marcados para volver a pedirse.\n\n¿Seguir?",
      )) return;

      const r = await revisarCoherencia({ empresaId, aplicar: true });
      setAvisoRevision(`Descartados ${r.filas} meses de ${r.vehiculos} vehículos.`);
      setDatos(await rankingKilometraje(empresaId));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo revisar la coherencia");
    } finally {
      setRevisando(false);
    }
  }

  function exportar() {
    if (!datos) return;
    // Los meses van con nombre y no solo contados: un CSV con «2» obliga a
    // volver a la pantalla para saber de qué dos meses habla.
    const mesesCsv = (ms: Array<{ year: number; month: number }>) =>
      ms.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(" ");
    const cab = "puesto;matricula;unidad;km_anual;meses;km_anio_actual;meses_del_anio;"
      + "meses_sin_dato;cuales_sin_dato;meses_con_error;cuales_con_error";
    const filas = datos.vehiculos.map((v, i) =>
      [i + 1, v.matricula ?? "", v.numeroUnidad ?? "", v.kmAnual ?? "", v.meses,
       v.kmAnioActual, v.mesesDelAnio,
       v.mesesSinDato, mesesCsv(v.mesesSinDatoDetalle ?? []),
       v.mesesConError, mesesCsv(v.mesesConErrorDetalle ?? [])].join(";"),
    );
    const csv = [cab, ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    // La empresa va en el nombre del fichero: dos CSV de dos clientes en la
    // carpeta de descargas son indistinguibles sin ella.
    const suf = nombreEmpresa ? `-${nombreEmpresa.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    a.download = `kilometros-por-vehiculo${suf}-${new Date().toISOString().slice(0, 10)}.csv`;
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
        <select
          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          aria-label="Empresa"
        >
          {empresas.length === 0 && <option value="">Cargando empresas…</option>}
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>
        {datos && !cargando && (
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
            onClick={() => void revisar()}
            disabled={revisando || !empresaId}
            title="Descarta los meses cuya distancia contradice a su propio odómetro"
            className="flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700/40 disabled:opacity-40"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> {revisando ? "Revisando…" : "Revisar coherencia"}
          </button>
          <button
            onClick={exportar}
            disabled={!datos?.vehiculos.length}
            className="flex items-center gap-1 rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/*
        El total de la flota va ARRIBA del ranking, no debajo.

        La pregunta «¿cuántos kilómetros ha hecho la flota?» es más frecuente
        que «¿cuál es el autobús que más rueda?», y hasta ahora había que
        sumarla a mano o salir a consultar la base. El ranking sigue donde
        estaba; esto solo contesta antes lo que se pregunta antes.
      */}
      {empresaId && <TotalFlotaKm empresaId={empresaId} />}

      {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {avisoRevision && <div className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{avisoRevision}</div>}
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
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {/* El puesto es el del ranking completo, no el de la lista
                    filtrada: buscar una matrícula no puede cambiar en qué
                    posición va ese autobús. */}
                {filtrados.map((v) => (
                  <Fila key={v.vehiculoId} v={v} puesto={datos.vehiculos.indexOf(v) + 1} num={num}
                        empresaId={empresaId} onRehecho={() => setRecarga((n) => n + 1)} />
                ))}
                {filtrados.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                    {busqueda
                      ? "Ningún vehículo con esa matrícula o unidad."
                      : `Todavía no hay kilómetros sincronizados${nombreEmpresa ? ` en ${nombreEmpresa}` : ""}.`}
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

function Fila({ v, puesto, num, empresaId, onRehecho }: {
  v: VehiculoDelRanking;
  puesto: number;
  num: (n: number | null | undefined) => string;
  empresaId: string;
  onRehecho: () => void;
}) {
  const [rehaciendo, setRehaciendo] = useState(false);
  const [aviso, setAviso] = useState("");
  const huecosConocidos = v.mesesSinDato + v.mesesConError;

  /*
   * Rehacer SOLO los meses que le faltan a este vehículo.
   *
   * Qué meses son lo decide el servidor leyendo sus filas: aquí no se manda
   * una lista, así que no se puede mandar mal. Y si no falta ninguno, el
   * servidor contesta sin llamar al proveedor: pulsar dos veces no cuesta
   * una petición de más.
   */
  async function rehacer() {
    setRehaciendo(true); setAviso("");
    try {
      const r = await rehacerHuecosVehiculo({ vehiculoId: v.vehiculoId, empresaId });
      if (r.pedidos === 0) {
        setAviso("No le falta ningún mes");
      } else {
        const partes = [
          r.porClase.error ? `${r.porClase.error} con error` : "",
          r.porClase.sin_dato ? `${r.porClase.sin_dato} sin dato` : "",
          r.porClase.ausente ? `${r.porClase.ausente} sin pedir` : "",
        ].filter(Boolean);
        setAviso(`Pedidos ${r.pedidos} meses (${partes.join(", ")})`);
        onRehecho();
      }
    } catch (e: unknown) {
      setAviso(e instanceof Error && e.message ? e.message : "No se ha podido rehacer");
    } finally {
      setRehaciendo(false);
    }
  }

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
      {/*
        Qué meses, no solo cuántos.

        «1 con error» alarma y no se puede arreglar: para arreglarlo hay que
        saber de qué mes se trata —no es lo mismo uno de hace un año, ya
        cerrado, que el del mes pasado— y qué contestó el proveedor. El mes
        va en la celda y el motivo en el título, que es donde cabe.
      */}
      <td className="px-3 py-1.5 text-slate-400">
        {v.mesesSinDato > 0 && (
          <span className="mr-2" title={detalleDeMeses(v.mesesSinDatoDetalle ?? [])}>
            {v.mesesSinDato} sin dato
            {(v.mesesSinDatoDetalle?.length ?? 0) > 0 && (
              <span className="ml-1 capitalize text-slate-500">· {listaDeMeses(v.mesesSinDatoDetalle)}</span>
            )}
          </span>
        )}
        {v.mesesConError > 0 && (
          <span
            className="text-amber-300"
            title={detalleDeMeses(v.mesesConErrorDetalle ?? []) || "El proveedor no dijo por qué"}
          >
            {v.mesesConError} con error
            {(v.mesesConErrorDetalle?.length ?? 0) > 0 && (
              <span className="ml-1 capitalize text-amber-200/70">· {listaDeMeses(v.mesesConErrorDetalle)}</span>
            )}
          </span>
        )}
        {v.mesesSinDato === 0 && v.mesesConError === 0 && "—"}
      </td>
      {/*
        El botón de la fila: rehace los meses que le faltan A ESTE vehículo y
        a ninguno más. Las dos alternativas no servían: el relleno recorre la
        flota entera y tarda horas, y pedir un rango a mano arrastra meses que
        ya están bien, que es cupo del proveedor gastado en vano.
      */}
      <td className="px-3 py-1.5 text-right">
        <div className="flex items-center justify-end gap-2">
          {aviso && <span className="text-[11px] text-slate-400">{aviso}</span>}
          <button
            onClick={() => void rehacer()}
            disabled={rehaciendo || !empresaId}
            title={huecosConocidos > 0
              ? "Vuelve a pedir al proveedor solo los meses que le faltan a este vehículo"
              : "Vuelve a pedir los meses que le falten. Si no falta ninguno, no se llama al proveedor"}
            className={`rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-40 ${
              huecosConocidos > 0
                ? "border-amber-500 text-amber-300 hover:bg-amber-500/10"
                : "border-slate-600 text-slate-400 hover:bg-slate-700/40"
            }`}
          >
            <RefreshCw className={`inline h-3 w-3 ${rehaciendo ? "animate-spin" : ""}`} />
            <span className="ml-1">{rehaciendo ? "Pidiendo…" : "Rehacer"}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}
