import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ETIQUETA_ESTADO, aniosConDatos } from "../ausenciasTecnicos";
import { loadScheduledTechStatusesFromBackend } from "../scheduledTechStatusApi";
import { loadAgendaConfig } from "../agendaConfigApi";
import { loadTechsFromBackend } from "../workshopApi";
import { esTecnicoDePrueba } from "../tecnicosDePrueba";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "../agendaConfig";
import { getTodayDateValue, type ScheduledTechStatus } from "../techStatusScheduleHelpers";
import { DEFAULT_WORKSHOP_ID, WORKSHOPS, normalizeWorkshopId } from "../workshops";
import {
  diasDelAnio,
  faltanPorDia,
  filaDeTecnico,
  picoDeAusencias,
  type CeldaDia,
  type EstadoDia,
} from "../planningAusencias";

/**
 * Planning anual de ausencias: todos los técnicos, día a día, por meses.
 *
 * Solo lectura. Lo que se ve es lo que hay en la agenda (franja «Todo el
 * día») y en el calendario del taller (Agenda → Configuración): festivos
 * nacionales, autonómicos y locales, sábados de agosto y jornadas especiales.
 * Para cambiar algo se va a la agenda; aquí se mira.
 */

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Inicial del día de la semana, de lunes a domingo (X para no repetir la M). */
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

/** A partir de cuántos técnicos fuera el día se pinta en rojo. */
const UMBRAL_ROJO = 3;

const COLOR: Record<EstadoDia, string> = {
  vacaciones: "bg-orange-500",
  baja: "bg-red-500",
  permiso: "bg-yellow-400",
  otro_taller: "bg-blue-500",
  nodisponible: "bg-violet-500",
};

function formatoFecha(fecha: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha;
}

