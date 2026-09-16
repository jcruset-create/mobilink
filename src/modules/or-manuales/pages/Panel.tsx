/**
 * El panel del módulo: los accesos de siempre y los números del momento.
 *
 * Los indicadores salen de la base (`/bootstrap` e `/indicadores`), no de
 * ningún contador guardado. Y lo primero de la pantalla es la BÚSQUEDA, porque
 * el uso más frecuente del módulo no es mirar estadísticas: es que alguien
 * llegue preguntando por la OR 1043.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, FileStack, History, PlusCircle, RefreshCw, ScanLine, Search } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import { Cabecera, Card, ChipEstadoBloc, ChipEstadoOr, ErrorBox, btnSecondary, inputCls } from "../components/ui";
import type { ResultadoBusqueda } from "../types";

const ACCESOS = [
  { to: "/or-manuales/blocs", label: "Blocs", icono: FileStack, permiso: "or-manuales.view" },
  { to: "/or-manuales/blocs/nuevo", label: "Nuevo bloc", icono: PlusCircle, permiso: "or-manuales.bloc.create" },
  { to: "/or-manuales/escanear", label: "Escanear documentos", icono: ScanLine, permiso: "or-manuales.documento.subir" },
  { to: "/or-manuales/pendientes", label: "Documentos pendientes", icono: AlertTriangle, permiso: "or-manuales.view" },
  { to: "/or-manuales/avisos", label: "Avisos", icono: Bell, permiso: "or-manuales.view" },
  { to: "/or-manuales/historico", label: "Histórico", icono: History, permiso: "or-manuales.view" },
];

export default function Panel() {
  const { indicadores, puede, refrescarIndicadores } = useOrManuales();
  const navegar = useNavigate();
  const [q, setQ] = useState("");
  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refrescarIndicadores();
  }, [refrescarIndicadores]);

  const buscar = useCallback(async () => {
    const termino = q.trim();
    if (!termino) {
      setResultado(null);
      return;
    }
    setBuscando(true);
    setError(null);
    try {
      setResultado(await api.buscar(termino));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido buscar");
    } finally {
      setBuscando(false);
    }
  }, [q]);

  return (
    <div>
      <Cabecera titulo="OR Manuales" descripcion="Blocs de órdenes de reparación en papel: quién los tiene, qué se ha escaneado y qué falta.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void refrescarIndicadores()}>
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </Cabecera>

      {/* Buscar una OR: lo que más se usa, lo primero que se ve. */}
      <form
        className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Número de OR, bloc o responsable…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className={btnSecondary} disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>

        {error && <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>}

        {resultado?.or && resultado.bloc && (
          <button
            type="button"
            onClick={() => navegar(`/or-manuales/blocs/${resultado.bloc!.id}`)}
            className="mt-3 flex w-full flex-wrap items-center gap-3 rounded-xl border border-teal-500/40 bg-teal-500/10 p-3 text-left hover:bg-teal-500/20"
          >
            <span className="text-lg font-black tabular-nums text-teal-200">OR {resultado.or.numeroOr}</span>
            <ChipEstadoOr estado={resultado.or.estado} />
            <span className="text-[13px] text-slate-300">
              Bloc {resultado.bloc.numeroBloc} · {resultado.bloc.orInicial}-{resultado.bloc.orFinal}
            </span>
            <ChipEstadoBloc estado={resultado.bloc.estado} />
            {resultado.bloc.responsableNombre && (
              <span className="text-[12px] text-slate-400">{resultado.bloc.responsableNombre}</span>
            )}
            {resultado.documento && <span className="text-[12px] text-slate-400">{resultado.documento.nombreArchivo}</span>}
          </button>
        )}

        {resultado && !resultado.or && resultado.blocs.length > 0 && (
          <div className="mt-3 space-y-1">
            {resultado.blocs.map((b) => (
              <Link
                key={b.id}
                to={`/or-manuales/blocs/${b.id}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-2 text-[13px] hover:bg-slate-700/40"
              >
                <span className="font-bold">Bloc {b.numeroBloc}</span>
                <span className="tabular-nums text-slate-400">
                  {b.orInicial}-{b.orFinal}
                </span>
                <ChipEstadoBloc estado={b.estado} />
                <span className="text-slate-400">
                  {b.archivadas}/{b.cantidadOr}
                </span>
              </Link>
            ))}
          </div>
        )}

        {resultado && !resultado.or && resultado.blocs.length === 0 && (
          <p className="mt-3 text-[13px] text-slate-400">
            No hay ninguna OR ni ningún bloc con «{q.trim()}». Si es una OR que todavía no se ha dado de alta, crea su bloc.
          </p>
        )}
      </form>

      {/* Los números */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Card title="Blocs entregados" value={String(indicadores?.blocsEntregados ?? 0)} accent="text-sky-400" hint="En manos del taller" />
        <Card title="Blocs pendientes" value={String(indicadores?.blocsPendientes ?? 0)} accent="text-amber-300" hint="Sin entregar o por escanear" />
        <Card title="OR pendientes" value={String(indicadores?.orPendientes ?? 0)} accent="text-rose-400" hint="Hojas sin archivar" />
        <Card title="Para revisar" value={String(indicadores?.documentosPorRevisar ?? 0)} accent="text-orange-300" hint="Documentos que esperan a alguien" />
        <Card title="Avisos abiertos" value={String(indicadores?.avisosAbiertos ?? 0)} accent="text-rose-400" hint="Blocs incompletos" />
        <Card title="Blocs cerrados" value={String(indicadores?.blocsCerrados ?? 0)} accent="text-emerald-400" hint="Archivo histórico" />
      </div>

      {/* Los accesos */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        {ACCESOS.filter((a) => puede(a.permiso)).map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 p-4 text-center text-[13px] font-semibold text-slate-200 hover:border-teal-500/50 hover:bg-slate-700/60"
          >
            <a.icono className="h-6 w-6 text-teal-400" />
            {a.label}
          </Link>
        ))}
      </div>

      {(indicadores?.procesosEnCurso ?? 0) > 0 && (
        <p className="mt-4 text-[13px] text-sky-300">
          Hay {indicadores?.procesosEnCurso} escaneo(s) procesándose ahora mismo.{" "}
          <Link to="/or-manuales/escanear" className="underline">
            Ver el avance
          </Link>
        </p>
      )}
    </div>
  );
}
