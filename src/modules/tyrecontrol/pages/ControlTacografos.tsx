import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Gauge, Search } from "lucide-react";

import {
  controlTacografos, listarEmpresas,
  type ControlTacografos as Datos, type EstadoTacografo, type FilaTacografo,
} from "../services/data";
import type { Empresa } from "../types";
import { TableWrap, tdCls, thCls } from "../components/ui";

/**
 * Control de tacógrafos: a quién le toca, de más urgente a menos.
 *
 * ── No calcula nada ─────────────────────────────────────────────────────────
 *
 * Las fechas y los estados vienen del servidor, del mismo módulo que alimenta
 * la sección Tacógrafo de la ficha de cada vehículo. La ficha es, literalmente,
 * una fila de esta lista. Si esta pantalla recalculara por su cuenta, un día
 * diría una fecha y la ficha otra.
 *
 * ── El resumen de arriba NO se encoge al filtrar ────────────────────────────
 *
 * Si al elegir una base el contador de vencidos bajara, parecería que se han
 * arreglado solos. Los cuatro números son siempre de la flota entera; lo que
 * cambia es la lista de abajo, y se dice cuántos se están viendo.
 *
 * ── Los «sin datos» van al final y tienen su propio color ───────────────────
 *
 * Un vehículo sin ninguna intervención registrada no es uno que esté al día
 * ni uno que esté vencido: es uno del que no se sabe nada. Mezclarlo con los
 * vencidos inflaría la urgencia; mezclarlo con los vigentes la escondería.
 */

const ETIQUETA: Record<EstadoTacografo, string> = {
  vigente: "Vigente", proxima: "Vence pronto", vencida: "Vencido", sin_datos: "Sin datos",
};
const TONO: Record<EstadoTacografo, string> = {
  vigente: "text-emerald-300", proxima: "text-amber-300",
  vencida: "text-rose-300", sin_datos: "text-slate-400",
};
const FONDO: Record<EstadoTacografo, string> = {
  vigente: "border-emerald-500/30 bg-emerald-500/5",
  proxima: "border-amber-500/30 bg-amber-500/5",
  vencida: "border-rose-500/30 bg-rose-500/5",
  sin_datos: "border-slate-600 bg-slate-800/40",
};

const fecha = (iso?: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : String(iso);
};

/** Los días, dichos como los diría una persona. */
function plazo(f: FilaTacografo): string {
  if (f.diasRestantes == null) return "—";
  const d = f.diasRestantes;
  if (d < 0) return `${Math.abs(d)} día(s) de retraso`;
  if (d === 0) return "vence hoy";
  return `faltan ${d} día(s)`;
}

