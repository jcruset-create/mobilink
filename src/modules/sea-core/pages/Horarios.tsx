import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Download, Pencil, Plus, RefreshCw } from "lucide-react";
import CoreLayout from "../layouts/CoreLayout";
import { useEsSuperadmin } from "../../esSuperadmin";
import { loadAgendaConfig } from "../../agendaConfigApi";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "../../agendaConfig";
import { getTodayDateValue } from "../../techStatusScheduleHelpers";
import { normalizarNombre } from "../../personasDeAusencias";
import {
  diasDeLaSemana,
  filaDeLaSemana,
  formatoHoras,
  formatoTramos,
  minutosDeTramos,
  personasEnTurnoPorDia,
  sumarDias,
  validarTurno,
  type CeldaDia,
  type FilaSemana,
  type Turno,
} from "../../horariosTurnos";
import { cargarSemana, claseDeTurno, guardarTurno, type DatosSemana } from "../../horariosApi";

/**
 * Horarios y turnos (Core, solo superadministrador).
 *
 * Dos pestañas: la semana de control, con quién trabaja cada día y en qué
 * turno, y el catálogo de turnos de la empresa. Qué le toca a cada uno lo
 * decide src/modules/horariosTurnos.ts; aquí solo se pinta.
 */

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_LETRA = ["L", "M", "X", "J", "V", "S", "D"];

const ESTADO_AUSENCIA: Record<string, { texto: string; clase: string }> = {
  baja: { texto: "Baja", clase: "bg-rose-500 text-white border-rose-500" },
  vacaciones: { texto: "Vacaciones", clase: "bg-orange-500 text-white border-orange-500" },
  permiso: { texto: "Permiso", clase: "bg-yellow-400 text-slate-900 border-yellow-400" },
  otro_taller: { texto: "Otro taller", clase: "bg-blue-500 text-white border-blue-500" },
  nodisponible: { texto: "No disponible", clase: "bg-violet-500 text-white border-violet-500" },
  formacion: { texto: "Formación", clase: "bg-sky-300 text-slate-900 border-sky-300" },
};