export default function PlanningAusenciasPage() {
  const [estados, setEstados] = useState<ScheduledTechStatus[]>([]);
  const [tecnicos, setTecnicos] = useState<string[]>([]);
  const [configAgenda, setConfigAgenda] = useState<AgendaConfig>(DEFAULT_AGENDA_CONFIG);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [tip, setTip] = useState<{ x: number; y: number; texto: string } | null>(null);

  const [workshopId, setWorkshopId] = useState<string>(() => {
    const guardado = window.localStorage.getItem("sea-selected-workshop");
    return normalizeWorkshopId(guardado ?? DEFAULT_WORKSHOP_ID);
  });

  const hoy = getTodayDateValue();
  const [anio, setAnio] = useState<number>(() => Number(hoy.slice(0, 4)));
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [listaEstados, listaTecnicos, agenda] = await Promise.all([
        loadScheduledTechStatusesFromBackend(),
        loadTechsFromBackend().catch(() => []),
        loadAgendaConfig().catch(() => DEFAULT_AGENDA_CONFIG),
      ]);
      setEstados(listaEstados);
      setTecnicos(
        (listaTecnicos as { name?: string; activo?: boolean }[])
          .filter((t) => t?.name && t.activo !== false && !esTecnicoDePrueba(t.name))
          .map((t) => String(t.name))
      );
      setConfigAgenda(agenda);
    } catch (e: any) {
      setError(e?.message || "Error cargando el planning.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // Los estados de un taller no cuentan en el de otro, como en Ausencias.
  const estadosDelTaller = useMemo(
    () => estados.filter((e) => !e.workshopId || normalizeWorkshopId(e.workshopId) === workshopId),
    [estados, workshopId]
  );

  const anios = useMemo(() => aniosConDatos(estados, Number(hoy.slice(0, 4))), [estados, hoy]);
  const dias = useMemo(() => diasDelAnio(anio, configAgenda, hoy), [anio, configAgenda, hoy]);

  // Los que tuvieron ausencias este año aunque ya no estén en la lista.
  const nombres = useMemo(() => {
    const lista = [...tecnicos];
    for (const e of estadosDelTaller) {
      if (e.startDate?.startsWith(String(anio)) && !lista.includes(e.techName) && !esTecnicoDePrueba(e.techName)) {
        lista.push(e.techName);
      }
    }
    return lista;
  }, [tecnicos, estadosDelTaller, anio]);

  const filas = useMemo(
    () => nombres.map((n) => ({ nombre: n, celdas: filaDeTecnico(n, estadosDelTaller, dias, hoy) })),
    [nombres, estadosDelTaller, dias, hoy]
  );
  const faltan = useMemo(() => faltanPorDia(filas.map((f) => f.celdas), dias.length), [filas, dias.length]);
  const pico = useMemo(() => picoDeAusencias(faltan, dias), [faltan, dias]);
  const ausentesHoy = useMemo(
    () => filas.filter((f) => f.celdas.find((c) => c.fecha === hoy)?.estado).map((f) => f.nombre),
    [filas, hoy]
  );
  const diasRojos = useMemo(() => faltan.filter((n) => n >= UMBRAL_ROJO).length, [faltan]);

  // Al abrir, hoy en el centro: lo que interesa es lo que viene.
  useEffect(() => {
    if (cargando) return;
    const hoyEl = scrollRef.current?.querySelector<HTMLElement>("[data-hoy='1']");
    hoyEl?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [cargando, anio]);

  const colsPorMes = useMemo(() => {
    const n = new Array<number>(12).fill(0);
    for (const d of dias) n[d.mes]++;
    return n;
  }, [dias]);

  function celdaClase(c: CeldaDia, i: number) {
    const d = dias[i];
    const base = ["h-8 w-[16px] min-w-[16px] border-b border-slate-700"];
    if (d.dia === 1) base.push("border-l border-l-slate-600");
    if (c.estado) {
      base.push(COLOR[c.estado]);
      if (c.inicio) base.push("rounded-l");
      if (c.fin) base.push("rounded-r");
      if (c.programado) base.push("planning-rayado");
    } else if (d.cerrado) {
      base.push("bg-slate-500/30");
    } else if (d.finde) {
      base.push("bg-slate-500/10");
    }
    if (d.hoy) base.push("shadow-[inset_0_-3px_0_#22c55e]");
    return base.join(" ");
  }

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <style>{`.planning-rayado{background-image:repeating-linear-gradient(135deg,transparent 0 3px,rgba(255,255,255,.4) 3px 5px)}`}</style>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Planning anual de ausencias</h1>
          <p className="text-xs text-slate-400">
            Todos los técnicos del taller, día a día. Los datos son los de la agenda y su calendario. Hoy: {formatoFecha(hoy)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={workshopId}
            onChange={(e) => setWorkshopId(normalizeWorkshopId(e.target.value))}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
          >
            {WORKSHOPS.map((w) => <option key={w.id} value={w.id}>{w.shortName}</option>)}
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
            onClick={() => void cargar()}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
          >
            <RefreshCw className="h-4 w-4" /> Recargar
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {(Object.keys(COLOR) as EstadoDia[]).map((k) => (
          <span key={k} className="flex items-center gap-1"><i className={`inline-block h-2.5 w-3.5 rounded-sm ${COLOR[k]}`} />{ETIQUETA_ESTADO[k]}</span>
        ))}
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-slate-500/30" />Festivo / taller cerrado</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-slate-500/10 border border-slate-700" />Fin de semana</span>
        <span className="flex items-center gap-1"><i className="planning-rayado inline-block h-2.5 w-3.5 rounded-sm bg-orange-500" />Rayado: aún no ha llegado</span>
        <span className="flex items-center gap-1"><i className="inline-block h-[3px] w-3.5 bg-emerald-500" />Hoy</span>
      </div>

      {error && <div className="mb-3 rounded-lg border border-rose-500/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</div>}

      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-800">
        {cargando ? (
          <div className="p-6 text-sm text-slate-400">Cargando…</div>
        ) : (
          <table className="border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                <th rowSpan={3} className="sticky left-0 z-20 min-w-[170px] border-b border-r-2 border-slate-600 bg-slate-800 px-2 text-left text-xs font-semibold">Técnico</th>
                {MESES.map((m, i) => (
                  <th key={m} colSpan={colsPorMes[i]} className="border-b border-l-2 border-slate-600 px-1.5 pb-0.5 pt-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-300">{m}</th>
                ))}
              </tr>
              {/* Inicial del día de la semana encima del número: sin esto hay que
                  contar columnas para saber si un rango cae en laborables. */}
              <tr>
                {dias.map((d) => (
                  <th
                    key={d.fecha}
                    title={d.motivo ?? undefined}
                    className={[
                      "h-3.5 w-[16px] min-w-[16px] font-mono text-[9px] font-semibold",
                      d.dia === 1 ? "border-l border-l-slate-600" : "",
                      d.cerrado ? "bg-slate-500/30 text-slate-300" : d.finde ? "bg-slate-500/10 text-slate-500" : "text-slate-400",
                    ].join(" ")}
                  >
                    {DIAS_SEMANA[d.semana]}
                  </th>
                ))}
              </tr>
              <tr>
                {dias.map((d) => (
                  <th
                    key={d.fecha}
                    data-hoy={d.hoy ? "1" : undefined}
                    title={d.motivo ?? undefined}
                    className={[
                      "h-4 w-[16px] min-w-[16px] border-b border-slate-700 font-mono text-[9px] font-medium text-slate-500",
                      d.dia === 1 ? "border-l border-l-slate-600" : "",
                      d.cerrado ? "bg-slate-500/30 text-slate-200" : d.finde ? "bg-slate-500/10" : "",
                      d.hoy ? "shadow-[inset_0_-3px_0_#22c55e]" : "",
                    ].join(" ")}
                  >
                    {d.dia}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const vac = f.celdas.filter((c) => c.estado === "vacaciones" && !c.programado).length;
                const prog = f.celdas.filter((c) => c.estado === "vacaciones" && c.programado).length;
                return (
                  <tr key={f.nombre}>
                    <td className="sticky left-0 z-10 border-b border-r-2 border-slate-600 bg-slate-800 px-2">
                      <b className="block text-xs">{f.nombre}</b>
                      <span className="block font-mono text-[10px] text-slate-400">vac {vac} · prog {prog}</span>
                    </td>
                    {f.celdas.map((c, i) => (
                      <td
                        key={c.fecha}
                        className={celdaClase(c, i)}
                        onMouseEnter={(e) => {
                          const d = dias[i];
                          const partes = [f.nombre, formatoFecha(c.fecha)];
                          if (c.estado) partes.push(`${ETIQUETA_ESTADO[c.estado]} · ${c.rango}`);
                          if (d.motivo) partes.push(d.motivo);
                          if (!c.estado && !d.motivo) return;
                          setTip({ x: e.clientX, y: e.clientY, texto: partes.join(" · ") });
                        }}
                        onMouseLeave={() => setTip(null)}
                      />
                    ))}
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr><td colSpan={dias.length + 1} className="p-6 text-sm text-slate-400">No hay técnicos en este taller.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r-2 border-t border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300">Técnicos fuera</td>
                {faltan.map((n, i) => (
                  <td
                    key={dias[i].fecha}
                    className={[
                      "border-t border-slate-600 py-1 text-center font-mono text-[10px] font-semibold",
                      n >= UMBRAL_ROJO ? "text-red-400" : n === 2 ? "text-orange-300" : "text-slate-400",
                    ].join(" ")}
                  >
                    {n || ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Ausentes hoy</div>
          <div className="font-mono text-xl font-bold">{ausentesHoy.length} <span className="font-sans text-xs font-normal text-slate-400">{ausentesHoy.join(" · ")}</span></div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Pico de ausencias</div>
          <div className="font-mono text-xl font-bold">
            {pico ? pico.cuantos : 0}{" "}
            <span className="font-sans text-xs font-normal text-slate-400">
              {pico ? (pico.desde === pico.hasta ? formatoFecha(pico.desde) : `${formatoFecha(pico.desde)} → ${formatoFecha(pico.hasta)}`) : "—"}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Días con {UMBRAL_ROJO}+ fuera</div>
          <div className="font-mono text-xl font-bold">{diasRojos}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Días cerrados en {anio}</div>
          <div className="font-mono text-xl font-bold">{dias.filter((d) => d.cerrado).length} <span className="font-sans text-xs font-normal text-slate-400">festivos y sábados de agosto</span></div>
        </div>
      </div>

      <p className="mt-2 max-w-3xl text-xs text-slate-500">
        Solo lectura. Las ausencias se programan desde la franja «Todo el día» de la agenda; los festivos y los sábados cerrados, en Agenda → Configuración. Al pasar el ratón por un día se ve el técnico, el estado, el rango y el festivo.
      </p>

      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-100 shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          {tip.texto}
        </div>
      )}
    </div>
  );
}