export default function ControlTacografos() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [base, setBase] = useState("");
  const [texto, setTexto] = useState("");
  const [estados, setEstados] = useState<EstadoTacografo[]>([]);
  const [venceAntesDe, setVenceAntesDe] = useState("");
  const [incluirBaja, setIncluirBaja] = useState(false);
  const [d, setD] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (e.length) setEmpresaId((a) => a || e[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true); setError("");
    try {
      setD(await controlTacografos({
        empresaId, base: base || null, texto: texto || null,
        estado: estados.length ? estados : null,
        venceAntesDe: venceAntesDe || null, incluirBaja,
      }));
    } catch (e: any) {
      setError(e.message); setD(null);
    } finally { setCargando(false); }
  }, [empresaId, base, texto, estados, venceAntesDe, incluirBaja]);

  useEffect(() => { void cargar(); }, [cargar]);

  const alternar = (e: EstadoTacografo) =>
    setEstados((a) => a.includes(e) ? a.filter((x) => x !== e) : [...a, e]);

  function exportar() {
    if (!d) return;
    const filas = [
      ["Matrícula", "Unidad", "Base", "Estado", "Última intervención", "Tipo",
       "Resultado", "Próxima revisión", "Días", "Intervenciones"],
      ...d.filas.map((f) => [
        f.matricula ?? "", f.numeroUnidad ?? "", f.base ?? "", ETIQUETA[f.estado],
        f.ultima ?? "", f.ultimoTipo ?? "", f.ultimoResultado ?? "",
        f.proxima ?? "", f.diasRestantes ?? "", f.intervenciones,
      ]),
    ];
    const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `control-tacografos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <div className="p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Gauge className="h-5 w-5" /> Control de tacógrafos
        </h1>
        {empresas.length > 1 && (
          <select
            value={empresaId}
            onChange={(e) => { setEmpresaId(e.target.value); setBase(""); }}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
            aria-label="Empresa"
          >
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        {d && (
          <span className="text-xs text-slate-400">
            cada {d.regla.meses} meses · aviso {d.regla.avisoDias} días antes
          </span>
        )}
        <button
          onClick={exportar}
          disabled={!d?.filas.length}
          className="ml-auto flex items-center gap-1 rounded-lg border border-sky-600 px-3 py-1.5
                     text-xs font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> Excel
        </button>
      </div>

      {/* El resumen es SIEMPRE de la flota entera. Pulsar filtra la lista. */}
      {d && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["vencida", "proxima", "vigente", "sin_datos"] as EstadoTacografo[]).map((e) => (
            <button
              key={e}
              onClick={() => alternar(e)}
              className={`rounded-xl border p-3 text-left transition
                ${FONDO[e]} ${estados.includes(e) ? "ring-2 ring-sky-500" : ""}`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {ETIQUETA[e]}
              </div>
              <div className={`text-2xl font-black tabular-nums ${TONO[e]}`}>
                {d.resumen[e].toLocaleString("es-ES")}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Base</span>
          <select value={base} onChange={(e) => setBase(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200">
            <option value="">Todas</option>
            {(d?.bases ?? []).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Matrícula o unidad</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="1234ABC"
              className="rounded-lg border border-slate-600 bg-slate-900 py-2 pl-7 pr-2 text-sm text-slate-200" />
          </div>
        </label>
        <label className="text-[11px] text-slate-400">
          <span className="mb-1 block">Vence antes de</span>
          <input type="date" value={venceAntesDe} onChange={(e) => setVenceAntesDe(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-200" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[12px] text-slate-300">
          <input type="checkbox" checked={incluirBaja} onChange={(e) => setIncluirBaja(e.target.checked)} />
          Incluir vehículos de baja
        </label>
        {(base || texto || estados.length > 0 || venceAntesDe || incluirBaja) && (
          <button
            onClick={() => { setBase(""); setTexto(""); setEstados([]); setVenceAntesDe(""); setIncluirBaja(false); }}
            className="rounded-lg border border-slate-600 px-3 py-2 text-[12px] text-slate-300 hover:bg-slate-700"
          >
            Quitar filtros
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

      {d && (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {d.mostrados === d.total
              ? `${d.total} vehículo(s)`
              : `${d.mostrados} de ${d.total} vehículo(s)`}
            {cargando && " · actualizando…"}
          </p>
          <TableWrap>
            <thead><tr>
              <th className={thCls}>Matrícula</th><th className={thCls}>Unidad</th>
              <th className={thCls}>Base</th><th className={thCls}>Estado</th>
              <th className={thCls}>Última</th><th className={thCls}>Tipo y resultado</th>
              <th className={thCls}>Próxima</th><th className={thCls}>Plazo</th>
              <th className={thCls}></th>
            </tr></thead>
            <tbody>
              {d.filas.map((f) => (
                <tr key={f.vehiculoId} className={f.activo ? "" : "opacity-60"}>
                  <td className={`${tdCls} font-bold`}>
                    {f.matricula ?? "—"}
                    {!f.activo && <span className="ml-1 text-[10px] text-slate-500">(baja)</span>}
                  </td>
                  <td className={`${tdCls} text-slate-400`}>{f.numeroUnidad ?? "—"}</td>
                  <td className={tdCls}>{f.base ?? "—"}</td>
                  <td className={`${tdCls} font-semibold ${TONO[f.estado]}`}>{ETIQUETA[f.estado]}</td>
                  <td className={tdCls}>{fecha(f.ultima)}</td>
                  <td className={`${tdCls} text-[11px] text-slate-400`}>
                    {f.ultimoTipo ?? "—"}
                    {f.ultimoResultado && f.ultimoResultado !== "-----" && <> · {f.ultimoResultado}</>}
                  </td>
                  <td className={tdCls}>{fecha(f.proxima)}</td>
                  <td className={`${tdCls} ${TONO[f.estado]}`}>{plazo(f)}</td>
                  <td className={tdCls}>
                    <button
                      onClick={() => navigate(`/tyrecontrol/vehiculos/${f.vehiculoId}`)}
                      className="rounded border border-slate-600 px-2 py-1 text-[11px] font-bold
                                 text-slate-200 hover:bg-slate-700"
                    >
                      Ficha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          {d.filas.length === 0 && (
            <p className="mt-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm text-slate-400">
              Ningún vehículo cumple esos filtros. Los contadores de arriba siguen siendo de la
              flota entera.
            </p>
          )}
        </>
      )}
    </div>
  );
}