function fechaCorta(fecha: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}` : fecha;
}

function Celda({ c, turnos }: { c: CeldaDia; turnos: Turno[] }) {
  if (c.tipo === "cerrado") {
    return <div className="rounded-md bg-slate-500/20 px-1 py-1.5 text-center font-mono text-[10.5px] text-slate-400">cerrado</div>;
  }
  if (c.tipo === "libre") {
    return <div className="px-1 py-1.5 text-center font-mono text-[10.5px] text-slate-500">libre</div>;
  }
  if (c.tipo === "sin_horario") {
    return <div className="px-1 py-1.5 text-center font-mono text-[10.5px] text-slate-500">—</div>;
  }
  if (c.tipo === "ausencia") {
    const e = ESTADO_AUSENCIA[c.estado] ?? { texto: c.estado, clase: "bg-slate-600 text-white border-slate-600" };
    return <div className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold ${e.clase}`}>{e.texto}</div>;
  }
  return (
    <div className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold leading-tight ${claseDeTurno(c.turnoId, turnos)}`}>
      {c.nombre}
      <span className="block font-mono text-[10px] font-medium opacity-85">
        {formatoTramos(c.tramos)}
        {c.cruzaMedianoche && " (+1)"}
      </span>
    </div>
  );
}

export default function Horarios() {
  const esSuperadmin = useEsSuperadmin();
  const [pestana, setPestana] = useState<"semana" | "turnos">("semana");

  // ── Semana ────────────────────────────────────────────────────────────
  const hoy = getTodayDateValue();
  const [fecha, setFecha] = useState(hoy);
  const [datos, setDatos] = useState<DatosSemana | null>(null);
  const [config, setConfig] = useState<AgendaConfig>(DEFAULT_AGENDA_CONFIG);
  const [centro, setCentro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [semana, agenda] = await Promise.all([cargarSemana(fecha), loadAgendaConfig()]);
      setDatos(semana);
      setConfig(agenda);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar la semana.");
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    if (esSuperadmin) void cargar();
  }, [esSuperadmin, cargar]);

  const dias = useMemo(() => diasDeLaSemana(fecha), [fecha]);
  const centros = useMemo(
    () => [...new Set((datos?.empleados ?? []).map((e) => e.centro).filter(Boolean) as string[])].sort(),
    [datos]
  );

  // Las ausencias siguen por nombre en la agenda: el del técnico vinculado o,
  // si no es técnico, el nombre completo (igual que en Ausencias y Planning).
  const ausenciaDe = useMemo(() => {
    const porNombre = new Map<string, { estado: string; desde: string; hasta: string }[]>();
    for (const a of datos?.ausencias ?? []) {
      const k = normalizarNombre(a.nombre);
      porNombre.set(k, [...(porNombre.get(k) ?? []), a]);
    }
    const nombreEnAgenda = new Map<string, string>();
    for (const e of datos?.empleados ?? []) nombreEnAgenda.set(e.id, normalizarNombre(e.techName || e.nombre));
    return (employeeId: string, dia: string): string | null => {
      const lista = porNombre.get(nombreEnAgenda.get(employeeId) ?? "") ?? [];
      const hit = lista.find((a) => a.desde <= dia && a.hasta >= dia);
      return hit && hit.estado !== "disponible" ? hit.estado : null;
    };
  }, [datos]);

  const filas: FilaSemana[] = useMemo(() => {
    if (!datos) return [];
    return datos.empleados
      .filter((e) => !centro || e.centro === centro)
      .map((e) =>
        filaDeLaSemana({
          empleado: e,
          asignaciones: datos.asignaciones,
          turnos: datos.turnos,
          fecha,
          config,
          ausenciaDe,
        })
      );
  }, [datos, centro, fecha, config, ausenciaDe]);

  const enTurno = useMemo(() => personasEnTurnoPorDia(filas), [filas]);
  const totalMinutos = filas.reduce((t, f) => t + f.minutos, 0);

  function exportarCsv() {
    const cab = ["Empleado", "Centro", "Horario", ...dias.map((d) => `${DIAS_CORTOS[dias.indexOf(d)]} ${fechaCorta(d)}`), "Horas"];
    const texto = (c: CeldaDia) =>
      c.tipo === "turno" ? `${c.nombre} ${formatoTramos(c.tramos)}` : c.tipo === "ausencia" ? c.estado : c.tipo === "sin_horario" ? "sin horario" : c.tipo;
    const lineas = filas.map((f) => [f.nombre, f.centro ?? "", f.resumen, ...f.celdas.map(texto), formatoHoras(f.minutos)]);
    const csv = [cab, ...lineas].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `horarios-semana-${dias[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Turnos ────────────────────────────────────────────────────────────
  const [editando, setEditando] = useState<Partial<Turno> | null>(null);
  const [erroresTurno, setErroresTurno] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);

  function abrirNuevo() {
    setErroresTurno([]);
    setEditando({ nombre: "", tramos: [{ inicio: "", fin: "" }, { inicio: "", fin: "" }], dias: [1, 2, 3, 4, 5], activo: true, orden: (datos?.turnos.length ?? 0) + 1 });
  }
  function abrirEditar(t: Turno) {
    setErroresTurno([]);
    const tramos = [...t.tramos];
    while (tramos.length < 2) tramos.push({ inicio: "", fin: "" });
    setEditando({ ...t, tramos });
  }

  async function guardar() {
    if (!editando) return;
    const limpio: Partial<Turno> = {
      ...editando,
      nombre: String(editando.nombre ?? "").trim(),
      tramos: (editando.tramos ?? []).filter((x) => x.inicio || x.fin),
    };
    const errores = validarTurno(limpio);
    setErroresTurno(errores);
    if (errores.length) return;
    setGuardando(true);
    try {
      await guardarTurno(limpio);
      setEditando(null);
      await cargar();
    } catch (e: any) {
      setErroresTurno([e?.message || "No se pudo guardar el turno."]);
    } finally {
      setGuardando(false);
    }
  }

  if (esSuperadmin === false) {
    return (
      <CoreLayout>
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6 text-sm text-slate-300">
          Los horarios los gestiona el superadministrador. Tu usuario no lo es.
        </div>
      </CoreLayout>
    );
  }

  const btn = "flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700";
  const input = "rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <CoreLayout>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><CalendarDays className="h-5 w-5 text-sky-400" /> Horarios y turnos</h1>
          <p className="text-xs text-slate-400">
            Quién trabaja cada día y en qué turno. Las ausencias de la agenda pisan el turno; los días cerrados del taller salen vacíos.
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-600 bg-slate-800 p-0.5 text-sm">
          {(["semana", "turnos"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPestana(p)}
              className={`rounded-md px-3 py-1.5 font-semibold ${pestana === p ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-700"}`}
            >
              {p === "semana" ? "Semana" : "Turnos"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

      {pestana === "semana" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={centro} onChange={(e) => setCentro(e.target.value)} className={input}>
              <option value="">Todos los centros</option>
              {centros.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" className={btn} onClick={() => setFecha(sumarDias(fecha, -7) ?? fecha)}>← Semana anterior</button>
            <button type="button" className={btn} onClick={() => setFecha(hoy)}>Hoy</button>
            <button type="button" className={btn} onClick={() => setFecha(sumarDias(fecha, 7) ?? fecha)}>Semana siguiente →</button>
            <span className="font-mono text-xs text-slate-400">{fechaCorta(dias[0] ?? "")} → {fechaCorta(dias[6] ?? "")}</span>
            <button type="button" className={btn} onClick={() => void cargar()}><RefreshCw className="h-4 w-4" /> Recargar</button>
            <button type="button" className={btn} onClick={exportarCsv} disabled={filas.length === 0}><Download className="h-4 w-4" /> CSV</button>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-sky-400 align-[-2px]" />Taller (agenda)</span>
            {(datos?.turnos ?? []).filter((t) => t.activo).map((t) => (
              <span key={t.id}><i className={`mr-1 inline-block h-3 w-3 rounded-sm border align-[-2px] ${claseDeTurno(t.id, datos?.turnos ?? [])}`} />{t.nombre}</span>
            ))}
            <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-rose-500 align-[-2px]" />Baja</span>
            <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-orange-500 align-[-2px]" />Vacaciones</span>
            <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-slate-500/40 align-[-2px]" />Taller cerrado</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-800">
            <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="border-b border-slate-700 px-3 py-2">Empleado</th>
                  {dias.map((d, i) => (
                    <th key={d} className={`border-b border-slate-700 px-2 py-2 ${d === hoy ? "text-sky-300" : ""}`}>
                      {DIAS_CORTOS[i]} <span className="block font-mono text-xs normal-case tracking-normal text-slate-200">{fechaCorta(d)}</span>
                    </th>
                  ))}
                  <th className="border-b border-slate-700 px-2 py-2 text-right">Horas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.employeeId} className="align-top">
                    <td className="whitespace-nowrap border-b border-slate-700 px-3 py-1.5">
                      <Link to={`/core/empleados/${f.employeeId}`} className="font-bold text-slate-100 hover:text-sky-300">{f.nombre}</Link>
                      <span className="block font-mono text-[10.5px] text-slate-400">
                        {f.centro ?? "sin centro"} · {f.resumen === "sin horario" ? <u>sin horario</u> : f.resumen}
                      </span>
                    </td>
                    {f.celdas.map((c, i) => (
                      <td key={i} className="border-b border-slate-700 px-1.5 py-1.5"><Celda c={c} turnos={datos?.turnos ?? []} /></td>
                    ))}
                    <td className="border-b border-slate-700 px-2 py-1.5 text-right font-mono text-xs">{f.minutos ? formatoHoras(f.minutos) : "—"}</td>
                  </tr>
                ))}
                {!cargando && filas.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">No hay empleados activos en este centro.</td></tr>
                )}
                {cargando && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">Cargando…</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="font-mono text-[11px] text-slate-400">
                  <td className="px-3 py-2">Personas en turno</td>
                  {enTurno.map((n, i) => <td key={i} className="px-2 py-2">{n}</td>)}
                  <td className="px-2 py-2 text-right">{formatoHoras(totalMinutos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            El horario de cada persona se asigna desde su ficha (Empleados → pestaña «Horario»). Quien no tiene ninguno sale como «sin horario»; no se le inventa.
          </p>
        </>
      )}

      {pestana === "turnos" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Se definen una vez. Un turno tiene uno o dos tramos; si acaba antes de empezar, acaba al día siguiente.</p>
            <button type="button" onClick={abrirNuevo} className="flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white hover:bg-sky-500"><Plus className="h-4 w-4" /> Nuevo turno</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-700 border-l-4 border-l-sky-400 bg-slate-900/60 p-3">
              <b className="text-sm">Horario del taller</b>
              <div className="my-1 font-mono text-[13px] font-semibold">Según la agenda</div>
              <div className="text-[11px] text-slate-400">Mañana y tarde por día, sábados y jornadas especiales de Agenda → Configuración. Es el que tiene quien trabaja «como el taller».</div>
            </div>
            {(datos?.turnos ?? []).map((t) => (
              <div key={t.id} className={`rounded-xl border border-slate-700 bg-slate-900/60 p-3 ${t.activo ? "" : "opacity-50"}`}>
                <span className={`inline-block rounded-md border px-2 py-0.5 text-sm font-bold ${claseDeTurno(t.id, datos?.turnos ?? [])}`}>
                  {t.nombre}{!t.activo && " · desactivado"}
                </span>
                <div className="mt-2 font-mono text-[13px] font-semibold text-slate-100">{formatoTramos(t.tramos)}{t.tramos.some((x) => x.fin <= x.inicio) && <span className="text-slate-400"> (+1)</span>}</div>
                <div className="text-[11px] text-slate-400">
                  {formatoHoras(minutosDeTramos(t.tramos))}/día · {(t.dias.length ? t.dias : [1, 2, 3, 4, 5]).map((d) => DIAS_LETRA[d - 1]).join("")}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" onClick={() => abrirEditar(t)} className="flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700"><Pencil className="h-3 w-3" /> Editar</button>
                  <button type="button" onClick={() => void guardarTurno({ ...t, activo: !t.activo }).then(cargar)} className="rounded-md border border-slate-600 px-2 py-1 text-[11px] font-semibold hover:bg-slate-700">
                    {t.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editando && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-5 text-slate-100">
                <h3 className="text-lg font-bold">{editando.id ? "Editar turno" : "Nuevo turno"}</h3>
                {erroresTurno.length > 0 && (
                  <ul className="mt-2 list-disc rounded-lg border border-rose-500/40 bg-rose-500/10 px-6 py-2 text-xs text-rose-300">
                    {erroresTurno.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )}
                <label className="mt-3 block text-xs font-medium text-slate-300">Nombre
                  <input id="turno-nombre" value={editando.nombre ?? ""} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} placeholder="Mañana, Tarde, Noche…" className={`mt-1 w-full ${input}`} />
                </label>
                {[0, 1].map((i) => (
                  <div key={i} className="mt-3 grid grid-cols-2 gap-2">
                    <label className="block text-xs font-medium text-slate-300">{i === 0 ? "Tramo 1 · entrada" : "Tramo 2 · entrada (opcional)"}
                      <input id={`turno-t${i}-inicio`} type="time" value={editando.tramos?.[i]?.inicio ?? ""} onChange={(e) => { const tr = [...(editando.tramos ?? [])]; tr[i] = { ...tr[i], inicio: e.target.value }; setEditando({ ...editando, tramos: tr }); }} className={`mt-1 w-full ${input}`} />
                    </label>
                    <label className="block text-xs font-medium text-slate-300">Salida
                      <input id={`turno-t${i}-fin`} type="time" value={editando.tramos?.[i]?.fin ?? ""} onChange={(e) => { const tr = [...(editando.tramos ?? [])]; tr[i] = { ...tr[i], fin: e.target.value }; setEditando({ ...editando, tramos: tr }); }} className={`mt-1 w-full ${input}`} />
                    </label>
                  </div>
                ))}
                <div className="mt-3 text-xs font-medium text-slate-300">Días que se trabaja</div>
                <div className="mt-1 flex gap-1">
                  {DIAS_LETRA.map((l, i) => {
                    const d = i + 1;
                    const on = (editando.dias ?? []).includes(d);
                    return (
                      <button key={l} type="button" onClick={() => setEditando({ ...editando, dias: on ? (editando.dias ?? []).filter((x) => x !== d) : [...(editando.dias ?? []), d].sort() })}
                        className={`h-8 w-8 rounded-md border text-xs font-bold ${on ? "border-sky-500 bg-sky-600 text-white" : "border-slate-600 text-slate-400"}`}>{l}</button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Los festivos y días cerrados del taller mandan igualmente.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={() => setEditando(null)} className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold">Cancelar</button>
                  <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar turno"}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </CoreLayout>
  );
}
