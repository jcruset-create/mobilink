import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, Save, Settings2 } from "lucide-react";
import {
  ESTADOS_CONTADOS,
  ETIQUETA_ESTADO,
  aniosConDatos,
  detectaSolapes,
  resumenPorTecnico,
  type ConfigVacaciones,
  type DetalleAusencia,
  type ModoVacaciones,
} from "../ausenciasTecnicos";
import { loadScheduledTechStatusesFromBackend } from "../scheduledTechStatusApi";
import { cargarConfigVacaciones, guardarConfigVacaciones } from "../vacacionesConfigApi";
import { loadAgendaConfig } from "../agendaConfigApi";
import { loadTechsFromBackend } from "../workshopApi";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "../agendaConfig";
import { getTodayDateValue, type ScheduledTechStatus } from "../techStatusScheduleHelpers";
import { DEFAULT_WORKSHOP_ID, WORKSHOPS, normalizeWorkshopId } from "../workshops";

/**
 * Ausencias y vacaciones por técnico.
 *
 * No inventa datos: cuenta los estados con fechas que ya se programan desde la
 * franja "Todo el día" de la agenda. Lo único nuevo es el cupo anual, que se
 * configura aquí.
 */

const MODOS: { valor: ModoVacaciones; etiqueta: string; ayuda: string }[] = [
  {
    valor: "naturales",
    etiqueta: "30 días naturales",
    ayuda: "Cuentan todos los días del rango, fines de semana y festivos incluidos.",
  },
  {
    valor: "laborables",
    etiqueta: "22 días laborables (L-V)",
    ayuda: "Solo de lunes a viernes, descontando los festivos del taller.",
  },
];

function formatoFecha(fecha: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha;
}

