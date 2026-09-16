/**
 * El listado de blocs, con sus filtros.
 *
 * En escritorio, tabla; en móvil, tarjetas. La columna que de verdad importa
 * es el progreso: «23/25» dice más que cualquier estado, y al lado va lo que
 * falta cuando son pocas.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PlusCircle, RefreshCw } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import {
  Cabecera,
  ChipEstadoBloc,
  EmptyRow,
  ErrorBox,
  Progreso,
  TableWrap,
  btnPrimary,
  btnSecondary,
  inputCls,
  tdCls,
  thCls,
} from "../components/ui";
import type { FilaBloc } from "../types";
import { fmtFecha } from "../../administracion/types";

export default function Blocs() {
  const { puede, vocabulario } = useOrManuales();
  const [filas, setFilas] = useState<FilaBloc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [incompletos, setIncompletos] = useState(false);
  const [cerrados, setCerrados] = useState(false);
  const [conRevisiones, setConRevisiones] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.listarBlocs({
        q: q || undefined,
        estado: estado || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        incompletos,
        cerrados,
        conRevisiones,
      });
      setFilas(r.blocs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los blocs");
    } finally {
      setCargando(false);
    }
  }, [q, estado, desde, hasta, incompletos, cerrados, conRevisiones]);

  useEffect(() => {
    // Se espera un momento al teclear: el filtro de texto busca también por
    // número de OR dentro del rango, y no hace falta consultar cada letra.
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div>
      <Cabecera titulo="Blocs de OR manuales" descripcion="Cada bloc son 25 órdenes consecutivas en papel.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
        {puede("or-manuales.bloc.create") && (
          <Link to="/or-manuales/blocs/nuevo" className={`${btnPrimary} flex items-center gap-2`}>
            <PlusCircle className="h-4 w-4" /> Nuevo bloc
          </Link>
        )}
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <input
          className={`${inputCls} max-w-xs`}
          placeholder="Nº de bloc, nº de OR o responsable…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={`${inputCls} max-w-[200px]`} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Cualquier estado</option>
          {(vocabulario?.estadosBloc ?? []).map((e) => (
            <option key={e} value={e}>
              {vocabulario?.etiquetas.estadoBloc[e] ?? e}
            </option>
          ))}
        </select>
        <label className="flex flex-col text-[10px] font-semibold uppercase text-slate-400">
          Entregado desde
          <input type="date" className={`${inputCls} max-w-[160px]`} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="flex flex-col text-[10px] font-semibold uppercase text-slate-400">
          Hasta
          <input type="date" className={`${inputCls} max-w-[160px]`} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-1">
          {[
            { on: incompletos, set: setIncompletos, label: "Incompletos" },
            { on: conRevisiones, set: setConRevisiones, label: "Con documentos pendientes" },
            { on: cerrados, set: setCerrados, label: "Cerrados" },
          ].map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => f.set(!f.on)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                f.on ? "bg-teal-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Móvil: tarjetas */}
      <div className="space-y-2 md:hidden">
        {filas.length === 0 && !cargando && <p className="py-6 text-center text-sm text-slate-500">No hay blocs con esos filtros.</p>}
        {filas.map((b) => (
          <Link key={b.id} to={`/or-manuales/blocs/${b.id}`} className="block rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-black">Bloc {b.numeroBloc}</span>
              <ChipEstadoBloc estado={b.estado} />
            </div>
            <div className="mt-1 text-[13px] tabular-nums text-slate-300">
              OR {b.orInicial} – {b.orFinal}
            </div>
            <div className="mt-2">
              <Progreso archivadas={b.archivadas} total={b.cantidadOr} />
            </div>
            <div className="mt-2 text-[12px] text-slate-400">
              {b.responsableNombre ?? "Sin responsable"} · Entregado {fmtFecha(b.fechaEntrega) || "—"}
            </div>
          </Link>
        ))}
      </div>

      {/* Escritorio: tabla */}
      <div className="hidden md:block">
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-700">
              <th className={thCls}>Nº bloc</th>
              <th className={thCls}>Rango OR</th>
              <th className={thCls}>Responsable</th>
              <th className={thCls}>Entrega</th>
              <th className={thCls}>Devolución</th>
              <th className={thCls}>Archivadas</th>
              <th className={thCls}>Pendientes</th>
              <th className={thCls}>Estado</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && !cargando && <EmptyRow cols={9} text="No hay blocs con esos filtros." />}
            {cargando && filas.length === 0 && <EmptyRow cols={9} text="Cargando…" />}
            {filas.map((b) => (
              <tr key={b.id} className="border-b border-slate-700/60 hover:bg-slate-700/30">
                <td className={`${tdCls} font-bold`}>{b.numeroBloc}</td>
                <td className={`${tdCls} tabular-nums`}>
                  {b.orInicial}-{b.orFinal}
                </td>
                <td className={tdCls}>{b.responsableNombre ?? <span className="text-slate-500">—</span>}</td>
                <td className={tdCls}>{fmtFecha(b.fechaEntrega) || "—"}</td>
                <td className={tdCls}>{fmtFecha(b.fechaDevolucion) || "—"}</td>
                <td className={tdCls}>
                  <Progreso archivadas={b.archivadas} total={b.cantidadOr} />
                </td>
                <td className={`${tdCls} tabular-nums`}>
                  {b.pendientes > 0 ? <span className="font-bold text-rose-300">{b.pendientes}</span> : <span className="text-slate-500">0</span>}
                  {b.enRevision > 0 && <span className="ml-2 text-[11px] text-orange-300">{b.enRevision} a revisar</span>}
                </td>
                <td className={tdCls}>
                  <ChipEstadoBloc estado={b.estado} />
                </td>
                <td className={tdCls}>
                  <Link to={`/or-manuales/blocs/${b.id}`} className="text-[12px] font-semibold text-teal-400 hover:underline">
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
