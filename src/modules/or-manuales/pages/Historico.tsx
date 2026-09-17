/**
 * El histórico del módulo: todo lo que se ha hecho, sin poder cambiarlo.
 *
 * La tabla `orm_eventos` es inmutable por trigger, así que esta pantalla sólo
 * lee. Se puede filtrar por bloc, y los blocs cerrados siguen aquí con sus
 * documentos: eso es lo que hace que cerrar un bloc no sea perderlo de vista.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import * as api from "../services/api";
import {
  Cabecera,
  ChipEstadoBloc,
  EmptyRow,
  ErrorBox,
  Progreso,
  TableWrap,
  btnSecondary,
  inputCls,
  tdCls,
  thCls,
} from "../components/ui";
import type { Evento, FilaBloc } from "../types";
import { ETIQUETA_ACCION } from "../types";
import { fmtFecha, fmtFechaHora } from "../../administracion/types";

export default function Historico() {
  const [blocs, setBlocs] = useState<FilaBloc[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [blocId, setBlocId] = useState("");
  const [q, setQ] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [b, h] = await Promise.all([api.listarBlocs({ q: q || undefined, cerrados: true }), api.historico(blocId || undefined)]);
      setBlocs(b.blocs);
      setEventos(h.eventos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el histórico");
    } finally {
      setCargando(false);
    }
  }, [q, blocId]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div>
      <Cabecera titulo="Histórico" descripcion="Blocs cerrados y todo lo que se ha hecho en el módulo.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()} disabled={cargando}>
          <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          className={`${inputCls} max-w-xs`}
          placeholder="Nº de bloc, nº de OR o responsable…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={`${inputCls} max-w-[260px]`} value={blocId} onChange={(e) => setBlocId(e.target.value)}>
          <option value="">Movimientos de todos los blocs</option>
          {blocs.map((b) => (
            <option key={b.id} value={b.id}>
              Bloc {b.numeroBloc} ({b.orInicial}-{b.orFinal})
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Blocs cerrados</div>
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-700">
              <th className={thCls}>Nº bloc</th>
              <th className={thCls}>Rango OR</th>
              <th className={thCls}>Responsable</th>
              <th className={thCls}>Devolución</th>
              <th className={thCls}>Archivadas</th>
              <th className={thCls}>Estado</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {blocs.length === 0 && !cargando && <EmptyRow cols={7} text="Todavía no hay ningún bloc cerrado." />}
            {blocs.map((b) => (
              <tr key={b.id} className="border-b border-slate-700/60 hover:bg-slate-700/30">
                <td className={`${tdCls} font-bold`}>{b.numeroBloc}</td>
                <td className={`${tdCls} tabular-nums`}>
                  {b.orInicial}-{b.orFinal}
                </td>
                <td className={tdCls}>{b.responsableNombre ?? "—"}</td>
                <td className={tdCls}>{fmtFecha(b.fechaDevolucion) || "—"}</td>
                <td className={tdCls}>
                  <Progreso archivadas={b.archivadas} total={b.cantidadOr} />
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

      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Movimientos</div>
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-700">
              <th className={thCls}>Cuándo</th>
              <th className={thCls}>Acción</th>
              <th className={thCls}>Quién</th>
              <th className={thCls}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {eventos.length === 0 && !cargando && <EmptyRow cols={4} text="Sin movimientos." />}
            {eventos.map((ev) => (
              <tr key={ev.id} className="border-b border-slate-700/60">
                <td className={`${tdCls} whitespace-nowrap text-slate-400`}>{fmtFechaHora(ev.createdAt)}</td>
                <td className={`${tdCls} font-semibold`}>{ETIQUETA_ACCION[ev.accion] ?? ev.accion}</td>
                <td className={tdCls}>{ev.usuarioNombre ?? "—"}</td>
                <td className={`${tdCls} text-[12px] text-slate-400`}>{resumen(ev.detalle)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}

/**
 * El detalle del evento en una línea legible.
 *
 * Los eventos guardan un JSON con lo que hiciera falta en cada caso; volcarlo
 * tal cual sería ilegible, así que se enseñan los campos que se entienden y se
 * omite el resto.
 */
function resumen(detalle: unknown): string {
  if (!detalle || typeof detalle !== "object") return "";
  const d = detalle as Record<string, unknown>;
  const partes: string[] = [];
  if (d.numeroOr) partes.push(`OR ${d.numeroOr}`);
  if (d.numeroBloc) partes.push(`bloc ${d.numeroBloc}`);
  if (d.orInicial && d.orFinal) partes.push(`${d.orInicial}-${d.orFinal}`);
  if (d.responsableNombre) partes.push(String(d.responsableNombre));
  if (d.confianza != null) partes.push(`confianza ${d.confianza}%`);
  if (Array.isArray(d.faltan) && d.faltan.length > 0) partes.push(`faltan ${d.faltan.slice(0, 6).join(", ")}`);
  if (d.de && d.a) partes.push(`${d.de} → ${d.a}`);
  if (d.archivo) partes.push(String(d.archivo));
  if (d.motivo) partes.push(String(d.motivo));
  return partes.join(" · ");
}