export default function AusenciasTecnicosPage() {
  const [estados, setEstados] = useState<ScheduledTechStatus[]>([]);
  const [tecnicos, setTecnicos] = useState<string[]>([]);
  const [configAgenda, setConfigAgenda] = useState<AgendaConfig>(DEFAULT_AGENDA_CONFIG);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [workshopId, setWorkshopId] = useState<string>(() => {
    const guardado = window.localStorage.getItem("sea-selected-workshop");
    return normalizeWorkshopId(guardado ?? DEFAULT_WORKSHOP_ID);
  });

  const hoy = getTodayDateValue();
  const [anio, setAnio] = useState(() => Number(hoy.slice(0, 4)));

  const [config, setConfig] = useState<ConfigVacaciones>({
    modo: "naturales",
    diasPorDefecto: 30,
    diasPorTecnico: {},
  });

  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");

    try {
      const [listaEstados, listaTecnicos, agenda, vacaciones] = await Promise.all([
        loadScheduledTechStatusesFromBackend(),
        loadTechsFromBackend().catch(() => []),
        loadAgendaConfig().catch(() => DEFAULT_AGENDA_CONFIG),
        cargarConfigVacaciones(anio, workshopId),
      ]);

      setEstados(listaEstados);

      // Los técnicos dados de baja no se listan, pero si tuvieron ausencias este
      // año el resumen los añade igualmente para no perder su histórico.
      setTecnicos(
        (listaTecnicos as { name?: string; activo?: boolean }[])
          .filter((t) => t?.name && t.activo !== false)
          .map((t) => String(t.name))
      );

      setConfigAgenda(agenda);
      setConfig({
        modo: vacaciones.modo,
        diasPorDefecto: vacaciones.diasPorDefecto,
        diasPorTecnico: vacaciones.diasPorTecnico ?? {},
      });
    } catch (e: any) {
      setError(e?.message || "Error cargando las ausencias.");
    } finally {
      setCargando(false);
    }
  }, [anio, workshopId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Los estados de un taller no cuentan en el resumen de otro, igual que en el
  // resto de la agenda. Los guardados sin taller se consideran del actual.
  const estadosDelTaller = useMemo(
    () =>
      estados.filter(
        (e) => !e.workshopId || normalizeWorkshopId(e.workshopId) === workshopId
      ),
    [estados, workshopId]
  );

  const resumenes = useMemo(
    () => resumenPorTecnico(estadosDelTaller, tecnicos, anio, config, configAgenda, hoy),
    [estadosDelTaller, tecnicos, anio, config, configAgenda, hoy]
  );

  const solapes = useMemo(() => detectaSolapes(resumenes), [resumenes]);
  const anios = useMemo(
    () => aniosConDatos(estados, Number(hoy.slice(0, 4))),
    [estados, hoy]
  );

  const totales = useMemo(() => {
    const acumulado: Record<string, number> = {};
    let disfrutadas = 0;
    let programadas = 0;

    for (const r of resumenes) {
      disfrutadas += r.vacacionesDisfrutadas;
      programadas += r.vacacionesProgramadas;

      for (const estado of ESTADOS_CONTADOS) {
        if (estado === "vacaciones") continue;
        acumulado[estado] = (acumulado[estado] ?? 0) + (r.porEstado[estado] ?? 0);
      }
    }

    return { disfrutadas, programadas, acumulado };
  }, [resumenes]);

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      await guardarConfigVacaciones({ ...config, anio, workshopId });
      setAjustesAbiertos(false);
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  }

  function exportarCsv() {
    const cabecera = [
      "Tecnico",
      "Cupo",
      "Vacaciones disfrutadas",
      "Vacaciones programadas",
      "Vacaciones pendientes",
      ...ESTADOS_CONTADOS.filter((e) => e !== "vacaciones").map((e) => ETIQUETA_ESTADO[e]),
    ];

    const filas = resumenes.map((r) => [
      r.techName,
      r.cupo,
      r.vacacionesDisfrutadas,
      r.vacacionesProgramadas,
      r.vacacionesPendientes,
      ...ESTADOS_CONTADOS.filter((e) => e !== "vacaciones").map((e) => r.porEstado[e] ?? 0),
    ]);

    const csv = [cabecera, ...filas]
      .map((fila) => fila.map((celda) => `"${String(celda).replace(/"/g, '""')}"`).join(";"))
      .join("\n");

    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    );

    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `ausencias-${workshopId}-${anio}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  const otrosEstados = ESTADOS_CONTADOS.filter((e) => e !== "vacaciones");

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Ausencias y vacaciones</h1>
            <p className="text-xs text-slate-400">
              Cuenta los estados programados de cada técnico desde la agenda. Hoy:{" "}
              {formatoFecha(hoy)}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={workshopId}
              onChange={(e) => setWorkshopId(normalizeWorkshopId(e.target.value))}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            >
              {WORKSHOPS.map((w) => (
                <option key={w.id} value={w.id}>{w.shortName}</option>
              ))}
            </select>

            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
            >
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>

            <button
              type="button"
              onClick={() => setAjustesAbiertos((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              <Settings2 className="h-4 w-4" /> Configuración
            </button>

            <button
              type="button"
              onClick={exportarCsv}
              className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              <Download className="h-4 w-4" /> CSV
            </button>

            <button
              type="button"
              onClick={() => void cargar()}
              className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" /> Recargar
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {ajustesAbiertos && (
          <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="mb-1 text-sm font-black uppercase tracking-wide text-slate-300">
              Cómputo de vacaciones · {anio}
            </h2>
            <p className="mb-3 text-xs text-slate-400">
              El modo afecta solo a las vacaciones. Baja, permiso y el resto de estados
              se cuentan siempre en días naturales.
            </p>

            <div className="grid gap-2 md:grid-cols-2">
              {MODOS.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      modo: m.valor,
                      diasPorDefecto: m.valor === "laborables" ? 22 : 30,
                    }))
                  }
                  className={`rounded-2xl border px-3 py-3 text-left text-sm ${
                    config.modo === m.valor
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-600 bg-slate-900 text-slate-300"
                  }`}
                >
                  <span className="block font-black">{m.etiqueta}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{m.ayuda}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Días por defecto
                </label>
                <input
                  type="number"
                  min={0}
                  max={366}
                  value={config.diasPorDefecto}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      diasPorDefecto: Number(e.target.value),
                    }))
                  }
                  className="w-28 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => void guardar()}
                disabled={guardando}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {guardando ? "Guardando…" : "Guardar configuración"}
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs text-slate-400">
                Cupo propio por técnico (vacío = hereda los {config.diasPorDefecto} días
                generales).
              </p>

              <div className="grid gap-2 md:grid-cols-3">
                {resumenes.map((r) => (
                  <label key={r.techName} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{r.techName}</span>
                    <input
                      type="number"
                      min={0}
                      max={366}
                      placeholder={String(config.diasPorDefecto)}
                      value={config.diasPorTecnico?.[r.techName] ?? ""}
                      onChange={(e) => {
                        const valor = e.target.value;

                        setConfig((prev) => {
                          const siguiente = { ...(prev.diasPorTecnico ?? {}) };

                          if (valor === "") delete siguiente[r.techName];
                          else siguiente[r.techName] = Number(valor);

                          return { ...prev, diasPorTecnico: siguiente };
                        });
                      }}
                      className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {solapes.length > 0 && (
          <div className="mb-4 rounded-2xl border border-amber-700/60 bg-amber-950/30 p-3 text-sm text-amber-200">
            <div className="flex items-center gap-2 font-black">
              <AlertTriangle className="h-4 w-4" />
              {solapes.length} solape{solapes.length === 1 ? "" : "s"} de fechas
            </div>
            <p className="mt-1 text-xs opacity-90">
              Estos técnicos tienen dos estados que se pisan. Los días compartidos se
              están contando dos veces: corrígelos desde la agenda.
            </p>
            <ul className="mt-2 space-y-0.5 text-xs">
              {solapes.slice(0, 8).map((s, i) => (
                <li key={`${s.techName}-${i}`}>
                  <b>{s.techName}</b>: {ETIQUETA_ESTADO[s.a.status] ?? s.a.status}{" "}
                  {formatoFecha(s.a.inicioEnAnio)}–{formatoFecha(s.a.finEnAnio)} ·{" "}
                  {ETIQUETA_ESTADO[s.b.status] ?? s.b.status}{" "}
                  {formatoFecha(s.b.inicioEnAnio)}–{formatoFecha(s.b.finEnAnio)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {cargando ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-800">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs uppercase text-slate-400">
                  <th className="px-3 py-2">Técnico</th>
                  <th className="px-3 py-2 text-right">Disfrutadas</th>
                  <th className="px-3 py-2 text-right">Programadas</th>
                  <th className="px-3 py-2 text-right">Pendientes</th>
                  <th className="px-3 py-2 text-right">Cupo</th>
                  {otrosEstados.map((e) => (
                    <th key={e} className="px-3 py-2 text-right">{ETIQUETA_ESTADO[e]}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {resumenes.map((r) => {
                  const abierto = expandido === r.techName;

                  return (
                    <FilaTecnico
                      key={r.techName}
                      abierto={abierto}
                      onToggle={() => setExpandido(abierto ? null : r.techName)}
                      techName={r.techName}
                      cupo={r.cupo}
                      disfrutadas={r.vacacionesDisfrutadas}
                      programadas={r.vacacionesProgramadas}
                      pendientes={r.vacacionesPendientes}
                      porEstado={r.porEstado}
                      otrosEstados={otrosEstados}
                      detalles={r.detalles}
                    />
                  );
                })}

                {resumenes.length === 0 && (
                  <tr>
                    <td colSpan={5 + otrosEstados.length} className="px-3 py-6 text-center text-slate-500">
                      No hay técnicos ni ausencias en {anio}.
                    </td>
                  </tr>
                )}
              </tbody>

              {resumenes.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-600 bg-slate-900/60 font-black">
                    <td className="px-3 py-2">Total taller</td>
                    <td className="px-3 py-2 text-right">{totales.disfrutadas}</td>
                    <td className="px-3 py-2 text-right">{totales.programadas}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    {otrosEstados.map((e) => (
                      <td key={e} className="px-3 py-2 text-right">
                        {totales.acumulado[e] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Disfrutadas: días ya pasados, hoy incluido. Programadas: días que aún no han
          llegado. Un rango a caballo de hoy se reparte entre las dos columnas.
          Pendientes = cupo − disfrutadas − programadas.
        </p>
      </div>
    </div>
  );
}

function FilaTecnico({
  techName,
  cupo,
  disfrutadas,
  programadas,
  pendientes,
  porEstado,
  otrosEstados,
  detalles,
  abierto,
  onToggle,
}: {
  techName: string;
  cupo: number;
  disfrutadas: number;
  programadas: number;
  pendientes: number;
  porEstado: Record<string, number>;
  otrosEstados: string[];
  detalles: DetalleAusencia[];
  abierto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-slate-700/60 hover:bg-slate-700/30"
      >
        <td className="px-3 py-2 font-semibold">{techName}</td>
        <td className="px-3 py-2 text-right tabular-nums">{disfrutadas}</td>
        <td className="px-3 py-2 text-right tabular-nums text-sky-300">{programadas}</td>
        <td
          className={`px-3 py-2 text-right font-black tabular-nums ${
            pendientes < 0 ? "text-rose-400" : "text-emerald-300"
          }`}
        >
          {pendientes}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-400">{cupo}</td>
        {otrosEstados.map((e) => (
          <td key={e} className="px-3 py-2 text-right tabular-nums">
            {porEstado[e] ?? 0}
          </td>
        ))}
      </tr>

      {abierto && (
        <tr className="border-b border-slate-700/60 bg-slate-900/50">
          <td colSpan={5 + otrosEstados.length} className="px-3 py-2">
            {detalles.length === 0 ? (
              <span className="text-xs text-slate-500">Sin ausencias este año.</span>
            ) : (
              <ul className="space-y-1 text-xs">
                {detalles.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-700 px-2 py-0.5 font-bold uppercase">
                      {ETIQUETA_ESTADO[d.status] ?? d.status}
                    </span>
                    <span>
                      {formatoFecha(d.inicioEnAnio)} → {formatoFecha(d.finEnAnio)}
                    </span>
                    <span className="text-slate-400">
                      {d.diasDisfrutados} disfrutados · {d.diasProgramados} programados
                    </span>
                    {d.notes && <span className="text-slate-500">· {d.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
